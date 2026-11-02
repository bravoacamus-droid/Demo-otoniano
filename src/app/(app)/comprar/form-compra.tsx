"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, Camera, CheckCircle2, FileText, PackageCheck, Plus, Share2, Trash2, Wallet } from "lucide-react";
import { BotonImprimir80 } from "@/components/ticket/boton-imprimir-80";
import { SelectorProveedor } from "@/components/selector-proveedor";
import { SelectorProducto, partesRuta, precioSugerido } from "@/components/selector-producto";
import { Campo, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { Aviso, Insignia, Tarjeta } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { cx } from "@/components/ui/clases";
import { aCentimos, aGramos, centimosASoles, gramosAKg, importeCentimos, normalizar } from "@/lib/montos";
import { soles } from "@/lib/formato";
import { subirArchivo } from "@/lib/archivos";
import type { Caja, MedioPagoConf, Producto, Proveedor } from "@/lib/tipos";
import { registrarCompra, saldoAFavor, type CompraRegistrada } from "../compras/acciones";
import { FormaPago, errorPlan, type PlanCredito } from "@/components/plan-credito";

interface Linea {
  uid: string;
  metal_id: string;
  bruto: string;
  /** Merma al pesar (kg): material sucio que se descuenta en el momento; se paga el neto */
  merma: string;
  precio: string;
  /** El operario digitó el precio: ya no se cambia solo al elegir otro proveedor */
  precioManual: boolean;
}

/** Lleva al peso bruto de una línea (scroll suave y foco) */
function irAPeso(uid: string) {
  const input = document.getElementById(`bruto-${uid}`);
  input?.scrollIntoView({ block: "center", behavior: "smooth" });
  input?.focus({ preventScroll: true });
}

/** Referencias por producto: costo promedio del stock y precio promedio pagado (últimos 90 días) */
export interface PrecioRef { costo_promedio: number | null; compra_promedio: number | null }

export function FormCompra({
  empresaId, productos, proveedores, medios, cajas, puedeEditarPrecio, montoDocObligatorio, referencias, verCostos,
}: {
  empresaId: string;
  productos: Producto[];
  proveedores: Proveedor[];
  medios: MedioPagoConf[];
  cajas: Caja[];
  puedeEditarPrecio: boolean;
  montoDocObligatorio: number | null;
  referencias: Record<string, PrecioRef>;
  verCostos: boolean;
}) {
  const medioInicial = medios.find((m) => m.tipo === "efectivo") ?? medios[0] ?? null;
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [saldo, setSaldo] = useState(0);
  const [aplicarSaldo, setAplicarSaldo] = useState(true);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [medioId, setMedioId] = useState(medioInicial?.id ?? "");
  const [cajaId, setCajaId] = useState(() => medioInicial?.caja_id ?? cajas.find((c) => c.tipo === "efectivo")?.id ?? cajas[0]?.id ?? "");
  const [notas, setNotas] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState<CompraRegistrada | null>(null);
  // null = al contado; con plan, a crédito (en cuotas si se eligen varias)
  const [plan, setPlan] = useState<PlanCredito | null>(null);
  // A crédito sin inicial no se mueve dinero ahora: no se piden medio ni caja (la RPC usa la caja por defecto)
  const sinDineroAhora = !!plan && aCentimos(plan.inicial || "0") === 0;
  const router = useRouter();

  const [resaltada, setResaltada] = useState<string | null>(null);
  const enfocar = useRef<string | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reloj.current), []);
  // Con teclado (Enter en la lista de productos) se salta al peso de la línea nueva; al tocar no, para seguir eligiendo
  useEffect(() => {
    if (!enfocar.current) return;
    irAPeso(enfocar.current);
    enfocar.current = null;
  }, [lineas.length]);

  const porId = useMemo(() => new Map(productos.map((m) => [m.id, m])), [productos]);
  const agregados = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineas) m.set(l.metal_id, (m.get(l.metal_id) ?? 0) + 1);
    return m;
  }, [lineas]);
  const clase = proveedor?.clase ?? "minorista";

  // Vista previa en vivo (enteros); el importe oficial lo calcula la base de datos
  const calculo = lineas.map((l) => {
    const bruto = aGramos(l.bruto);
    const merma = Math.min(aGramos(l.merma), bruto);
    const neto = bruto - merma;
    return { bruto, merma, neto, importe: importeCentimos(neto, aCentimos(l.precio)) };
  });
  const totalCent = calculo.reduce((s, c) => s + c.importe, 0);
  const sinPeso = lineas.filter((_, i) => calculo[i].bruto <= 0);
  const totalKg = calculo.reduce((s, c) => s + c.neto, 0);
  const saldoCent = Math.round(saldo * 100);
  const aplicadoCent = aplicarSaldo && proveedor ? Math.min(saldoCent, totalCent) : 0;
  const precioPromCent = totalKg > 0 ? Math.round((totalCent * 1000) / totalKg) : 0;
  const requiereDoc = montoDocObligatorio !== null && totalCent >= montoDocObligatorio * 100
    && (!proveedor || proveedor.tipo_doc === "SIN_DOC");

  function elegirProveedor(p: Proveedor | null) {
    setProveedor(p);
    if (!p) setPlan(null); // sin proveedor no hay a quién deberle
    // El precio sugerido depende del tipo de proveedor (al mayorista se le paga su precio)
    setLineas((ls) => ls.map((l) => l.precioManual ? l : { ...l, precio: precioSugerido(porId.get(l.metal_id)!, p?.clase) }));
    setSaldo(0);
    // Saldo a favor del proveedor (descuentos de la versión anterior de la selección en almacén)
    if (p) saldoAFavor(p.id).then(setSaldo);
  }
  function agregar(p: Producto, desdeTeclado?: boolean) {
    const uid = crypto.randomUUID();
    setLineas((ls) => [...ls, { uid, metal_id: p.id, bruto: "", merma: "", precio: precioSugerido(p, clase), precioManual: false }]);
    if (desdeTeclado) enfocar.current = uid;
    setResaltada(uid);
    clearTimeout(reloj.current);
    reloj.current = setTimeout(() => setResaltada(null), 1200);
  }
  function cambiar(uid: string, campo: "bruto" | "merma" | "precio", valor: string) {
    setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, [campo]: valor, precioManual: l.precioManual || campo === "precio" } : l)));
  }
  function elegirMedio(m: MedioPagoConf) {
    setMedioId(m.id);
    if (m.caja_id && cajas.some((c) => c.id === m.caja_id)) setCajaId(m.caja_id);
  }

  async function guardar() {
    setError(null);
    if (lineas.length === 0) return setError("Agregue al menos un producto.");
    if (calculo.some((c) => c.bruto <= 0)) return setError("Ingrese el peso bruto de cada producto.");
    if (calculo.some((c) => c.neto <= 0)) return setError("La merma debe ser menor al peso bruto.");
    if (requiereDoc) return setError(`Para compras desde S/ ${montoDocObligatorio} se requiere el DNI o RUC del proveedor.`);
    if (plan && !proveedor) return setError("Para comprar a crédito elija al proveedor.");
    const errCredito = plan ? errorPlan(plan, totalCent - aplicadoCent) : null;
    if (errCredito) return setError(errCredito);
    setGuardando(true);
    try {
      const rutaFoto = foto ? await subirArchivo(empresaId, "tickets", foto) : null;
      const r = await registrarCompra({
        clave,
        proveedor_id: proveedor?.id ?? null,
        caja_id: cajaId,
        medio_id: medioId || null,
        notas: notas.trim() || null,
        foto_ticket_url: rutaFoto,
        aplicar_saldo: aplicarSaldo && saldo > 0,
        credito: plan ? { ...plan, inicial: normalizar(plan.inicial) || "0" } : null,
        items: lineas.map((l) => ({
          metal_id: l.metal_id, peso_bruto_kg: normalizar(l.bruto), descuento_kg: normalizar(l.merma) || "0", precio_kg: normalizar(l.precio),
        })),
      });
      if (!r.ok) setError(r.error);
      else {
        setHecho(r.data);
        router.refresh(); // en segundo plano: stock, caja y listas al día
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  function nueva() {
    setClave(crypto.randomUUID());
    setProveedor(null);
    setSaldo(0);
    setLineas([]);
    setNotas("");
    setFoto(null);
    setHecho(null);
    setAplicarSaldo(true);
    setPlan(null);
    if (medioInicial) elegirMedio(medioInicial);
    window.scrollTo({ top: 0 });
  }

  if (hecho) return <CompraHecha compra={hecho} onNueva={nueva} />;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Nueva compra</h1>
        <Link href="/compras" className="text-sm text-marca-700 hover:underline">Ver compras</Link>
      </div>

      <Tarjeta className="p-4">
        <p className="mb-2 text-sm font-medium text-stone-700">¿Quién vende?</p>
        <SelectorProveedor valor={proveedor} onCambio={elegirProveedor} proveedores={proveedores} />
        {!proveedor && <p className="mt-1.5 text-xs text-stone-500">Sin elegir, se registra como «Sin documento» con el precio minorista.</p>}
        {proveedor?.clase === "mayorista" && <p className="mt-1.5 text-xs text-sky-700">Mayorista: se sugiere el precio de compra mayorista de cada producto.</p>}
        {proveedor && saldo > 0 && (
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <input type="checkbox" checked={aplicarSaldo} onChange={(e) => setAplicarSaldo(e.target.checked)} className="mt-0.5 size-4 accent-emerald-600" />
            <span>
              <b className="font-semibold">Tiene {soles(saldo)} a favor</b> por descuentos de compras anteriores.
              <span className="block text-xs text-emerald-800">Descontarlo de este pago (se paga menos en caja).</span>
            </span>
          </label>
        )}
      </Tarjeta>

      <Tarjeta className="p-4">
        <p className="mb-2 text-sm font-medium text-stone-700">¿Qué productos trae?</p>
        <SelectorProducto productos={productos} onElegir={agregar} agregados={agregados}
          precio={(p) => `${soles(precioSugerido(p, clase))}/kg`} />
        {sinPeso.length > 0 && (
          <button type="button" onClick={() => irAPeso(sinPeso[0].uid)}
            className="mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-marca-200 bg-marca-50 px-3 text-sm text-marca-800 hover:bg-marca-100">
            <span>
              <b className="font-semibold">{lineas.length} producto{lineas.length === 1 ? "" : "s"} agregado{lineas.length === 1 ? "" : "s"}</b>
              {" · "}{sinPeso.length === 1 ? "falta 1 peso" : `faltan ${sinPeso.length} pesos`}
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium">Ingresar pesos <ArrowDown className="size-4" /></span>
          </button>
        )}
      </Tarjeta>

      {lineas.map((l, i) => {
        const m = porId.get(l.metal_id)!;
        const c = calculo[i];
        const ref = referencias[l.metal_id];
        const sugerido = precioSugerido(m, clase);
        const ruta = partesRuta(m.ruta);
        return (
          <Tarjeta key={l.uid} id={`linea-${l.uid}`}
            className={cx("scroll-mt-4 border-l-4 p-4 transition-shadow", resaltada === l.uid && "ring-2 ring-marca-400")}
            style={{ borderLeftColor: m.color ?? "var(--color-stone-300)" }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="cifra flex size-7 shrink-0 items-center justify-center rounded-md bg-marca-50 text-xs font-semibold text-marca-700">{i + 1}</span>
                <div className="min-w-0">
                  {ruta.familia && <p className="truncate text-[11px] font-medium uppercase tracking-wide text-stone-500">{ruta.familia}</p>}
                  <p className="truncate text-base font-semibold text-stone-900">
                    {m.tiene_hijos ? `${m.nombre} · sin clasificar` : ruta.nombre}
                  </p>
                </div>
                {c.bruto <= 0 && <Insignia tono="ambar">Falta peso</Insignia>}
              </div>
              <button
                type="button"
                onClick={() => setLineas((ls) => ls.filter((x) => x.uid !== l.uid))}
                className="rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Quitar línea"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Campo etiqueta="Peso bruto (kg)">
                <InputNumero id={`bruto-${l.uid}`} value={l.bruto} onChange={(e) => cambiar(l.uid, "bruto", e.target.value)} placeholder="0.000" />
              </Campo>
              <Campo etiqueta="Merma kg (opcional)">
                <InputNumero value={l.merma} onChange={(e) => cambiar(l.uid, "merma", e.target.value)} placeholder="0.000" />
              </Campo>
              <Campo etiqueta="Precio S/ por kg">
                <InputNumero
                  value={l.precio}
                  onChange={(e) => cambiar(l.uid, "precio", e.target.value)}
                  readOnly={!puedeEditarPrecio}
                  className={cx(!puedeEditarPrecio && "bg-stone-100")}
                />
              </Campo>
              <div className="rounded-lg bg-stone-50 px-3 py-2 text-right">
                <p className="text-xs text-stone-500">{gramosAKg(c.neto)} kg neto</p>
                <p className="cifra text-lg font-semibold">S/ {centimosASoles(c.importe)}</p>
              </div>
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
              <span>
                Precio del día ({clase}): <b className="cifra font-medium text-stone-700">{soles(sugerido)}/kg</b>
                {l.precioManual && aCentimos(l.precio) !== aCentimos(sugerido) && (
                  <button type="button" className="ml-1 font-medium text-marca-700 hover:underline"
                    onClick={() => setLineas((ls) => ls.map((x) => x.uid === l.uid ? { ...x, precio: sugerido, precioManual: false } : x))}>
                    usar
                  </button>
                )}
              </span>
              {c.merma > 0 && <span className="text-amber-700">Se descuentan {gramosAKg(c.merma)} kg de merma</span>}
              {verCostos && ref?.costo_promedio != null && <span>Costo promedio en stock: <b className="cifra font-medium text-stone-700">{soles(ref.costo_promedio)}/kg</b></span>}
              {ref?.compra_promedio != null && <span>Compra promedio (90 días): <b className="cifra font-medium text-stone-700">{soles(ref.compra_promedio)}/kg</b></span>}
            </p>
          </Tarjeta>
        );
      })}

      {lineas.length > 0 && (
        <Tarjeta className="space-y-4 p-4">
          <FormaPago plan={plan} onCambio={setPlan} totalCent={totalCent - aplicadoCent} tipo="compra"
            deshabilitarCredito={proveedor ? null : "Elija al proveedor para comprarle a crédito"} />
          {sinDineroAhora ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">No sale dinero de caja ahora. Cada cuota se paga desde Caja y finanzas → Créditos.</p>
          ) : (
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">{plan ? "Medio de pago de la inicial" : "Medio de pago"}</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {medios.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => elegirMedio(m)}
                  className={cx(
                    "truncate rounded-lg border px-1 py-2 text-xs font-medium sm:text-sm",
                    medioId === m.id ? "border-marca-600 bg-marca-50 text-marca-700" : "border-stone-200 bg-superficie text-stone-700",
                  )}
                >
                  {m.nombre}
                </button>
              ))}
            </div>
          </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {!sinDineroAhora && (
              <Campo etiqueta={plan ? "Sale de la caja (inicial)" : "Sale de la caja"}>
                <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                  {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </Select>
              </Campo>
            )}
            <Campo etiqueta="Foto (opcional)">
              <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-superficie px-3 text-sm text-stone-600">
                <Camera className="size-4 shrink-0" />
                <span className="truncate">{foto ? foto.name : "Tomar o elegir foto"}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
                />
              </label>
            </Campo>
          </div>
          <Campo etiqueta="Nota (opcional)">
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Campo>
          <p className="flex items-start gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <PackageCheck className="mt-px size-4 shrink-0 text-stone-400" />
            <span>
              Después pasa por <b>Limpieza</b>: se vuelve a pesar y se registra la merma real y el material de otra clase.
              Emitido el ticket, el peso y el precio solo los corrige Gerencia o Administración.
            </span>
          </p>
        </Tarjeta>
      )}

      {error && <Aviso tono="rojo">{error}</Aviso>}
      {requiereDoc && !error && (
        <Aviso>Para compras desde S/ {montoDocObligatorio} se requiere el DNI o RUC del proveedor.</Aviso>
      )}

      {/* Total fijo abajo, siempre visible */}
      <div className="sticky bottom-20 z-10 md:bottom-4">
        <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-superficie p-3 shadow-lg">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-stone-500">
              {gramosAKg(totalKg)} kg neto · {lineas.length} línea(s)
              {precioPromCent > 0 && <> · prom. S/ {centimosASoles(precioPromCent)}/kg</>}
            </p>
            <p className="cifra truncate text-[clamp(1.25rem,6vw,1.5rem)] font-bold">S/ {centimosASoles(totalCent - aplicadoCent)}</p>
            {aplicadoCent > 0 && (
              <p className="cifra text-xs text-emerald-700">Total S/ {centimosASoles(totalCent)} − saldo a favor S/ {centimosASoles(aplicadoCent)}</p>
            )}
            {plan && (
              <p className="line-clamp-2 text-xs font-medium text-marca-700">
                A crédito · {plan.cuotas === 1 ? "pago único" : `${plan.cuotas} cuotas`}
                {aCentimos(plan.inicial || "0") > 0 && ` · inicial S/ ${centimosASoles(aCentimos(plan.inicial))}`}
              </p>
            )}
          </div>
          <Boton tamano="lg" onClick={guardar} disabled={guardando || lineas.length === 0} className="shrink-0 px-4 text-base sm:px-6 sm:text-lg">
            {guardando ? "Guardando…" : <><span className="sm:hidden">{plan ? "Guardar" : "Pagar"}</span><span className="hidden sm:inline">{plan ? "Guardar a crédito" : "Pagar y guardar"}</span></>}
          </Boton>
        </div>
      </div>
    </div>
  );
}

function CompraHecha({ compra, onNueva }: { compra: CompraRegistrada; onNueva: () => void }) {
  const urlTicket = `/compras/${compra.id}/ticket`;
  const aplicado = Number(compra.saldo_aplicado ?? 0);

  async function compartir() {
    const texto = `Compra N° ${compra.numero} · Total ${soles(compra.total)}`;
    try {
      const blob = await fetch(urlTicket).then((r) => r.blob());
      const archivo = new File([blob], `compra-${compra.numero}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: `Compra N° ${compra.numero}`, text: texto });
        return;
      }
    } catch {
      /* cae al enlace de WhatsApp */
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
  }

  return (
    <div className="mx-auto max-w-md py-6 text-center">
      <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
      <h1 className="mt-3 text-xl font-semibold">Compra N° {compra.numero} registrada</h1>
      <p className="cifra mt-1 text-3xl font-bold">{soles(compra.total)}</p>
      {aplicado > 0 && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-emerald-700">
          <Wallet className="size-4" /> Se descontó {soles(aplicado)} a favor · pagado {soles(Number(compra.total) - aplicado)}
        </p>
      )}
      {compra.credito_id ? (
        <p className="mt-1 text-sm text-stone-500">
          Quedó <b className="font-medium text-stone-700">a crédito</b> y se sumó al stock. Las cuotas se pagan desde{" "}
          <Link href={`/creditos/${compra.credito_id}`} className="font-medium text-marca-700 hover:underline">Créditos</Link>. Queda pendiente de limpieza.
        </p>
      ) : (
        <p className="mt-1 text-sm text-stone-500">Se descontó de caja y se sumó al stock. Queda pendiente de limpieza.</p>
      )}
      {/* 80 mm para la impresora térmica del mostrador; PDF y Compartir: el A4 con la marca */}
      <div className="mt-6 grid grid-cols-3 gap-2">
        <BotonImprimir80 href={`/imprimir/compra/${compra.id}`} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-superficie font-medium" />
        <a href={urlTicket} target="_blank" className="flex h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-superficie font-medium">
          <FileText className="size-4" /> PDF
        </a>
        <button onClick={compartir} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-superficie font-medium">
          <Share2 className="size-4" /> Compartir
        </button>
      </div>
      <Boton tamano="lg" className="mt-3 w-full" onClick={onNueva}>
        <Plus className="size-5" /> Nueva compra
      </Boton>
      <Link href={`/compras/${compra.id}`} className="mt-3 inline-block text-sm text-marca-700 hover:underline">Ver detalle</Link>
    </div>
  );
}

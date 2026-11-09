"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Trash2 } from "lucide-react";
import { Campo, Input, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { Aviso, Tarjeta } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import { SelectorCliente } from "@/components/selector-cliente";
import { SelectorProducto, partesRuta } from "@/components/selector-producto";
import { Boton } from "@/components/ui/boton";
import { aCentimos, aGramos, centimosASoles, gramosAKg, importeCentimos, normalizar } from "@/lib/montos";
import { kg, soles } from "@/lib/formato";
import { subirArchivo } from "@/lib/archivos";
import type { Caja, Comprador, MedioPagoConf, Producto } from "@/lib/tipos";
import { COMPROBANTES, TIPOS_COMPROBANTE, comprobanteSugerido, type TipoComprobante } from "@/lib/comprobantes";
import { registrarVenta } from "../ventas/acciones";
import { FormaPago, errorPlan, type PlanCredito } from "@/components/plan-credito";

export interface MetalConStock {
  metal_id: string;
  nombre: string;
  /** Ubicación en la jerarquía: «Cobre › Cable › Quemado» */
  ruta: string;
  nivel: number;
  color: string | null;
  kg: string;
  costo_promedio: string | null;
  precio_venta: string;
  /** Precio promedio al que se vendió en los últimos 90 días */
  venta_promedio: number | null;
}

interface Linea {
  uid: string;
  metal_id: string;
  salida: string;
  recibido: string;
  precio: string;
}

export function FormVenta({
  empresaId, metales, productos, compradores, cajas, medios, verCostos, siguientes,
}: {
  empresaId: string; metales: MetalConStock[];
  /** Árbol de productos con stock (en el producto o en sus variantes), para el selector */
  productos: Producto[];
  compradores: Comprador[]; cajas: Caja[]; medios: MedioPagoConf[]; verCostos: boolean;
  /** Siguiente N° de cada tipo de comprobante (lo asigna la BD al guardar; aquí solo se muestra) */
  siguientes: Partial<Record<TipoComprobante, string>>;
}) {
  const router = useRouter();
  const [clave] = useState(() => crypto.randomUUID());
  const [compradorId, setCompradorId] = useState("");
  const comprador = compradores.find((c) => c.id === compradorId) ?? null;
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [confirmarYa, setConfirmarYa] = useState(false);
  const medioInicial = medios.find((m) => m.tipo === "transferencia") ?? medios[0] ?? null;
  const [medioId, setMedioId] = useState(medioInicial?.id ?? "");
  const [cajaId, setCajaId] = useState(() => medioInicial?.caja_id ?? cajas.find((c) => c.tipo === "banco")?.id ?? cajas[0]?.id ?? "");
  // Comprobante: se sugiere según el cliente (RUC → factura) hasta que se elija a mano
  const [tipoElegido, setTipoElegido] = useState<TipoComprobante | null>(null);
  const tipoCp = tipoElegido ?? comprobanteSugerido(comprador?.ruc);
  // Cobro al contado (null) o a crédito: se decide al confirmar el pesaje del comprador
  const [plan, setPlan] = useState<PlanCredito | null>(null);
  const sinDineroAhora = !!plan && aCentimos(plan.inicial || "0") === 0;
  const [guiaNumero, setGuiaNumero] = useState("");
  const [guia, setGuia] = useState<File | null>(null);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const metal = (id: string) => metales.find((m) => m.metal_id === id)!;
  const conStock = useMemo(() => new Map(metales.map((m) => [m.metal_id, m])), [metales]);
  // Cada producto sale en una sola línea: lo agregado se marca y al tocarlo de nuevo se va a su línea
  const agregados = useMemo(() => new Map(lineas.map((l) => [l.metal_id, 1])), [lineas]);
  const [resaltada, setResaltada] = useState<string | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reloj.current), []);

  function resaltar(metalId: string) {
    setResaltada(metalId);
    clearTimeout(reloj.current);
    reloj.current = setTimeout(() => setResaltada(null), 1200);
  }
  // Con teclado (Enter en la lista de productos) se salta al peso de salida; al tocar no, para seguir eligiendo
  const enfocar = useRef<string | null>(null);
  useEffect(() => {
    if (!enfocar.current) return;
    irASalida(enfocar.current);
    enfocar.current = null;
  }, [lineas.length]);
  function irASalida(metalId: string) {
    const el = document.getElementById(`salida-${metalId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }
  const bloqueado = useCallback((p: Producto) => (conStock.has(p.id) ? null : "Sin stock"), [conStock]);

  function agregar(p: Producto, desdeTeclado?: boolean) {
    const m = conStock.get(p.id);
    if (!m) return false;
    resaltar(p.id);
    if (agregados.has(p.id)) {
      if (desdeTeclado) irASalida(p.id);
      else document.getElementById(`linea-${p.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return false;
    }
    if (desdeTeclado) enfocar.current = p.id;
    setLineas((ls) => [...ls, { uid: crypto.randomUUID(), metal_id: p.id, salida: "", recibido: "", precio: m.precio_venta }]);
  }
  function elegirMedio(id: string) {
    setMedioId(id);
    const caja = medios.find((m) => m.id === id)?.caja_id;
    if (caja && cajas.some((c) => c.id === caja)) setCajaId(caja);
  }
  function cambiar(uid: string, campo: keyof Linea, v: string) {
    setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, [campo]: v } : l)));
  }

  const totalSalida = lineas.reduce((s, l) => s + aGramos(l.salida), 0);
  const totalImporte = lineas.reduce((s, l) => s + importeCentimos(aGramos(l.recibido), aCentimos(l.precio)), 0);
  const totalRecibido = lineas.reduce((s, l) => s + aGramos(l.recibido), 0);
  const ventaPromCent = totalRecibido > 0 ? Math.round((totalImporte * 1000) / totalRecibido) : 0;

  async function guardar() {
    setError(null);
    if (!compradorId) return setError("Elija el comprador.");
    if (lineas.length === 0) return setError("Agregue al menos un producto.");
    if (tipoCp === "factura" && !comprador?.ruc) return setError("Para emitir factura el cliente debe tener RUC. Elija boleta o registre su RUC.");
    const errCredito = confirmarYa && plan ? errorPlan(plan, totalImporte) : null;
    if (errCredito) return setError(errCredito);
    for (const l of lineas) {
      const m = metal(l.metal_id);
      if (aGramos(l.salida) <= 0) return setError(`Ingrese el peso de salida de ${m.nombre}.`);
      if (aGramos(l.salida) > aGramos(m.kg)) return setError(`No hay suficiente ${m.nombre}: disponible ${kg(m.kg)}.`);
      if (confirmarYa && (!normalizar(l.recibido) || !normalizar(l.precio))) {
        return setError(`Ingrese el peso recibido y el precio de ${m.nombre}.`);
      }
      if (confirmarYa && aGramos(l.recibido) > Math.round(aGramos(l.salida) * 1.02)) {
        return setError(`El peso recibido de ${m.nombre} es mayor a lo que salió. Revise el dato.`);
      }
    }
    setGuardando(true);
    try {
      const rutaGuia = guia ? await subirArchivo(empresaId, "guias", guia) : null;
      const r = await registrarVenta({
        clave,
        comprador_id: compradorId,
        items: lineas.map((l) => ({
          metal_id: l.metal_id,
          peso_salida_kg: normalizar(l.salida),
          ...(confirmarYa ? { peso_recibido_kg: normalizar(l.recibido), precio_kg: normalizar(l.precio) } : {}),
        })),
        guia_numero: guiaNumero.trim() || null,
        guia_url: rutaGuia,
        notas: notas.trim() || null,
        caja_id: confirmarYa ? cajaId : null,
        medio_id: confirmarYa ? medioId || null : null,
        comprobante_url: null,
        comprobante_tipo: tipoCp,
        comprobante_numero: null,
        credito: confirmarYa && plan ? { ...plan, inicial: normalizar(plan.inicial) || "0" } : null,
      });
      if (!r.ok) {
        setError(r.error);
        setGuardando(false);
      } else {
        router.push(`/ventas/${r.data.id}`);
        router.refresh(); // limpia las listas en memoria (ventas, stock, caja) sin esperar

      }
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Nueva venta</h1>

      <Tarjeta className="grid gap-3 p-4 sm:grid-cols-2">
        {/* div y no <label>: dentro de un label, tocar la lista vuelve a enfocar el campo */}
        <div className="min-w-0 sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-stone-700">Comprador</p>
          <SelectorCliente valor={comprador} onCambio={(c) => { setCompradorId(c?.id ?? ""); setTipoElegido(null); }} clientes={compradores} />
        </div>
        <div className="min-w-0 sm:col-span-2">
          <p id="etiqueta-comprobante" className="mb-1 text-sm font-medium text-stone-700">Comprobante</p>
          {/* En celular uno debajo de otro (la ayuda no se corta); desde sm, en 3 columnas. Flechas ←/→ como radio */}
          <div role="radiogroup" aria-labelledby="etiqueta-comprobante" className="grid gap-2 sm:grid-cols-3"
            onKeyDown={(e) => {
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
              e.preventDefault();
              const posibles = TIPOS_COMPROBANTE.filter((t) => t !== "factura" || !comprador || !!comprador.ruc);
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
              const sig = posibles[(posibles.indexOf(tipoCp) + d + posibles.length) % posibles.length];
              setTipoElegido(sig);
              document.getElementById(`comprobante-${sig}`)?.focus();
            }}>
            {TIPOS_COMPROBANTE.map((t) => {
              const sinRuc = t === "factura" && !!comprador && !comprador.ruc;
              const activo = tipoCp === t;
              return (
                <button key={t} id={`comprobante-${t}`} type="button" role="radio" aria-checked={activo} disabled={sinRuc}
                  tabIndex={activo ? 0 : -1} onClick={() => setTipoElegido(t)}
                  className={cx(
                    "flex min-h-12 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500 disabled:cursor-not-allowed sm:block",
                    activo ? "border-marca-600 bg-marca-50 ring-1 ring-marca-600"
                      : sinRuc ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-superficie hover:border-marca-300",
                  )}>
                  <span className={cx("block text-sm font-semibold leading-tight", activo ? "text-marca-700" : sinRuc ? "text-stone-400" : "text-stone-900")}>
                    {COMPROBANTES[t].texto}
                  </span>
                  <span className={cx("block text-right text-xs leading-tight sm:mt-0.5 sm:text-left", sinRuc ? "text-stone-600" : "text-stone-500")}>
                    {sinRuc ? "Sin RUC: registre su RUC para facturar" : COMPROBANTES[t].ayuda}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {/* Correlativo: lo pone el sistema al guardar (siguiente de la serie); no se escribe a mano */}
        <Campo etiqueta={`N° de ${COMPROBANTES[tipoCp].corto.toLowerCase()} que se emite`}>
          <p className="flex h-[42px] items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3">
            <span className="cifra font-semibold text-stone-900">{siguientes[tipoCp] ?? "—"}</span>
            <span className="text-xs text-stone-500">automático</span>
          </p>
        </Campo>
        <Campo etiqueta="N° de guía de remisión (opcional)">
          <Input value={guiaNumero} onChange={(e) => setGuiaNumero(e.target.value)} placeholder="T001-000123" />
        </Campo>
        <Campo etiqueta="Foto o PDF de la guía (opcional)" className="sm:col-span-2">
          <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-superficie px-3 text-sm text-stone-600">
            <FileUp className="size-4 shrink-0" />
            <span className="truncate">{guia ? guia.name : "Adjuntar archivo"}</span>
            <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => setGuia(e.target.files?.[0] ?? null)} />
          </label>
        </Campo>
      </Tarjeta>

      <Tarjeta className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-stone-700">Productos que salen (peso de nuestra balanza)</p>
        </div>
        <div className="mb-4">
          <SelectorProducto productos={productos} onElegir={agregar} agregados={agregados}
            bloqueado={bloqueado}
            precio={(p) => `${soles(p.precio_venta)}/kg`}
            extra={(p) => conStock.has(p.id) ? <span className="text-stone-500">Disponible {kg(conStock.get(p.id)!.kg)}</span> : null} />
        </div>

        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmarYa} onChange={(e) => setConfirmarYa(e.target.checked)} className="size-4 accent-marca-600" />
          Ya tengo el pesaje y el precio del comprador (confirmar ahora)
        </label>

        {lineas.length === 0 && <p className="py-6 text-center text-sm text-stone-500">Agregue los productos que salen. Solo se puede vender lo que hay en stock.</p>}
        <div className="space-y-3">
          {lineas.map((l, i) => {
            const m = metal(l.metal_id);
            const merma = aGramos(l.salida) - aGramos(l.recibido);
            const costo = m.costo_promedio ? aCentimos(String(m.costo_promedio)) : 0;
            const margen = importeCentimos(aGramos(l.recibido), aCentimos(l.precio)) - importeCentimos(aGramos(l.recibido), costo);
            return (
              <div key={l.uid} id={`linea-${l.metal_id}`}
                className={cx("scroll-mt-4 rounded-xl border border-l-4 border-stone-200 p-3 transition-shadow", resaltada === l.metal_id && "ring-2 ring-marca-400")}
                style={{ borderLeftColor: m.color ?? "var(--color-stone-300)" }}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="cifra flex size-7 shrink-0 items-center justify-center rounded-md bg-marca-50 text-xs font-semibold text-marca-700">{i + 1}</span>
                    <span className="min-w-0">
                      {partesRuta(m.ruta).familia && <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-stone-500">{partesRuta(m.ruta).familia}</span>}
                      <span className="block truncate font-semibold text-stone-900">{partesRuta(m.ruta).nombre}</span>
                    </span>
                  </span>
                  <span className={`flex shrink-0 items-center gap-2 text-xs ${aGramos(l.salida) > aGramos(m.kg) ? "font-semibold text-red-700" : "text-stone-500"}`}>
                    Disponible {kg(m.kg)}
                    <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.uid !== l.uid))} className="rounded p-1 hover:bg-red-50 hover:text-red-600" aria-label="Quitar">
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Campo etiqueta="Salida (kg)">
                    <InputNumero id={`salida-${l.metal_id}`} value={l.salida} onChange={(e) => cambiar(l.uid, "salida", e.target.value)} placeholder="0.00" />
                  </Campo>
                  {confirmarYa && (
                    <>
                      <Campo etiqueta="Recibido (kg)">
                        <InputNumero value={l.recibido} onChange={(e) => cambiar(l.uid, "recibido", e.target.value)} placeholder="0.00" />
                      </Campo>
                      <Campo etiqueta="Precio S/ por kg">
                        <InputNumero value={l.precio} onChange={(e) => cambiar(l.uid, "precio", e.target.value)} />
                      </Campo>
                      <div className="rounded-lg bg-stone-50 px-3 py-2 text-right">
                        <p className="text-xs text-stone-500">Merma {gramosAKg(Math.max(merma, 0))} kg</p>
                        <p className="cifra font-semibold">S/ {centimosASoles(importeCentimos(aGramos(l.recibido), aCentimos(l.precio)))}</p>
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
                  {verCostos && m.costo_promedio && <span>Costo promedio: <b className="cifra font-medium text-stone-700">{soles(m.costo_promedio)}/kg</b></span>}
                  {m.venta_promedio != null && <span>Venta promedio (90 días): <b className="cifra font-medium text-stone-700">{soles(m.venta_promedio)}/kg</b></span>}
                  <span>Precio del día: <b className="cifra font-medium text-stone-700">{soles(m.precio_venta)}/kg</b></span>
                  {verCostos && confirmarYa && aGramos(l.recibido) > 0 && costo > 0 && (
                    <span className={margen < 0 ? "font-medium text-red-700" : "font-medium text-emerald-700"}>Margen estimado S/ {centimosASoles(margen)}</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </Tarjeta>

      {confirmarYa && (
        <Tarjeta className="space-y-3 p-4">
          <FormaPago plan={plan} onCambio={setPlan} totalCent={totalImporte} tipo="venta" />
          {sinDineroAhora ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">No entra dinero a caja ahora. Cada cuota se cobra desde Caja y finanzas → Créditos.</p>
          ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta={plan ? "Medio de cobro de la inicial" : "Medio de cobro"}>
            <Select value={medioId} onChange={(e) => elegirMedio(e.target.value)}>
              {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </Select>
          </Campo>
            <Campo etiqueta={plan ? "Entra a la caja (inicial)" : "Entra a la caja"}>
            <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Campo>
          </div>
          )}
        </Tarjeta>
      )}

      <Tarjeta className="p-4">
        <Campo etiqueta="Notas (opcional)">
          <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Campo>
      </Tarjeta>

      {error && <Aviso tono="rojo">{error}</Aviso>}

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-superficie p-3 shadow-lg">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-stone-500">Salida {gramosAKg(totalSalida)} kg{confirmarYa && ventaPromCent > 0 && <> · venta prom. S/ {centimosASoles(ventaPromCent)}/kg</>}</p>
            <p className="cifra truncate text-[clamp(1.125rem,5.5vw,1.25rem)] font-bold">{confirmarYa ? `S/ ${centimosASoles(totalImporte)}` : "Pendiente de pesaje"}</p>
            {confirmarYa && plan && <p className="line-clamp-2 text-xs font-medium text-marca-700">A crédito · {plan.cuotas === 1 ? "pago único" : `${plan.cuotas} cuotas`}</p>}
          </div>
          <Boton tamano="lg" onClick={guardar} disabled={guardando || lineas.length === 0} className="shrink-0 px-4 text-base sm:px-6 sm:text-lg">
            {guardando ? "Guardando…" : !confirmarYa ? "Registrar salida" : <><span className="sm:hidden">{plan ? "Registrar" : "Cobrar"}</span><span className="hidden sm:inline">{plan ? "Registrar a crédito" : "Registrar y cobrar"}</span></>}
          </Boton>
        </div>
      </div>

    </div>
  );
}

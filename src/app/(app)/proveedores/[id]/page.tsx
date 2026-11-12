import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone } from "lucide-react";
import { obtenerContexto } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { ETIQUETA_CLASE, fecha, fechaHora, kg, soles } from "@/lib/formato";
import { Dato, Encabezado, Insignia, Kpi, PuntoMetal, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { Pestanas } from "@/components/ui/pestanas";
import { TablaDatos } from "@/components/ui/tabla";
import type { Proveedor } from "@/lib/tipos";
import { EditarProveedor } from "../nuevo-proveedor";
import { anularAdelanto } from "../acciones";
import { BotonAdelanto } from "./adelanto";
import { BotonAnular } from "@/components/boton-anular";
import { cargarMediosPago } from "@/lib/productos";

/** Movimiento de la cuenta del proveedor: lo que queda a favor de la empresa y lo que se le descuenta */
type MovCuenta = { id: string; fecha: string; concepto: string; aFavor: number; descontado: number; anulado: boolean; adelantoId?: string; nota?: string | null; motivo?: string | null };

type PorMetal = {
  metal_id: string; metal: string; color: string | null; kg: number; importe: number; precio_promedio: number | null;
  n_compras?: number; n_ventas?: number; merma_kg?: number;
};

export const metadata: Metadata = { title: "Proveedor" };

export default async function ProveedorDetalle({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const pestana = tab === "compras" || tab === "metales" || tab === "adelantos" ? tab : "resumen";
  const ctx = await obtenerContexto();
  const { supabase, rol } = ctx;
  const [{ data: p }, { data: compras }, { data: metales }, { data: cuenta }, { data: adelantos }, { data: selecciones }, { data: devoluciones }, medios] = await Promise.all([
    supabase.from("v_proveedores_resumen").select("*").eq("id", id).maybeSingle(),
    supabase.from("v_compras").select("*").eq("proveedor_id", id).order("fecha", { ascending: false }).limit(100),
    supabase.rpc("proveedor_por_metal", { p_proveedor: id }),
    supabase.from("v_saldo_proveedor").select("saldo, adelantos").eq("proveedor_id", id).maybeSingle(),
    supabase.from("adelantos_proveedor").select("id, fecha, monto, nota, estado, motivo_anulacion").eq("proveedor_id", id).order("fecha", { ascending: false }).limit(200),
    supabase.from("v_selecciones").select("id, fecha, importe, numero, compra_numero").eq("proveedor_id", id).eq("estado", "registrada").eq("cobrar", true).limit(200),
    supabase.from("devoluciones_proveedor").select("id, fecha, monto, nota").eq("proveedor_id", id).eq("estado", "registrada").limit(200),
    cargarMediosPago(ctx),
  ]);
  if (!p) notFound();
  const porMetal = (metales ?? []) as PorMetal[];
  const maxImporte = Math.max(...porMetal.map((m) => Number(m.importe)), 1);
  const saldo = Number(cuenta?.saldo ?? 0);
  const puedeAdelantar = puede(rol, "adelantos");

  // Cuenta del proveedor: adelantos y descuentos de limpieza (a favor) contra lo descontado en compras y lo devuelto
  const movimientos: MovCuenta[] = [
    ...(adelantos ?? []).map((a) => ({ id: `a-${a.id}`, fecha: a.fecha, concepto: "Adelanto", aFavor: Number(a.monto), descontado: 0,
      anulado: a.estado === "anulada", adelantoId: a.id, nota: a.nota, motivo: a.motivo_anulacion })),
    ...(compras ?? []).filter((c) => c.estado !== "anulada" && Number(c.saldo_aplicado) > 0).map((c) => ({
      id: `c-${c.id}`, fecha: c.fecha!, concepto: `Descontado en compra N° ${c.numero}`, aFavor: 0, descontado: Number(c.saldo_aplicado), anulado: false })),
    ...(selecciones ?? []).map((x) => ({ id: `s-${x.id}`, fecha: x.fecha!, concepto: `Descuento de limpieza N° ${x.numero} (compra N° ${x.compra_numero})`,
      aFavor: Number(x.importe), descontado: 0, anulado: false })),
    ...(devoluciones ?? []).map((d) => ({ id: `d-${d.id}`, fecha: d.fecha, concepto: "Devolvió en efectivo", aFavor: 0, descontado: Number(d.monto), anulado: false, nota: d.nota })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const nAdelantos = (adelantos ?? []).filter((a) => a.estado !== "anulada").length;

  const tablaCuenta = (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi titulo="Saldo a favor (pendiente)" valor={soles(saldo)} tono={saldo > 0 ? "aviso" : undefined} detalle={saldo > 0 ? "Se descuenta en su próxima compra" : "No debe nada"} />
        <Kpi titulo="Adelantos dados" valor={soles(cuenta?.adelantos ?? 0)} detalle={`${nAdelantos} adelanto${nAdelantos === 1 ? "" : "s"}`} />
        <Kpi titulo="Descontado en compras" valor={soles((compras ?? []).filter((c) => c.estado !== "anulada").reduce((t, c) => t + Number(c.saldo_aplicado ?? 0), 0))} />
      </div>
      <Tarjeta>
        <TituloTarjeta>Cuenta del proveedor: adelantos y descuentos</TituloTarjeta>
        <TablaDatos
          filas={movimientos}
          clave={(m) => m.id}
          vacio="Sin adelantos ni descuentos."
          columnas={[
            { titulo: "Fecha", celda: (m) => fechaHora(m.fecha) },
            {
              titulo: "Concepto", principal: true, completo: true,
              celda: (m) => (
                <span className="block leading-tight">
                  <span className={m.anulado ? "text-stone-500 line-through" : "font-medium"}>{m.concepto}</span>
                  {m.anulado && <span className="ml-1.5"><Insignia tono="rojo">Anulado</Insignia></span>}
                  {m.nota && <span className="block text-xs text-stone-500">{m.nota}</span>}
                  {m.anulado && m.motivo && <span className="block text-xs text-red-700">Motivo: {m.motivo}</span>}
                </span>
              ),
            },
            { titulo: "A favor", alinear: "der", celda: (m) => m.aFavor ? <span className={m.anulado ? "cifra text-stone-500 line-through" : "cifra font-medium"}>{soles(m.aFavor)}</span> : "" },
            { titulo: "Descontado", alinear: "der", celda: (m) => m.descontado ? <span className="cifra">− {soles(m.descontado)}</span> : "" },
            {
              titulo: "", alinear: "der",
              celda: (m) => m.adelantoId && !m.anulado && puede(rol, "anular") ? (
                <BotonAnular id={m.adelantoId} accion={anularAdelanto} titulo="Anular adelanto" etiqueta="Anular" chico
                  explicacion="El dinero vuelve a la caja. Solo se puede si aún no se descontó en compras." />
              ) : null,
            },
          ]}
        />
      </Tarjeta>
    </>
  );

  const historial = (
    <Tarjeta>
      <TituloTarjeta>Historial de compras</TituloTarjeta>
      <TablaDatos
        filas={compras ?? []}
        clave={(c) => c.id}
        enlace={(c) => `/compras/${c.id}`}
        vacio="Aún no hay compras."
        columnas={[
          { titulo: "N°", principal: true, celda: (c) => `#${c.numero}` },
          { titulo: "Fecha", celda: (c) => fechaHora(c.fecha) },
          { titulo: "Productos", celda: (c) => c.metales },
          { titulo: "Kg", alinear: "der", celda: (c) => <span className="cifra">{kg(c.kg_total)}</span> },
          { titulo: "Total", alinear: "der", principal: true, celda: (c) => <span className={c.estado === "anulada" ? "cifra text-stone-500 line-through" : "cifra"}>{soles(c.total)}</span> },
        ]}
      />
    </Tarjeta>
  );

  const tablaMetales = (
    <Tarjeta>
      <TituloTarjeta>Lo que nos vende, por producto</TituloTarjeta>
      <ul className="divide-y divide-stone-100">
        {porMetal.map((m) => (
          <li key={m.metal_id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium"><PuntoMetal color={m.color} /> {m.metal}</span>
              <span className="cifra font-semibold">{soles(m.importe)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100">
              <div className="barra-crece h-full rounded-full" style={{ width: `${(Number(m.importe) / maxImporte) * 100}%`, background: m.color ?? "#a8a29e" }} />
            </div>
            <p className="mt-1 text-xs tabular-nums text-stone-500">
              {kg(m.kg)} · {m.n_compras} compras · promedio {soles(m.precio_promedio)}/kg
            </p>
          </li>
        ))}
        {porMetal.length === 0 && <li className="px-4 py-6 text-center text-sm text-stone-500">Aún no hay compras.</li>}
      </ul>
    </Tarjeta>
  );

  return (
    <>
      <Link href="/proveedores" className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ArrowLeft className="size-4" /> Proveedores
      </Link>
      <Encabezado
        titulo={p.nombre}
        descripcion={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{p.nro_doc ? `${p.tipo_doc} ${p.nro_doc}` : "Sin documento"}</span>
            {p.telefono && (
              <a href={`tel:${p.telefono}`} className="inline-flex items-center gap-1 text-marca-700 hover:underline">
                <Phone className="size-3.5" /> {p.telefono}
              </a>
            )}
            <Insignia tono={p.clase === "mayorista" ? "azul" : "gris"}>{ETIQUETA_CLASE[p.clase] ?? "Minorista"}</Insignia>
            {!p.activo && <Insignia>Inactivo</Insignia>}
          </span>
        }
        acciones={<>
          {puedeAdelantar && p.activo && <BotonAdelanto proveedor={{ id, nombre: p.nombre! }} saldo={saldo} medios={medios} />}
          {puede(rol, "editarTerceros") && <EditarProveedor proveedor={p as Proveedor} puedeDesactivar={puede(rol, "editarTerceros")} />}
        </>}
      />

      <Pestanas
        base={`/proveedores/${id}`}
        actual={pestana}
        opciones={[
          { valor: "resumen", texto: "Resumen" },
          { valor: "compras", texto: "Compras", cantidad: p.n_compras },
          { valor: "metales", texto: "Por producto", cantidad: porMetal.length },
          { valor: "adelantos", texto: "Adelantos y saldo", cantidad: movimientos.length },
        ]}
      />

      {pestana === "resumen" && (
        <>
          {saldo > 0 && (
            <Link href={`/proveedores/${id}?tab=adelantos`} className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-marca-200 bg-marca-50 px-4 py-3 text-sm text-marca-900 hover:bg-marca-100">
              <span>Tiene <b className="cifra">{soles(saldo)}</b> a favor (adelantos o descuentos): se descuenta en su próxima compra.</span>
              <span className="shrink-0 font-medium text-marca-700">Ver cuenta</span>
            </Link>
          )}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Compras" valor={p.n_compras} />
            <Kpi titulo="Kilos que nos vendió" valor={kg(p.kg_total)} />
            <Kpi titulo="Total pagado" valor={soles(p.importe_total)} />
            <Kpi titulo="Última compra" valor={fecha(p.ultima_compra)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta className="p-4">
              <dl className="grid grid-cols-2 gap-3">
                <Dato etiqueta="Documento">{p.nro_doc ? `${p.tipo_doc} ${p.nro_doc}` : "—"}</Dato>
                <Dato etiqueta="Teléfono">{p.telefono ?? "—"}</Dato>
                <Dato etiqueta="Dirección">{p.direccion ?? "—"}</Dato>
                <Dato etiqueta="Registrado">{fecha(p.creado_en)}</Dato>
                <Dato etiqueta="Estado">{p.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia>Inactivo</Insignia>}</Dato>
              </dl>
            </Tarjeta>
            {tablaMetales}
          </div>
        </>
      )}
      {pestana === "compras" && historial}
      {pestana === "metales" && tablaMetales}
      {pestana === "adelantos" && tablaCuenta}
    </>
  );
}

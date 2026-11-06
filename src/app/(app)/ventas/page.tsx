import type { Metadata } from "next";
import Link from "next/link";
import { PencilLine, Plus } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { fechaHora, kg, soles } from "@/lib/formato";
import { Encabezado, Insignia, Tarjeta, type Tono } from "@/components/ui/basicos";
import { BotonLink } from "@/components/ui/boton";
import { TablaDatos } from "@/components/ui/tabla";
import { Filtros, rangoLima } from "@/components/filtros";
import { ResumenVentas } from "@/components/resumen-modulo";
import { TituloSeccion } from "@/components/panel-modulo";
import { COMPROBANTES, TIPOS_COMPROBANTE, type TipoComprobante } from "@/lib/comprobantes";
import { CreditoLinea } from "@/components/avance-credito";

export const metadata: Metadata = { title: "Ventas" };

const ESTADO: Record<string, [string, Tono]> = {
  pendiente: ["Pendiente de pesaje", "ambar"],
  confirmada: ["Confirmada", "verde"],
  anulada: ["Anulada", "rojo"],
};

type Params = { desde?: string; hasta?: string; estado?: string; comprador?: string; metal?: string; comprobante?: string };

export default async function VentasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await exigir("verTodo", "vender");
  const { supabase, empresa, rol } = ctx;
  const { desde, hasta } = rangoLima(sp.desde, sp.hasta);

  let q = supabase.from("v_ventas").select("*").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).order("numero", { ascending: false }).limit(200);
  if (desde) q = q.gte("fecha", desde);
  if (hasta) q = q.lt("fecha", hasta);
  if (sp.estado) q = q.eq("estado", sp.estado);
  if (sp.comprador) q = q.eq("comprador_id", sp.comprador);
  if (sp.metal) q = q.contains("metal_ids", [sp.metal]);
  if (sp.comprobante === "sin") q = q.is("comprobante_tipo", null);
  else if (TIPOS_COMPROBANTE.includes(sp.comprobante as TipoComprobante)) q = q.eq("comprobante_tipo", sp.comprobante as TipoComprobante);

  const [{ data: ventas }, { data: compradores }, { data: metales }, { data: creditos }] = await Promise.all([
    q,
    supabase.from("compradores").select("id, razon_social").eq("empresa_id", empresa.id).order("razon_social"),
    supabase.from("v_productos").select("id, nombre:ruta").eq("empresa_id", empresa.id).order("clave_orden"),
    // Ventas a crédito: cuánto falta cobrar (se muestra debajo del total)
    supabase.from("v_creditos").select("venta_id, saldo, situacion").eq("empresa_id", empresa.id).eq("tipo", "por_cobrar").neq("situacion", "anulado"),
  ]);
  const filas = ventas ?? [];
  const credito = new Map((creditos ?? []).map((c) => [c.venta_id, c]));
  const corrige = puede(rol, "corregir");

  return (
    <>
      <Encabezado
        titulo="Ventas"
        descripcion="Salida de nuestra balanza → confirmación del pesaje del comprador"
        acciones={puede(rol, "vender") && <BotonLink href="/vender"><Plus className="size-4" /> Nueva venta</BotonLink>}
      />
      <ResumenVentas ctx={ctx} />
      <TituloSeccion titulo="Historial de ventas" detalle={`${filas.length} ventas con estos filtros`} />
      <Filtros
        valores={sp}
        selects={[
          { nombre: "comprador", etiqueta: "Comprador", opciones: (compradores ?? []).map((c) => ({ valor: c.id, texto: c.razon_social })) },
          { nombre: "metal", etiqueta: "Producto", opciones: (metales ?? []).map((m) => ({ valor: m.id, texto: m.nombre })) },
          { nombre: "comprobante", etiqueta: "Comprobante", opciones: [
            ...TIPOS_COMPROBANTE.map((t) => ({ valor: t, texto: COMPROBANTES[t].texto })), { valor: "sin", texto: "Sin comprobante" },
          ] },
          { nombre: "estado", etiqueta: "Estado", opciones: Object.entries(ESTADO).map(([v, [t]]) => ({ valor: v, texto: t })) },
        ]}
      />
      <Tarjeta>
        <TablaDatos
          filas={filas}
          clave={(v) => v.id}
          enlace={(v) => `/ventas/${v.id}`}
          vacio="No hay ventas con esos filtros."
          columnas={[
            {
              // El comprobante va primero y resaltado: con un clic sobre la boleta/factura se abre el detalle
              titulo: "Comprobante", principal: true,
              celda: (v) => (
                <span className="block leading-tight">
                  {v.comprobante_tipo ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-marca-50 px-1.5 py-0.5 text-xs font-semibold text-marca-800 ring-1 ring-marca-200">
                      {COMPROBANTES[v.comprobante_tipo as TipoComprobante].corto}
                      {v.comprobante_numero && <span className="cifra">{v.comprobante_numero}</span>}
                    </span>
                  ) : <span className="text-xs font-normal text-stone-500">Sin comprobante</span>}
                  <span className="cifra mt-0.5 block text-xs font-normal text-stone-500">Venta N° {v.numero}</span>
                </span>
              ),
            },
            { titulo: "Fecha", celda: (v) => fechaHora(v.fecha) },
            { titulo: "Comprador", celda: (v) => v.comprador_nombre },
            { titulo: "Productos", celda: (v) => v.metales, ocultarMovil: true },
            {
              titulo: "Salida", alinear: "der", celda: (v) => (
                <span className="block leading-tight">
                  <span className="cifra">{kg(v.kg_salida)}</span>
                  {v.merma_kg !== null && Number(v.merma_kg) !== 0 && <span className="cifra block text-xs text-amber-700">merma {kg(v.merma_kg)}</span>}
                </span>
              ),
            },
            {
              // S/ por kg debajo del total: con 8 columnas la tabla entra en laptop con el menú abierto
              titulo: "Total", alinear: "der", principal: true, celda: (v) => (
                <span className="block leading-tight">
                  <span className={v.estado === "anulada" ? "cifra text-stone-500 line-through" : "cifra font-semibold"}>{soles(v.total)}</span>
                  {Number(v.precio_promedio) > 0 && <span className="cifra block text-xs text-stone-500">{soles(v.precio_promedio)}/kg</span>}
                  {credito.has(v.id) && <CreditoLinea c={credito.get(v.id)!} />}
                </span>
              ),
            },
            { titulo: "Estado", celda: (v) => <Insignia tono={ESTADO[v.estado][1]}>{ESTADO[v.estado][0]}</Insignia> },
            // En celular la tarjeta entera abre el detalle (ahí está «Corregir»): esta columna va solo en la tabla
            ...(corrige ? [{
              titulo: "", ocultarMovil: true,
              celda: (v: (typeof filas)[number]) => v.estado === "confirmada" && (
                <Link href={`/ventas/${v.id}?corregir=1`} title={`Corregir venta N° ${v.numero}`}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-marca-700 hover:bg-marca-50">
                  <PencilLine className="size-3.5" /> Corregir
                </Link>
              ),
            }] : []),
          ]}
        />
      </Tarjeta>
    </>
  );
}

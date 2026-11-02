import type { Metadata } from "next";
import { Plus } from "lucide-react";
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
            ...TIPOS_COMPROBANTE.map((t) => ({ valor: t, texto: COMPROBANTES[t].texto })), { valor: "sin", texto: "Sin registrar" },
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
            { titulo: "N°", principal: true, celda: (v) => <span className="cifra">#{v.numero}</span> },
            { titulo: "Fecha", celda: (v) => fechaHora(v.fecha) },
            {
              // El comprobante va debajo del comprador (una columna más pasaba la tabla a tarjetas en laptop)
              titulo: "Comprador · comprobante",
              celda: (v) => (
                <span className="block leading-tight">
                  {v.comprador_nombre}
                  {v.comprobante_tipo && (
                    <span className="mt-0.5 block text-xs text-stone-500">
                      <span className="font-medium text-stone-700">{COMPROBANTES[v.comprobante_tipo as TipoComprobante].corto}</span>
                      {v.comprobante_numero && <span className="cifra"> {v.comprobante_numero}</span>}
                    </span>
                  )}
                </span>
              ),
            },
            { titulo: "Productos", celda: (v) => v.metales, ocultarMovil: true },
            { titulo: "Salida", alinear: "der", celda: (v) => <span className="cifra">{kg(v.kg_salida)}</span> },
            { titulo: "Merma", alinear: "der", celda: (v) => v.merma_kg === null ? "—" : <span className="cifra">{kg(v.merma_kg)}</span> },
            {
              // S/ por kg debajo del total: con 8 columnas la tabla entra en laptop con el menú abierto
              titulo: "Total", alinear: "der", principal: true, celda: (v) => (
                <span className="block leading-tight">
                  <span className={v.estado === "anulada" ? "cifra text-stone-500 line-through" : "cifra font-semibold"}>{soles(v.total)}</span>
                  {v.precio_promedio && <span className="cifra block text-xs text-stone-500">{soles(v.precio_promedio)}/kg</span>}
                  {credito.has(v.id) && <CreditoLinea c={credito.get(v.id)!} />}
                </span>
              ),
            },
            { titulo: "Estado", celda: (v) => <Insignia tono={ESTADO[v.estado][1]}>{ESTADO[v.estado][0]}</Insignia> },
          ]}
        />
      </Tarjeta>
    </>
  );
}

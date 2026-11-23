import Link from "next/link";
import type { Contexto } from "@/lib/contexto";
import { fechaHora, nombrePeriodo, periodoActual, soles } from "@/lib/formato";
import { Kpi, Tarjeta } from "@/components/ui/basicos";
import { TablaDatos } from "@/components/ui/tabla";
import { Filtros, rangoLima } from "@/components/filtros";
import { Insignia } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import type { CajaOrigen } from "@/components/selector-origen-dinero";
import { FileImage } from "lucide-react";
import { BotonImprimir80 } from "@/components/ticket/boton-imprimir-80";
import { MenuPago, TIPOS_PAGO, type ContextoPago, type PagoFila, type TipoPago } from "./formularios";

const MEDIO_TEXTO: Record<string, string> = { efectivo: "Efectivo", yape: "Yape", plin: "Plin", transferencia: "Transferencia" };

export type FiltrosHistorial = { trabajador?: string; tipo?: string; de?: string; desde?: string; hasta?: string };

const TONO_TIPO: Record<TipoPago, string> = {
  pago: "bg-marca-600 text-white",
  adelanto: "bg-marca-50 text-marca-700",
  bono: "bg-stone-100 text-stone-700",
};

/** Historial general de pagos al personal: todos los trabajadores en una lista, con filtros */
export async function HistorialPagos({ ctx, sp, cajas, ctxPago }: {
  ctx: Pick<Contexto, "supabase" | "empresa">; sp: FiltrosHistorial; cajas: CajaOrigen[]; ctxPago: ContextoPago;
}) {
  const { supabase, empresa } = ctx;
  const { desde, hasta } = rangoLima(sp.desde, sp.hasta);
  let q = supabase.from("v_pagos_personal").select("*").eq("empresa_id", empresa.id)
    .order("fecha", { ascending: false }).limit(500);
  if (sp.trabajador) q = q.eq("trabajador_id", sp.trabajador);
  if (sp.tipo && sp.tipo in TIPOS_PAGO) q = q.eq("tipo", sp.tipo);
  if (sp.de === "caja") q = q.not("caja_id", "is", null);
  else if (sp.de === "ninguna") q = q.is("caja_id", null);
  else if (sp.de) q = q.eq("caja_id", sp.de);
  if (desde) q = q.gte("fecha", desde);
  if (hasta) q = q.lt("fecha", hasta);

  const [{ data: pagos }, { data: trabajadores }] = await Promise.all([
    q,
    supabase.from("trabajadores").select("id, nombre").eq("empresa_id", empresa.id).order("nombre"),
  ]);
  const lista = pagos ?? [];
  const vigentes = lista.filter((p) => p.estado === "registrada");
  const suma = (tipo?: string) => vigentes.filter((p) => !tipo || p.tipo === tipo).reduce((s, p) => s + Number(p.monto), 0);
  const elegido = (trabajadores ?? []).find((t) => t.id === sp.trabajador);

  return (
    <>
      <Filtros
        valores={sp as Record<string, string | undefined>}
        ocultos={{ vista: "historial" }}
        selects={[
          { nombre: "trabajador", etiqueta: "Trabajador", opciones: (trabajadores ?? []).map((t) => ({ valor: t.id, texto: t.nombre })) },
          { nombre: "tipo", etiqueta: "Tipo", opciones: Object.entries(TIPOS_PAGO).map(([v, t]) => ({ valor: v, texto: t.texto })) },
          { nombre: "de", etiqueta: "Salió de", opciones: [...cajas.map((c) => ({ valor: c.id, texto: c.nombre })), { valor: "ninguna", texto: "Pagado por fuera" }] },
        ]}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo={elegido ? `Pagado a ${elegido.nombre.split(" ")[0]}` : "Total pagado"} valor={soles(suma())} detalle={`${vigentes.length} pago(s) en la lista`} />
        <Kpi titulo="Pagos de sueldo" valor={soles(suma("pago"))} />
        <Kpi titulo="Adelantos" valor={soles(suma("adelanto"))} />
        <Kpi titulo="Bonos" valor={soles(suma("bono"))} />
      </div>

      <Tarjeta>
        <TablaDatos
          filas={lista}
          clave={(p) => p.id!}
          vacio="No hay pagos con esos filtros."
          columnas={[
            { titulo: "Fecha", celda: (p) => <span className={cx(p.estado === "anulada" && "text-stone-400 line-through")}>{fechaHora(p.fecha)}</span> },
            {
              titulo: "Trabajador", principal: true,
              celda: (p) => (
                // Tocar el nombre filtra el historial por ese trabajador
                <Link href={`/personal/pagos?vista=historial&trabajador=${p.trabajador_id}`} className="group min-w-0">
                  <span className={cx("block truncate font-semibold group-hover:text-marca-700", p.estado === "anulada" ? "text-stone-400 line-through" : "text-stone-900")}>{p.trabajador_nombre}</span>
                  <span className="block truncate text-xs text-stone-500">{p.cargo ?? "—"}</span>
                </Link>
              ),
            },
            { titulo: "Mes", celda: (p) => nombrePeriodo(p.periodo!) },
            {
              titulo: "Tipo",
              celda: (p) => (
                <span className={cx("rounded-md px-2 py-0.5 text-[11px] font-semibold", p.estado === "anulada" ? "bg-stone-100 text-stone-400" : TONO_TIPO[p.tipo as TipoPago])}>
                  {TIPOS_PAGO[p.tipo as TipoPago]?.texto ?? p.tipo}
                </span>
              ),
            },
            {
              titulo: "Cómo y a dónde",
              celda: (p) => (
                <span className="min-w-0">
                  <span className="block truncate font-medium">{MEDIO_TEXTO[p.medio ?? "efectivo"]}{p.destino && <span className="font-normal text-stone-600"> · {p.destino}</span>}</span>
                  <span className="block truncate text-xs text-stone-500">
                    {[p.caja_nombre ? `De ${p.caja_nombre}` : "Pagado por fuera", p.operacion && `Op. ${p.operacion}`, p.nota].filter(Boolean).join(" · ")}
                  </span>
                </span>
              ),
            },
            {
              titulo: "Monto", alinear: "der", principal: true,
              celda: (p) => <span className={cx("cifra font-semibold", p.estado === "anulada" && "text-stone-400 line-through")}>{soles(p.monto)}</span>,
            },
            {
              titulo: "",
              celda: (p) => {
                if (p.estado === "anulada") return <span title={p.motivo_anulacion ?? ""}><Insignia tono="rojo">Anulado</Insignia></span>;
                const historial = (p.historial ?? []) as PagoFila["historial"];
                return (
                  <span className="inline-flex items-center gap-1">
                    {historial.length > 0 && <span title={`Último motivo: ${historial[historial.length - 1].razon}`}><Insignia tono="marca">Corregido</Insignia></span>}
                    {p.voucher_url && (
                      <a href={`/personal/pagos/voucher/${p.id}`} target="_blank" title="Ver voucher"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-marca-700 hover:bg-marca-50"><FileImage className="size-3.5" /> Voucher</a>
                    )}
                    <BotonImprimir80 href={`/imprimir/pago-personal/${p.id}`} texto="Constancia" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-marca-700 hover:bg-marca-50" />
                    <MenuPago cajas={cajas} mesActual={periodoActual()} ctx={ctxPago}
                      pago={{
                        id: p.id!, periodo: p.periodo!, tipo: p.tipo as TipoPago, monto: String(p.monto), caja_id: p.caja_id, nota: p.nota, historial,
                        medio: p.medio ?? "efectivo", destino: p.destino, operacion: p.operacion, voucher: !!p.voucher_url,
                      }} />
                  </span>
                );
              },
            },
          ]}
        />
      </Tarjeta>
      {lista.length === 500 && <p className="mt-2 text-xs text-stone-500">Se muestran los 500 pagos más recientes; use los filtros para acotar.</p>}
    </>
  );
}

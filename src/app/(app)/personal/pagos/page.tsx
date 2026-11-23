import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, History, Table2 } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { fechaHora, nombrePeriodo, periodoActual, soles } from "@/lib/formato";
import { Aviso, Encabezado, Insignia, Kpi, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { TablaDatos } from "@/components/ui/tabla";
import { cx } from "@/components/ui/clases";
import { BotonPagar, type Cobro, type ContextoPago } from "./formularios";
import { cargarMediosPago } from "@/lib/productos";
import { HistorialPagos, type FiltrosHistorial } from "./historial";
import type { Database } from "@/lib/supabase/database.types";

type FilaPlanillaMes = Database["public"]["Functions"]["planilla_mes"]["Returns"][number];

export const metadata: Metadata = { title: "Pagos al personal" };

const mesValido = (p?: string) => (p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p) ? p : undefined);
function mover(p: string, d: number) {
  const [a, m] = p.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1 + d, 15));
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Estado = { texto: string; tono: "verde" | "ambar" | "gris" | "marca" };
function estado(aPagar: number, pagado: number, saldo: number): Estado {
  if (aPagar <= 0) return pagado > 0 ? { texto: "Con pagos", tono: "marca" } : { texto: "Sin sueldo", tono: "gris" };
  if (saldo <= 0) return { texto: "Pagado", tono: "verde" };
  if (pagado > 0) return { texto: "Pago parcial", tono: "ambar" };
  return { texto: "Pendiente", tono: "gris" };
}

/** Planilla del mes: lo que corresponde a cada trabajador, lo pagado (adelantos, pagos, bonos) y lo que falta */
export default async function PagosPersonalPage({ searchParams }: { searchParams: Promise<{ mes?: string; vista?: string } & FiltrosHistorial> }) {
  const sp = await searchParams;
  const actual = periodoActual();
  const mes = mesValido(sp.mes) ?? actual;
  const vista = sp.vista === "historial" ? "historial" : "planilla";
  const ctx = await exigir("personal");
  const { supabase, empresa } = ctx;

  const [{ data: planilla }, { data: saldos }, { data: ultimos }, medios, { data: fichas }] = await Promise.all([
    vista === "planilla" ? supabase.rpc("planilla_mes", { p_empresa: empresa.id, p_periodo: mes }) : { data: [] },
    supabase.from("v_saldo_caja").select("caja_id, nombre, saldo, tipo, activo").eq("empresa_id", empresa.id).order("orden"),
    vista === "planilla"
      ? supabase.from("v_pagos_personal").select("id, fecha, trabajador_id, trabajador_nombre, tipo, monto, caja_nombre, estado, periodo")
        .eq("empresa_id", empresa.id).eq("periodo", mes).order("fecha", { ascending: false }).limit(8)
      : { data: [] },
    cargarMediosPago(ctx),
    supabase.from("trabajadores").select("id, pago_medio, pago_celular, pago_banco, pago_cuenta, pago_cci").eq("empresa_id", empresa.id),
  ]);
  const filas = (planilla ?? []) as FilaPlanillaMes[];
  // Caja que usa cada medio (Configuración → Medios de pago): al elegir Yape se propone la caja de Yape
  const cajaPorMedio: Record<string, string> = {};
  for (const m of medios) if (m.caja_id && !cajaPorMedio[m.tipo]) cajaPorMedio[m.tipo] = m.caja_id;
  const ctxPago: ContextoPago = { empresaId: empresa.id, cajaPorMedio };
  const cobros = new Map((fichas ?? []).map((t): [string, Cobro] => [t.id, { medio: t.pago_medio, celular: t.pago_celular, banco: t.pago_banco, cuenta: t.pago_cuenta, cci: t.pago_cci }]));
  const cajas = (saldos ?? []).filter((c) => c.activo).map((c) => ({ id: c.caja_id!, nombre: c.nombre!, saldo: String(c.saldo), tipo: c.tipo }));

  const cabecera = (
    <>
      <Encabezado
        titulo="Pagos al personal"
        descripcion="El sistema calcula lo que le corresponde a cada uno según la asistencia: sueldo + horas extras + domingos − faltas, tardanzas y permisos sin goce."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-stone-200/70 p-1 sm:inline-flex">
        {([["planilla", "Planilla del mes", Table2], ["historial", "Historial de pagos", History]] as const).map(([v, t, Icono]) => (
          <Link key={v} href={v === "planilla" ? "/personal/pagos" : "/personal/pagos?vista=historial"}
            className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", vista === v ? "bg-superficie text-marca-700 shadow-sm" : "text-stone-600 hover:text-stone-900")}>
            <Icono className="size-4" /> {t}
          </Link>
        ))}
      </div>
    </>
  );
  if (vista === "historial") {
    return <>{cabecera}<HistorialPagos ctx={ctx} sp={sp} cajas={cajas} ctxPago={ctxPago} /></>;
  }
  // Totales del mes para los indicadores (suma de lo que devuelve la planilla de la BD)
  const total = (k: "a_pagar" | "pagado" | "adelantos") => filas.reduce((s, f) => s + Number(f[k] ?? 0), 0);
  const falta = filas.reduce((s, f) => s + Math.max(Number(f.saldo ?? 0), 0), 0);
  const pagados = filas.filter((f) => Number(f.a_pagar) > 0 && Number(f.saldo) <= 0).length;
  const conSueldo = filas.filter((f) => Number(f.a_pagar) > 0).length;

  return (
    <>
      {cabecera}

      {/* Mes */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/personal/pagos?mes=${mover(mes, -1)}`} aria-label="Mes anterior"
          className="rounded-lg border border-stone-200 bg-superficie p-2 text-stone-600 hover:border-marca-300 hover:text-marca-700"><ChevronLeft className="size-4" /></Link>
        <span className="min-w-40 rounded-lg bg-marca-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-sm">{nombrePeriodo(mes)}</span>
        <Link href={`/personal/pagos?mes=${mover(mes, 1)}`} aria-label="Mes siguiente"
          className="rounded-lg border border-stone-200 bg-superficie p-2 text-stone-600 hover:border-marca-300 hover:text-marca-700"><ChevronRight className="size-4" /></Link>
        {mes !== actual && <Link href="/personal/pagos" className="text-sm font-medium text-marca-700 hover:underline">Ir al mes actual</Link>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="A pagar en el mes" valor={soles(total("a_pagar"))} detalle={`${conSueldo} trabajador(es) con sueldo`} />
        <Kpi titulo="Ya pagado" valor={soles(total("pagado"))} detalle={`Adelantos ${soles(total("adelantos"))}`} tono="positivo" />
        <Kpi titulo="Falta pagar" valor={soles(falta)} tono={falta > 0 ? "aviso" : undefined} />
        <Kpi titulo="Trabajadores pagados" valor={`${pagados} de ${conSueldo}`} tono={conSueldo > 0 && pagados === conSueldo ? "positivo" : undefined} />
      </div>

      {filas.some((f) => Number(f.dias_por_marcar) > 0) && (
        <Aviso>Hay días sin marcar en la asistencia. El cálculo usa lo marcado: <Link href="/personal/asistencia" className="font-medium underline">complete el tareo</Link> para que salga exacto.</Aviso>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Tarjeta className="min-w-0 xl:col-span-2">
          <TituloTarjeta>Planilla de {nombrePeriodo(mes).toLowerCase()}</TituloTarjeta>
          <TablaDatos
            filas={filas}
            clave={(f) => f.trabajador_id!}
            vacio="No hay trabajadores en este mes. Regístrelos en Personal."
            columnas={[
              {
                titulo: "Trabajador", principal: true,
                celda: (f) => (
                  <Link href={`/personal/pagos?vista=historial&trabajador=${f.trabajador_id}`} className="group min-w-0">
                    <span className="block truncate font-semibold text-stone-900 group-hover:text-marca-700">{f.nombre}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {[f.cargo, f.situacion === "cesado" ? "Cesado" : null, Number(f.dias_mes) < 30 ? `${f.dias_mes} días en el mes` : null, Number(f.faltas) > 0 ? `${f.faltas} falta(s)` : null].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </Link>
                ),
              },
              {
                titulo: "A pagar", alinear: "der",
                celda: (f) => (
                  <span className="cifra" title={`Sueldo ${soles(f.sueldo_periodo)} + extras ${soles(f.monto_extras)} + domingos ${soles(f.monto_domingos)}`}>
                    <span className="block font-medium">{soles(f.a_pagar)}</span>
                    {(Number(f.monto_extras) > 0 || Number(f.monto_domingos) > 0) && (
                      <span className="block text-[11px] text-stone-500">+ extras y domingos {soles(Number(f.monto_extras) + Number(f.monto_domingos))}</span>
                    )}
                    {Number(f.descuentos) > 0 && (
                      <span className="block text-[11px] text-red-700">
                        − {soles(f.descuentos)} ({[Number(f.faltas) > 0 && `${f.faltas} falta(s)`, Number(f.tardanzas) > 0 && `${f.tardanzas} tardanza(s)`, Number(f.desc_permisos) > 0 && `${f.permisos} permiso(s)`].filter(Boolean).join(", ")})
                      </span>
                    )}
                  </span>
                ),
              },
              {
                // Adelantos y bonos como detalle: menos columnas para que la planilla entre sin desplazarse
                titulo: "Pagado", alinear: "der",
                celda: (f) => (
                  <span className="cifra">
                    <span className="block">{soles(f.pagado)}</span>
                    {Number(f.adelantos) > 0 && <span className="block text-[11px] text-stone-500">adelantos {soles(f.adelantos)}</span>}
                    {Number(f.bonos) > 0 && <span className="block text-[11px] text-stone-500">bono {soles(f.bonos)}</span>}
                  </span>
                ),
              },
              {
                titulo: "Falta", alinear: "der", principal: true,
                celda: (f) => {
                  const e = estado(Number(f.a_pagar), Number(f.pagado), Number(f.saldo));
                  return (
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className={cx("cifra font-semibold", Number(f.saldo) > 0 ? "text-marca-700" : "text-emerald-700")}>{soles(Math.max(Number(f.saldo), 0))}</span>
                      <Insignia tono={e.tono}>{e.texto}</Insignia>
                    </span>
                  );
                },
              },
              {
                titulo: "",
                celda: (f) => (
                  <span className="inline-flex items-center gap-1">
                    <BotonPagar cajas={cajas} ctx={ctxPago} principal={Number(f.saldo) > 0}
                      fila={{
                        trabajador_id: f.trabajador_id!, nombre: f.nombre!, periodo: mes, cobro: cobros.get(f.trabajador_id!) ?? null, a_pagar: String(f.a_pagar), adelantos: String(f.adelantos), pagado: String(f.pagado), saldo: String(f.saldo),
                        desglose: {
                          sueldo: String(f.sueldo_periodo), dias: Number(f.dias_mes), extras: String(f.monto_extras), horas_extra: String(Number(f.horas_extra)),
                          domingos: String(f.monto_domingos), n_domingos: Number(f.domingos), faltas: Number(f.faltas), desc_faltas: String(f.desc_faltas),
                          tardanzas: Number(f.tardanzas), minutos_tarde: Number(f.minutos_tarde), desc_tardanzas: String(f.desc_tardanzas),
                          permisos: Number(f.permisos), desc_permisos: String(f.desc_permisos), sin_marcar: Number(f.dias_por_marcar),
                        },
                      }} />
                  </span>
                ),
              },
            ]}
          />
        </Tarjeta>

        <Tarjeta className="min-w-0">
          <TituloTarjeta accion={<Link href="/personal/pagos?vista=historial" className="text-sm font-medium text-marca-700 hover:underline">Ver historial</Link>}>Últimos pagos del mes</TituloTarjeta>
          {(ultimos ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">Aún no hay pagos en {nombrePeriodo(mes).toLowerCase()}.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {(ultimos ?? []).map((p) => (
                <li key={p.id} className={cx("flex items-center justify-between gap-3 px-4 py-2.5", p.estado === "anulada" && "opacity-60")}>
                  <Link href={`/personal/pagos?vista=historial&trabajador=${p.trabajador_id}`} className="min-w-0 hover:text-marca-700">
                    <span className={cx("block truncate text-sm font-medium", p.estado === "anulada" && "line-through")}>{p.trabajador_nombre}</span>
                    <span className="block truncate text-xs text-stone-500">{fechaHora(p.fecha)} · {p.caja_nombre ?? "Por fuera"}</span>
                  </Link>
                  <span className="shrink-0 text-right">
                    <span className={cx("cifra block text-sm font-semibold", p.estado === "anulada" && "line-through")}>{soles(p.monto)}</span>
                    <span className="block text-[11px] text-stone-500">{p.estado === "anulada" ? "Anulado" : p.tipo === "pago" ? "Pago" : p.tipo === "adelanto" ? "Adelanto" : "Bono"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </>
  );
}

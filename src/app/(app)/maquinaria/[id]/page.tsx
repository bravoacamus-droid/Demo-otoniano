import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { Dato, Encabezado, Insignia, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { TablaDatos } from "@/components/ui/tabla";
import { PanelModulo } from "@/components/panel-modulo";
import { cx } from "@/components/ui/clases";
import { AccionesFicha, AnularMovimiento, type Maquina } from "../formularios";
import { ESTADOS } from "../datos";

export const metadata: Metadata = { title: "Máquina" };

type Cambio = { fecha: string; razon: string | null; antes: Record<string, unknown> };
const CAMPOS: Record<string, string> = {
  nombre: "Nombre", tipo: "Tipo", marca: "Marca", modelo: "Modelo", serie: "Serie/placa", cantidad: "Cantidad",
  fecha_adquisicion: "Fecha de compra", valor_compra: "Valor de compra", estado: "Estado", ubicacion: "Ubicación",
  responsable: "Responsable", notas: "Notas",
};

/** Ficha de una máquina: datos, totales y su historial de gastos e ingresos (v_maquina_movimientos) */
export default async function MaquinaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ver?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, empresa, rol } = await exigir("maquinaria");
  const ver = sp.ver === "gasto" || sp.ver === "ingreso" ? sp.ver : null;

  const [{ data: m }, { data: movs }, { data: cajas }] = await Promise.all([
    supabase.from("v_maquinas").select("*").eq("id", id).eq("empresa_id", empresa.id).maybeSingle(),
    supabase.from("v_maquina_movimientos").select("*").eq("maquina_id", id).order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
    supabase.from("v_saldo_caja").select("caja_id, nombre, saldo, activo").eq("empresa_id", empresa.id).order("orden"),
  ]);
  if (!m) notFound();
  const lista = (movs ?? []).filter((x) => !ver || x.tipo === ver);
  const listaCajas = (cajas ?? []).filter((c) => c.activo).map((c) => ({ id: c.caja_id!, nombre: c.nombre!, saldo: String(c.saldo) }));
  const gastos = Number(m.gastos ?? 0);
  const ingresos = Number(m.ingresos ?? 0);
  const neto = Math.round(gastos * 100 - ingresos * 100) / 100;
  const cambios = ((m.historial ?? []) as Cambio[]).slice().reverse();
  const puedeAnular = puede(rol, "corregir");
  const estado = ESTADOS[m.estado!];
  const valorDe = (k: string, v: unknown) =>
    v === null || v === undefined || v === "" ? "—"
      : k === "valor_compra" ? soles(v as string)
      : k === "estado" ? ESTADOS[String(v)]?.texto ?? String(v)
      : k === "fecha_adquisicion" ? fecha(`${v}T12:00:00-05:00`)
      : String(v);

  return (
    <>
      <Link href="/maquinaria" className="mb-2 inline-flex items-center gap-1 text-sm text-marca-700 hover:underline"><ArrowLeft className="size-4" /> Maquinaria</Link>
      <Encabezado
        titulo={m.nombre!}
        descripcion={<span className="inline-flex flex-wrap items-center gap-2">
          <Insignia tono={estado?.tono ?? "gris"}>{estado?.texto ?? m.estado}</Insignia>
          <span>{[m.tipo, m.marca, m.modelo].filter(Boolean).join(" · ")}</span>
        </span>}
        acciones={m.estado !== "de_baja" || puede(rol, "editarMaquinaria") ? (
          <AccionesFicha m={m as unknown as Maquina} cajas={listaCajas} puedeEditar={puede(rol, "editarMaquinaria")}
            puedeMover={puede(rol, "moverMaquinaria") && m.estado !== "de_baja"} puedeFecha={rol === "dueno" || rol === "administrador"} />
        ) : undefined}
      />

      <PanelModulo
        tono="caja"
        etiqueta="Dinero de esta máquina"
        principal={{ titulo: "Gastado en uso", valor: soles(gastos), detalle: `${soles(m.gastos_caja)} de caja · ${soles(m.gastos_fuera)} pagado por fuera` }}
        celdas={[
          { titulo: "Ingresos", valor: soles(ingresos), detalle: "Alquileres, ventas…" },
          { titulo: neto >= 0 ? "Costo neto" : "Ganancia neta", valor: soles(Math.abs(neto)), detalle: "Gastos − ingresos" },
          { titulo: "Movimientos", valor: String(m.n_movimientos ?? 0), detalle: m.ultimo_movimiento ? `Último: ${fecha(m.ultimo_movimiento)}` : "Sin movimientos" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Tarjeta>
          <TituloTarjeta accion={
            <div className="flex gap-1 rounded-lg bg-stone-100 p-0.5 text-sm">
              {([[null, "Todo"], ["gasto", "Gastos"], ["ingreso", "Ingresos"]] as const).map(([v, t]) => (
                <Link key={t} href={v ? `/maquinaria/${id}?ver=${v}` : `/maquinaria/${id}`} scroll={false}
                  className={cx("rounded-md px-2.5 py-1 font-medium", ver === v ? "bg-superficie shadow-sm" : "text-stone-600 hover:text-stone-900")}>{t}</Link>
              ))}
            </div>
          }>Historial de gastos e ingresos</TituloTarjeta>
          <TablaDatos
            filas={lista}
            clave={(x) => `${x.tipo}-${x.id}`}
            vacio="Sin movimientos. Use «Registrar gasto» o «Registrar ingreso»."
            columnas={[
              { titulo: "Fecha", celda: (x) => fechaHora(x.fecha) },
              {
                titulo: "Concepto", principal: true,
                celda: (x) => (
                  <span className={cx("min-w-0", x.estado === "anulada" && "text-stone-500 line-through")}>
                    <Insignia tono={x.tipo === "ingreso" ? "verde" : "gris"}>{x.categoria}</Insignia>{" "}
                    <span className="text-sm">{x.detalle?.replace(`${m.nombre} · ${x.categoria}`, "").replace(/^: /, "") || ""}</span>
                    <span className="block text-xs text-stone-500">
                      {x.origen === "fuera" ? "Pagado por fuera (solo registro)" : x.caja_nombre}{x.creado_por_nombre && ` · ${x.creado_por_nombre}`}
                    </span>
                    {x.estado === "anulada" && <span className="block text-xs text-red-700 no-underline">Anulado: {x.motivo_anulacion}</span>}
                  </span>
                ),
              },
              {
                titulo: "Monto", alinear: "der", principal: true,
                celda: (x) => (
                  <span className={cx("cifra font-medium", x.estado === "anulada" ? "text-stone-500 line-through" : x.tipo === "ingreso" ? "text-emerald-700" : "text-red-700")}>
                    {x.tipo === "ingreso" ? "+" : "−"}{soles(x.monto)}
                  </span>
                ),
              },
              { titulo: "", celda: (x) => puedeAnular && x.estado === "registrada" ? <AnularMovimiento id={x.id!} tipo={x.tipo!} origen={x.origen!} /> : null },
            ]}
          />
        </Tarjeta>

        <div className="space-y-4">
          <Tarjeta>
            <TituloTarjeta>Datos</TituloTarjeta>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
              <Dato etiqueta="Tipo">{m.tipo}</Dato>
              <Dato etiqueta="Cantidad">{m.cantidad}</Dato>
              <Dato etiqueta="Marca">{m.marca ?? "—"}</Dato>
              <Dato etiqueta="Modelo">{m.modelo ?? "—"}</Dato>
              <Dato etiqueta="Serie o placa">{m.serie ?? "—"}</Dato>
              <Dato etiqueta="Fecha de compra">{m.fecha_adquisicion ? fecha(`${m.fecha_adquisicion}T12:00:00-05:00`) : "—"}</Dato>
              <Dato etiqueta="Valor de compra">
                {m.valor_compra != null ? soles(m.valor_compra) : "—"}
                {Number(m.compra_pagada) > 0 && <span className="block text-xs font-normal text-stone-500">Pago registrado: {soles(m.compra_pagada)}</span>}
              </Dato>
              <Dato etiqueta="Ubicación">{m.ubicacion ?? "—"}</Dato>
              <Dato etiqueta="Responsable">{m.responsable ?? "—"}</Dato>
              <Dato etiqueta="Registrada">{fecha(m.creado_en)}{m.creado_por_nombre && ` · ${m.creado_por_nombre}`}</Dato>
              {m.notas && <div className="col-span-2"><Dato etiqueta="Notas">{m.notas}</Dato></div>}
            </dl>
          </Tarjeta>

          {cambios.length > 0 && (
            <Tarjeta>
              <TituloTarjeta><span className="inline-flex items-center gap-1.5"><History className="size-4 text-stone-500" /> Cambios en la ficha</span></TituloTarjeta>
              <ul className="divide-y divide-stone-100 text-sm">
                {cambios.map((c, i) => {
                  // Lo que cambió respecto del estado siguiente (el más reciente se compara con la ficha actual)
                  const despues = (i === 0 ? m : cambios[i - 1].antes) as Record<string, unknown>;
                  const dif = Object.keys(CAMPOS).filter((k) => String(c.antes[k] ?? "") !== String(despues[k] ?? ""));
                  return (
                    <li key={c.fecha} className="px-4 py-2.5">
                      <p className="text-xs text-stone-500">{fechaHora(c.fecha)}{c.razon && ` · ${c.razon}`}</p>
                      {dif.length === 0 ? <p className="text-stone-500">Sin cambios en los datos</p> : (
                        <ul className="mt-0.5 space-y-0.5">
                          {dif.map((k) => <li key={k}><span className="text-stone-500">{CAMPOS[k]}:</span> {valorDe(k, c.antes[k])} → <b className="font-medium">{valorDe(k, despues[k])}</b></li>)}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Tarjeta>
          )}
        </div>
      </div>
    </>
  );
}

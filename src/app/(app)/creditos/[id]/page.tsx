import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { fechaDia, fechaHora, soles } from "@/lib/formato";
import { cargarMediosPago } from "@/lib/productos";
import { Aviso, Dato, Encabezado, Insignia, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { TablaDatos } from "@/components/ui/tabla";
import { BotonAnular } from "@/components/boton-anular";
import { AvanceCredito, type CreditoFila } from "@/components/avance-credito";
import { FRECUENCIA, SITUACION_CUOTA, TIPOS_CREDITO, type TipoCredito } from "@/lib/creditos";
import type { Caja } from "@/lib/tipos";
import { anularPagoCredito } from "../acciones";
import { RegistrarPago } from "./registrar-pago";

export const metadata: Metadata = { title: "Crédito" };

export default async function CreditoDetalle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await exigir("creditos");
  const { supabase, empresa, rol } = ctx;
  const [{ data: c }, { data: cuotas }, { data: pagos }, { data: cajas }, medios] = await Promise.all([
    supabase.from("v_creditos").select("*").eq("id", id).maybeSingle(),
    supabase.from("v_credito_cuotas").select("*").eq("credito_id", id).order("numero"),
    supabase.from("v_credito_pagos").select("*").eq("credito_id", id).order("fecha", { ascending: false }),
    supabase.from("cajas").select("*").eq("empresa_id", empresa.id).eq("activo", true).order("orden"),
    cargarMediosPago(ctx),
  ]);
  if (!c) notFound();

  const t = TIPOS_CREDITO[c.tipo as TipoCredito];
  const cobro = c.tipo === "por_cobrar";
  const saldo = Number(c.saldo);
  const operacion = cobro ? `/ventas/${c.venta_id}` : `/compras/${c.compra_id}`;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/creditos?tipo=${c.tipo}`} className="mb-2 inline-flex items-center gap-1 text-sm text-marca-700 hover:underline">
        <ArrowLeft className="size-4" /> Créditos {t.texto.toLowerCase()}
      </Link>
      <Encabezado
        titulo={`${t.texto} · ${c.contraparte ?? "—"}`}
        descripcion={<>{t.operacion} <Link href={operacion} className="font-medium text-marca-700 hover:underline">N° {c.operacion_numero}</Link> del {fechaHora(c.fecha)}</>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {c.situacion !== "anulado" && saldo > 0 && puede(rol, "creditos") && (
            <Tarjeta>
              <TituloTarjeta>{cobro ? "Registrar cobro de cuota" : "Registrar pago de cuota"}</TituloTarjeta>
              <div className="p-4">
                <RegistrarPago key={String(c.saldo)} creditoId={c.id} tipo={c.tipo as TipoCredito} saldo={saldo}
                  sugerido={Number(c.proxima_saldo ?? saldo)} medios={medios} cajas={(cajas ?? []) as Caja[]} />
              </div>
            </Tarjeta>
          )}
          {c.situacion === "anulado" && <Aviso tono="rojo">Crédito anulado junto con la {t.operacion.toLowerCase()}: {c.motivo_anulacion}</Aviso>}

          <Tarjeta>
            <TituloTarjeta>Cronograma de cuotas</TituloTarjeta>
            <TablaDatos
              filas={cuotas ?? []}
              clave={(q) => q.id!}
              columnas={[
                { titulo: "Cuota", principal: true, celda: (q) => <span className="cifra">{q.numero} de {c.n_cuotas}</span> },
                { titulo: "Vence", celda: (q) => fechaDia(q.vence) },
                { titulo: "Monto", alinear: "der", celda: (q) => <span className="cifra">{soles(q.monto)}</span> },
                { titulo: cobro ? "Cobrado" : "Pagado", alinear: "der", celda: (q) => <span className="cifra">{soles(q.pagado)}</span> },
                { titulo: "Falta", alinear: "der", principal: true, celda: (q) => <span className="cifra font-semibold">{soles(q.saldo)}</span> },
                {
                  titulo: "Estado",
                  celda: (q) => {
                    const [texto, tono] = SITUACION_CUOTA[q.situacion ?? "pendiente"];
                    return <Insignia tono={c.situacion === "anulado" ? "gris" : tono}>{texto}</Insignia>;
                  },
                },
              ]}
            />
          </Tarjeta>

          <Tarjeta>
            <TituloTarjeta>{cobro ? "Cobros registrados" : "Pagos registrados"}</TituloTarjeta>
            <TablaDatos
              filas={pagos ?? []}
              clave={(p) => p.id!}
              vacio={cobro ? "Aún no hay cobros." : "Aún no hay pagos."}
              columnas={[
                { titulo: "Fecha", principal: true, celda: (p) => fechaHora(p.fecha) },
                { titulo: "Monto", alinear: "der", principal: true, celda: (p) => <span className={p.estado === "anulada" ? "cifra text-stone-500 line-through" : "cifra font-semibold"}>{soles(p.monto)}</span> },
                { titulo: "Medio · caja", celda: (p) => `${p.medio_nombre} · ${p.caja_nombre}` },
                { titulo: "Registró", ocultarMovil: true, celda: (p) => p.creado_por_nombre ?? "—" },
                { titulo: "Nota", ocultarMovil: true, celda: (p) => p.estado === "anulada" ? <span className="text-red-700">Anulado: {p.motivo_anulacion}</span> : p.nota ?? "—" },
                {
                  titulo: "",
                  alinear: "der",
                  celda: (p) => p.estado === "registrada" && puede(rol, "corregir") ? (
                    <BotonAnular id={p.id!} accion={anularPagoCredito} etiqueta="Anular" titulo={`Anular ${cobro ? "cobro" : "pago"} de ${soles(p.monto)}`}
                      explicacion={`El movimiento de caja se anula y lo ${cobro ? "cobrado" : "pagado"} vuelve a quedar pendiente en las cuotas.`} />
                  ) : null,
                },
              ]}
            />
          </Tarjeta>
        </div>

        {/* En celular va primero: cuánto falta y si está vencido, antes de cobrar */}
        <div className="order-first space-y-4 lg:order-none">
          <Tarjeta className="p-4">
            <AvanceCredito c={c as unknown as CreditoFila} enlace={false} />
          </Tarjeta>
          <Tarjeta className="p-4">
            <dl className="grid grid-cols-2 gap-3">
              <Dato etiqueta={t.contraparte}>{c.contraparte ?? "—"}</Dato>
              <Dato etiqueta="Documento">{c.contraparte_doc ?? "—"}</Dato>
              <Dato etiqueta={`Total de la ${t.operacion.toLowerCase()}`}>{soles(c.total_operacion)}</Dato>
              <Dato etiqueta="Inicial">{soles(c.inicial)}</Dato>
              <Dato etiqueta="A crédito">{soles(c.monto)}</Dato>
              <Dato etiqueta="Frecuencia">{FRECUENCIA[c.frecuencia ?? "unica"]}</Dato>
            </dl>
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}

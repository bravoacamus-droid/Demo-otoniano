import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { exigir } from "@/lib/contexto";
import { logoDataUri } from "@/lib/ticket-datos";
import { fechaHora, nombrePeriodo, soles } from "@/lib/formato";
import { HojaTicket80 } from "@/components/ticket/ticket-80";

export const metadata: Metadata = { title: "Constancia de pago" };

const TIPO: Record<string, string> = { pago: "PAGO DE SUELDO", adelanto: "ADELANTO DE SUELDO", bono: "BONO" };
const MEDIO: Record<string, string> = { efectivo: "Efectivo", yape: "Yape", plin: "Plin", transferencia: "Transferencia" };

// Constancia de pago al personal en 80 mm, para que el trabajador firme. La abre BotonImprimir80.
export default async function ImprimirPagoPersonal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await exigir("personal");
  const [{ data: p }, logo] = await Promise.all([
    ctx.supabase.from("v_pagos_personal").select("*").eq("id", id).maybeSingle(),
    logoDataUri(ctx),
  ]);
  if (!p) notFound();
  return (
    <HojaTicket80 empresa={ctx.empresa} logo={logo}>
      <div className="tit">CONSTANCIA · {TIPO[p.tipo!] ?? "PAGO"}</div>
      {p.estado === "anulada" && <div className="c b">*** ANULADO ***</div>}
      <div className="c">{fechaHora(p.fecha)}</div>
      <div className="lin" />
      <div><span className="b">Trabajador: </span>{p.trabajador_nombre}</div>
      {p.trabajador_dni && <div><span className="b">DNI: </span>{p.trabajador_dni}</div>}
      {p.cargo && <div><span className="b">Cargo: </span>{p.cargo}</div>}
      <div><span className="b">Mes: </span>{nombrePeriodo(p.periodo!)}</div>
      <div className="lin" />
      <div><span className="b">Medio: </span>{MEDIO[p.medio ?? "efectivo"]}</div>
      {p.destino && <div><span className="b">Enviado a: </span>{p.destino}</div>}
      {p.operacion && <div><span className="b">N° operación: </span>{p.operacion}</div>}
      <div><span className="b">Salió de: </span>{p.caja_nombre ?? "Pagado por fuera"}</div>
      {p.nota && <div><span className="b">Nota: </span>{p.nota}</div>}
      <div className="lin" />
      <div className="fila total"><span>MONTO</span><span>{soles(p.monto)}</span></div>
      {p.creado_por_nombre && <div className="peq">Registró: {p.creado_por_nombre}</div>}
      <div className="lin" />
      <br /><br />
      <div className="c">_______________________</div>
      <div className="c peq">Firma del trabajador · recibí conforme</div>
    </HojaTicket80>
  );
}

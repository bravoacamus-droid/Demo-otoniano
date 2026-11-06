import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obtenerContexto } from "@/lib/contexto";
import { logoDataUri } from "@/lib/ticket-datos";
import { fechaHora, nombrePeriodo, soles } from "@/lib/formato";
import { ETIQUETA_MOV_SOCIO, type TipoMovSocio } from "@/lib/socios";
import { HojaTicket80 } from "@/components/ticket/ticket-80";

export const metadata: Metadata = { title: "Constancia de socio" };

// Constancia de aporte / retiro / utilidad en 80 mm. Lo abre BotonImprimir80 en un iframe oculto.
export default async function ImprimirAporte({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await obtenerContexto();
  const [{ data: m }, logo] = await Promise.all([
    ctx.supabase.from("v_aportes_retiros").select("*").eq("id", id).maybeSingle(),
    logoDataUri(ctx),
  ]);
  if (!m) notFound();
  const tipo = m.tipo as TipoMovSocio;
  return (
    <HojaTicket80 empresa={ctx.empresa} logo={logo}>
      <div className="tit">CONSTANCIA · {ETIQUETA_MOV_SOCIO[tipo].toUpperCase()}</div>
      {m.estado === "anulada" && <div className="c b">*** ANULADO ***</div>}
      <div className="c">{fechaHora(m.fecha)}</div>
      <div className="lin" />
      <div><span className="b">Socio: </span>{m.socio_nombre}</div>
      {m.periodo && <div><span className="b">Utilidad de: </span>{nombrePeriodo(m.periodo)}</div>}
      <div><span className="b">{tipo === "aporte" ? "Ingresó a: " : tipo === "capitalizacion" ? "Caja: " : "Salió de: "}</span>{m.caja_nombre ?? "Sin movimiento de dinero"}</div>
      {m.voucher_numero && <div><span className="b">Voucher N°: </span>{m.voucher_numero}</div>}
      {m.nota && <div><span className="b">Nota: </span>{m.nota}</div>}
      <div className="lin" />
      <div className="fila total"><span>MONTO</span><span>{soles(m.monto)}</span></div>
      {m.creado_por_nombre && <div className="peq">Registró: {m.creado_por_nombre}</div>}
      <div className="lin" />
      <br /><br />
      <div className="c">_______________________</div>
      <div className="c peq">Firma del socio</div>
    </HojaTicket80>
  );
}

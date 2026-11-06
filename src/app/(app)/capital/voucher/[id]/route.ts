import { obtenerContexto } from "@/lib/contexto";
import { urlArchivo } from "@/lib/archivos-servidor";

// Abre el voucher de un movimiento de socio (archivo privado → URL firmada de 1 hora)
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await obtenerContexto();
  const { data } = await supabase.from("aportes_retiros").select("voucher_url").eq("id", id).maybeSingle();
  const url = await urlArchivo(supabase, data?.voucher_url);
  if (!url) return new Response("Este movimiento no tiene voucher.", { status: 404 });
  return Response.redirect(url, 302);
}

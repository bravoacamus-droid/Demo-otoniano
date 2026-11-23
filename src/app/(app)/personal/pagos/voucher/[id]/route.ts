import { exigir } from "@/lib/contexto";
import { urlArchivo } from "@/lib/archivos-servidor";

// Abre el voucher de un pago al personal (archivo privado → URL firmada de 1 hora)
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await exigir("personal");
  const { data } = await supabase.from("pagos_personal").select("voucher_url").eq("id", id).maybeSingle();
  const url = await urlArchivo(supabase, data?.voucher_url);
  if (!url) return new Response("Este pago no tiene voucher.", { status: 404 });
  return Response.redirect(url, 302);
}

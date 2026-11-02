"use server";

import { obtenerContexto } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import type { Resultado } from "@/lib/tipos";

/** Pago de cuotas: la BD lo aplica a las cuotas en orden y mueve la caja */
export async function registrarPagoCredito(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("registrar_pago_credito", {
    p_credito: texto(fd, "credito_id") ?? "",
    p_monto: Number(normalizar(texto(fd, "monto") ?? "") || 0),
    p_medio: texto(fd, "medio_id") ?? undefined,
    p_caja: texto(fd, "caja_id") ?? undefined,
    p_nota: texto(fd, "nota") ?? undefined,
    p_clave: texto(fd, "clave") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularPagoCredito(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_pago_credito", { p_pago: texto(fd, "id") ?? "", p_motivo: texto(fd, "motivo") ?? "" });
  if (error) return fallo(error);
  return ok(null);
}

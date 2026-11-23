"use server";

import { exigir } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import type { Resultado } from "@/lib/tipos";

/** «ninguna» = pagado por fuera (no sale de ninguna caja) */
const cajaDe = (fd: FormData) => {
  const c = texto(fd, "caja_id");
  return c && c !== "ninguna" ? c : null;
};

/** Cómo y a dónde se pagó: medio, destino, N° de operación y voucher (ruta en el bucket) */
const cobro = (fd: FormData) => ({
  p_medio: texto(fd, "medio") ?? "efectivo",
  p_destino: texto(fd, "destino") ?? undefined,
  p_operacion: texto(fd, "operacion") ?? undefined,
  p_voucher_url: texto(fd, "voucher_url") ?? undefined,
});

export async function registrarPago(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await exigir("personal");
  const monto = normalizar(texto(fd, "monto") ?? "");
  if (!monto || Number(monto) <= 0) return fallo("Ingrese el monto.");
  if (!texto(fd, "caja_id")) return fallo("Elija de dónde sale el dinero.");
  const { error } = await supabase.rpc("registrar_pago_personal", {
    p_empresa: empresa.id, p_trabajador: texto(fd, "trabajador_id")!, p_periodo: texto(fd, "periodo")!,
    p_tipo: texto(fd, "tipo") ?? "pago", p_monto: Number(monto),
    p_caja: cajaDe(fd) ?? undefined, p_nota: texto(fd, "nota") ?? undefined, ...cobro(fd),
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function editarPago(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await exigir("personal");
  const monto = normalizar(texto(fd, "monto") ?? "");
  if (!monto || Number(monto) <= 0) return fallo("Ingrese el monto.");
  const { error } = await supabase.rpc("editar_pago_personal", {
    p_id: texto(fd, "id")!, p_periodo: texto(fd, "periodo")!, p_tipo: texto(fd, "tipo")!, p_monto: Number(monto),
    p_caja: cajaDe(fd)!, p_nota: texto(fd, "nota")!, p_razon: texto(fd, "razon")!, ...cobro(fd),
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularPago(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await exigir("personal");
  const { error } = await supabase.rpc("anular_pago_personal", { p_id: texto(fd, "id")!, p_motivo: texto(fd, "motivo")! });
  if (error) return fallo(error);
  return ok(null);
}

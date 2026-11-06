"use server";

import { obtenerContexto } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import { hoyLima } from "@/lib/formato";
import type { Resultado } from "@/lib/tipos";

export async function guardarSocio(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const id = texto(fd, "id");
  const datos = {
    nombre: texto(fd, "nombre"),
    dni: texto(fd, "dni"),
    porcentaje: normalizar(texto(fd, "porcentaje") ?? "0") || "0",
    activo: fd.get("activo") !== "off",
  };
  if (!datos.nombre) return fallo("Ingrese el nombre del socio.");
  if (datos.dni && !/^\d{8}$/.test(datos.dni)) return fallo("El DNI debe tener 8 dígitos.");
  if (Number(datos.porcentaje) > 100) return fallo("El porcentaje no puede pasar de 100.");
  const { error, count } = id
    ? await supabase.from("socios").update(datos, { count: "exact" }).eq("id", id)
    : await supabase.from("socios").insert({ ...datos, empresa_id: empresa.id }, { count: "exact" });
  if (error) return fallo(error);
  if (!count) return fallo("Solo el dueño puede gestionar socios.");
  return ok(null);
}

const fechaLima = (fd: FormData) => {
  const f = texto(fd, "fecha");
  return f && f !== hoyLima() ? `${f}T12:00:00-05:00` : null;
};

/** Aporte, retiro de capital, utilidad entregada o utilidad que se deja como capital (con su voucher) */
export async function registrarMovimientoSocio(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const monto = normalizar(texto(fd, "monto") ?? "");
  if (!monto) return fallo("Ingrese el monto.");
  const tipo = texto(fd, "tipo") as "aporte" | "retiro" | "retiro_utilidad" | "capitalizacion";
  const { error } = await supabase.rpc("registrar_movimiento_socio", {
    p_empresa: empresa.id, p_socio: texto(fd, "socio_id")!, p_tipo: tipo, p_monto: Number(monto),
    p_caja: tipo === "capitalizacion" ? undefined : texto(fd, "caja_id") ?? undefined,
    p_fecha: fechaLima(fd) ?? undefined, p_nota: texto(fd, "nota") ?? undefined,
    p_voucher_numero: texto(fd, "voucher_numero") ?? undefined, p_voucher_url: texto(fd, "voucher_url") ?? undefined,
    p_periodo: texto(fd, "periodo") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

/** «Editar el capital» de un socio: la diferencia queda registrada como aporte o retiro */
export async function ajustarCapital(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const capital = normalizar(texto(fd, "capital") ?? "");
  if (!capital) return fallo("Ingrese el capital correcto.");
  const { error } = await supabase.rpc("ajustar_capital_socio", {
    p_empresa: empresa.id, p_socio: texto(fd, "socio_id")!, p_capital: Number(capital), p_motivo: texto(fd, "motivo") ?? "",
    p_caja: texto(fd, "caja_id") ?? undefined, p_fecha: fechaLima(fd) ?? undefined,
    p_voucher_numero: texto(fd, "voucher_numero") ?? undefined, p_voucher_url: texto(fd, "voucher_url") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function actualizarVoucher(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("actualizar_aporte_voucher", {
    p_id: texto(fd, "id")!, p_voucher_numero: texto(fd, "voucher_numero") ?? "",
    p_voucher_url: texto(fd, "voucher_url") ?? "", p_nota: texto(fd, "nota") ?? "",
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularAporteRetiro(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_aporte_retiro", { p_id: texto(fd, "id"), p_motivo: texto(fd, "motivo") });
  if (error) return fallo(error);
  return ok(null);
}

export async function cerrarMes(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const { error } = await supabase.rpc("cerrar_mes", { p_empresa: empresa.id, p_periodo: texto(fd, "periodo") });
  if (error) return fallo(error);
  return ok(null);
}

export async function reabrirMes(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const { error } = await supabase.rpc("reabrir_mes", {
    p_empresa: empresa.id, p_periodo: texto(fd, "id"), p_motivo: texto(fd, "motivo"),
  });
  if (error) return fallo(error);
  return ok(null);
}

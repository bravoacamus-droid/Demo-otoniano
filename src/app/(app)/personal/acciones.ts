"use server";

import { obtenerContexto, olvidarMembresias } from "@/lib/contexto";
import { crearUsuarioEmpresa } from "@/lib/usuarios";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import type { Resultado } from "@/lib/tipos";
import type { Json } from "@/lib/supabase/database.types";
import { hoyLima } from "@/lib/formato";

const fechaValida = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Ficha del trabajador (alta o edición). La RLS deja escribir solo a Gerencia. */
export async function guardarTrabajador(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const id = texto(fd, "id");
  const sueldo = normalizar(texto(fd, "sueldo_mensual") ?? "");
  const datos = {
    nombre: texto(fd, "nombre"),
    dni: texto(fd, "dni"),
    cargo: texto(fd, "cargo"),
    telefono: texto(fd, "telefono"),
    fecha_ingreso: fechaValida(texto(fd, "fecha_ingreso")),
    fecha_cese: fechaValida(texto(fd, "fecha_cese")),
    motivo_cese: texto(fd, "motivo_cese"),
    sueldo_mensual: sueldo ? Number(sueldo) : null,
    notas: texto(fd, "notas"),
  };
  if (!datos.nombre) return fallo("Ingrese el nombre del trabajador.");
  if (datos.dni && !/^\d{8}$/.test(datos.dni)) return fallo("El DNI debe tener 8 dígitos.");
  if (!datos.fecha_ingreso) return fallo("Ingrese la fecha de ingreso.");
  if (datos.fecha_ingreso > hoyLima()) return fallo("La fecha de ingreso no puede ser futura.");
  if (datos.fecha_cese && datos.fecha_cese < datos.fecha_ingreso) return fallo("La fecha de cese no puede ser anterior al ingreso.");
  if (!datos.fecha_cese) datos.motivo_cese = null;
  // Acceso al sistema: correo y contraseña; su usuario toma el cargo de la ficha
  const acceso = fd.get("acceso") === "on";
  const email = texto(fd, "email");
  let cargoId: string | null = null;
  if (acceso) {
    if (!email) return fallo("Ingrese el correo con el que entrará al sistema.");
    if (!datos.cargo) return fallo("Elija el cargo: define qué pantallas verá en el sistema.");
    const { data: c } = await supabase.from("cargos").select("id").eq("empresa_id", empresa.id).eq("activo", true).eq("nombre", datos.cargo).maybeSingle();
    if (!c) return fallo("Ese cargo no existe en Cargos y permisos: elija uno de la lista.");
    cargoId = c.id;
  }

  const { data: fila, error } = id
    ? await supabase.from("trabajadores").update(datos).eq("id", id).select("id, user_id").maybeSingle()
    : await supabase.from("trabajadores").insert({ ...datos, fecha_ingreso: datos.fecha_ingreso, nombre: datos.nombre, empresa_id: empresa.id })
      .select("id, user_id").maybeSingle();
  if (error) return fallo(error.code === "23505" ? "Ya hay un trabajador con ese DNI." : error);
  if (!fila) return fallo("Solo Gerencia puede gestionar el personal.");

  if (acceso && cargoId && !fila.user_id) {
    const u = await crearUsuarioEmpresa(empresa.id, { email: email!, nombre: datos.nombre, password: texto(fd, "password"), cargoId });
    if (!u.ok) return fallo(`Trabajador guardado, pero no se pudo crear su acceso: ${u.error}`);
    const { error: e2 } = await supabase.from("trabajadores").update({ user_id: u.data }).eq("id", fila.id);
    if (e2) return fallo(e2.code === "23505" ? "Ese usuario ya está unido a otro trabajador." : e2);
  }
  olvidarMembresias();
  return ok(null);
}

export interface FilaAsistencia {
  trabajador_id: string;
  estado: string;
  entrada: string;
  salida: string;
  horas_extra: string;
  nota: string;
}

/** Asistencia de un día (todas las filas marcadas de una vez) */
export async function guardarAsistencia(fecha: string, filas: FilaAsistencia[]): Promise<Resultado<number>> {
  const { supabase, empresa } = await obtenerContexto();
  const { data, error } = await supabase.rpc("guardar_asistencia", {
    p_empresa: empresa.id,
    p_fecha: fecha,
    p_filas: filas.map((f) => ({ ...f, horas_extra: normalizar(f.horas_extra) || "0" })),
  });
  if (error) return fallo(error);
  return ok(data as number);
}

/** Gerencia aprueba las horas extras del periodo (de un trabajador o de todos) */
export async function aprobarHorasExtra(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const { error } = await supabase.rpc("aprobar_horas_extra", {
    p_empresa: empresa.id,
    p_desde: texto(fd, "desde") ?? "",
    p_hasta: texto(fd, "hasta") ?? "",
    p_trabajador: texto(fd, "trabajador_id") ?? undefined,
    // Solo lo que Gerencia tenía en pantalla: lo que se marcó después queda por aprobar
    p_visto_en: texto(fd, "visto_en") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

export interface CeldaTareo { trabajador_id: string; fecha: string; estado: string }

/** Casillas cambiadas del tareo del mes (un solo «Guardar cambios») */
export async function guardarTareo(celdas: CeldaTareo[]): Promise<Resultado<number>> {
  const { supabase, empresa } = await obtenerContexto();
  const { data, error } = await supabase.rpc("guardar_tareo", { p_empresa: empresa.id, p_celdas: celdas as unknown as Json });
  if (error) return fallo(error);
  return ok(data as number);
}

/** Horas extras de un día: las anota Gerencia y quedan aprobadas (0 = quitarlas) */
export async function registrarHorasExtra(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const horas = normalizar(texto(fd, "horas") ?? "");
  const fecha = fechaValida(texto(fd, "fecha"));
  if (!fecha) return fallo("Indique el día.");
  if (horas === "") return fallo("Ingrese las horas extras (0 para quitarlas).");
  const { error } = await supabase.rpc("registrar_horas_extra", {
    p_empresa: empresa.id, p_trabajador: texto(fd, "trabajador_id") ?? "", p_fecha: fecha, p_horas: Number(horas),
    p_nota: texto(fd, "nota") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

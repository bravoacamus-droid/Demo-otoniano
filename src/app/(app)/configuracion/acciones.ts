"use server";

import { exigir, olvidarMembresias } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Resultado, Rol } from "@/lib/tipos";

const ROLES: Rol[] = ["dueno", "administrador", "cajero", "balancero", "socio"];

export async function guardarEmpresa(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await exigir("configurar");
  const ruc = texto(fd, "ruc");
  if (ruc && !/^\d{11}$/.test(ruc)) return fallo("El RUC debe tener 11 dígitos.");
  const monto = texto(fd, "monto_doc_obligatorio");
  const roles = ROLES.filter((r) => r === "dueno" || fd.get(`precio_${r}`) === "on");
  const dias = Number(texto(fd, "dias_seleccion") ?? 2);
  if (!Number.isInteger(dias) || dias < 0 || dias > 60) return fallo("Los días para limpiar deben estar entre 0 y 60.");
  const alertaTxt = normalizar(texto(fd, "merma_alerta_pct") ?? "");
  const alerta = alertaTxt === "" ? 5 : Number(alertaTxt);
  if (!(alerta >= 0 && alerta <= 100)) return fallo("El % de merma debe estar entre 0 y 100.");
  // Personal: jornada diaria y sobretasas (horas extras y domingo trabajado)
  // Vacío = valor por defecto; un 0 escrito se respeta (p. ej. domingo con descanso sustitutorio)
  const num = (campo: string, def: number) => { const v = normalizar(texto(fd, campo) ?? ""); return v === "" ? def : Number(v); };
  const jornada = num("jornada_horas", 8);
  const hx1 = num("hx_tasa_primeras", 25);
  const hx2 = num("hx_tasa_siguientes", 35);
  const dom = num("domingo_tasa", 100);
  if (!(jornada > 0 && jornada <= 24)) return fallo("La jornada debe ser mayor a 0 y de hasta 24 horas.");
  if ([hx1, hx2, dom].some((t) => !(t >= 0 && t <= 300))) return fallo("Las sobretasas deben estar entre 0 y 300 %.");
  const { error } = await supabase.from("empresas").update({
    razon_social: texto(fd, "razon_social"),
    ruc,
    direccion: texto(fd, "direccion"),
    telefono: texto(fd, "telefono"),
    monto_doc_obligatorio: monto ? normalizar(monto) || null : null,
    roles_editan_precio: roles,
    dias_seleccion: dias,
    merma_alerta_pct: alerta,
    jornada_horas: jornada,
    hx_tasa_primeras: hx1,
    hx_tasa_siguientes: hx2,
    domingo_tasa: dom,
  }).eq("id", empresa.id);
  if (error) return fallo(error);
  olvidarMembresias();
  return ok(null);
}

/** Crea el usuario en Supabase Auth (o reutiliza uno existente) y lo agrega como miembro. */
export async function invitarUsuario(_: unknown, fd: FormData): Promise<Resultado> {
  const { empresa } = await exigir("configurar");
  const email = texto(fd, "email")?.toLowerCase();
  const nombre = texto(fd, "nombre");
  const password = texto(fd, "password");
  const rol = texto(fd, "rol") as Rol;
  if (!email || !nombre) return fallo("Ingrese nombre y correo.");
  if (!ROLES.includes(rol)) return fallo("Rol no válido.");

  const admin = crearClienteAdmin();
  let userId: string | null = null;
  const { data: creado, error } = await admin.auth.admin.createUser({
    email, password: password ?? undefined, email_confirm: true, user_metadata: { nombre },
  });
  if (creado?.user) {
    userId = creado.user.id;
  } else if (error && /already|registered|exists/i.test(error.message)) {
    // Ya tiene cuenta (p. ej. trabaja en otra empresa): solo se agrega como miembro
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = lista?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  } else if (error) {
    return fallo(error.message.includes("Password") ? "La contraseña debe tener al menos 6 caracteres." : error.message);
  }
  if (!userId) return fallo("No se pudo crear el usuario.");

  const { error: e2 } = await admin.rpc("admin_agregar_miembro", {
    p_empresa: empresa.id, p_user: userId, p_rol: rol, p_nombre: nombre, p_email: email,
  });
  if (e2) return fallo(e2);
  olvidarMembresias();
  return ok(null);
}

export async function actualizarMiembro(userId: string, cambios: { rol?: Rol; activo?: boolean }): Promise<Resultado> {
  const { supabase, empresa, userId: yo } = await exigir("configurar");
  if (userId === yo) return fallo("No puede cambiar su propio rol ni desactivarse.");
  const { error } = await supabase.from("miembros").update(cambios).eq("empresa_id", empresa.id).eq("user_id", userId);
  if (error) return fallo(error);
  olvidarMembresias();
  return ok(null);
}

export async function guardarCaja(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await exigir("configurar");
  const id = texto(fd, "id");
  const datos = { nombre: texto(fd, "nombre"), tipo: texto(fd, "tipo"), orden: Number(texto(fd, "orden") ?? 0) || 0 };
  if (!datos.nombre) return fallo("Ingrese el nombre de la caja.");
  const { error } = id
    ? await supabase.from("cajas").update(datos).eq("id", id)
    : await supabase.from("cajas").insert({ ...datos, empresa_id: empresa.id });
  if (error) return fallo(error);
  return ok(null);
}

export async function cambiarEstado(tabla: "cajas" | "categorias_gasto" | "medios_pago", id: string, activo: boolean): Promise<Resultado> {
  const { supabase } = await exigir("configurar");
  const { error } = await supabase.from(tabla).update({ activo }).eq("id", id);
  if (error) return fallo(error);
  return ok(null);
}

export async function guardarCategoria(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await exigir("configurar");
  const nombre = texto(fd, "nombre");
  if (!nombre) return fallo("Ingrese el nombre.");
  const { error } = await supabase.from("categorias_gasto").insert({ nombre, empresa_id: empresa.id });
  if (error) return fallo(error);
  return ok(null);
}

export async function guardarMedioPago(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await exigir("configurar");
  const id = texto(fd, "id");
  const tipo = texto(fd, "tipo");
  if (!tipo || !["efectivo", "yape", "plin", "transferencia"].includes(tipo)) return fallo("Tipo no válido.");
  const datos = { nombre: texto(fd, "nombre"), tipo, caja_id: texto(fd, "caja_id"), orden: Number(texto(fd, "orden") ?? 0) || 0 };
  if (!datos.nombre) return fallo("Ingrese el nombre del medio de pago.");
  const { error } = id
    ? await supabase.from("medios_pago").update(datos).eq("id", id)
    : await supabase.from("medios_pago").insert({ ...datos, empresa_id: empresa.id });
  if (error) return fallo(error);
  return ok(null);
}

/** Serie y último N° emitido de cada comprobante de venta: la próxima venta toma el siguiente */
export async function guardarSerieComprobante(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await exigir("configurar");
  const tipo = texto(fd, "tipo");
  if (tipo !== "factura" && tipo !== "boleta" && tipo !== "nota_venta") return fallo("Comprobante no válido.");
  const ultimo = Number(texto(fd, "ultimo") ?? 0);
  if (!Number.isInteger(ultimo) || ultimo < 0) return fallo("El último número emitido debe ser un entero (0 si aún no emite ninguno).");
  const { error } = await supabase.rpc("configurar_serie_comprobante", {
    p_empresa: empresa.id, p_tipo: tipo, p_serie: texto(fd, "serie") ?? "", p_ultimo: ultimo,
  });
  return error ? fallo(error) : ok(null);
}

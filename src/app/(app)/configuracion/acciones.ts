"use server";

import { exigir, olvidarMembresias } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import { crearUsuarioEmpresa } from "@/lib/usuarios";
import type { Resultado, Rol } from "@/lib/tipos";
import { MODULOS, visible } from "@/components/shell/modulos";

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

/** Alta de usuario con su cargo (Configuración → Usuarios) */
export async function invitarUsuario(_: unknown, fd: FormData): Promise<Resultado> {
  const { empresa } = await exigir("configurar");
  const email = texto(fd, "email");
  const nombre = texto(fd, "nombre");
  const cargoId = texto(fd, "cargo_id");
  if (!email || !nombre) return fallo("Ingrese nombre y correo.");
  if (!cargoId) return fallo("Elija el cargo del usuario.");
  const r = await crearUsuarioEmpresa(empresa.id, { email, nombre, password: texto(fd, "password"), cargoId });
  return r.ok ? ok(null) : r;
}

export async function actualizarMiembro(userId: string, cambios: { cargoId?: string; activo?: boolean }): Promise<Resultado> {
  const { supabase, empresa, userId: yo } = await exigir("configurar");
  if (userId === yo) return fallo("No puede cambiar su propio cargo ni desactivarse.");
  const { error } = cambios.cargoId
    ? await supabase.rpc("asignar_cargo_miembro", { p_empresa: empresa.id, p_user: userId, p_cargo: cambios.cargoId })
    : await supabase.from("miembros").update({ activo: cambios.activo }).eq("empresa_id", empresa.id).eq("user_id", userId);
  if (error) return fallo(error);
  olvidarMembresias();
  return ok(null);
}

const NIVELES: Rol[] = ["dueno", "administrador", "cajero"];

/** Cargo con su nivel de acceso y las pantallas marcadas. Todas marcadas = null (las pantallas nuevas aparecen solas). */
export async function guardarCargo(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await exigir("configurar");
  const rol = texto(fd, "rol") as Rol;
  if (!NIVELES.includes(rol)) return fallo("Elija el nivel de acceso.");
  const posibles = MODULOS.flatMap((m) => m.items).filter((i) => i.href !== "/" && visible(rol, i)).map((i) => i.href);
  const marcadas = fd.getAll("seccion").map(String).filter((h) => posibles.includes(h));
  if (rol !== "dueno" && marcadas.length === 0) return fallo("Marque al menos una pantalla.");
  const { error } = await supabase.rpc("guardar_cargo", {
    p_empresa: empresa.id,
    p_id: texto(fd, "id"),
    p_nombre: texto(fd, "nombre") ?? "",
    p_rol: rol as "dueno" | "administrador" | "cajero",
    p_secciones: marcadas.length === posibles.length ? null : marcadas,
    p_activo: fd.get("activo") !== "off",
  });
  if (error) return fallo(error);
  // El menú de los usuarios con ese cargo cambia en su próxima pantalla
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

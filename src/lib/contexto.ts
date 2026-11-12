import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "./supabase/server";
import { puede, type Accion } from "./permisos";
import { rutaPermitida } from "@/components/shell/modulos";
import type { Empresa, Rol } from "./tipos";

export const COOKIE_EMPRESA = "empresa_activa";

export interface Contexto {
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>;
  userId: string;
  email: string;
  nombre: string;
  empresa: Empresa;
  rol: Rol;
  /** Cargo del usuario (Configuración → Cargos y permisos) */
  cargo: string | null;
  /** Pantallas que su cargo tiene marcadas; null = todas las de su nivel */
  secciones: string[] | null;
  empresas: { id: string; razon_social: string; rol: Rol }[];
}

type Membresia = { rol: Rol; nombre: string | null; empresa: Empresa; cargo: { nombre: string; secciones: string[] | null } | null };

/**
 * Membresías por usuario en memoria del servidor por unos segundos: así cambiar de sección no
 * espera una consulta extra a Supabase. Solo afecta a la UI (menú, permisos visibles); la RLS
 * sigue validando cada lectura y escritura. Se limpia al cambiar empresa, roles o miembros.
 */
const MEMBRESIAS_TTL_MS = 30_000;
const membresias = new Map<string, { lista: Membresia[]; vence: number }>();

export function olvidarMembresias() {
  membresias.clear();
}

/** Usuario + empresa activa + rol. Redirige a /login o /sin-empresa si corresponde. */
export const obtenerContexto = cache(async (): Promise<Contexto> => {
  const supabase = await crearClienteServidor();
  // JWT verificado localmente (el middleware ya refrescó la sesión): sin viaje a Supabase Auth
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub, email: (claims.email as string | undefined) ?? "" };

  let lista = membresias.get(user.id);
  if (!lista || lista.vence < Date.now()) {
    const { data: filas, error } = await supabase
      .from("miembros")
      .select("rol, nombre, cargo:cargos(nombre, secciones), empresa:empresas(id, razon_social, ruc, direccion, telefono, logo_url, monto_doc_obligatorio, roles_editan_precio, dias_seleccion, merma_alerta_pct, jornada_horas, hx_tasa_primeras, hx_tasa_siguientes, domingo_tasa)")
      .eq("user_id", user.id)
      .eq("activo", true);
    // Un error (p. ej. columna nueva sin su migración) no es «sin empresa»: que se vea
    if (error) throw new Error(`No se pudo leer la empresa: ${error.message}`);
    lista = {
      lista: (filas ?? [])
        .filter((m) => m.empresa)
        .map((m) => ({ rol: m.rol as Rol, nombre: m.nombre as string | null, empresa: m.empresa as unknown as Empresa, cargo: m.cargo as unknown as Membresia["cargo"] })),
      vence: Date.now() + MEMBRESIAS_TTL_MS,
    };
    if (lista.lista.length > 0) membresias.set(user.id, lista);
  }
  const { lista: miembros } = lista;
  if (miembros.length === 0) redirect("/sin-empresa");

  const elegida = (await cookies()).get(COOKIE_EMPRESA)?.value;
  const actual = miembros.find((m) => m.empresa.id === elegida) ?? miembros[0];
  // Gerencia ve todo; los demás, solo las pantallas que su cargo tiene marcadas (la ruta la pone el middleware)
  const secciones = actual.rol === "dueno" ? null : actual.cargo?.secciones ?? null;
  const ruta = (await headers()).get("x-ruta");
  if (ruta && !rutaPermitida(ruta, secciones)) redirect("/sin-permiso");

  return {
    supabase,
    userId: user.id,
    email: user.email,
    nombre: actual.nombre ?? user.email?.split("@")[0] ?? "",
    empresa: actual.empresa,
    rol: actual.rol,
    cargo: actual.cargo?.nombre ?? null,
    secciones,
    empresas: miembros.map((m) => ({ id: m.empresa.id, razon_social: m.empresa.razon_social, rol: m.rol })),
  };
});

/** Igual que obtenerContexto, pero corta con /sin-permiso si el rol no puede ninguna de las acciones. */
export async function exigir(...acciones: Accion[]): Promise<Contexto> {
  const ctx = await obtenerContexto();
  if (!acciones.some((a) => puede(ctx.rol, a))) redirect("/sin-permiso");
  return ctx;
}

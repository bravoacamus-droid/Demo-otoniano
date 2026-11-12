import "server-only";
import { crearClienteAdmin } from "./supabase/admin";
import { fallo, ok } from "./acciones";
import { olvidarMembresias } from "./contexto";
import type { Resultado, Rol } from "./tipos";

/**
 * Crea el usuario en Supabase Auth (o reutiliza uno existente) y lo agrega a la empresa con su cargo.
 * Lo usan Configuración → Usuarios y la ficha del trabajador («Puede entrar al sistema»).
 */
export async function crearUsuarioEmpresa(empresaId: string, d: {
  email: string; nombre: string; password: string | null; cargoId: string;
}): Promise<Resultado<string>> {
  const admin = crearClienteAdmin();
  const email = d.email.trim().toLowerCase();
  const { data: cargo } = await admin.from("cargos").select("rol").eq("id", d.cargoId).eq("empresa_id", empresaId).eq("activo", true).maybeSingle();
  if (!cargo) return fallo("Cargo no válido.");

  let userId: string | null = null;
  const { data: creado, error } = await admin.auth.admin.createUser({
    email, password: d.password ?? undefined, email_confirm: true, user_metadata: { nombre: d.nombre },
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
    p_empresa: empresaId, p_user: userId, p_rol: cargo.rol as Rol, p_nombre: d.nombre, p_email: email, p_cargo: d.cargoId,
  });
  if (e2) return fallo(e2);
  olvidarMembresias();
  return ok(userId);
}

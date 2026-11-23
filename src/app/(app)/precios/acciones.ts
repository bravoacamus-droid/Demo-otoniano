"use server";

import { obtenerContexto } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import type { Resultado } from "@/lib/tipos";

/** Guarda solo los precios que cambiaron. El trigger de la BD deja el histórico. */
export async function guardarPrecios(cambios: { id: string; precio_compra: string; precio_mayorista: string; precio_venta: string }[]): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  for (const c of cambios) {
    // String(): desde el cliente pueden llegar números (numeric de Postgres) en vez de texto
    const pc = normalizar(String(c.precio_compra));
    const pv = normalizar(String(c.precio_venta));
    const mayorista = String(c.precio_mayorista ?? "").trim();
    const pm = mayorista ? normalizar(mayorista) : null;
    if (!pc || !pv || pm === "") return fallo("Los precios deben ser números válidos.");
    const { error, count } = await supabase
      .from("metales")
      .update({ precio_compra: pc, precio_venta: pv, precio_mayorista: pm }, { count: "exact" })
      .eq("id", c.id);
    if (error) return fallo(error);
    if (!count) return fallo("Solo Gerencia o Administración pueden cambiar los precios del día.");
  }
  return ok(null);
}

export async function guardarMetal(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const id = texto(fd, "id");
  const mayorista = texto(fd, "precio_mayorista");
  const datos = {
    nombre: texto(fd, "nombre"),
    codigo: texto(fd, "codigo"),
    padre_id: texto(fd, "padre_id"),
    color: texto(fd, "color"),
    orden: Number(texto(fd, "orden") ?? 0) || 0,
    unidad: texto(fd, "unidad") ?? "kg",
    precio_compra: normalizar(texto(fd, "precio_compra") ?? "0") || "0",
    precio_mayorista: mayorista ? normalizar(mayorista) || null : null,
    precio_venta: normalizar(texto(fd, "precio_venta") ?? "0") || "0",
  };
  if (!datos.nombre) return fallo("Ingrese el nombre del producto.");
  if (id) {
    // Cambiar la unidad no convierte lo que ya hay: solo se permite con el stock en cero
    const { data: actual } = await supabase.from("v_stock_metal").select("unidad, kg").eq("metal_id", id).maybeSingle();
    if (actual && actual.unidad !== datos.unidad && Number(actual.kg) !== 0) {
      return fallo("Este producto ya tiene stock: la unidad de medida solo se cambia con el stock en cero.");
    }
  }
  if (id && datos.padre_id === id) return fallo("Un producto no puede estar dentro de sí mismo.");
  const { error } = id
    ? await supabase.from("metales").update(datos).eq("id", id)
    : await supabase.from("metales").insert({ ...datos, empresa_id: empresa.id });
  if (error) {
    if (/metales_nombre_uq/.test(error.message)) return fallo("Ya existe un producto con ese nombre en el mismo nivel.");
    if (/metales_codigo_uq/.test(error.message)) return fallo("Ese código ya lo usa otro producto.");
    if (/metales_unidad_fk/.test(error.message)) return fallo("Unidad de medida no válida.");
    return fallo(error);
  }
  return ok(null);
}

export async function cambiarEstadoMetal(id: string, activo: boolean): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.from("metales").update({ activo }).eq("id", id);
  if (error) return fallo(error);
  return ok(null);
}

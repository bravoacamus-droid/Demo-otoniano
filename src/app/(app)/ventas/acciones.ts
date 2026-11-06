"use server";

import { obtenerContexto } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import type { Resultado } from "@/lib/tipos";
import type { TipoComprobante } from "@/lib/comprobantes";
import type { PlanCredito } from "@/components/plan-credito";

export interface DatosVenta {
  clave: string;
  comprador_id: string;
  items: { metal_id: string; peso_salida_kg: string; peso_recibido_kg?: string; precio_kg?: string }[];
  guia_numero: string | null;
  guia_url: string | null;
  notas: string | null;
  /** Si viene caja y todas las líneas traen recibido+precio, se confirma en el acto */
  caja_id: string | null;
  /** Medio de cobro configurado (define el tipo y la caja por defecto) */
  medio_id: string | null;
  comprobante_url: string | null;
  /** Factura, boleta o nota de venta (la BD exige RUC para factura) */
  comprobante_tipo: TipoComprobante;
  comprobante_numero: string | null;
  /** A crédito (solo si se confirma en el acto); null = al contado */
  credito: PlanCredito | null;
}

export async function registrarVenta(d: DatosVenta): Promise<Resultado<{ id: string; numero: number; estado: string }>> {
  const { supabase, empresa } = await obtenerContexto();
  const { data, error } = await supabase.rpc("registrar_venta", {
    p_empresa: empresa.id,
    p_comprador: d.comprador_id,
    p_items: d.items,
    p_guia_numero: d.guia_numero,
    p_guia_url: d.guia_url,
    p_notas: d.notas,
    p_clave: d.clave,
    p_caja: d.caja_id,
    p_comprobante_url: d.comprobante_url,
    p_medio: d.medio_id,
    p_comprobante_tipo: d.comprobante_tipo,
    p_comprobante_numero: d.comprobante_numero ?? undefined,
    p_credito: d.credito ?? undefined,
  });
  if (error) return fallo(error);
  return ok(data as { id: string; numero: number; estado: string });
}

export async function confirmarVenta(d: {
  venta_id: string;
  items: { item_id: string; peso_recibido_kg: string; precio_kg: string }[];
  caja_id: string;
  medio_id: string | null;
  comprobante_url: string | null;
  credito: PlanCredito | null;
}): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("confirmar_venta", {
    p_venta: d.venta_id,
    p_items: d.items,
    p_caja: d.caja_id,
    p_comprobante_url: d.comprobante_url,
    p_medio: d.medio_id,
    p_credito: d.credito ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularVenta(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_venta", { p_venta: texto(fd, "id"), p_motivo: texto(fd, "motivo") });
  if (error) return fallo(error);
  return ok(null);
}

export async function actualizarGuia(d: {
  venta_id: string; guia_numero: string | null; guia_url: string | null; comprobante_url: string | null; notas: string | null;
  comprobante_tipo: TipoComprobante | null; comprobante_numero: string | null;
}): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("actualizar_venta_guia", {
    p_venta: d.venta_id, p_guia_numero: d.guia_numero, p_guia_url: d.guia_url,
    p_comprobante_url: d.comprobante_url, p_notas: d.notas,
    p_comprobante_tipo: d.comprobante_tipo ?? undefined, p_comprobante_numero: d.comprobante_numero ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

/** Corrección de peso recibido/precio de una venta confirmada: solo Gerencia o Administración (lo valida la BD) */
export async function corregirVenta(d: {
  venta_id: string;
  items: { item_id: string; peso_recibido_kg: string; precio_kg: string }[];
  motivo: string;
}): Promise<Resultado<{ total: number; diferencia: number }>> {
  const { supabase } = await obtenerContexto();
  const items = d.items.map((i) => ({ item_id: i.item_id, peso_recibido_kg: normalizar(i.peso_recibido_kg), precio_kg: normalizar(i.precio_kg) }));
  if (items.some((i) => !i.peso_recibido_kg || !i.precio_kg)) return fallo("Ingrese el peso recibido y el precio de cada línea.");
  if (!d.motivo.trim()) return fallo("Indique el motivo de la corrección.");
  const { data, error } = await supabase.rpc("corregir_venta", { p_venta: d.venta_id, p_items: items, p_motivo: d.motivo });
  if (error) return fallo(error);
  return ok(data as { total: number; diferencia: number });
}

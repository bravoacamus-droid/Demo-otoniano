import type { Database } from "@/lib/supabase/database.types";

export type TipoComprobante = Database["public"]["Enums"]["tipo_comprobante"];

/**
 * Comprobante con que se le vende al cliente (solo se registra; la emisión a SUNAT va aparte).
 * La guía de remisión no es un comprobante: respalda el traslado y va en su propio campo.
 */
export const COMPROBANTES: Record<TipoComprobante, { texto: string; corto: string; ayuda: string; ejemplo: string }> = {
  factura: { texto: "Factura", corto: "Factura", ayuda: "Comprador con RUC", ejemplo: "F001-000123" },
  boleta: { texto: "Boleta de venta", corto: "Boleta", ayuda: "Persona o comprador sin RUC", ejemplo: "B001-000123" },
  nota_venta: { texto: "Nota de venta", corto: "Nota de venta", ayuda: "Sin comprobante de SUNAT", ejemplo: "NV-000123" },
};

export const TIPOS_COMPROBANTE = Object.keys(COMPROBANTES) as TipoComprobante[];

/** Con RUC lo usual es factura (le sirve al cliente para el crédito fiscal); sin RUC, boleta */
export const comprobanteSugerido = (ruc: string | null | undefined): TipoComprobante => (ruc ? "factura" : "boleta");

/** «Factura F001-000123», «Boleta» o «—» si la venta es anterior a este dato */
export function textoComprobante(tipo: TipoComprobante | null | undefined, numero?: string | null, corto = true) {
  if (!tipo) return "—";
  const t = corto ? COMPROBANTES[tipo].corto : COMPROBANTES[tipo].texto;
  return numero ? `${t} ${numero}` : t;
}

import type { Tono } from "@/components/ui/basicos";

// Textos de los créditos (compras y ventas a plazos). Los montos y el avance salen de v_creditos.

export type TipoCredito = "por_cobrar" | "por_pagar";
export type Situacion = "al_dia" | "vencido" | "pagado" | "anulado";

export const TIPOS_CREDITO: Record<TipoCredito, { texto: string; contraparte: string; operacion: string; ruta: string; verbo: string }> = {
  por_cobrar: { texto: "Por cobrar", contraparte: "Comprador", operacion: "Venta", ruta: "/ventas", verbo: "Cobrar" },
  por_pagar: { texto: "Por pagar", contraparte: "Proveedor", operacion: "Compra", ruta: "/compras", verbo: "Pagar" },
};

export const SITUACION: Record<Situacion, [string, Tono]> = {
  al_dia: ["Al día", "verde"],
  vencido: ["Vencido", "rojo"],
  pagado: ["Pagado", "gris"],
  anulado: ["Anulado", "gris"],
};

export const FRECUENCIA: Record<string, string> = {
  unica: "Pago único", semanal: "Semanal", quincenal: "Quincenal", mensual: "Mensual",
};

export const SITUACION_CUOTA: Record<string, [string, Tono]> = {
  pagada: ["Pagada", "verde"],
  parcial: ["Pago parcial", "ambar"],
  vencida: ["Vencida", "rojo"],
  pendiente: ["Pendiente", "gris"],
};

/** «2 de 6 cuotas pagadas» */
export const avanceCuotas = (pagadas: number | null | undefined, total: number | null | undefined) =>
  `${pagadas ?? 0} de ${total ?? 0} ${total === 1 ? "cuota pagada" : "cuotas pagadas"}`;

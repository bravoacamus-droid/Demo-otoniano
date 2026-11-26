// Textos de préstamos para la página (servidor) y los cuadros (cliente): fuera del archivo "use client".

export const SITUACION: Record<string, { texto: string; tono: "verde" | "rojo" | "ambar" | "gris" }> = {
  al_dia: { texto: "Al día", tono: "ambar" }, vencido: { texto: "Cuota vencida", tono: "rojo" },
  pagado: { texto: "Devuelto", tono: "verde" }, anulado: { texto: "Anulado", tono: "gris" },
};

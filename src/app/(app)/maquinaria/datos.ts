// Tablas de Maquinaria que usan tanto las páginas (servidor) como los formularios (cliente):
// un objeto exportado desde un archivo "use client" llega al servidor como referencia, no como datos.

export const TIPOS = ["Vehículo", "Balanza", "Prensa", "Compresora", "Montacargas", "Herramienta", "Equipo", "Otro"];

export const ESTADOS: Record<string, { texto: string; tono: "verde" | "ambar" | "gris" }> = {
  operativo: { texto: "Operativa", tono: "verde" }, en_reparacion: { texto: "En reparación", tono: "ambar" }, de_baja: { texto: "De baja", tono: "gris" },
};

export const CATEGORIAS = {
  gasto: ["Mantenimiento", "Reparación", "Repuestos", "Combustible", "Llantas", "Seguro / SOAT", "Compra", "Otro"],
  ingreso: ["Alquiler", "Venta", "Otro"],
} as const;

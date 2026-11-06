// Movimientos de socio (aportes_retiros.tipo): etiquetas para formularios e historial
export type TipoMovSocio = "aporte" | "retiro" | "retiro_utilidad" | "capitalizacion";

export const TIPOS_MOV_SOCIO: Record<TipoMovSocio, { texto: string; ayuda: string }> = {
  aporte: { texto: "Aporte de capital", ayuda: "Entra dinero a la caja y sube el capital del socio." },
  retiro: { texto: "Retiro de capital", ayuda: "Sale dinero de la caja y baja el capital del socio." },
  retiro_utilidad: { texto: "Entregar utilidad", ayuda: "Sale dinero de la caja como pago (o adelanto) de la utilidad del mes. El capital no cambia." },
  capitalizacion: { texto: "Dejar utilidad como capital", ayuda: "No sale dinero: la utilidad del mes que le toca pasa a ser capital del socio." },
};

/** Texto corto para el historial */
export const ETIQUETA_MOV_SOCIO: Record<TipoMovSocio, string> = {
  aporte: "Aporte", retiro: "Retiro de capital", retiro_utilidad: "Utilidad entregada", capitalizacion: "Utilidad a capital",
};

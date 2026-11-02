import type { Rol } from "./tipos";

// Espejo de la RLS/RPC para mostrar u ocultar botones. La garantía real está en la BD.
// Gerencia = dueno · Administración = administrador · Almacén = cajero (balancero: solo compras).
const PERMISOS = {
  comprar: ["dueno", "administrador", "cajero", "balancero"],
  vender: ["dueno", "administrador", "cajero"],
  /** Limpieza: volver a pesar, registrar merma y material separado */
  limpiar: ["dueno", "administrador", "cajero", "balancero"],
  anular: ["dueno"],
  /** Corregir peso/precio de un ticket emitido o anular una limpieza (queda registrado quién) */
  corregir: ["dueno", "administrador"],
  /** Productos (jerarquía) y precios del día */
  editarPrecios: ["dueno", "administrador"],
  ajustarInventario: ["dueno"],
  caja: ["dueno", "cajero"],
  socios: ["dueno"],
  verReportes: ["dueno", "administrador", "socio"],
  /** Costos, capital y utilidad */
  verTodo: ["dueno", "socio"],
  /** Costo promedio del stock (Administración fija precios con él) */
  verCostos: ["dueno", "administrador", "socio"],
  configurar: ["dueno"],
  editarTerceros: ["dueno", "administrador", "cajero"],
  /** Créditos: ver cuentas por cobrar/pagar y registrar pagos de cuotas (anular un pago: «corregir») */
  creditos: ["dueno", "administrador", "cajero"],
  /** Avisos de cuotas vencidas o por vencer (campana de la barra superior) */
  avisosCredito: ["dueno"],
  /** Personal: fichas (ingreso, cese, sueldo) y asistencia diaria */
  personal: ["dueno", "administrador"],
  /** Aprobar horas extras */
  aprobarExtras: ["dueno"],
} as const satisfies Record<string, readonly Rol[]>;

export type Accion = keyof typeof PERMISOS;

export function puede(rol: Rol | null | undefined, accion: Accion): boolean {
  return !!rol && (PERMISOS[accion] as readonly Rol[]).includes(rol);
}

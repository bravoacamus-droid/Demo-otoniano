import type { Contexto } from "./contexto";

export const sumarDias = (iso: string, d: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/** Solo fechas reales (2026-02-31 no pasa) */
export const fechaOk = (v?: string | null) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && sumarDias(v, 0) === v ? v : undefined;

/** Periodo del resumen de Personal: por defecto el mes en curso; nunca después de hoy; si viene al revés, se ordena */
export function periodoPersonal(sp: { desde?: string | null; hasta?: string | null }, hoy: string) {
  const [desde, hasta] = [fechaOk(sp.desde) ?? `${hoy.slice(0, 8)}01`, fechaOk(sp.hasta) ?? hoy]
    .map((d) => (d > hoy ? hoy : d)).sort();
  return { desde, hasta };
}

/** Días del periodo, del primero al último */
export function diasEntre(desde: string, hasta: string) {
  const dias: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

export type MarcaAsistencia = { trabajador_id: string; fecha: string; estado: string; horas_extra: number };

/** Marcas de asistencia de un rango, por páginas (la API devuelve como máximo 1000 filas por consulta) */
export async function marcasAsistencia(supabase: Contexto["supabase"], empresaId: string, desde: string, hasta: string) {
  const todas: MarcaAsistencia[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.from("asistencias").select("trabajador_id, fecha, estado, horas_extra")
      .eq("empresa_id", empresaId).gte("fecha", desde).lte("fecha", hasta).order("id").range(i, i + 999);
    if (error) throw new Error(error.message);
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

export const LETRA_ESTADO: Record<string, string> = { asistio: "A", falta: "F", descanso: "D", permiso: "P", vacaciones: "V" };

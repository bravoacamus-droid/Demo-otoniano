"use client";

import { CalendarClock } from "lucide-react";
import { Campo, Input, InputNumero, Select } from "@/components/ui/campos";
import { Aviso } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import { aCentimos, centimosASoles } from "@/lib/montos";
import { hoyLima } from "@/lib/formato";

export type Frecuencia = "semanal" | "quincenal" | "mensual";
/** Lo que viaja a la RPC (p_credito); null = al contado */
export interface PlanCredito { cuotas: number; frecuencia: Frecuencia; primer_vencimiento: string; inicial: string }

const FRECUENCIAS: { valor: Frecuencia; texto: string; dias: number }[] = [
  { valor: "semanal", texto: "Semanal", dias: 7 },
  { valor: "quincenal", texto: "Quincenal", dias: 15 },
  { valor: "mensual", texto: "Mensual", dias: 0 },
];
const OPCIONES_CUOTAS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

const sumarDias = (iso: string, d: number) => {
  const f = new Date(`${iso}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + d);
  return f.toISOString().slice(0, 10);
};
const sumarMeses = (iso: string, m: number) => {
  const [a, mes, dia] = iso.split("-").map(Number);
  // Como en la BD: si el mes no tiene ese día, queda en su último día (31/01 + 1 mes = 28/02)
  const ultimo = new Date(Date.UTC(a, mes - 1 + m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, mes - 1 + m, Math.min(dia, ultimo))).toISOString().slice(0, 10);
};
const vence = (primero: string, f: Frecuencia, i: number) =>
  f === "mensual" ? sumarMeses(primero, i) : sumarDias(primero, i * (f === "semanal" ? 7 : 15));
const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");

/** Primer vencimiento por defecto: una semana, quince días o un mes desde hoy */
export const primerVencimiento = (f: Frecuencia) => (f === "mensual" ? sumarMeses(hoyLima(), 1) : sumarDias(hoyLima(), FRECUENCIAS.find((x) => x.valor === f)!.dias));

export const planInicial = (): PlanCredito => ({ cuotas: 1, frecuencia: "mensual", primer_vencimiento: primerVencimiento("mensual"), inicial: "" });

/** Cronograma de vista previa (céntimos enteros, igual que la BD: la última cuota absorbe los céntimos) */
export function cronograma(plan: PlanCredito, totalCent: number) {
  const financiado = totalCent - aCentimos(plan.inicial || "0");
  const n = Math.max(1, plan.cuotas);
  const base = Math.floor(financiado / n);
  return {
    financiado,
    cuotas: Array.from({ length: n }, (_, i) => ({
      numero: i + 1,
      vence: vence(plan.primer_vencimiento, plan.frecuencia, i),
      montoCent: i < n - 1 ? base : financiado - base * (n - 1),
    })),
  };
}

/** Error de la vista previa (la BD vuelve a validar todo) */
export function errorPlan(plan: PlanCredito, totalCent: number): string | null {
  const inicial = aCentimos(plan.inicial || "0");
  if (inicial < 0 || inicial >= totalCent) return "La inicial debe ser menor al total.";
  if (!plan.primer_vencimiento || plan.primer_vencimiento < hoyLima()) return "La primera cuota no puede vencer antes de hoy.";
  if (Math.floor((totalCent - inicial) / plan.cuotas) <= 0) return "El monto es muy pequeño para tantas cuotas.";
  return null;
}

/**
 * Forma de pago de una compra o venta: al contado (sale/entra todo de caja ahora) o a crédito,
 * en una sola fecha o en cuotas, con inicial opcional. Muestra el cronograma de cuotas.
 */
export function FormaPago({
  plan, onCambio, totalCent, tipo, deshabilitarCredito,
}: {
  plan: PlanCredito | null;
  onCambio: (p: PlanCredito | null) => void;
  totalCent: number;
  /** compra = le pagamos al proveedor; venta = nos paga el comprador */
  tipo: "compra" | "venta";
  /** Motivo por el que no se ofrece crédito (p. ej. sin proveedor) */
  deshabilitarCredito?: string | null;
}) {
  const credito = plan !== null;
  const cambiar = (c: Partial<PlanCredito>) => plan && onCambio({ ...plan, ...c });
  const { financiado, cuotas } = plan ? cronograma(plan, totalCent) : { financiado: 0, cuotas: [] };
  const error = plan && totalCent > 0 ? errorPlan(plan, totalCent) : null;

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-sm font-medium text-stone-700">Forma de pago</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pago">
          {([
            [false, "Al contado", tipo === "compra" ? "Se paga todo ahora" : "Se cobra todo ahora"],
            [true, "A crédito", deshabilitarCredito ?? "En una fecha o en cuotas"],
          ] as const).map(([esCredito, texto, ayuda]) => {
            const activo = credito === esCredito;
            const bloqueado = esCredito && !!deshabilitarCredito;
            return (
              <button key={texto} type="button" role="radio" aria-checked={activo} disabled={bloqueado}
                onClick={() => onCambio(esCredito ? plan ?? planInicial() : null)}
                className={cx(
                  "min-h-12 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed",
                  activo ? "border-marca-600 bg-marca-50 ring-1 ring-marca-600"
                    : bloqueado ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-superficie hover:border-marca-300",
                )}>
                <span className={cx("block text-sm font-semibold", activo ? "text-marca-700" : bloqueado ? "text-stone-400" : "text-stone-900")}>{texto}</span>
                <span className={cx("block text-xs", bloqueado ? "text-stone-600" : "text-stone-500")}>{ayuda}</span>
              </button>
            );
          })}
        </div>
      </div>

      {plan && (
        <div className="space-y-3 rounded-xl border border-marca-200 bg-marca-50/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Cuotas">
              <Select value={plan.cuotas} onChange={(e) => {
                const n = Number(e.target.value);
                cambiar({ cuotas: n, primer_vencimiento: n > 1 && plan.cuotas === 1 ? primerVencimiento(plan.frecuencia) : plan.primer_vencimiento });
              }}>
                {OPCIONES_CUOTAS.map((n) => <option key={n} value={n}>{n === 1 ? "1 (pago único)" : `${n} cuotas`}</option>)}
              </Select>
            </Campo>
            {plan.cuotas > 1 && (
              <Campo etiqueta="Cada cuánto">
                <Select value={plan.frecuencia} onChange={(e) => {
                  const f = e.target.value as Frecuencia;
                  cambiar({ frecuencia: f, primer_vencimiento: primerVencimiento(f) });
                }}>
                  {FRECUENCIAS.map((f) => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
                </Select>
              </Campo>
            )}
            <Campo etiqueta={plan.cuotas > 1 ? "Vence la primera cuota" : "Fecha de pago"}>
              <Input type="date" value={plan.primer_vencimiento} min={hoyLima()} onChange={(e) => cambiar({ primer_vencimiento: e.target.value })} />
            </Campo>
            <Campo etiqueta="Inicial (opcional)" ayuda={tipo === "compra" ? "Se paga ahora, sale de caja" : "Se cobra ahora, entra a caja"}>
              <InputNumero value={plan.inicial} onChange={(e) => cambiar({ inicial: e.target.value })} placeholder="0.00" />
            </Campo>
          </div>

          {totalCent > 0 && !error && (
            <div className="rounded-lg border border-stone-200 bg-superficie">
              <p className="flex items-center justify-between gap-2 border-b border-stone-100 px-3 py-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium text-stone-700"><CalendarClock className="size-4 text-marca-600" /> Cronograma</span>
                <span className="cifra text-stone-600">{tipo === "compra" ? "Por pagar" : "Por cobrar"}: <b className="text-stone-900">S/ {centimosASoles(financiado)}</b></span>
              </p>
              <ol className="max-h-48 divide-y divide-stone-100 overflow-y-auto text-sm">
                {aCentimos(plan.inicial || "0") > 0 && (
                  <li className="flex items-center justify-between gap-2 px-3 py-1.5 text-stone-600">
                    <span>Inicial · hoy</span>
                    <span className="cifra">S/ {centimosASoles(aCentimos(plan.inicial))}</span>
                  </li>
                )}
                {cuotas.map((q) => (
                  <li key={q.numero} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="text-stone-600">Cuota {q.numero}{cuotas.length > 1 && ` de ${cuotas.length}`} · {fechaCorta(q.vence)}</span>
                    <span className="cifra font-medium">S/ {centimosASoles(q.montoCent)}</span>
                  </li>
                ))}
              </ol>
              <p className="cifra border-t border-stone-100 px-3 py-2 text-xs text-stone-600">
                Total S/ {centimosASoles(totalCent)}
                {aCentimos(plan.inicial || "0") > 0 && <> = inicial S/ {centimosASoles(aCentimos(plan.inicial))} +</>}
                {" "}{cuotas.length === 1 ? "1 pago" : `${cuotas.length} cuotas`} de S/ {centimosASoles(cuotas[0]?.montoCent ?? 0)}{cuotas.length > 1 && cuotas[cuotas.length - 1].montoCent !== cuotas[0].montoCent && " (la última ajusta los céntimos)"}
              </p>
            </div>
          )}
          {error && <div role="alert"><Aviso tono="rojo">{error}</Aviso></div>}
        </div>
      )}
    </div>
  );
}

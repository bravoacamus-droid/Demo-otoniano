"use client";

import { Ban, Building2, Smartphone, Wallet } from "lucide-react";
import { cx } from "@/components/ui/clases";
import { soles } from "@/lib/formato";

export type CajaOrigen = { id: string; nombre: string; saldo?: string | null; tipo?: string | null };

const ICONO = { efectivo: Wallet, banco: Building2, billetera: Smartphone } as const;
export const claseFicha = (activa: boolean) => cx(
  "rounded-xl border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500",
  activa ? "border-marca-600 bg-marca-600 text-white shadow-sm" : "border-stone-200 bg-superficie text-stone-700 hover:border-marca-300 hover:bg-marca-50",
);

/**
 * «¿De dónde sale el dinero?»: una ficha por caja (con su saldo) y «No salió de ninguna caja» (pagado por fuera).
 * Envía `name` con el id de la caja o «ninguna».
 */
export function SelectorOrigenDinero({ cajas, valor, onCambio, name = "caja_id", etiqueta = "¿De dónde salió el dinero?", textoFuera }: {
  cajas: CajaOrigen[]; valor: string; onCambio: (v: string) => void; name?: string; etiqueta?: string;
  /** Explicación de la opción «por fuera» */
  textoFuera?: string;
}) {
  const fuera = valor === "ninguna";
  return (
    <div>
      <p id={`etq-${name}`} className="mb-1.5 text-sm font-medium text-stone-700">{etiqueta}</p>
      <input type="hidden" name={name} value={valor} />
      <div role="radiogroup" aria-labelledby={`etq-${name}`} className="grid gap-2 sm:grid-cols-2">
        {cajas.map((c) => {
          const Icono = ICONO[(c.tipo ?? "efectivo") as keyof typeof ICONO] ?? Wallet;
          const activa = valor === c.id;
          return (
            <button key={c.id} type="button" role="radio" aria-checked={activa} onClick={() => onCambio(c.id)} className={cx(claseFicha(activa), "flex items-center gap-2.5")}>
              <Icono className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.nombre}</span>
                {c.saldo != null && <span className={cx("cifra block text-xs", activa ? "text-white/80" : "text-stone-500")}>Saldo {soles(c.saldo)}</span>}
              </span>
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={fuera} onClick={() => onCambio("ninguna")}
          className={cx(claseFicha(fuera), "flex items-center gap-2.5 sm:col-span-2", !fuera && "border-dashed")}>
          <Ban className="size-4 shrink-0" />
          <span className="min-w-0">
            <span className="block font-semibold">No salió de ninguna caja</span>
            <span className={cx("block text-xs", fuera ? "text-white/80" : "text-stone-500")}>
              {textoFuera ?? "Se pagó por fuera: solo queda anotado en el historial de gastos."}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

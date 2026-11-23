"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, History } from "lucide-react";
import { cx } from "@/components/ui/clases";
import { fechaHora, soles, unidadCorta } from "@/lib/formato";

export type CambioPrecio = {
  id: string; fecha: string; metal_id: string; nombre: string; color: string | null; unidad: string;
  precio_compra: string; precio_mayorista: string | null; precio_venta: string;
};

// Solo grises y azules de la marca (sin el color de cada producto): se lee más limpio
const PRECIOS = [
  { campo: "precio_compra", texto: "Compra", tono: "bg-stone-100 text-stone-700" },
  { campo: "precio_mayorista", texto: "Mayorista", tono: "bg-marca-50 text-marca-700" },
  { campo: "precio_venta", texto: "Venta", tono: "bg-marca-100 text-marca-800" },
] as const;

/**
 * Histórico de precios: llena el alto de su tarjeta (hasta donde termina la tabla de productos) y muestra lo que
 * entra; «Ver todo» lo vuelve desplazable. Cada precio indica si subió o bajó frente a su cambio anterior.
 */
export function HistorialPrecios({ cambios }: { cambios: CambioPrecio[] }) {
  const [todos, setTodos] = useState(false);
  const lista = useRef<HTMLDivElement>(null);
  // Para comparar: el cambio anterior del mismo producto (la lista viene de lo más reciente a lo más antiguo)
  const anterior = (i: number) => cambios.slice(i + 1).find((c) => c.metal_id === cambios[i].metal_id);

  if (!cambios.length) return <p className="px-5 py-8 text-center text-sm text-stone-500">Sin cambios registrados.</p>;

  return (
    <div className="flex h-full flex-col">
      <div ref={lista} className={cx("relative min-h-0 flex-1", todos ? "overflow-y-auto" : "overflow-hidden")}>
        <ol className="relative space-y-3 px-4 py-4">
          <span aria-hidden className="absolute bottom-6 left-[1.6rem] top-6 w-px bg-marca-100" />
          {cambios.map((c, i) => {
            const prev = anterior(i);
            const u = unidadCorta(c.unidad);
            return (
              <li key={c.id} className="relative flex gap-3">
                <span className="relative z-10 mt-3.5 size-3 shrink-0 rounded-full bg-marca-600 ring-4 ring-[var(--color-superficie)]" />
                <div className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-superficie p-3 transition hover:border-marca-300 hover:shadow-sm">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="truncate font-semibold text-stone-900">{c.nombre}</span>
                    <span className="text-xs text-stone-500">{fechaHora(c.fecha)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PRECIOS.map((p) => {
                      const valor = c[p.campo];
                      const antes = prev?.[p.campo];
                      const dif = valor != null && antes != null ? Number(valor) - Number(antes) : 0;
                      return (
                        <div key={p.campo} className={cx("rounded-lg px-2 py-1.5", p.tono)}>
                          <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-75">{p.texto}</span>
                          <span className="cifra flex items-center gap-0.5 text-sm font-semibold">
                            {valor != null ? soles(valor) : "—"}
                            {dif > 0 && <ArrowUp className="size-3.5 text-emerald-700" aria-label="subió" />}
                            {dif < 0 && <ArrowDown className="size-3.5 text-red-700" aria-label="bajó" />}
                          </span>
                          {u !== "kg" && <span className="block text-[10px] opacity-70">por {u}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {/* Lo que no entra se desvanece hacia abajo */}
        {!todos && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--color-superficie)] to-transparent" />}
      </div>
      <div className="border-t border-stone-100 px-4 py-3">
        <button type="button"
          onClick={() => { if (todos) lista.current?.scrollTo({ top: 0 }); setTodos((t) => !t); }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-marca-50 px-3 py-2 text-sm font-medium text-marca-700 transition hover:bg-marca-100">
          {todos ? "Ver menos" : <><History className="size-4" /> Ver todo el historial ({cambios.length})</>}
          <ChevronDown className={cx("size-4 transition-transform", todos && "rotate-180")} />
        </button>
      </div>
    </div>
  );
}

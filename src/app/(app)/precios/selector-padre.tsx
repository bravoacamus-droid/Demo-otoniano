"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FolderTree, Search } from "lucide-react";
import { claseInput, cx } from "@/components/ui/clases";
import type { Producto } from "@/lib/tipos";

const NORM = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** «Dentro de»: lista propia (la nativa del navegador no se puede pintar) con buscador, familias y variantes con su color */
export function SelectorPadre({ productos, valor, onCambio, name }: {
  productos: Producto[];
  valor: string;
  onCambio: (id: string) => void;
  name: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const elegido = productos.find((p) => p.id === valor) ?? null;

  // Al buscar se muestra la ruta completa para no perder de qué familia es cada variante
  const visibles = useMemo(() => {
    const q = NORM(busca.trim());
    return q ? productos.filter((p) => NORM(p.ruta).includes(q)) : productos;
  }, [busca, productos]);

  useEffect(() => {
    if (!abierto) return;
    buscador.current?.focus();
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const elegir = (id: string) => { onCambio(id); setAbierto(false); setBusca(""); };
  const punto = (color: string | null, grande = false) => (
    <span className={cx("shrink-0 rounded-full ring-2 ring-white/70", grande ? "size-3" : "size-2.5")} style={{ background: color ?? "var(--color-stone-400)" }} />
  );

  return (
    <div ref={ref} className="relative" onKeyDown={(e) => { if (e.key === "Escape" && abierto) { e.stopPropagation(); setAbierto(false); } }}>
      <input type="hidden" name={name} value={valor} />
      <button type="button" onClick={() => setAbierto((a) => !a)} aria-haspopup="listbox" aria-expanded={abierto}
        className={cx(claseInput, "flex items-center gap-2.5 text-left", abierto && "border-marca-500 ring-2 ring-marca-200")}>
        {elegido ? punto(elegido.color, true) : <FolderTree className="size-4 shrink-0 text-marca-600" />}
        <span className="min-w-0 flex-1 truncate">
          {elegido
            ? <><span className="font-medium text-stone-900">{elegido.nombre}</span>{elegido.nivel > 1 && <span className="ml-1.5 text-xs text-stone-500">{elegido.ruta.split(" › ").slice(0, -1).join(" › ")}</span>}</>
            : <span className="font-medium text-marca-700">Familia (primer nivel)</span>}
        </span>
        <ChevronDown className={cx("size-4 shrink-0 text-stone-500 transition-transform", abierto && "rotate-180")} />
      </button>

      {/* En línea (no flotante): dentro del modal con scroll nunca queda recortada */}
      {abierto && (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-marca-200 bg-superficie shadow-lg ring-1 ring-marca-100">
          <div className="flex items-center gap-2 border-b border-stone-200 bg-marca-50 px-3 py-2">
            <Search className="size-4 shrink-0 text-marca-600" />
            <input ref={buscador} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar familia o producto…"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (visibles[0]) elegir(visibles[0].id); } }}
              className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 placeholder:text-stone-500 focus:outline-none" />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {!busca && (
              <li>
                <button type="button" role="option" aria-selected={!valor} onClick={() => elegir("")}
                  className={cx("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm", !valor ? "bg-marca-600 text-white" : "text-marca-700 hover:bg-marca-50")}>
                  <FolderTree className="size-4 shrink-0" />
                  <span className="flex-1 font-semibold">Familia (primer nivel)</span>
                  {!valor && <Check className="size-4" />}
                </button>
              </li>
            )}
            {visibles.map((p) => {
              const activo = p.id === valor;
              const familia = p.nivel === 1;
              return (
                <li key={p.id} className={cx(familia && !busca && "mt-1 border-t border-stone-100 pt-1 first:mt-0 first:border-0")}>
                  <button type="button" role="option" aria-selected={activo} onClick={() => elegir(p.id)}
                    style={{ paddingLeft: busca ? 12 : 12 + (p.nivel - 1) * 18 }}
                    className={cx("flex w-full items-center gap-2.5 py-2 pr-3 text-left text-sm transition-colors",
                      activo ? "bg-marca-600 text-white" : "text-stone-800 hover:bg-marca-50 hover:text-marca-800")}>
                    {!familia && !busca && <span className={cx("-ml-1 text-xs", activo ? "text-white/70" : "text-stone-400")}>└</span>}
                    {punto(p.color, familia)}
                    <span className={cx("min-w-0 flex-1 truncate", familia ? "font-semibold" : "")}>
                      {busca ? p.ruta : p.nombre}
                    </span>
                    {familia && p.tiene_hijos && !activo && (
                      <span className="rounded-full bg-marca-50 px-2 py-0.5 text-[11px] font-medium text-marca-700">familia</span>
                    )}
                    {activo && <Check className="size-4 shrink-0" />}
                  </button>
                </li>
              );
            })}
            {visibles.length === 0 && <li className="px-3 py-4 text-center text-sm text-stone-500">Sin resultados para «{busca}».</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

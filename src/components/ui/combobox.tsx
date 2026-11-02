"use client";

import { Fragment, useId, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { claseInput, cx } from "@/components/ui/clases";

/**
 * Campo con lista desplegable que se filtra al escribir: muestra todos al enfocar, se maneja con
 * flechas/Enter/Escape y, en celular, sube el campo para que la lista quede sobre el teclado.
 * El filtrado lo hace quien lo usa (`items` ya filtrados según `q`).
 */
export function Combobox<T>({
  q, onQ, items, total, clave, onElegir, fila, grupo, placeholder, vacio, name, grande, autoFocus, etiqueta,
}: {
  q: string;
  onQ: (q: string) => void;
  items: T[];
  /** Cuántos hay sin filtrar (para el pie «N de M») */
  total: number;
  clave: (x: T) => string;
  /** teclado = elegido con Enter (quien lo usa puede saltar al siguiente campo) */
  onElegir: (x: T, teclado: boolean) => void;
  fila: (x: T) => React.ReactNode;
  /** Encabezado de grupo (los items deben venir ordenados por grupo) */
  grupo?: (x: T) => string;
  placeholder: string;
  vacio: React.ReactNode;
  /** Si va dentro de un <form method="get">, Enter sin elegir envía lo escrito */
  name?: string;
  grande?: boolean;
  autoFocus?: boolean;
  etiqueta: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();
  const mostrados = items.slice(0, 100);

  function abrir() {
    setAbierto(true);
    // en celular, el campo sube para que la lista quepa sobre el teclado
    if (window.matchMedia("(max-width: 639px)").matches) caja.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function elegir(x: T, teclado = false) {
    onElegir(x, teclado);
    setAbierto(false);
    setActivo(-1);
  }
  function mover(d: number) {
    if (!mostrados.length) return;
    const i = activo < 0 && d < 0 ? mostrados.length - 1 : (activo + d + mostrados.length) % mostrados.length;
    setActivo(i);
    setAbierto(true);
    document.getElementById(`${id}-${i}`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div
      ref={caja}
      className="relative min-w-0 flex-1 scroll-mt-4"
      onBlur={(e) => { if (!caja.current?.contains(e.relatedTarget as Node)) setAbierto(false); }}
    >
      <Search className={cx("pointer-events-none absolute left-3 text-stone-400", grande ? "top-3.5 size-5" : "top-3 size-4")} />
      <input
        name={name}
        value={q}
        autoFocus={autoFocus}
        autoComplete="off"
        inputMode="search"
        aria-label={etiqueta}
        placeholder={placeholder}
        onChange={(e) => { onQ(e.target.value); setAbierto(true); setActivo(-1); }}
        onFocus={abrir}
        onClick={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); mover(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
          else if (e.key === "Escape") {
            // dentro de un modal, la primera Escape cierra la lista y no el modal
            if (abierto) { e.preventDefault(); e.stopPropagation(); setAbierto(false); } else onQ("");
          }
          else if (e.key === "Enter" && abierto) {
            const x = activo >= 0 ? mostrados[activo] : !name && q.trim() ? mostrados[0] : undefined;
            if (x) { e.preventDefault(); elegir(x, true); }
          }
        }}
        className={cx(claseInput, grande ? "h-12 pl-10 text-base sm:text-base" : "pl-9", q ? "pr-[5.5rem] sm:pr-20" : "pr-11 sm:pr-10")}
        role="combobox"
        aria-expanded={abierto}
        aria-controls={`${id}-lista`}
        aria-autocomplete="list"
        aria-activedescendant={abierto && activo >= 0 ? `${id}-${activo}` : undefined}
      />
      <span className="absolute inset-y-0 right-1 flex items-center" onMouseDown={(e) => e.preventDefault()}>
        {q && (
          <button type="button" tabIndex={-1} onClick={() => { onQ(""); setActivo(-1); setAbierto(true); }}
            aria-label="Limpiar búsqueda" className="grid size-10 place-items-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-700 sm:size-9">
            <X className="size-4" />
          </button>
        )}
        <button type="button" tabIndex={-1} onClick={() => setAbierto((a) => !a)} aria-label={abierto ? "Cerrar lista" : "Ver todos"}
          className="grid size-10 place-items-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-700 sm:size-9">
          <ChevronDown className={cx("size-4 transition", abierto && "rotate-180")} />
        </button>
      </span>

      {abierto && (
        // mousedown sin foco: en Safari el clic no enfoca botones y la lista se cerraba antes de elegir
        <div onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-stone-200 bg-superficie shadow-lg">
          <ul id={`${id}-lista`} role="listbox" aria-label={etiqueta} className="max-h-[60dvh] overflow-y-auto sm:max-h-80">
            {mostrados.map((x, i) => {
              const g = grupo?.(x);
              const nuevoGrupo = g && (i === 0 || grupo!(mostrados[i - 1]) !== g);
              return (
                <Fragment key={clave(x)}>
                  {nuevoGrupo && (
                    <li role="presentation" className="sticky top-0 z-10 border-b border-stone-100 bg-stone-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-700">
                      {g} ({items.filter((y) => grupo!(y) === g).length})
                    </li>
                  )}
                  <li id={`${id}-${i}`} role="option" aria-selected={i === activo}
                    onClick={() => elegir(x)} onMouseEnter={() => setActivo(i)}
                    className={cx("flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2",
                      i === activo && "bg-marca-50 outline-2 -outline-offset-2 outline-marca-700")}>
                    {fila(x)}
                  </li>
                </Fragment>
              );
            })}
            {mostrados.length === 0 && <li role="option" aria-disabled="true" aria-selected="false" className="px-3 py-5 text-center text-sm text-stone-500">{vacio}</li>}
          </ul>
          {(q.trim() || items.length > mostrados.length) && (
            <p className="border-t border-stone-100 px-3 py-1.5 text-xs text-stone-500">
              {items.length > mostrados.length
                ? `Mostrando ${mostrados.length} de ${items.length} · siga escribiendo para filtrar`
                : `${items.length} de ${total}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

/** Clase de cada opción del menú (enlace o botón) */
export const opcionMenu = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 hover:bg-marca-50";

/** Tres puntitos con un menú de opciones. `children` recibe `cerrar` para cerrarlo al elegir una opción. */
export function MenuPuntos({ etiqueta, alto = 170, children }: {
  /** Para lectores de pantalla: «Opciones de …» */
  etiqueta: string;
  /** Alto aproximado del menú: si no entra debajo del botón, se abre hacia arriba */
  alto?: number;
  children: (cerrar: () => void) => React.ReactNode;
}) {
  // Posición fija junto al botón: la tabla recorta (overflow) lo que sale de ella, p. ej. en las últimas filas
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const abierto = pos !== null;
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  // En celular/laptop la fila es una tarjeta-enlace: el toque en los puntitos no debe abrir la ficha
  const alternar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (abierto || !boton.current) return setPos(null);
    const b = boton.current.getBoundingClientRect();
    const arriba = window.innerHeight - b.bottom < alto;
    setPos({ position: "fixed", right: window.innerWidth - b.right, ...(arriba ? { bottom: window.innerHeight - b.top + 4 } : { top: b.bottom + 4 }) });
  };

  useEffect(() => {
    if (!abierto) return;
    const cerrarMenu = () => setPos(null);
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) cerrarMenu(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") cerrarMenu(); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", cerrarMenu, true);
    window.addEventListener("resize", cerrarMenu);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", cerrarMenu, true);
      window.removeEventListener("resize", cerrarMenu);
    };
  }, [abierto]);

  return (
    <div ref={ref} className="relative inline-block">
      <button ref={boton} type="button" onClick={alternar} aria-expanded={abierto} aria-haspopup="menu"
        aria-label={etiqueta} title="Opciones"
        className="rounded-md p-1.5 text-stone-500 hover:bg-marca-50 hover:text-marca-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500">
        <MoreVertical className="size-4" />
      </button>
      {abierto && createPortal(
        <div ref={menu} role="menu" style={pos} onClick={(e) => e.stopPropagation()} className="z-30 w-56 overflow-hidden rounded-lg border border-stone-200 bg-superficie py-1 text-left shadow-lg">
          {children(() => setPos(null))}
        </div>,
        document.body,
      )}
    </div>
  );
}

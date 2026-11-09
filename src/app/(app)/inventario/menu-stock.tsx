"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { History, MoreVertical, Sparkles, Tags } from "lucide-react";

/** Tres puntitos en cada producto del stock: historial, limpiar lo pendiente y editar el producto o su precio */
export function MenuStock({ id, nombre, porLimpiar, puedeLimpiar, puedeEditar }: {
  id: string; nombre: string;
  /** Kilos de ese producto (o sus variantes) que esperan limpieza */
  porLimpiar: boolean;
  puedeLimpiar: boolean;
  puedeEditar: boolean;
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
    const arriba = window.innerHeight - b.bottom < 170;
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

  const opcion = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 hover:bg-marca-50";
  const cerrar = () => setPos(null);

  return (
    <div ref={ref} className="relative inline-block">
      <button ref={boton} type="button" onClick={alternar} aria-expanded={abierto} aria-haspopup="menu"
        aria-label={`Opciones de ${nombre}`} title="Opciones"
        className="rounded-md p-1.5 text-stone-500 hover:bg-marca-50 hover:text-marca-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500">
        <MoreVertical className="size-4" />
      </button>
      {abierto && createPortal(
        <div ref={menu} role="menu" style={pos} onClick={(e) => e.stopPropagation()} className="z-30 w-56 overflow-hidden rounded-lg border border-stone-200 bg-superficie py-1 text-left shadow-lg">
          <Link role="menuitem" href={`/inventario/${id}`} className={opcion} onClick={cerrar}>
            <History className="size-4 text-stone-500" /> Ver historial
          </Link>
          {puedeLimpiar && (
            porLimpiar ? (
              <Link role="menuitem" href={`/limpieza?producto=${id}`} className={opcion} onClick={cerrar}>
                <Sparkles className="size-4 text-stone-500" /> Limpiar este producto
              </Link>
            ) : (
              <span role="menuitem" aria-disabled className="flex items-center gap-2 px-3 py-2 text-sm text-stone-400">
                <Sparkles className="size-4" /> Nada por limpiar
              </span>
            )
          )}
          {puedeEditar && (
            <Link role="menuitem" href="/precios" className={opcion} onClick={cerrar}>
              <Tags className="size-4 text-stone-500" /> Productos y precios
            </Link>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { History, Sparkles, Tags } from "lucide-react";
import { MenuPuntos, opcionMenu } from "@/components/ui/menu-puntos";

/** Tres puntitos en cada producto del stock: historial, limpiar lo pendiente y editar el producto o su precio */
export function MenuStock({ id, nombre, porLimpiar, puedeLimpiar, puedeEditar }: {
  id: string; nombre: string;
  /** Kilos de ese producto (o sus variantes) que esperan limpieza */
  porLimpiar: boolean;
  puedeLimpiar: boolean;
  puedeEditar: boolean;
}) {
  return (
    <MenuPuntos etiqueta={`Opciones de ${nombre}`}>
      {(cerrar) => (
        <>
          <Link role="menuitem" href={`/inventario/${id}`} className={opcionMenu} onClick={cerrar}>
            <History className="size-4 text-stone-500" /> Ver historial
          </Link>
          {puedeLimpiar && (
            porLimpiar ? (
              <Link role="menuitem" href={`/limpieza?producto=${id}`} className={opcionMenu} onClick={cerrar}>
                <Sparkles className="size-4 text-stone-500" /> Limpiar este producto
              </Link>
            ) : (
              <span role="menuitem" aria-disabled className="flex items-center gap-2 px-3 py-2 text-sm text-stone-400">
                <Sparkles className="size-4" /> Nada por limpiar
              </span>
            )
          )}
          {puedeEditar && (
            <Link role="menuitem" href="/precios" className={opcionMenu} onClick={cerrar}>
              <Tags className="size-4 text-stone-500" /> Productos y precios
            </Link>
          )}
        </>
      )}
    </MenuPuntos>
  );
}

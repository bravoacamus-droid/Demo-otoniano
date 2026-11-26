"use client";

import { useState } from "react";
import Link from "next/link";
import { History, PencilLine, Sparkles, Tags } from "lucide-react";
import { MenuPuntos, opcionMenu } from "@/components/ui/menu-puntos";
import { EditarStock } from "./acciones-inventario";

/** Tres puntitos en cada producto del stock: historial, editar el stock, limpiar lo pendiente y editar el producto o su precio */
export function MenuStock({ id, nombre, porLimpiar, puedeLimpiar, puedeEditar, stock }: {
  id: string; nombre: string;
  /** Kilos de ese producto (o sus variantes) que esperan limpieza */
  porLimpiar: boolean;
  puedeLimpiar: boolean;
  puedeEditar: boolean;
  /** Solo Gerencia (ajustarInventario): stock propio del producto y si su stock está en las variantes */
  stock?: { kg: string; unidad: string | null; enVariantes: boolean };
}) {
  const [editando, setEditando] = useState(false);
  return (
    <>
      <MenuPuntos etiqueta={`Opciones de ${nombre}`}>
        {(cerrar) => (
          <>
            <Link role="menuitem" href={`/inventario/${id}`} className={opcionMenu} onClick={cerrar}>
              <History className="size-4 text-stone-500" /> Ver historial
            </Link>
            {stock && (
              stock.enVariantes ? (
                // El stock de una familia es la suma de sus variantes: se edita en cada una
                <span role="menuitem" aria-disabled className="flex items-center gap-2 px-3 py-2 text-sm text-stone-400">
                  <PencilLine className="size-4" /> Editar stock en cada variante
                </span>
              ) : (
                <button type="button" role="menuitem" className={opcionMenu} onClick={() => { cerrar(); setEditando(true); }}>
                  <PencilLine className="size-4 text-stone-500" /> Editar stock
                </button>
              )
            )}
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
      {stock && !stock.enVariantes && (
        <EditarStock metal={{ id, nombre, kg: stock.kg, unidad: stock.unidad }} abierto={editando} onCerrar={() => setEditando(false)} />
      )}
    </>
  );
}

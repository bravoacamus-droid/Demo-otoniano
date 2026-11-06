"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { History, MoreVertical, Pencil, Plus } from "lucide-react";

/** Tres puntitos al costado de cada producto: editar nombre/datos, agregar variante, ver historial */
export function MenuProducto({ nombre, id, activo, onEditar, onSubtipo }: {
  nombre: string; id: string; activo: boolean; onEditar: () => void; onSubtipo: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);

  const opcion = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-marca-50";
  const elegir = (f: () => void) => () => { setAbierto(false); f(); };

  return (
    <div ref={ref} className="relative ml-auto shrink-0">
      <button type="button" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}
        aria-label={`Opciones de ${nombre}`} title="Opciones"
        className="-m-1 rounded-md p-2 text-stone-500 hover:bg-marca-50 hover:text-marca-700">
        <MoreVertical className="size-4" />
      </button>
      {abierto && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-stone-200 bg-superficie py-1 shadow-lg">
          <button type="button" className={opcion} onClick={elegir(onEditar)}>
            <Pencil className="size-4 text-stone-500" /> Editar nombre y datos
          </button>
          {activo && (
            <button type="button" className={opcion} onClick={elegir(onSubtipo)}>
              <Plus className="size-4 text-stone-500" /> Agregar variante
            </button>
          )}
          <Link href={`/inventario/${id}`} className={opcion} onClick={() => setAbierto(false)}>
            <History className="size-4 text-stone-500" /> Ver historial
          </Link>
        </div>
      )}
    </div>
  );
}

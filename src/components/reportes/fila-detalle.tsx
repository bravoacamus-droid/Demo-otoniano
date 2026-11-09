"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "@/components/ui/clases";

/**
 * Fila del resumen que se despliega al tocarla: debajo aparecen las compras/ventas de ese grupo
 * (día, mes, producto…). Las celdas y el detalle llegan ya armados desde el servidor.
 */
export function FilaDetalle({ etiqueta, celdas, detalle, columnas, cantidad, className }: {
  etiqueta: string;
  /** Las demás celdas (<td>) de la fila */
  celdas: React.ReactNode;
  detalle: React.ReactNode;
  columnas: number;
  cantidad: number;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <tr onClick={() => setAbierto(!abierto)} className={cx("cursor-pointer transition-colors hover:bg-marca-50", abierto && "bg-marca-50/70", className)}>
        <td className="px-2 py-2 pl-4 @5xl:px-3">
          <button type="button" aria-expanded={abierto} onClick={(e) => { e.stopPropagation(); setAbierto(!abierto); }}
            title={abierto ? "Ocultar detalle" : `Ver las ${cantidad} operaciones`}
            className="flex items-center gap-1.5 rounded text-left font-medium text-marca-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500">
            <ChevronRight aria-hidden className={cx("size-4 shrink-0 transition-transform duration-200", abierto && "rotate-90")} />
            {etiqueta}
          </button>
        </td>
        {celdas}
      </tr>
      {abierto && (
        <tr className="bg-stone-50/80">
          <td colSpan={columnas} className="px-4 pb-3 pt-1">{detalle}</td>
        </tr>
      )}
    </>
  );
}

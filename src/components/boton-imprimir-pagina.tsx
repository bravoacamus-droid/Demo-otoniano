"use client";

import { Printer } from "lucide-react";

/** Imprime la página actual (el menú y la barra se ocultan con .no-imprimir) */
export function BotonImprimirPagina({ texto = "Imprimir", className }: { texto?: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      <Printer className="size-4" /> {texto}
    </button>
  );
}

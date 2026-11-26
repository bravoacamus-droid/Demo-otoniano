"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Lleva su contenido al <body> (solo en el navegador, tras montar: sin desajuste de hidratación) y frena
 * el clic: en celular las filas de TablaDatos con `enlace` son un <a> y un cuadro abierto desde su ⋮ no
 * debe abrir esa ficha al escribir o guardar.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(<div onClick={(e) => e.stopPropagation()}>{children}</div>, document.body);
}

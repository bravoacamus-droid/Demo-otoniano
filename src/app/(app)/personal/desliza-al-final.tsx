"use client";

import { useEffect, useRef } from "react";

/** Contenedor con scroll horizontal que arranca mostrando el final (los días más recientes) */
export function DeslizaAlFinal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth; }, []);
  return <div ref={ref} className="overflow-x-auto">{children}</div>;
}

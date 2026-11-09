"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "@/components/ui/clases";

/**
 * Lista de secciones del menú azul con barra de desplazamiento visible y, mientras quede algo más abajo,
 * un botón «Más secciones» al pie (reunión del 09/11: no se notaba que había más secciones abajo).
 */
export function NavLateral({ className, compacto = false, children }: { className?: string; compacto?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [masAbajo, setMasAbajo] = useState(false);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const medir = () => setMasAbajo(nav.scrollHeight - nav.scrollTop - nav.clientHeight > 8);
    medir();
    nav.addEventListener("scroll", medir, { passive: true });
    const obs = new ResizeObserver(medir);
    obs.observe(nav);
    return () => { nav.removeEventListener("scroll", medir); obs.disconnect(); };
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <nav ref={ref} className={cx("barra-lateral h-full overflow-y-auto", className)} aria-label="Secciones">
        {children}
      </nav>
      {masAbajo && (
        <button type="button" onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.7, behavior: "smooth" })}
          aria-label="Ver más secciones abajo" title="Más secciones abajo"
          className="absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-[#0b2140] via-[#0b2140]/90 to-transparent pb-2 pt-8 text-xs font-medium text-lateral-texto hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cian-400">
          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
            <ChevronDown className="size-3.5 animate-bounce" />
            {!compacto && "Más secciones"}
          </span>
        </button>
      )}
    </div>
  );
}

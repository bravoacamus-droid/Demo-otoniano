"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cx } from "@/components/ui/clases";

/** Vuelve a traer los datos de la pantalla (p. ej. lo que registró otra persona) sin recargar todo */
export function BotonActualizar({ lateral = false }: { /** En la barra azul, junto al logo: solo el ícono, en blanco */ lateral?: boolean }) {
  const router = useRouter();
  const [cargando, iniciar] = useTransition();
  if (lateral) {
    return (
      <button type="button" onClick={() => iniciar(() => router.refresh())} disabled={cargando}
        title="Actualizar datos" aria-label="Actualizar datos"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-lateral-texto transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cian-400 disabled:opacity-80">
        <RefreshCw className={cx("size-[18px]", cargando && "animate-spin")} />
      </button>
    );
  }
  return (
    <button type="button" onClick={() => iniciar(() => router.refresh())} disabled={cargando}
      title="Actualizar datos" aria-label="Actualizar datos"
      className="flex items-center gap-1.5 rounded-lg p-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-marca-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500 disabled:opacity-70 lg:px-3">
      <RefreshCw className={cx("size-[18px]", cargando && "animate-spin")} />
      <span className="hidden lg:inline">{cargando ? "Actualizando…" : "Actualizar"}</span>
    </button>
  );
}

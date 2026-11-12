"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Si Gerencia le quitó pantallas al cargo, el menú (layout) aún muestra las viejas: se vuelve a pedir una vez */
export function RefrescarMenu() {
  const router = useRouter();
  useEffect(() => { router.refresh(); }, [router]);
  return null;
}

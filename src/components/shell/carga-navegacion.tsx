"use client";

import { useEffect, useState } from "react";

/**
 * Cambios de filtro en la misma página (pestañas ?r=, rangos, «Ver», «Filtrar»). Con el router de Next, en
 * producción, cambiar solo la búsqueda de la URL a veces no llegaba a pintar los datos nuevos (la respuesta
 * se descartaba y la pantalla quedaba colgada), y aun cuando funcionaba no mostraba ningún aviso.
 * Aquí se navega como un enlace normal del navegador (siempre llega) y, mientras carga, barra arriba,
 * lo pulsado con un giro y el resto atenuado; el navegador mantiene la página visible hasta pintar la nueva.
 */
export function CargaNavegacion({ children }: { children: React.ReactNode }) {
  const [cargando, setCargando] = useState(false);

  // Al volver con «Atrás» el navegador puede restaurar la página tal cual (bfcache): quitar el aviso
  useEffect(() => {
    const restaurar = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setCargando(false);
      document.querySelectorAll("[data-pulsado]").forEach((el) => el.removeAttribute("data-pulsado"));
    };
    window.addEventListener("pageshow", restaurar);
    return () => window.removeEventListener("pageshow", restaurar);
  }, []);

  const ir = (url: URL, el: HTMLElement) => {
    document.querySelectorAll("[data-pulsado]").forEach((x) => x.removeAttribute("data-pulsado"));
    el.setAttribute("data-pulsado", "");
    setCargando(true);
    window.location.assign(url.pathname + url.search);
    // Si se canceló la salida (aviso de cambios sin guardar), la página sigue aquí: quitar el aviso de carga
    setTimeout(() => {
      setCargando(false);
      el.removeAttribute("data-pulsado");
    }, 4000);
  };

  // Solo navegaciones a la MISMA ruta con otra búsqueda; las demás ya tienen su loading.tsx
  const mismaRuta = (url: URL) =>
    url.origin === location.origin && url.pathname === location.pathname && url.search !== location.search;

  return (
    <div
      // pantalla: cada bloque de la página entra en cascada (globals.css)
      className="pantalla"
      data-cargando={cargando || undefined}
      aria-busy={cargando || undefined}
      // Captura: corre antes que el onClick de <Link>
      onClickCapture={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as HTMLElement).closest("a");
        if (!a || !a.href || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
        const url = new URL(a.href);
        if (!mismaRuta(url)) return;
        e.preventDefault();
        ir(url, a);
      }}
      // Burbuja: respeta los formularios que ya navegan por su cuenta (preventDefault propio)
      onSubmit={(e) => {
        const form = e.target as HTMLFormElement;
        if (e.defaultPrevented || form.method.toLowerCase() !== "get" || (form.target && form.target !== "_self")) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const url = new URL(form.action || location.href);
        url.search = new URLSearchParams(new FormData(form, submitter) as unknown as [string, string][]).toString();
        if (url.origin !== location.origin || url.pathname !== location.pathname) return;
        e.preventDefault();
        ir(url, submitter ?? form);
      }}
    >
      {cargando && <span aria-hidden className="barra-navegacion" />}
      {children}
    </div>
  );
}

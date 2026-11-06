"use client";

import { useEffect, useRef, useState } from "react";

// Primer número del texto con el formato del sistema (es-PE: 1,234.50), con signo. Fechas y horas no se animan.
const NUMERO = /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;
const FECHA_HORA = /\d{1,2}\/\d{1,2}|\d:\d{2}/;

// Tras la primera hidratación, las cifras que se montan después (navegación entre secciones) siempre cuentan
let hidratado = false;

/**
 * Cifra que sube desde 0 (o desde el valor anterior) hasta la final, conservando prefijo y formato («S/ 1,234.50»).
 * El servidor pinta el valor final oculto un instante (.cifra-espera) para que no se vea «final → 0 → cuenta»;
 * si la página tardó en hidratar, se muestra sin contar. Los lectores de pantalla leen siempre el valor real.
 */
export function CifraAnimada({ texto }: { texto: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previo = useRef<number | null>(null);
  const [espera, setEspera] = useState(true);

  useEffect(() => {
    const primera = !hidratado;
    const marca = setTimeout(() => { hidratado = true; });
    setEspera(false);
    const nodo = ref.current?.firstChild;
    const m = FECHA_HORA.test(texto) ? null : texto.match(NUMERO);
    const objetivo = m ? Number(m[0].replace(/,/g, "")) : NaN;
    const desde = previo.current ?? 0;
    previo.current = objetivo;
    const animar = nodo && m && Number.isFinite(objetivo) && desde !== objetivo
      && !matchMedia("(prefers-reduced-motion: reduce)").matches
      && !(primera && performance.now() > 1200);
    if (!animar) return () => clearTimeout(marca);

    const decimales = m[0].split(".")[1]?.length ?? 0;
    const fmt = new Intl.NumberFormat("es-PE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    const antes = texto.slice(0, m.index);
    const despues = texto.slice(m.index! + m[0].length);
    const pintar = (v: number) => { nodo.nodeValue = antes + fmt.format(v) + despues; };
    pintar(desde);                                   // antes del primer cuadro: sin destello del valor final
    const t0 = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      if (p < 1) {
        pintar(desde + (objetivo - desde) * (1 - (1 - p) ** 3));
        raf = requestAnimationFrame(paso);
      } else nodo.nodeValue = texto;
    };
    raf = requestAnimationFrame(paso);
    return () => {
      clearTimeout(marca);
      cancelAnimationFrame(raf);
      nodo.nodeValue = texto;
      previo.current = desde === 0 && primera ? null : previo.current;   // StrictMode (dev): la 2.ª pasada vuelve a contar
    };
  }, [texto]);

  return (
    <>
      <span className="sr-only">{texto}</span>
      <span aria-hidden ref={ref} className={espera ? "cifra-espera" : undefined}>{texto}</span>
    </>
  );
}

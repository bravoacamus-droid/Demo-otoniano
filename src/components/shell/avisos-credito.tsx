"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { cx } from "@/components/ui/clases";
import { useNotificar } from "@/components/ui/notificaciones";
import { fechaDia, hoyLima, soles } from "@/lib/formato";
import { avanceCuotas } from "@/lib/creditos";

/** Crédito con una cuota vencida o que vence en los próximos días (fila de v_creditos) */
export interface AvisoCredito {
  id: string;
  tipo: "por_cobrar" | "por_pagar";
  contraparte: string | null;
  operacion_numero: number | null;
  situacion: string;
  n_cuotas: number;
  cuotas_pagadas: number | null;
  cuotas_vencidas: number | null;
  monto_vencido: number | string | null;
  dias_atraso: number | null;
  proxima_numero: number | null;
  proxima_vence: string | null;
  proxima_saldo: number | string | null;
  saldo: number | string;
}

const CLAVE_SESION = "otiniano:avisos-credito";

/** Recibe la consulta sin esperar (streaming desde el layout) */
export function AvisosCreditoDiferidos({ promesa }: { promesa: Promise<AvisoCredito[]> }) {
  return <AvisosCredito avisos={use(promesa)} />;
}

/** Mientras llega la consulta: la campana sin número */
export function CampanaEsperando() {
  return <span className="block p-2 text-stone-300"><Bell className="size-5" /></span>;
}

/** «vence hoy», «vence mañana», «vence en 3 días» */
function cuando(vence: string | null) {
  if (!vence) return "";
  const dias = Math.round((Date.parse(`${vence.slice(0, 10)}T00:00:00Z`) - Date.parse(`${hoyLima()}T00:00:00Z`)) / 86_400_000);
  return dias <= 0 ? "vence hoy" : dias === 1 ? "vence mañana" : `vence en ${dias} días (${fechaDia(vence)})`;
}

/**
 * Campana de Gerencia: cuotas vencidas y por vencer (3 días) de compras y ventas a crédito.
 * Al entrar, si hay vencidas, avisa una vez por sesión.
 */
export function AvisosCredito({ avisos }: { avisos: AvisoCredito[] }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const notificar = useNotificar();
  const vencidos = avisos.filter((a) => a.situacion === "vencido");
  const nVencidos = vencidos.length;
  const montoVencido = vencidos.reduce((s, a) => s + Number(a.monto_vencido ?? 0), 0);

  // Una vez por sesión (y una sola vez por montaje si no hay sessionStorage)
  const avisado = useRef(false);
  useEffect(() => {
    if (!nVencidos || avisado.current) return;
    avisado.current = true;
    try {
      if (sessionStorage.getItem(CLAVE_SESION)) return;
      sessionStorage.setItem(CLAVE_SESION, "1");
    } catch { /* sin sessionStorage: se avisa una vez */ }
    const monto = montoVencido;
    notificar({
      tono: "aviso", duracion: 9000,
      titulo: `${nVencidos} crédito${nVencidos === 1 ? "" : "s"} con cuotas vencidas`,
      mensaje: `${soles(monto)} vencidos. Revíselos en la campana o en Caja y finanzas → Créditos.`,
    });
  }, [nVencidos, montoVencido, notificar]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);

  const Icono = avisos.length ? BellRing : Bell;
  return (
    <div ref={caja} className="relative">
      <button type="button" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto} aria-haspopup="dialog"
        aria-label={avisos.length ? `Avisos de créditos: ${avisos.length}` : "Avisos de créditos: ninguno"}
        title="Cuotas de créditos"
        className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500">
        <Icono className="size-5" />
        {avisos.length > 0 && (
          <span className={cx("cifra absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white",
            vencidos.length ? "bg-red-600" : "bg-marca-600")}>
            {avisos.length}
          </span>
        )}
      </button>

      {abierto && (
        <div role="dialog" aria-label="Avisos de créditos"
          className="animar-aparecer absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-stone-200 bg-superficie shadow-lg">
          <p className="border-b border-stone-100 px-3 py-2.5 text-sm font-semibold">
            Cuotas por atender
            <span className="ml-1 font-normal text-stone-500">· vencidas y de los próximos 3 días</span>
          </p>
          {avisos.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-stone-500">Todo al día: no hay cuotas vencidas ni por vencer.</p>
          ) : (
            <ul className="max-h-[60dvh] divide-y divide-stone-100 overflow-y-auto">
              {avisos.map((a) => {
                const vencido = a.situacion === "vencido";
                const cobro = a.tipo === "por_cobrar";
                return (
                  <li key={a.id}>
                    <Link href={`/creditos/${a.id}`} onClick={() => setAbierto(false)} className="block px-3 py-2.5 hover:bg-stone-50">
                      <p className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{cobro ? "Cobrar a" : "Pagar a"} {a.contraparte}</span>
                        <span className={cx("shrink-0 text-xs font-semibold", vencido ? "text-red-700" : "text-marca-700")}>
                          {vencido ? `${a.dias_atraso} día${a.dias_atraso === 1 ? "" : "s"} de atraso` : cuando(a.proxima_vence)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-stone-600">
                        {vencido
                          ? `${a.cuotas_vencidas} cuota${a.cuotas_vencidas === 1 ? "" : "s"} vencida${a.cuotas_vencidas === 1 ? "" : "s"}: ${soles(a.monto_vencido)}`
                          : `Cuota ${a.proxima_numero} de ${a.n_cuotas}: ${soles(a.proxima_saldo)}`}
                        {" · "}{cobro ? "Venta" : "Compra"} N° {a.operacion_numero}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        Van {avanceCuotas(a.cuotas_pagadas, a.n_cuotas)} · falta <b className="cifra font-medium text-stone-700">{soles(a.saldo)}</b>
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/creditos" onClick={() => setAbierto(false)} className="block border-t border-stone-100 px-3 py-2 text-center text-sm font-medium text-marca-700 hover:bg-stone-50">
            Ver todos los créditos
          </Link>
        </div>
      )}
    </div>
  );
}

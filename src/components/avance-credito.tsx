import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Insignia } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import { fechaDia, soles } from "@/lib/formato";
import { FRECUENCIA, SITUACION, TIPOS_CREDITO, avanceCuotas, type Situacion, type TipoCredito } from "@/lib/creditos";

/** Fila de v_creditos (lo que usan las pantallas) */
export interface CreditoFila {
  id: string;
  tipo: TipoCredito;
  situacion: Situacion;
  contraparte: string | null;
  monto: number | string;
  inicial: number | string;
  pagado: number | string;
  saldo: number | string;
  n_cuotas: number;
  frecuencia: string;
  cuotas_pagadas: number | null;
  cuotas_vencidas: number | null;
  monto_vencido: number | string | null;
  proxima_numero: number | null;
  proxima_vence: string | null;
  proxima_saldo: number | string | null;
  dias_atraso: number | null;
}

/** Barra de avance de lo pagado */
export function BarraAvance({ pagado, total, vencido }: { pagado: number; total: number; vencido?: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((pagado * 100) / total)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full", vencido ? "bg-red-600" : "bg-marca-600")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Tarjeta compacta del crédito de una compra o venta: avance, próxima cuota y enlace a Créditos */
export function AvanceCredito({ c, enlace = true }: { c: CreditoFila; enlace?: boolean }) {
  const t = TIPOS_CREDITO[c.tipo];
  const [textoSit, tono] = SITUACION[c.situacion];
  const vencido = c.situacion === "vencido";
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">A crédito · {c.n_cuotas === 1 ? FRECUENCIA.unica : `${c.n_cuotas} cuotas ${FRECUENCIA[c.frecuencia]?.toLowerCase()}es`}</p>
        <Insignia tono={tono}>{textoSit}</Insignia>
      </div>
      <BarraAvance pagado={Number(c.pagado)} total={Number(c.monto)} vencido={vencido} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div><dt className="text-xs text-stone-500">{c.tipo === "por_cobrar" ? "Cobrado" : "Pagado"}</dt><dd className="cifra font-medium">{soles(c.pagado)}</dd></div>
        <div><dt className="text-xs text-stone-500">Falta</dt><dd className="cifra font-semibold">{soles(c.saldo)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-stone-500">Cuotas</dt><dd>{avanceCuotas(c.cuotas_pagadas, c.n_cuotas)}{Number(c.inicial) > 0 && ` · inicial ${soles(c.inicial)}`}</dd></div>
      </dl>
      {c.proxima_numero && c.situacion !== "anulado" && (
        <p className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs", vencido ? "bg-red-50 text-red-800" : "bg-marca-50 text-marca-800")}>
          <CalendarClock className="size-3.5 shrink-0" />
          {vencido
            ? <>{c.cuotas_vencidas} cuota{c.cuotas_vencidas === 1 ? "" : "s"} vencida{c.cuotas_vencidas === 1 ? "" : "s"} ({soles(c.monto_vencido)}) · {c.dias_atraso} días de atraso</>
            : <>Próxima: cuota {c.proxima_numero} de {c.n_cuotas}, {soles(c.proxima_saldo)} el {fechaDia(c.proxima_vence)}</>}
        </p>
      )}
      {enlace && (
        <Link href={`/creditos/${c.id}`} className="inline-block font-medium text-marca-700 hover:underline">
          {c.situacion === "pagado" || c.situacion === "anulado" ? "Ver cronograma y pagos" : `${t.verbo} cuotas y ver cronograma`}
        </Link>
      )}
    </div>
  );
}

/** Línea bajo el total en los historiales: «A crédito · falta S/ X» */
export function CreditoLinea({ c }: { c: { saldo: number | string | null; situacion: string | null } }) {
  if (c.situacion === "pagado") return <span className="block text-xs text-stone-500">Crédito pagado</span>;
  return (
    <span className={cx("cifra block text-xs font-medium", c.situacion === "vencido" ? "text-red-700" : "text-marca-700")}>
      {c.situacion === "vencido" ? "Vencido" : "A crédito"} · falta {soles(c.saldo)}
    </span>
  );
}

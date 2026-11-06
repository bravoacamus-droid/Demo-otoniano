import Link from "next/link";
import { cx } from "@/components/ui/clases";
import { fechaDia } from "@/lib/formato";
import { DeslizaAlFinal } from "./desliza-al-final";

export interface MarcaDia {
  trabajador_id: string;
  fecha: string;
  estado: string;
  horas_extra: number | string;
}

export interface TrabajadorCal {
  id: string;
  nombre: string;
  fecha_ingreso: string;
  fecha_cese: string | null;
}

// Verde/rojo para asistir/faltar (estados); el resto en azul de marca (informativo)
export const ESTADO_DIA: Record<string, { letra: string; texto: string; clase: string }> = {
  asistio: { letra: "A", texto: "Asistió", clase: "bg-emerald-100 text-emerald-800" },
  falta: { letra: "F", texto: "Falta", clase: "bg-red-100 text-red-800" },
  descanso: { letra: "D", texto: "Descanso", clase: "bg-marca-50 text-marca-700" },
  permiso: { letra: "P", texto: "Permiso", clase: "bg-marca-50 text-marca-700" },
  vacaciones: { letra: "V", texto: "Vacaciones", clase: "bg-marca-50 text-marca-700" },
};

const DIAS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];
const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** Cuadro trabajador × día: de un vistazo quién vino, quién faltó y qué días faltan marcar */
export function CalendarioAsistencia({ dias, trabajadores, marcas, hoy }: {
  dias: string[]; trabajadores: TrabajadorCal[]; marcas: MarcaDia[]; hoy: string;
}) {
  const porClave = new Map(marcas.map((m) => [`${m.trabajador_id}|${m.fecha}`, m]));
  if (!trabajadores.length) return <p className="px-4 py-6 text-center text-sm text-stone-500">Sin trabajadores en estas fechas.</p>;
  const colHoy = (d: string) => d === hoy && "bg-marca-50";

  return (
    <>
      {/* El cuadro se desliza dentro de la tarjeta (en celular), nunca la página; arranca mostrando los últimos días */}
      <DeslizaAlFinal>
        <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <caption className="sr-only">Asistencia por día de cada trabajador</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 border-r border-stone-100 bg-superficie px-3 py-2 text-left font-medium text-stone-500">Trabajador</th>
              {dias.map((d) => {
                const domingo = dia(d).getUTCDay() === 0;
                return (
                  <th key={d} scope="col" aria-current={d === hoy ? "date" : undefined} className={cx("w-8 px-0.5 py-1 text-center font-medium", domingo ? "text-marca-700" : "text-stone-500", colHoy(d))}>
                    <Link prefetch={false} href={`/personal/asistencia?fecha=${d}`} aria-label={`Abrir la hoja del ${fechaDia(d)}`}
                      className="flex min-h-11 flex-col justify-center rounded hover:bg-stone-100">
                      <span className="text-[11px]">{DIAS[dia(d).getUTCDay()]}</span>
                      <span className={cx("cifra", d === hoy && "font-bold text-stone-900")}>{Number(d.slice(8))}</span>
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {trabajadores.map((t) => (
              <tr key={t.id}>
                <th scope="row" className="sticky left-0 z-10 border-r border-t border-stone-100 bg-superficie px-3 py-1.5 text-left font-medium text-stone-800">
                  <span className="block max-w-28 truncate sm:max-w-44" title={t.nombre}>{t.nombre}</span>
                </th>
                {dias.map((d) => {
                  const fuera = d < t.fecha_ingreso || (t.fecha_cese != null && d > t.fecha_cese) || d > hoy;
                  const m = porClave.get(`${t.id}|${d}`);
                  const e = m && ESTADO_DIA[m.estado];
                  const extra = m && Number(m.horas_extra) > 0 ? `, ${Number(m.horas_extra)} h extra` : "";
                  const domingo = dia(d).getUTCDay() === 0;
                  const texto = e ? e.texto : domingo ? "domingo sin marcar (no se exige)" : "sin marcar";
                  return (
                    <td key={d} className={cx("border-t border-stone-100 px-0.5 py-1 text-center", colHoy(d))}>
                      {fuera ? <span className="block h-6" /> : (
                        <Link prefetch={false} href={`/personal/asistencia?fecha=${d}`} aria-label={`${t.nombre}, ${fechaDia(d)}: ${texto}${extra}`}
                          title={`${t.nombre} · ${fechaDia(d)} · ${texto}${extra}`}
                          className={cx("relative mx-auto grid size-6 place-items-center rounded font-semibold hover:ring-2 hover:ring-marca-600/40",
                            e ? e.clase : domingo ? "border border-dashed border-stone-300" : "border border-dashed border-amber-600 bg-amber-50 text-amber-700")}>
                          {e ? e.letra : !domingo && <span aria-hidden>?</span>}
                          {extra && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-amber-600" />}
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </DeslizaAlFinal>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-stone-100 px-4 py-2 text-xs text-stone-600">
        {Object.values(ESTADO_DIA).map((e) => (
          <span key={e.letra} className="inline-flex items-center gap-1.5">
            <span className={cx("grid size-5 place-items-center rounded font-semibold", e.clase)}>{e.letra}</span>{e.texto}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="grid size-5 place-items-center rounded border border-dashed border-amber-600 bg-amber-50 font-semibold text-amber-700">?</span>Sin marcar
        </span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-amber-600" />Con horas extras</span>
      </div>
    </>
  );
}

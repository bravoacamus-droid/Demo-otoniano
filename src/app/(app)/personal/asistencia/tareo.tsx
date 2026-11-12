"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Aviso, Tarjeta } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { cx } from "@/components/ui/clases";
import { useNotificar } from "@/components/ui/notificaciones";
import { guardarTareo } from "../acciones";

export interface FilaTareo {
  trabajador_id: string;
  nombre: string;
  cargo: string | null;
  ingreso: string;
  cese: string | null;
  /** fecha → estado guardado */
  marcas: Record<string, string>;
}
export interface DiaTareo { fecha: string; dia: number; semana: string; domingo: boolean }

// Orden en que cambia una casilla al tocarla
const ORDEN = ["asistio", "falta", "permiso", "descanso", "vacaciones"] as const;
const CASILLA: Record<string, { clase: string; letra?: string; texto: string }> = {
  asistio: { clase: "bg-emerald-600 text-white", texto: "Asistió" },
  falta: { clase: "bg-red-600 text-white", texto: "Faltó" },
  permiso: { clase: "bg-marca-600 text-white", letra: "P", texto: "Permiso" },
  descanso: { clase: "bg-amber-500 text-white", letra: "D", texto: "Descanso" },
  vacaciones: { clase: "bg-cyan-700 text-white", letra: "V", texto: "Vacaciones" },
};

function Marca({ estado }: { estado: string }) {
  const c = CASILLA[estado];
  if (!c) return null;
  if (estado === "asistio") return <Check className="size-3.5" strokeWidth={3} aria-hidden />;
  if (estado === "falta") return <X className="size-3.5" strokeWidth={3} aria-hidden />;
  return <span aria-hidden className="text-xs font-bold">{c.letra}</span>;
}

/** Tareo del mes: una fila por trabajador y una casilla por día. Se toca para cambiar; un solo «Guardar cambios». */
export function Tareo({ titulo, dias, filas, hoy }: { titulo: string; dias: DiaTareo[]; filas: FilaTareo[]; hoy: string }) {
  const router = useRouter();
  const notificar = useNotificar();
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tras guardar, la página trae lo que quedó en la BD
  useEffect(() => { setCambios({}); }, [filas]);
  const sucio = Object.keys(cambios).length > 0;

  useEffect(() => {
    if (!sucio) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  const clave = (id: string, fecha: string) => `${id}|${fecha}`;
  const habil = (f: FilaTareo, fecha: string) => fecha <= hoy && fecha >= f.ingreso && (!f.cese || fecha <= f.cese);
  const estadoDe = (f: FilaTareo, fecha: string) => cambios[clave(f.trabajador_id, fecha)] ?? f.marcas[fecha] ?? "";

  function poner(f: FilaTareo, fecha: string, estado: string) {
    const k = clave(f.trabajador_id, fecha);
    setCambios((c) => {
      const n = { ...c };
      if (estado === (f.marcas[fecha] ?? "")) delete n[k]; else n[k] = estado;
      return n;
    });
  }
  function tocar(f: FilaTareo, fecha: string) {
    const actual = estadoDe(f, fecha);
    const i = ORDEN.indexOf(actual as (typeof ORDEN)[number]);
    // Tras el último vuelve al inicio; una casilla que aún no se guardó puede volver a quedar vacía
    const siguiente = i < ORDEN.length - 1 ? ORDEN[i + 1] : f.marcas[fecha] ? ORDEN[0] : "";
    poner(f, fecha, siguiente);
  }
  /** El número del día marca «asistió» a todos los que aún no tienen nada ese día */
  function marcarDia(fecha: string) {
    for (const f of filas) if (habil(f, fecha) && !estadoDe(f, fecha)) poner(f, fecha, "asistio");
  }

  const totales = useMemo(() => new Map(filas.map((f) => {
    const t = { asis: 0, faltas: 0, perm: 0, laborables: 0 };
    for (const d of dias) {
      if (!habil(f, d.fecha)) continue;
      const e = cambios[clave(f.trabajador_id, d.fecha)] ?? f.marcas[d.fecha] ?? "";
      if (e === "asistio") t.asis++;
      if (e === "falta") t.faltas++;
      if (e === "permiso") t.perm++;
      if (!d.domingo) t.laborables++;
    }
    return [f.trabajador_id, t] as const;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [filas, dias, cambios, hoy]);

  async function guardar() {
    setError(null);
    setGuardando(true);
    const celdas = Object.entries(cambios).filter(([, estado]) => estado).map(([k, estado]) => {
      const [trabajador_id, fecha] = k.split("|");
      return { trabajador_id, fecha, estado };
    });
    const r = await guardarTareo(celdas);
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    notificar({ titulo: "Tareo guardado", mensaje: `${r.data} casilla${r.data === 1 ? "" : "s"} actualizada${r.data === 1 ? "" : "s"}.` });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-600">
        {ORDEN.map((e) => (
          <span key={e} className="flex items-center gap-1.5">
            <span className={cx("grid size-5 place-items-center rounded", CASILLA[e].clase)}><Marca estado={e} /></span>{CASILLA[e].texto}
          </span>
        ))}
        <span className="text-xs text-stone-500">Toque una casilla para cambiarla; el número del día marca «asistió» a todos. Luego «Guardar cambios».</span>
      </div>

      <Tarjeta className="overflow-hidden">
        <p className="border-b border-stone-100 py-2 text-center font-semibold">{titulo}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-marca-50/60 text-stone-600">
                <th scope="col" className="sticky left-0 z-10 w-8 bg-marca-50 px-2 py-1.5 text-left text-xs font-medium">N°</th>
                <th scope="col" className="sticky left-8 z-10 min-w-36 bg-marca-50 px-2 py-1.5 text-left text-xs font-medium">Nombres y apellidos</th>
                {dias.map((d) => (
                  <th key={d.fecha} scope="col" className={cx("px-0 py-1 text-center text-[10px] font-normal", d.domingo && "bg-marca-100")}>
                    <button type="button" onClick={() => marcarDia(d.fecha)} disabled={d.fecha > hoy}
                      title={d.fecha > hoy ? undefined : `Marcar a todos «asistió» el ${d.dia}`}
                      className={cx("w-full rounded px-0.5 leading-tight enabled:hover:bg-marca-200 disabled:text-stone-400", d.fecha === hoy && "font-semibold text-marca-700 underline")}>
                      {d.semana}<span className="block text-xs font-semibold">{d.dia}</span>
                    </button>
                  </th>
                ))}
                <th scope="col" className="bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-800">Asis.</th>
                <th scope="col" className="bg-red-50 px-1.5 text-xs font-semibold text-red-800">Faltas</th>
                <th scope="col" className="bg-marca-100 px-1.5 text-xs font-semibold text-marca-800">Perm.</th>
                <th scope="col" className="bg-stone-100 px-1.5 text-xs font-semibold text-stone-700">%</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, n) => {
                const t = totales.get(f.trabajador_id)!;
                const pct = t.laborables ? Math.round((t.asis / t.laborables) * 100) : 0;
                return (
                  <tr key={f.trabajador_id} className="odd:bg-superficie even:bg-stone-50">
                    <td className="sticky left-0 z-10 border-t border-stone-100 bg-inherit px-2 text-xs text-stone-500">{n + 1}</td>
                    <th scope="row" className="sticky left-8 z-10 border-t border-stone-100 bg-inherit px-2 py-1 text-left font-normal">
                      <span className="block max-w-44 truncate text-xs font-semibold uppercase">{f.nombre}</span>
                      {f.cargo && <span className="block text-[11px] text-stone-500">{f.cargo}</span>}
                    </th>
                    {dias.map((d) => {
                      const e = estadoDe(f, d.fecha);
                      const puede = habil(f, d.fecha);
                      const cambiada = clave(f.trabajador_id, d.fecha) in cambios;
                      return (
                        <td key={d.fecha} className={cx("border-t border-stone-100 p-px py-0.5 text-center", d.domingo && "bg-marca-50")}>
                          <button type="button" disabled={!puede} onClick={() => tocar(f, d.fecha)}
                            aria-label={`${f.nombre}, ${d.semana} ${d.dia}: ${CASILLA[e]?.texto ?? "sin marcar"}`}
                            className={cx("mx-auto grid size-6 place-items-center rounded border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500",
                              !puede ? "border-transparent bg-stone-100/70"
                                : e ? cx("border-transparent", CASILLA[e].clase) : "border-stone-200 bg-superficie hover:border-marca-400",
                              cambiada && "ring-2 ring-marca-400 ring-offset-1")}>
                            <Marca estado={e} />
                          </button>
                        </td>
                      );
                    })}
                    <td className="border-t border-stone-100 bg-emerald-50/60 px-2 text-center font-semibold text-emerald-800">{t.asis}</td>
                    <td className={cx("border-t border-stone-100 bg-red-50/60 px-2 text-center", t.faltas ? "font-semibold text-red-700" : "text-stone-400")}>{t.faltas}</td>
                    <td className={cx("border-t border-stone-100 bg-marca-50 px-2 text-center", t.perm ? "font-semibold text-marca-700" : "text-stone-400")}>{t.perm}</td>
                    <td className="cifra border-t border-stone-100 px-2 text-center font-semibold text-stone-700">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>
      <p className="text-xs text-stone-500">% = días que asistió entre los días de lunes a sábado que ya pasaron (desde su ingreso). Las casillas grises son días futuros o fuera de su contrato.</p>

      {error && <Aviso tono="rojo">{error}</Aviso>}
      <div className="sticky bottom-20 z-20 md:bottom-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-superficie p-3 shadow-lg">
          <p className={cx("min-w-0 truncate text-sm font-medium", sucio ? "text-amber-700" : "text-stone-500")}>
            {sucio ? `${Object.keys(cambios).length} cambio(s) sin guardar` : "Todo guardado"}
          </p>
          <span className="flex shrink-0 gap-2">
            {sucio && <Boton variante="secundario" onClick={() => setCambios({})} disabled={guardando}>Deshacer</Boton>}
            <Boton tamano="lg" onClick={guardar} disabled={guardando || !sucio}>
              {guardando ? <><Loader2 className="size-4 animate-spin" /> Guardando…</> : "Guardar cambios"}
            </Boton>
          </span>
        </div>
      </div>
    </div>
  );
}

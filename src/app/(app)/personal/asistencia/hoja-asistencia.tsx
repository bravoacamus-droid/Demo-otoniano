"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";
import { Aviso, Insignia, Tarjeta } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { Input } from "@/components/ui/campos";
import { cx } from "@/components/ui/clases";
import { useNotificar } from "@/components/ui/notificaciones";
import { numero } from "@/lib/formato";
import { guardarAsistencia } from "../acciones";

export interface FilaHoja {
  trabajador_id: string;
  nombre: string;
  cargo: string | null;
  estado: string;
  entrada: string;
  salida: string;
  horas_extra: string;
  nota: string;
  /** Horas extras (las anota Gerencia con «Horas extras»; aquí solo se muestran y se conservan) */
  aprobada: boolean;
}

const ESTADOS = [
  { valor: "asistio", texto: "Asistió" },
  { valor: "falta", texto: "Falta" },
  { valor: "descanso", texto: "Descanso" },
  { valor: "permiso", texto: "Permiso" },
  { valor: "vacaciones", texto: "Vacaciones" },
] as const;

const minutos = (h: string) => (h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : null);

/** Hoja del día: una tarjeta por trabajador (sirve igual en celular) y un solo «Guardar» */
export function HojaAsistencia({ fecha, filas: iniciales, domingo }: { fecha: string; filas: FilaHoja[]; domingo: boolean }) {
  const router = useRouter();
  const notificar = useNotificar();
  const [filas, setFilas] = useState(iniciales);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tras guardar, la página trae lo que quedó en la BD: la hoja vuelve a partir de eso
  useEffect(() => { setFilas(iniciales); }, [iniciales]);
  const cambiar = (id: string, c: Partial<FilaHoja>) => setFilas((fs) => fs.map((f) => (f.trabajador_id === id ? { ...f, ...c } : f)));
  const sinMarcar = filas.filter((f) => !f.estado).length;
  const asistieron = filas.filter((f) => f.estado === "asistio").length;
  const faltas = filas.filter((f) => f.estado === "falta").length;
  const sucio = useMemo(() => JSON.stringify(filas) !== JSON.stringify(iniciales), [filas, iniciales]);
  const horarioMal = (f: FilaHoja) => f.estado === "asistio" && !!f.entrada && !!f.salida && minutos(f.salida)! <= minutos(f.entrada)!;
  const conError = filas.filter(horarioMal);

  // Cambiar de día (flechas o fecha) recarga la página: avisar si hay algo sin guardar
  useEffect(() => {
    if (!sucio) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  async function guardar() {
    setError(null);
    if (conError.length) return setError(`Revise el horario de ${conError.map((f) => f.nombre).join(", ")}: la salida debe ser posterior a la entrada.`);
    setGuardando(true);
    const r = await guardarAsistencia(fecha, filas.filter((f) => f.estado).map(({ trabajador_id, estado, entrada, salida, horas_extra, nota }) =>
      ({ trabajador_id, estado, entrada, salida, horas_extra: estado === "asistio" ? horas_extra : "", nota })));
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    notificar({ titulo: "Asistencia guardada", mensaje: `${r.data} trabajador${r.data === 1 ? "" : "es"} registrado${r.data === 1 ? "" : "s"}.` });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">
          <b className="text-stone-900">{asistieron}</b> asistieron · <b className={cx(faltas > 0 ? "text-red-700" : "text-stone-900")}>{faltas}</b> faltas
          {sinMarcar > 0 && <> · <b className="text-amber-700">{sinMarcar}</b> sin marcar</>}
        </p>
        {sinMarcar > 0 && (
          <Boton variante="secundario" onClick={() => setFilas((fs) => fs.map((f) => (f.estado ? f : { ...f, estado: "asistio" })))}>
            <CheckCheck className="size-4" /> Los que faltan marcar: asistió
          </Boton>
        )}
      </div>

      {filas.map((f) => {
        return (
          <Tarjeta key={f.trabajador_id} className={cx("p-3 sm:p-4", !f.estado && "border-amber-200")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{f.nombre}</p>
                {f.cargo && <p className="text-xs text-stone-500">{f.cargo}</p>}
              </div>
              <div className="grid w-full grid-cols-2 gap-1.5 sm:w-auto sm:grid-cols-5" role="radiogroup" aria-label={`Asistencia de ${f.nombre}`}>
                {ESTADOS.map((e) => {
                  const activo = f.estado === e.valor;
                  return (
                    <button key={e.valor} type="button" role="radio" aria-checked={activo} onClick={() => cambiar(f.trabajador_id, { estado: e.valor })}
                      className={cx("min-h-10 rounded-lg border px-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500",
                        e.valor === "asistio" && "col-span-2 sm:col-span-1",
                        !activo ? "border-stone-200 bg-superficie text-stone-700 hover:border-marca-300"
                          : e.valor === "asistio" ? "border-marca-600 bg-marca-600 text-white"
                            : e.valor === "falta" ? "border-red-600 bg-red-50 text-red-700 ring-1 ring-red-600"
                              : "border-marca-600 bg-marca-50 text-marca-700 ring-1 ring-marca-600")}>
                      {e.texto}
                    </button>
                  );
                })}
              </div>
            </div>

            {f.estado === "asistio" && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
                <label className="text-xs font-medium text-stone-600">Entrada
                  <Input type="time" value={f.entrada} onChange={(e) => cambiar(f.trabajador_id, { entrada: e.target.value })} className="mt-1" />
                </label>
                <label className="text-xs font-medium text-stone-600">Salida
                  <Input type="time" value={f.salida} onChange={(e) => cambiar(f.trabajador_id, { salida: e.target.value })} className="mt-1" />
                </label>
                {horarioMal(f) && <p className="col-span-2 text-xs font-medium text-red-700">La salida debe ser posterior a la entrada.</p>}
              </div>
            )}
            {f.estado && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input value={f.nota} onChange={(e) => cambiar(f.trabajador_id, { nota: e.target.value })} placeholder="Nota (opcional)" className="h-9 max-w-md text-sm" />
                {f.estado === "asistio" && domingo && <Insignia tono="azul">Domingo trabajado</Insignia>}
                {f.estado === "asistio" && Number(f.horas_extra) > 0 && (
                  <Insignia tono={f.aprobada ? "verde" : "ambar"}>{numero(Number(f.horas_extra))} h extras{f.aprobada ? "" : " por aprobar"}</Insignia>
                )}
              </div>
            )}
          </Tarjeta>
        );
      })}

      {error && <Aviso tono="rojo">{error}</Aviso>}
      <div className="sticky bottom-20 z-10 md:bottom-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-superficie p-3 shadow-lg">
          <p className={cx("min-w-0 truncate text-sm font-medium", sucio ? "text-amber-700" : "text-stone-500")}>
            {sucio ? "Cambios sin guardar" : "Todo guardado"}
            <span className="font-normal text-stone-500"> · {filas.length - sinMarcar} de {filas.length} marcados</span>
          </p>
          <Boton tamano="lg" onClick={guardar} disabled={guardando || !sucio} className="shrink-0">
            {guardando ? <><Loader2 className="size-4 animate-spin" /> Guardando…</> : "Guardar asistencia"}
          </Boton>
        </div>
      </div>
    </div>
  );
}

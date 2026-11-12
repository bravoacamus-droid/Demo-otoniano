import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, FileSpreadsheet, FileText } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { periodoPersonal } from "@/lib/personal";
import { EnlaceDescarga } from "@/components/ui/enlace-descarga";
import { puede } from "@/lib/permisos";
import { fechaDia, hoyLima, numero, soles } from "@/lib/formato";
import { Encabezado, Insignia, Kpi, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { BotonLink } from "@/components/ui/boton";
import { claseBoton, cx } from "@/components/ui/clases";
import { TablaDatos } from "@/components/ui/tabla";
import { FormularioAccion } from "@/components/ui/formulario";
import { aprobarHorasExtra } from "./acciones";
import { BotonTrabajador, type AccesoTrabajador, type TrabajadorEditable } from "./form-trabajador";
import type { Cargo } from "../configuracion/cargos";
import type { Database } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Personal" };

type Params = { ver?: string; desde?: string; hasta?: string };
type Marca = { estado: string; entrada: string | null; salida: string | null; horas_extra: number; nota: string | null };
const ESTADO_TEXTO: Record<string, string> = { descanso: "Descanso", permiso: "Permiso", vacaciones: "Vacaciones" };
const VER = { activos: "Activos", cesados: "Cesados", todos: "Todos" } as const;

/** «2 años 3 meses», «5 meses», «12 días» entre dos fechas YYYY-MM-DD */
function antiguedad(desde: string, hasta: string) {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  let meses = (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (meses < 1) {
    const dias = Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
    return `${dias} día${dias === 1 ? "" : "s"}`;
  }
  const anios = Math.floor(meses / 12);
  meses %= 12;
  return [anios && `${anios} año${anios === 1 ? "" : "s"}`, meses && `${meses} mes${meses === 1 ? "" : "es"}`].filter(Boolean).join(" ");
}

const hora = (h?: string | null) => (h ? h.slice(0, 5) : null);

export default async function PersonalPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ver = (sp.ver && sp.ver in VER ? sp.ver : "activos") as keyof typeof VER;
  const hoy = hoyLima();
  const { desde, hasta } = periodoPersonal(sp, hoy);
  const vistoEn = new Date().toISOString();
  const { supabase, empresa, rol } = await exigir("personal");
  const aprueba = puede(rol, "aprobarExtras");

  const [{ data: todos }, { data: resumen }, { data: hoyAsis }, { data: filasCargo }, { data: usuarios }, { data: miembros }] = await Promise.all([
    supabase.from("v_trabajadores").select("*").eq("empresa_id", empresa.id).order("nombre"),
    supabase.rpc("resumen_personal", { p_empresa: empresa.id, p_desde: desde, p_hasta: hasta }),
    supabase.from("asistencias").select("trabajador_id, estado, entrada, salida, horas_extra, nota").eq("empresa_id", empresa.id).eq("fecha", hoy),
    supabase.from("cargos").select("id, nombre, rol, secciones, activo").eq("empresa_id", empresa.id).eq("activo", true).order("creado_en"),
    supabase.from("trabajadores").select("id, user_id").eq("empresa_id", empresa.id).not("user_id", "is", null),
    supabase.from("miembros").select("user_id, email, activo").eq("empresa_id", empresa.id),
  ]);
  const cargos = (filasCargo ?? []) as Cargo[];
  // Trabajadores que entran al sistema: su usuario (correo y si está activo)
  const accesos = new Map<string, AccesoTrabajador>((usuarios ?? []).map((u) => {
    const m = (miembros ?? []).find((x) => x.user_id === u.user_id);
    return [u.id, m ? { email: m.email, activo: m.activo } : null];
  }));
  const trabajadores = (todos ?? []).filter((t) => ver === "todos" || t.situacion === (ver === "activos" ? "activo" : "cesado"));
  const filas = (resumen ?? []) as Database["public"]["Functions"]["resumen_personal"]["Returns"];
  // Hoy: quiénes estaban en la empresa y qué se marcó de cada uno
  const enEmpresaHoy = (todos ?? []).filter((t) => t.fecha_ingreso! <= hoy && (!t.fecha_cese || t.fecha_cese >= hoy));
  const activos = enEmpresaHoy.length;
  const marcaHoy = new Map((hoyAsis ?? []).map((a) => [a.trabajador_id, a]));
  const grupoHoy = (estados: string[] | null) => enEmpresaHoy
    .map((t) => ({ t, m: marcaHoy.get(t.id!) }))
    .filter(({ m }) => (estados ? !!m && estados.includes(m.estado) : !m));
  const hoyAsistieron = grupoHoy(["asistio"]);
  const hoyFaltaron = grupoHoy(["falta"]);
  const hoyOtros = grupoHoy(["descanso", "permiso", "vacaciones"]);
  const hoySinMarcar = grupoHoy(null);
  const asistieronHoy = hoyAsistieron.length;
  // El domingo no se exige marcar: quien no tiene marca no queda «pendiente»
  const hoyDomingo = new Date(`${hoy}T12:00:00Z`).getUTCDay() === 0;
  const porMarcarHoy = hoyDomingo ? 0 : hoySinMarcar.length;
  const pendientes = filas.reduce((s, r) => s + Number(r.horas_pendientes), 0);
  const conSueldo = filas.some((r) => r.sueldo_mensual != null);
  const href = (c: Params) => `/personal?${new URLSearchParams({ ver, desde, hasta, ...c })}`;
  const mesPasado = (() => {
    const [a, m] = hoy.split("-").map(Number);
    const ini = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
    const fin = new Date(Date.UTC(a, m - 1, 0)).toISOString().slice(0, 10);
    return { desde: ini, hasta: fin };
  })();

  return (
    <>
      <Encabezado
        titulo="Personal"
        descripcion="Ingreso y cese de cada trabajador, asistencia, domingos trabajados y horas extras"
        acciones={<><BotonLink href="/personal/asistencia" variante="secundario"><CalendarCheck className="size-4" /> Marcar asistencia</BotonLink><BotonTrabajador cargos={cargos} /></>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Trabajadores activos" valor={numero(activos)} />
        <Kpi titulo="Asistieron hoy" valor={`${asistieronHoy} de ${activos}`} tono={activos > 0 && asistieronHoy + hoyOtros.length === activos ? "positivo" : porMarcarHoy > 0 ? "aviso" : undefined}
          detalle={<Link href="/personal/asistencia" className="hover:underline">{(hoyAsis ?? []).length ? "Ver o corregir" : "Aún no se marca"}</Link>} />
        <Kpi titulo="Faltaron hoy" valor={numero(hoyFaltaron.length)} tono={hoyFaltaron.length > 0 ? "negativo" : undefined}
          detalle={porMarcarHoy > 0 ? `${porMarcarHoy} sin marcar` : hoyDomingo ? "Domingo" : "Todos marcados"} />
        <Kpi titulo="Horas extras por aprobar" valor={numero(pendientes)} tono={pendientes > 0 ? "aviso" : undefined}
          detalle={pendientes > 0 ? <a href="#resumen" className="hover:underline">{aprueba ? "Apruébelas en el resumen" : "Las aprueba Gerencia"}</a> : "Nada pendiente"} />
      </div>

      {activos > 0 && (
        <Tarjeta className="mb-4">
          <TituloTarjeta accion={<BotonLink href="/personal/asistencia" variante="secundario">{(hoyAsis ?? []).length ? "Corregir" : "Marcar"}</BotonLink>}>
            Hoy · {fechaDia(hoy)}
          </TituloTarjeta>
          <div className="grid gap-px bg-stone-100 sm:grid-cols-2 lg:grid-cols-4">
            {[
              // Primero lo que pide atención; al final los que asistieron
              { titulo: "Faltaron", tono: "rojo" as const, lista: hoyFaltaron, detalle: (m?: Marca) => m?.nota ?? "" },
              hoyDomingo
                ? { titulo: "Sin marcar (domingo, no se exige)", tono: "gris" as const, lista: hoySinMarcar, detalle: () => "" }
                : { titulo: "Sin marcar", tono: "ambar" as const, lista: hoySinMarcar, detalle: () => "" },
              { titulo: "Descanso, permiso o vacaciones", tono: "azul" as const, lista: hoyOtros,
                detalle: (m?: Marca) => [m && ESTADO_TEXTO[m.estado], m?.nota].filter(Boolean).join(" · ") },
              { titulo: "Asistieron", tono: "verde" as const, lista: hoyAsistieron,
                detalle: (m?: Marca) => [hora(m?.entrada) && `${hora(m?.entrada)}${hora(m?.salida) ? `–${hora(m?.salida)}` : ""}`,
                  Number(m?.horas_extra) > 0 && `${numero(m!.horas_extra)} h extra`].filter(Boolean).join(" · ") },
            ].map((g) => (
              <div key={g.titulo} className="bg-superficie px-4 py-3">
                <p className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-stone-500">
                  {g.titulo}<Insignia tono={g.tono}>{g.lista.length}</Insignia>
                </p>
                {g.lista.length === 0 ? <p className="text-sm text-stone-500">Nadie</p> : (
                  <ul className="space-y-1.5">
                    {g.lista.map(({ t, m }) => (
                      <li key={t.id} className="text-sm leading-tight">
                        <span className="font-medium text-stone-800">{t.nombre}</span>
                        {g.detalle(m) && <span className="block text-xs text-stone-500">{g.detalle(m)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      <Tarjeta id="resumen" className="mb-4 scroll-mt-20">
        <TituloTarjeta accion={
          <div className="flex gap-2">
            <a href={`/personal/exportar?desde=${desde}&hasta=${hasta}&formato=pdf`} target="_blank" className={claseBoton("secundario", "sm")}>
              <FileText className="size-4" /> PDF
            </a>
            <EnlaceDescarga href={`/personal/exportar?desde=${desde}&hasta=${hasta}&formato=xlsx`} className={claseBoton("secundario", "sm")}>
              <FileSpreadsheet className="size-4" /> Excel
            </EnlaceDescarga>
          </div>
        }>
          Totales del periodo · {fechaDia(desde)} al {fechaDia(hasta)}
        </TituloTarjeta>
        <div className="flex flex-wrap items-end gap-2 border-b border-stone-100 px-4 py-3">
          {[
            { texto: "Este mes", desde: `${hoy.slice(0, 8)}01`, hasta: hoy },
            { texto: "Mes pasado", ...mesPasado },
          ].map((p) => (
            <Link key={p.texto} href={href({ desde: p.desde, hasta: p.hasta })}
              className={cx("inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium",
                desde === p.desde && hasta === p.hasta ? "border-marca-600 bg-marca-50 text-marca-700" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>
              {p.texto}
            </Link>
          ))}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="ver" value={ver} />
            <label className="text-xs font-medium text-stone-600">Desde<input type="date" name="desde" defaultValue={desde} max={hoy} className="mt-1 block h-9 rounded-md border border-stone-300 bg-superficie px-2 text-sm" /></label>
            <label className="text-xs font-medium text-stone-600">Hasta<input type="date" name="hasta" defaultValue={hasta} max={hoy} className="mt-1 block h-9 rounded-md border border-stone-300 bg-superficie px-2 text-sm" /></label>
            <button className="h-9 rounded-md border border-stone-300 px-3 text-sm font-medium hover:bg-stone-50">Ver</button>
          </form>
          {aprueba && pendientes > 0 && (
            <div className="ml-auto">
              <FormularioAccion accion={aprobarHorasExtra} textoBoton={`Aprobar todas (${numero(pendientes)} h)`} variante="secundario"
                mensajeExito="Horas extras aprobadas." className="flex"
                confirmar={`¿Aprobar ${numero(pendientes)} h extras de ${filas.filter((r) => Number(r.horas_pendientes) > 0).length} trabajador(es) del ${fechaDia(desde)} al ${fechaDia(hasta)}? Quedarán para pago.`}>
                <input type="hidden" name="desde" value={desde} />
                <input type="hidden" name="hasta" value={hasta} />
                <input type="hidden" name="visto_en" value={vistoEn} />
              </FormularioAccion>
            </div>
          )}
        </div>
        <p className="px-4 pt-3 text-xs text-stone-500">
          Asistencias, domingos trabajados y horas extras para el pago. Para marcar o ver día por día use el{" "}
          <Link href="/personal/asistencia" className="font-medium text-marca-700 hover:underline">tareo del mes</Link>.
        </p>
        <TablaDatos
          filas={filas}
          clave={(r) => r.trabajador_id}
          vacio="Sin trabajadores en estas fechas."
          columnas={[
            { titulo: "Trabajador", principal: true, celda: (r) => <span className="font-medium">{r.nombre}</span> },
            { titulo: "Asistió", alinear: "der", celda: (r) => <span className="cifra">{r.asistencias}</span> },
            {
              titulo: "Faltas · otros", alinear: "der",
              celda: (r) => (
                <span className="block leading-tight">
                  <span className={cx("cifra", r.faltas > 0 && "font-semibold text-red-700")}>{r.faltas}</span>
                  {(r.descansos + r.permisos + r.vacaciones) > 0 && (
                    <span className="block text-xs text-stone-500">{[r.descansos && `${r.descansos} desc.`, r.permisos && `${r.permisos} perm.`, r.vacaciones && `${r.vacaciones} vac.`].filter(Boolean).join(" · ")}</span>
                  )}
                </span>
              ),
            },
            { titulo: "Sin marcar", alinear: "der", celda: (r) => <span className={cx("cifra", r.dias_por_marcar > 0 ? "text-amber-700" : "text-stone-500")}>{r.dias_por_marcar}</span> },
            { titulo: "Domingos", alinear: "der", celda: (r) => <span className="cifra">{r.domingos_trabajados}</span> },
            {
              titulo: "Horas extras", alinear: "der",
              celda: (r) => (
                <span className="block leading-tight">
                  <span className="cifra font-medium">{numero(r.horas_extra)} h</span>
                  {Number(r.horas_pendientes) > 0
                    ? <span className="block text-xs font-medium text-amber-700">{numero(r.horas_pendientes)} h por aprobar</span>
                    : Number(r.horas_extra) > 0 && <span className="block text-xs text-stone-500">aprobadas</span>}
                </span>
              ),
            },
            ...(conSueldo ? [{
              titulo: "Le corresponde", alinear: "der" as const,
              celda: (r: (typeof filas)[number]) => r.sueldo_mensual == null ? <span className="text-xs text-stone-500">Sin sueldo</span> : (
                <span className="block leading-tight">
                  <span className="cifra font-semibold">{soles(r.monto_total)}</span>
                  <span className="block text-xs text-stone-500">{soles(r.monto_horas)} extras · {soles(r.monto_domingos)} domingos</span>
                </span>
              ),
            }] : []),
            {
              titulo: "", alinear: "der",
              celda: (r) => aprueba && Number(r.horas_pendientes) > 0 ? (
                <FormularioAccion accion={aprobarHorasExtra} textoBoton={`Aprobar ${numero(r.horas_pendientes)} h`} variante="secundario"
                  mensajeExito={`Horas extras de ${r.nombre} aprobadas.`} className="flex"
                  confirmar={`¿Aprobar ${numero(r.horas_pendientes)} h extras de ${r.nombre} del ${fechaDia(desde)} al ${fechaDia(hasta)}? Quedarán para pago.`}>
                  <input type="hidden" name="desde" value={desde} />
                  <input type="hidden" name="hasta" value={hasta} />
                  <input type="hidden" name="visto_en" value={vistoEn} />
                  <input type="hidden" name="trabajador_id" value={r.trabajador_id} />
                </FormularioAccion>
              ) : null,
            },
          ]}
        />
        <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">
          Horas extras: las 2 primeras del día con +{numero(empresa.hx_tasa_primeras ?? 25)} %, las siguientes con +{numero(empresa.hx_tasa_siguientes ?? 35)} %;
          domingo trabajado: +{numero(empresa.domingo_tasa ?? 100)} % del día. Solo se pagan las horas aprobadas por Gerencia. Montos estimados; confirme con su contador.
        </p>
      </Tarjeta>

      <Tarjeta>
        <TituloTarjeta accion={
          <div className="flex gap-1.5">
            {(Object.keys(VER) as (keyof typeof VER)[]).map((v) => (
              <Link key={v} href={href({ ver: v })}
                className={cx("inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium",
                  ver === v ? "border-marca-600 bg-marca-50 text-marca-700" : "border-stone-200 bg-superficie text-stone-600 hover:bg-stone-50")}>
                {VER[v]}
              </Link>
            ))}
          </div>
        }>
          Trabajadores
        </TituloTarjeta>
        <TablaDatos
          filas={trabajadores ?? []}
          clave={(t) => t.id!}
          vacio={<>No hay trabajadores {ver === "todos" ? "registrados" : VER[ver].toLowerCase()}. Use «Nuevo trabajador».</>}
          columnas={[
            {
              titulo: "Trabajador", principal: true,
              celda: (t) => (
                <span className="block leading-tight">
                  <span className="font-medium">{t.nombre}</span>
                  {t.dni && <span className="cifra block text-xs text-stone-500">DNI {t.dni}</span>}
                </span>
              ),
            },
            {
              titulo: "Cargo",
              celda: (t) => (
                <span className="block leading-tight">
                  {t.cargo ?? "—"}
                  {accesos.get(t.id!) && <span className="block text-xs text-stone-500">{accesos.get(t.id!)!.activo ? "Usa el sistema" : "Sin acceso al sistema"}</span>}
                </span>
              ),
            },
            { titulo: "Ingreso", celda: (t) => fechaDia(t.fecha_ingreso) },
            {
              titulo: "Cese",
              celda: (t) => t.fecha_cese ? (
                <span className="block leading-tight">{fechaDia(t.fecha_cese)}{t.motivo_cese && <span className="block text-xs text-stone-500">{t.motivo_cese}</span>}</span>
              ) : "—",
            },
            { titulo: "Antigüedad", celda: (t) => antiguedad(t.fecha_ingreso!, t.fecha_cese && t.fecha_cese < hoy ? t.fecha_cese : hoy) },
            { titulo: "Estado", celda: (t) => <Insignia tono={t.situacion === "activo" ? "verde" : "gris"}>{t.situacion === "activo" ? "Activo" : "Cesado"}</Insignia> },
            { titulo: "", alinear: "der", celda: (t) => <BotonTrabajador cargos={cargos} inicial={t as unknown as TrabajadorEditable} acceso={accesos.get(t.id!) ?? null} /> },
          ]}
        />
      </Tarjeta>
    </>
  );
}

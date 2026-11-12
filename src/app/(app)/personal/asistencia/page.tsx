import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { hoyLima } from "@/lib/formato";
import { Aviso, Encabezado } from "@/components/ui/basicos";
import { BotonLink } from "@/components/ui/boton";
import { claseBoton, cx } from "@/components/ui/clases";
import { EnlaceDescarga } from "@/components/ui/enlace-descarga";
import { HojaAsistencia, type FilaHoja } from "./hoja-asistencia";
import { Tareo, type DiaTareo, type FilaTareo } from "./tareo";
import { BotonHorasExtra } from "./horas-extra";

export const metadata: Metadata = { title: "Asistencia" };

const sumarDias = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-PE", { ...o, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nombreDia = (iso: string) => mayuscula(fmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
/** Mes vecino en formato YYYY-MM */
const otroMes = (mes: string, d: number) => {
  const [a, m] = mes.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1 + d, 1));
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`;
};

const flecha = "grid size-10 place-items-center rounded-lg border border-stone-300 bg-superficie hover:bg-stone-50";
const flechaOff = "grid size-10 place-items-center rounded-lg border border-stone-200 text-stone-300";

export default async function AsistenciaPage({ searchParams }: { searchParams: Promise<{ fecha?: string; mes?: string; vista?: string }> }) {
  const sp = await searchParams;
  const hoy = hoyLima();
  const { supabase, empresa } = await exigir("personal");
  // Mes (tareo) por defecto; «Día» es la hoja de un día con horario y notas
  const vista = sp.vista === "dia" || (sp.fecha && !sp.mes) ? "dia" : "mes";
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) && sp.fecha <= hoy ? sp.fecha : hoy;
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) && sp.mes <= hoy.slice(0, 7) ? sp.mes : (vista === "dia" ? fecha : hoy).slice(0, 7);
  const inicio = `${mes}-01`;
  const fin = sumarDias(`${otroMes(mes, 1)}-01`, -1);
  const desde = vista === "dia" ? fecha : inicio;
  const hasta = vista === "dia" ? fecha : fin;

  // Quienes estuvieron en la empresa en el periodo (ingresaron antes del final y no cesaron antes del inicio)
  const [{ data: trabajadores }, { data: marcas }] = await Promise.all([
    supabase.from("trabajadores").select("id, nombre, cargo, fecha_ingreso, fecha_cese").eq("empresa_id", empresa.id)
      .lte("fecha_ingreso", hasta).or(`fecha_cese.is.null,fecha_cese.gte.${desde}`).order("nombre"),
    supabase.from("asistencias").select("*").eq("empresa_id", empresa.id).gte("fecha", desde).lte("fecha", hasta),
  ]);
  const lista = trabajadores ?? [];
  const opcionesExtra = lista.filter((t) => !t.fecha_cese || t.fecha_cese >= inicio).map((t) => ({ id: t.id, nombre: t.nombre }));

  const pestana = (activa: boolean) => cx("rounded-md px-4 py-1.5 text-sm font-semibold", activa ? "bg-superficie text-marca-700 shadow-sm" : "text-stone-600 hover:text-stone-900");
  const excel = `/personal/exportar?desde=${inicio}&hasta=${fin < hoy ? fin : hoy}&formato=xlsx`;

  let contenido: React.ReactNode;
  if (lista.length === 0) {
    contenido = <Aviso>No hay trabajadores en la empresa en estas fechas. Regístrelos en <Link href="/personal" className="font-medium underline">Personal</Link>.</Aviso>;
  } else if (vista === "mes") {
    const dias: DiaTareo[] = [];
    for (let d = inicio; d <= fin; d = sumarDias(d, 1)) {
      dias.push({ fecha: d, dia: Number(d.slice(8)), semana: fmt(d, { weekday: "short" }).replace(".", ""), domingo: new Date(`${d}T12:00:00Z`).getUTCDay() === 0 });
    }
    const filas: FilaTareo[] = lista.map((t) => ({
      trabajador_id: t.id, nombre: t.nombre, cargo: t.cargo, ingreso: t.fecha_ingreso, cese: t.fecha_cese,
      marcas: Object.fromEntries((marcas ?? []).filter((m) => m.trabajador_id === t.id).map((m) => [m.fecha, m.estado])),
    }));
    contenido = <Tareo key={mes} titulo={mayuscula(fmt(inicio, { month: "long", year: "numeric" }))} dias={dias} filas={filas} hoy={hoy} />;
  } else {
    const porTrabajador = new Map((marcas ?? []).map((m) => [m.trabajador_id, m]));
    const filas: FilaHoja[] = lista.map((t) => {
      const m = porTrabajador.get(t.id);
      return {
        trabajador_id: t.id, nombre: t.nombre, cargo: t.cargo,
        estado: m?.estado ?? "", entrada: m?.entrada?.slice(0, 5) ?? "", salida: m?.salida?.slice(0, 5) ?? "",
        horas_extra: m && Number(m.horas_extra) > 0 ? String(Number(m.horas_extra)) : "", nota: m?.nota ?? "",
        aprobada: !!m?.extra_aprobada,
      };
    });
    const domingo = new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;
    contenido = (
      <>
        {domingo && <div className="mb-4"><Aviso tono="azul">Es domingo: a quien marque «Asistió» se le cuenta como <b>domingo trabajado</b> en el resumen.</Aviso></div>}
        <HojaAsistencia key={fecha} fecha={fecha} filas={filas} domingo={domingo} />
      </>
    );
  }

  return (
    <>
      <Encabezado titulo="Asistencia" descripcion="Tareo del mes: marque quién asistió, faltó, tuvo permiso o descansó"
        acciones={<BotonLink href="/personal" variante="secundario">Resumen y trabajadores</BotonLink>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-superficie p-3">
        <div className="flex rounded-lg bg-stone-100 p-1" role="tablist" aria-label="Vista">
          <Link role="tab" aria-selected={vista === "mes"} href={`/personal/asistencia?mes=${mes}`} className={pestana(vista === "mes")}>Mes</Link>
          <Link role="tab" aria-selected={vista === "dia"} href={`/personal/asistencia?vista=dia&fecha=${mes === hoy.slice(0, 7) ? hoy : fin}`} className={pestana(vista === "dia")}>Día</Link>
        </div>

        {vista === "mes" ? (
          <>
            <Link href={`/personal/asistencia?mes=${otroMes(mes, -1)}`} aria-label="Mes anterior" className={flecha}><ChevronLeft className="size-5" /></Link>
            <form method="get" className="flex items-center gap-2">
              <input type="month" name="mes" defaultValue={mes} max={hoy.slice(0, 7)} aria-label="Mes"
                className="h-10 rounded-lg border border-stone-300 bg-superficie px-3 text-sm" />
              <button className="h-10 rounded-lg border border-stone-300 bg-superficie px-3 text-sm font-medium hover:bg-stone-50">Ir</button>
            </form>
            {mes < hoy.slice(0, 7)
              ? <Link href={`/personal/asistencia?mes=${otroMes(mes, 1)}`} aria-label="Mes siguiente" className={flecha}><ChevronRight className="size-5" /></Link>
              : <span className={flechaOff}><ChevronRight className="size-5" /></span>}
          </>
        ) : (
          <>
            <Link href={`/personal/asistencia?vista=dia&fecha=${sumarDias(fecha, -1)}`} aria-label="Día anterior" className={flecha}><ChevronLeft className="size-5" /></Link>
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="vista" value="dia" />
              <input type="date" name="fecha" defaultValue={fecha} max={hoy} aria-label="Día"
                className="h-10 rounded-lg border border-stone-300 bg-superficie px-3 text-sm" />
              <button className="h-10 rounded-lg border border-stone-300 bg-superficie px-3 text-sm font-medium hover:bg-stone-50">Ir</button>
            </form>
            {fecha < hoy
              ? <Link href={`/personal/asistencia?vista=dia&fecha=${sumarDias(fecha, 1)}`} aria-label="Día siguiente" className={flecha}><ChevronRight className="size-5" /></Link>
              : <span className={flechaOff}><ChevronRight className="size-5" /></span>}
            <p className="ml-1 text-sm font-semibold text-stone-800">{nombreDia(fecha)}{fecha === hoy && <span className="font-normal text-stone-500"> · hoy</span>}</p>
          </>
        )}

        <span className="ml-auto flex flex-wrap gap-2">
          <BotonHorasExtra trabajadores={opcionesExtra} hoy={hoy} />
          <EnlaceDescarga href={excel} className={claseBoton("secundario")}><Download className="size-4" /> Excel</EnlaceDescarga>
        </span>
      </div>

      {contenido}
    </>
  );
}

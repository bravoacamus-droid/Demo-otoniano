import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { hoyLima } from "@/lib/formato";
import { Aviso, Encabezado } from "@/components/ui/basicos";
import { BotonLink } from "@/components/ui/boton";
import { HojaAsistencia, type FilaHoja } from "./hoja-asistencia";

export const metadata: Metadata = { title: "Asistencia" };

const sumarDias = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const nombreDia = (iso: string) => {
  const s = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default async function AsistenciaPage({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const sp = await searchParams;
  const hoy = hoyLima();
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) && sp.fecha <= hoy ? sp.fecha : hoy;
  const { supabase, empresa } = await exigir("personal");
  const domingo = new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;

  // Quienes estaban en la empresa ese día (ingresaron antes y no habían cesado)
  const [{ data: trabajadores }, { data: marcas }] = await Promise.all([
    supabase.from("trabajadores").select("id, nombre, cargo, fecha_ingreso, fecha_cese").eq("empresa_id", empresa.id)
      .lte("fecha_ingreso", fecha).or(`fecha_cese.is.null,fecha_cese.gte.${fecha}`).order("nombre"),
    supabase.from("asistencias").select("*").eq("empresa_id", empresa.id).eq("fecha", fecha),
  ]);
  const porTrabajador = new Map((marcas ?? []).map((m) => [m.trabajador_id, m]));
  const filas: FilaHoja[] = (trabajadores ?? []).map((t) => {
    const m = porTrabajador.get(t.id);
    return {
      trabajador_id: t.id, nombre: t.nombre, cargo: t.cargo,
      estado: m?.estado ?? "", entrada: m?.entrada?.slice(0, 5) ?? "", salida: m?.salida?.slice(0, 5) ?? "",
      horas_extra: m && Number(m.horas_extra) > 0 ? String(Number(m.horas_extra)) : "", nota: m?.nota ?? "",
      aprobada: !!m?.extra_aprobada,
    };
  });

  return (
    <>
      <Encabezado titulo="Asistencia" descripcion="Marque quién asistió, faltó o descansó; registre horas extras (las aprueba Gerencia)"
        acciones={<BotonLink href="/personal" variante="secundario">Resumen y trabajadores</BotonLink>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/personal/asistencia?fecha=${sumarDias(fecha, -1)}`} aria-label="Día anterior"
          className="grid size-10 place-items-center rounded-lg border border-stone-300 bg-superficie hover:bg-stone-50"><ChevronLeft className="size-5" /></Link>
        <form method="get" className="flex items-center gap-2">
          <input type="date" name="fecha" defaultValue={fecha} max={hoy}
            className="h-10 rounded-lg border border-stone-300 bg-superficie px-3 text-sm" />
          <button className="h-10 rounded-lg border border-stone-300 bg-superficie px-3 text-sm font-medium hover:bg-stone-50">Ir</button>
        </form>
        {fecha < hoy ? (
          <Link href={`/personal/asistencia?fecha=${sumarDias(fecha, 1)}`} aria-label="Día siguiente"
            className="grid size-10 place-items-center rounded-lg border border-stone-300 bg-superficie hover:bg-stone-50"><ChevronRight className="size-5" /></Link>
        ) : <span className="grid size-10 place-items-center rounded-lg border border-stone-200 text-stone-300"><ChevronRight className="size-5" /></span>}
        <p className="ml-1 text-sm font-semibold text-stone-800">{nombreDia(fecha)}{fecha === hoy && <span className="font-normal text-stone-500"> · hoy</span>}</p>
      </div>

      {domingo && (
        <div className="mb-4"><Aviso tono="azul">Es domingo: a quien marque «Asistió» se le cuenta como <b>domingo trabajado</b> en el resumen.</Aviso></div>
      )}

      {filas.length === 0 ? (
        <Aviso>No hay trabajadores en la empresa en esta fecha. Regístrelos en <Link href="/personal" className="font-medium underline">Personal</Link>.</Aviso>
      ) : (
        <HojaAsistencia key={fecha} fecha={fecha} filas={filas} domingo={domingo} jornada={Number(empresa.jornada_horas ?? 8)} />
      )}
    </>
  );
}

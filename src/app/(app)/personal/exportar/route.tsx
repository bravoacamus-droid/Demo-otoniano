import ExcelJS from "exceljs";
import { renderToBuffer } from "@react-pdf/renderer";
import { obtenerContexto } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { cargarLogo } from "@/lib/archivos-servidor";
import { fechaDia, hoyLima, numero, soles } from "@/lib/formato";
import { LETRA_ESTADO, diasEntre, marcasAsistencia, periodoPersonal } from "@/lib/personal";
import { AsistenciaPdf, type DatosAsistenciaPdf } from "@/lib/pdf/asistencia";
import { fechaHoraLima } from "@/lib/pdf/marca";
import type { Database } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

// Resumen de asistencia del periodo (solo Gerencia, igual que la pantalla Personal): totales por trabajador
// (de resumen_personal) y cuadro día por día. ?desde=&hasta=&formato=pdf|xlsx

const MARCA = "FF1A5CA8";
const MARCA_OSCURO = "FF0F2C50";
const TINTE = "FFEFF7FE";
const CEBRA = "FFFAFAF9";
const SOLES = '"S/" #,##0.00';
const HORAS = '#,##0.##" h"';
const SEMANA = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];
const COLOR_DIA: Record<string, [string, string]> = {
  A: ["FFD1FAE5", "FF065F46"], F: ["FFFEE2E2", "FF991B1B"], D: [TINTE, "FF164B8A"], P: [TINTE, "FF164B8A"],
  V: [TINTE, "FF164B8A"], "?": ["FFFEF3C7", "FF92400E"],
};

type Resumen = Database["public"]["Functions"]["resumen_personal"]["Returns"][number];
const n = (v: unknown) => Number(v ?? 0);
const diaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

export async function GET(request: Request) {
  const ctx = await obtenerContexto();
  if (!puede(ctx.rol, "personal")) return new Response("Sin permiso", { status: 403 });
  const { supabase, empresa } = ctx;
  const sp = new URL(request.url).searchParams;
  const formato = sp.get("formato") === "xlsx" ? "xlsx" : "pdf";
  const hoy = hoyLima();
  const { desde, hasta } = periodoPersonal({ desde: sp.get("desde"), hasta: sp.get("hasta") }, hoy);

  const [resumen, trabajadores, marcas, logo] = await Promise.all([
    supabase.rpc("resumen_personal", { p_empresa: empresa.id, p_desde: desde, p_hasta: hasta }),
    supabase.from("trabajadores").select("id, nombre, fecha_ingreso, fecha_cese").eq("empresa_id", empresa.id)
      .lte("fecha_ingreso", hasta).or(`fecha_cese.is.null,fecha_cese.gte.${desde}`).order("nombre"),
    marcasAsistencia(supabase, empresa.id, desde, hasta),
    formato === "pdf" ? cargarLogo(supabase, empresa.logo_url) : Promise.resolve(null),
  ]);
  for (const r of [resumen, trabajadores]) if (r.error) return new Response(r.error.message, { status: 500 });
  const filas = (resumen.data ?? []) as Resumen[];
  const conSueldo = filas.some((r) => r.sueldo_mensual != null);

  // Cuadro: letra de cada trabajador en cada día del periodo
  const dias = diasEntre(desde, hasta);
  const porClave = new Map(marcas.map((m) => [`${m.trabajador_id}|${m.fecha}`, m]));
  const cuadro = (trabajadores.data ?? []).map((t) => ({
    nombre: t.nombre,
    dias: dias.map((d) => {
      if (d < t.fecha_ingreso || (t.fecha_cese && d > t.fecha_cese)) return { letra: "", extra: false };
      const m = porClave.get(`${t.id}|${d}`);
      if (!m) return { letra: diaSemana(d) === 0 ? "·" : "?", extra: false };
      return { letra: LETRA_ESTADO[m.estado] ?? "", extra: n(m.horas_extra) > 0 };
    }),
  }));

  const periodo = `Del ${fechaDia(desde)} al ${fechaDia(hasta)}`;
  const nota = `Horas extras: las 2 primeras del día con +${numero(empresa.hx_tasa_primeras ?? 25)} %, las siguientes con `
    + `+${numero(empresa.hx_tasa_siguientes ?? 35)} %; domingo trabajado: +${numero(empresa.domingo_tasa ?? 100)} % del día. `
    + "Solo se pagan las horas aprobadas por Gerencia. Montos estimados; confirme con su contador.";
  const archivo = `asistencia_${desde}_${hasta}`;

  const columnas: { titulo: string; ancho: number; valor: (r: Resumen) => number | string; tipo: "texto" | "num" | "horas" | "soles"; total?: boolean }[] = [
    { titulo: "Trabajador", ancho: 30, valor: (r) => r.nombre, tipo: "texto" },
    { titulo: "Asistió", ancho: 8, valor: (r) => r.asistencias, tipo: "num", total: true },
    { titulo: "Faltas", ancho: 8, valor: (r) => r.faltas, tipo: "num", total: true },
    { titulo: "Descanso", ancho: 9, valor: (r) => r.descansos, tipo: "num", total: true },
    { titulo: "Permiso", ancho: 8, valor: (r) => r.permisos, tipo: "num", total: true },
    { titulo: "Vacaciones", ancho: 10, valor: (r) => r.vacaciones, tipo: "num", total: true },
    { titulo: "Sin marcar", ancho: 9, valor: (r) => r.dias_por_marcar, tipo: "num", total: true },
    { titulo: "Domingos", ancho: 9, valor: (r) => r.domingos_trabajados, tipo: "num", total: true },
    { titulo: "H. extras", ancho: 9, valor: (r) => n(r.horas_extra), tipo: "horas", total: true },
    { titulo: "Por aprobar", ancho: 10, valor: (r) => n(r.horas_pendientes), tipo: "horas", total: true },
    ...(conSueldo ? [
      { titulo: "Pago extras", ancho: 12, valor: (r: Resumen) => n(r.monto_horas), tipo: "soles" as const, total: true },
      { titulo: "Pago domingos", ancho: 12, valor: (r: Resumen) => n(r.monto_domingos), tipo: "soles" as const, total: true },
      { titulo: "Le corresponde", ancho: 13, valor: (r: Resumen) => n(r.monto_total), tipo: "soles" as const, total: true },
    ] : []),
  ];
  const suma = (i: number) => filas.reduce((a, r) => a + n(columnas[i].valor(r)), 0);
  const textoDe = (tipo: string, v: number | string) =>
    tipo === "soles" ? soles(v) : tipo === "horas" ? `${numero(v)} h` : tipo === "num" ? numero(v) : String(v);

  if (formato === "pdf") {
    const bloques: DatosAsistenciaPdf["bloques"] = [];
    for (let i = 0; i < dias.length; i += 31) {
      const tramo = dias.slice(i, i + 31);
      bloques.push({
        titulo: `${fechaDia(tramo[0])} al ${fechaDia(tramo[tramo.length - 1])}`,
        dias: tramo.map((d) => ({ dia: String(Number(d.slice(8))), semana: SEMANA[diaSemana(d)], domingo: diaSemana(d) === 0 })),
        // Sin filas vacías: quien aún no ingresaba o ya había cesado en ese tramo no aparece
        filas: cuadro.map((c) => ({ nombre: c.nombre, dias: c.dias.slice(i, i + 31) })).filter((c) => c.dias.some((x) => x.letra)),
      });
    }
    const d: DatosAsistenciaPdf = {
      empresa: { razon_social: empresa.razon_social, ruc: empresa.ruc, direccion: empresa.direccion, telefono: empresa.telefono },
      logo: logo?.buffer ?? null,
      periodo,
      generado: `${fechaHoraLima(new Date())} · ${ctx.nombre}`,
      columnas: columnas.map((c) => ({ titulo: c.titulo, ancho: c.ancho })),
      filas: filas.map((r) => ({
        nombre: r.nombre, cargo: r.cargo ?? "", situacion: r.situacion, faltas: r.faltas,
        celdas: columnas.map((c) => textoDe(c.tipo, c.valor(r))),
      })),
      totales: columnas.map((c, i) => (i === 0 ? `Total · ${filas.length} trabajador(es)` : c.total ? textoDe(c.tipo, suma(i)) : "")),
      bloques,
      nota,
    };
    const pdf = await renderToBuffer(<AsistenciaPdf d={d} />);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${archivo}.pdf"` },
    });
  }

  // --- Excel: hoja de totales y hoja día por día ---
  const libro = new ExcelJS.Workbook();
  libro.creator = empresa.razon_social;
  libro.created = new Date();

  const banda = (hoja: ExcelJS.Worksheet, ancho: number, titulo: string) => {
    const ultima = hoja.getColumn(ancho).letter;
    ([[empresa.razon_social, 15], [titulo, 12], [`${periodo} · Generado ${fechaHoraLima(new Date())} por ${ctx.nombre}`, 9]] as const)
      .forEach(([texto, tam], i) => {
        hoja.mergeCells(`A${i + 1}:${ultima}${i + 1}`);
        const celda = hoja.getCell(`A${i + 1}`);
        celda.value = texto;
        celda.font = { bold: i < 2, size: tam, color: { argb: i === 0 ? "FFFFFFFF" : "FFDBEEFC" } };
        celda.alignment = { vertical: "middle", indent: 1 };
        hoja.getRow(i + 1).height = i === 0 ? 26 : 18;
        for (let c = 1; c <= ancho; c++) hoja.getCell(i + 1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA } };
      });
    for (let c = 1; c <= ancho; c++) hoja.getCell(4, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA_OSCURO } };
    hoja.getRow(4).height = 4;
    hoja.addRow([]);
  };
  const cabecera = (fila: ExcelJS.Row) => {
    fila.height = 22;
    fila.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA } };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
  };
  const imprimir = (hoja: ExcelJS.Worksheet, titulo: string) => {
    hoja.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    hoja.headerFooter = { oddHeader: `&L&8${empresa.razon_social}&R&8${titulo}`, oddFooter: "&L&8Documento de uso interno&RPágina &P de &N" };
  };

  // Hoja 1: totales
  const h1 = libro.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
  const anchoH1 = columnas.length + 1;
  banda(h1, anchoH1, "Resumen de asistencia");
  cabecera(h1.addRow([columnas[0].titulo, "Cargo", ...columnas.slice(1).map((c) => c.titulo)]));
  filas.forEach((r, i) => {
    const fila = h1.addRow([r.nombre + (r.situacion === "cesado" ? " (cesado)" : ""), r.cargo ?? "", ...columnas.slice(1).map((c) => c.valor(r))]);
    for (let c = 1; c <= anchoH1; c++) {
      const celda = fila.getCell(c);
      if (i % 2 === 1) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CEBRA } };
      celda.border = { bottom: { style: "hair", color: { argb: "FFE7E5E4" } } };
    }
    if (r.faltas > 0) fila.getCell(4).font = { bold: true, color: { argb: "FFB91C1C" } };
  });
  const tot = h1.addRow([`Total · ${filas.length} trabajador(es)`, "", ...columnas.slice(1).map((c, i) => (c.total ? suma(i + 1) : null))]);
  tot.font = { bold: true };
  tot.eachCell({ includeEmpty: true }, (c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINTE } };
    c.border = { top: { style: "medium", color: { argb: MARCA_OSCURO } } };
  });
  h1.getColumn(1).width = 30;
  h1.getColumn(2).width = 22;
  columnas.slice(1).forEach((c, i) => {
    const col = h1.getColumn(i + 3);
    col.width = Math.max(11, c.ancho + 3);
    col.numFmt = c.tipo === "soles" ? SOLES : c.tipo === "horas" ? HORAS : "0";
  });
  h1.addRow([]);
  const filaNota = h1.addRow([nota]);
  h1.mergeCells(filaNota.number, 1, filaNota.number, anchoH1);
  filaNota.getCell(1).font = { italic: true, size: 9, color: { argb: "FF78716C" } };
  filaNota.getCell(1).alignment = { wrapText: true };
  filaNota.height = 30;
  imprimir(h1, "Resumen de asistencia");

  // Hoja 2: día por día
  const h2 = libro.addWorksheet("Día por día", { views: [{ state: "frozen", xSplit: 1, ySplit: 7, showGridLines: false }] });
  banda(h2, Math.max(dias.length + 1, 8), "Asistencia día por día");
  cabecera(h2.addRow(["", ...dias.map((d) => SEMANA[diaSemana(d)])]));
  cabecera(h2.addRow(["Trabajador", ...dias.map((d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`)]));
  dias.forEach((d, i) => { if (diaSemana(d) === 0) for (const f of [6, 7]) h2.getCell(f, i + 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARCA_OSCURO } }; });
  for (const c of cuadro) {
    const fila = h2.addRow([c.nombre, ...c.dias.map((x) => x.letra + (x.extra ? "+" : ""))]);
    fila.getCell(1).font = { bold: true };
    c.dias.forEach((x, i) => {
      const celda = fila.getCell(i + 2);
      celda.alignment = { horizontal: "center" };
      celda.border = { bottom: { style: "hair", color: { argb: "FFE7E5E4" } } };
      const color = COLOR_DIA[x.letra];
      if (color) {
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color[0] } };
        celda.font = { bold: true, color: { argb: color[1] } };
      } else celda.font = { color: { argb: "FFA8A29E" } };
    });
  }
  h2.getColumn(1).width = 30;
  for (let i = 0; i < dias.length; i++) h2.getColumn(i + 2).width = 5.5;
  h2.addRow([]);
  h2.addRow(["A = asistió · F = falta · D = descanso · P = permiso · V = vacaciones · ? = sin marcar · · = domingo sin marcar (no se exige) · + = con horas extras"])
    .getCell(1).font = { italic: true, size: 9, color: { argb: "FF78716C" } };
  imprimir(h2, "Asistencia día por día");

  const buffer = await libro.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${archivo}.xlsx"`,
    },
  });
}

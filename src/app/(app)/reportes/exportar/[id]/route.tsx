import ExcelJS from "exceljs";
import { renderToBuffer } from "@react-pdf/renderer";
import { obtenerContexto } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { logoReporte } from "@/lib/archivos-servidor";
import { REPORTES, filtrosDesde, totales, type Col, type DatosReporte, type DefReporte, type DetalleReporte } from "@/lib/reportes";
import { fecha, fechaHora, kg, numero, porcentaje, soles } from "@/lib/formato";
import { ReportePdf } from "@/lib/pdf/reporte";
import { fechaHoraLima } from "@/lib/pdf/marca";

export const runtime = "nodejs";

const FORMATO_EXCEL: Partial<Record<Col["tipo"], string>> = {
  soles: '"S/" #,##0.00;[Red]-"S/" #,##0.00',
  precio: '"S/" #,##0.00##',
  kg: "#,##0.00#",
  num: "#,##0",
  pct: '0.00" %"',
  fecha: "dd/mm/yyyy hh:mm",
};
const ANCHO: Record<Col["tipo"], number> = { texto: 30, fecha: 16, soles: 14, precio: 13, kg: 13, num: 9, pct: 10 };
// Colores de la marca (los mismos de src/lib/pdf/marca.tsx), en ARGB para Excel
const XL_MARCA = "FF1A5CA8";
const XL_OSCURO = "FF0F2C50";
const XL_TINTE = "FFEFF7FE";
const XL_GRIS = "FF78716C";

function texto(c: Col, v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  // -0 (p. ej. «− retiros» en cero) se muestra como 0
  if (c.tipo !== "texto" && c.tipo !== "fecha") v = Number(v) + 0;
  switch (c.tipo) {
    case "soles": return soles(v as string);
    case "precio": return `S/ ${Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    case "kg": return kg(v as string);
    case "num": return numero(v as string);
    case "pct": return porcentaje(v as string);
    case "fecha": return fechaHora(v as string);
    default: return String(v);
  }
}

function valorExcel(c: Col, v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  if (c.tipo === "texto") return String(v);
  if (c.tipo !== "fecha") return Number(v) + 0;
  // Excel no maneja zonas horarias: se escribe la hora de Lima como fecha "local"
  const d = new Date(v as string);
  return new Date(d.getTime() - 5 * 3600 * 1000);
}

/** Operaciones de cada grupo, por la clave de la fila del resumen */
function agrupar(det: DetalleReporte | null) {
  const m = new Map<string, DetalleReporte["filas"]>();
  for (const d of det?.filas ?? []) m.set(d._clave, [...(m.get(d._clave) ?? []), d]);
  return m;
}

/** Totales destacados arriba del PDF (aunque haya una sola fila): los elegidos en el reporte o los primeros que se suman */
function kpisDe(def: DefReporte, datos: DatosReporte) {
  const t = totales(datos, 1);
  if (!t) return [];
  const cols = def.destacar ? def.destacar.map((k) => datos.columnas.find((c) => c.clave === k)).filter((c): c is Col => Boolean(c)) : datos.columnas.filter((c) => c.clave in t).slice(0, 4);
  return cols.map((c) => ({ titulo: `Total ${c.titulo.toLowerCase()}`, valor: texto(c, t[c.clave]) }));
}
const anchoDe = (c: Col) => c.ancho ?? (c.clave === "numero" ? 6 : ANCHO[c.tipo]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await obtenerContexto();
  if (!puede(ctx.rol, "verReportes")) return new Response("Sin permiso", { status: 403 });
  const def = REPORTES.find((r) => r.id === id);
  if (!def) return new Response("Reporte no existe", { status: 404 });

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const f = filtrosDesde(sp);
  const [datos, detalle, logo] = await Promise.all([
    def.obtener(ctx, f),
    def.detalle ? def.detalle(ctx, f).catch(() => null) : null,
    logoReporte(ctx.supabase, ctx.empresa.logo_url),
  ]);
  const t = totales(datos);
  const porGrupo = agrupar(detalle);
  const ops = (r: Record<string, unknown>) => (detalle ? porGrupo.get(String(r.clave)) ?? [] : []);
  const rango = def.id === "patrimonio" ? `Al ${fecha(new Date())}` : `Del ${fecha(`${f.desde}T12:00:00-05:00`)} al ${fecha(`${f.hasta}T12:00:00-05:00`)}`;
  const agrupado = def.agrupaciones?.find((a) => a.valor === f.agrupar)?.texto ?? def.agrupaciones?.[0]?.texto;
  const subtitulo = agrupado ? `${rango}  ·  ${agrupado}` : rango;
  const generado = `${fechaHoraLima(new Date())} · ${ctx.nombre}`;
  const nombreArchivo = `${def.id}_${f.desde}_${f.hasta}`;
  const empresa = ctx.empresa;

  if (sp.formato === "pdf") {
    const pdf = await renderToBuffer(
      <ReportePdf
        empresa={{ razon_social: empresa.razon_social, ruc: empresa.ruc, direccion: empresa.direccion, telefono: empresa.telefono }}
        logo={logo?.buffer ?? null}
        titulo={def.titulo}
        descripcion={def.descripcion}
        subtitulo={subtitulo}
        generado={generado}
        kpis={kpisDe(def, datos)}
        columnas={datos.columnas.map((c) => ({ titulo: c.titulo, derecha: c.tipo !== "texto" && c.tipo !== "fecha", ancho: anchoDe(c) }))}
        columnasDetalle={detalle?.columnas.map((c) => ({ titulo: c.titulo, derecha: c.tipo !== "texto" && c.tipo !== "fecha", ancho: anchoDe(c) }))}
        filas={datos.filas.map((r) => ({
          celdas: datos.columnas.map((c) => texto(c, r[c.clave])),
          fuerte: Boolean(r._fuerte),
          detalle: ops(r).map((d) => detalle!.columnas.map((c) => texto(c, d[c.clave]))),
        }))}
        total={t ? datos.columnas.map((c, i) => (i === 0 ? "Total" : c.clave in t ? texto(c, t[c.clave]) : "")) : null}
        nota={datos.nota}
      />,
    );
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nombreArchivo}.pdf"` },
    });
  }

  const libro = new ExcelJS.Workbook();
  libro.creator = "Sistema Otiniano";
  const idLogo = logo ? libro.addImage({ buffer: logo.buffer as unknown as ExcelJS.Buffer, extension: logo.ext }) : null;

  /** Cabecera de marca: logo, empresa, título y rango; deja la fila 6 para los títulos de columna */
  const cabecera = (hoja: ExcelJS.Worksheet, titulo: string, ncols: number) => {
    const ultima = Math.max(ncols, 4);
    for (let r = 1; r <= 4; r++) {
      for (let c = 1; c <= ultima; c++) hoja.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_MARCA } };
    }
    const desde = idLogo !== null ? 2 : 1;
    hoja.getCell(1, desde).value = empresa.razon_social;
    hoja.getCell(1, desde).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    hoja.getCell(2, desde).value = titulo;
    hoja.getCell(2, desde).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    hoja.getCell(3, desde).value = subtitulo;
    hoja.getCell(3, desde).font = { size: 10, color: { argb: "FFDBEEFC" } };
    hoja.getCell(4, desde).value = `Generado ${generado}`;
    hoja.getCell(4, desde).font = { size: 9, color: { argb: "FFDBEEFC" } };
    hoja.getRow(2).height = 22;
    if (idLogo !== null) hoja.addImage(idLogo, { tl: { col: 0.15, row: 0.2 }, ext: { width: 62, height: 68 } });
    hoja.addRow([]);
  };
  const filaTitulos = (hoja: ExcelJS.Worksheet, titulos: string[]) => {
    const cab = hoja.addRow(titulos);
    cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cab.height = 18;
    cab.eachCell((celda) => {
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_OSCURO } };
      celda.alignment = { vertical: "middle" };
    });
  };
  const formatoColumnas = (hoja: ExcelJS.Worksheet, cols: Col[], primero = 0) => {
    cols.forEach((c, i) => {
      const col = hoja.getColumn(i + 1 + primero);
      col.width = Math.max(anchoDe(c), c.titulo.length + 3);
      if (FORMATO_EXCEL[c.tipo]) col.numFmt = FORMATO_EXCEL[c.tipo]!;
    });
  };

  // Hoja 1 · Resumen por grupo; con detalle, las operaciones de cada grupo quedan debajo (se pliegan con el «−» de Excel)
  const hoja = libro.addWorksheet("Resumen", { properties: { outlineLevelRow: 1 }, views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
  hoja.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const ncols = Math.max(datos.columnas.length, detalle ? detalle.columnas.length + 1 : 0);
  cabecera(hoja, def.titulo, ncols);
  filaTitulos(hoja, datos.columnas.map((c) => c.titulo));
  formatoColumnas(hoja, datos.columnas);
  for (const r of datos.filas) {
    const fila = hoja.addRow(datos.columnas.map((c) => valorExcel(c, r[c.clave])));
    const lista = ops(r);
    if (r._fuerte || lista.length) {
      fila.font = { bold: true, color: { argb: XL_OSCURO } };
      fila.eachCell({ includeEmpty: true }, (celda) => { celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_TINTE } }; });
    }
    if (lista.length) {
      // Sub-cabecera y operaciones del grupo, corridas una columna a la derecha
      const sub = hoja.addRow(["", ...detalle!.columnas.map((c) => c.titulo)]);
      sub.outlineLevel = 1;
      sub.font = { bold: true, size: 9, color: { argb: XL_GRIS } };
      for (const d of lista) {
        const fd = hoja.addRow(["", ...detalle!.columnas.map((c) => valorExcel(c, d[c.clave]))]);
        fd.outlineLevel = 1;
        fd.font = { size: 10, color: { argb: "FF44403C" } };
        detalle!.columnas.forEach((c, i) => { if (FORMATO_EXCEL[c.tipo]) fd.getCell(i + 2).numFmt = FORMATO_EXCEL[c.tipo]!; });
      }
    }
  }
  if (t) {
    const fila = hoja.addRow(datos.columnas.map((c, i) => (i === 0 ? "Total" : c.clave in t ? t[c.clave] : null)));
    fila.font = { bold: true, color: { argb: "FFFFFFFF" } };
    fila.eachCell({ includeEmpty: true }, (celda) => { celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_OSCURO } }; });
  }
  if (detalle) {
    // Las columnas del detalle (corridas una a la derecha) también necesitan ancho
    detalle.columnas.forEach((c, i) => {
      const col = hoja.getColumn(i + 2);
      col.width = Math.max(col.width ?? 10, ANCHO[c.tipo]);
    });
  }
  if (datos.nota) {
    hoja.addRow([]);
    hoja.addRow([datos.nota]).font = { italic: true, color: { argb: XL_GRIS } };
  }

  // Hoja 2 · Todas las operaciones en una sola tabla, con filtros (para ordenar o sumar en Excel)
  if (detalle && detalle.filas.length) {
    const etiqueta = new Map(datos.filas.map((r) => [String(r.clave), texto(datos.columnas[0], r[datos.columnas[0].clave])]));
    const cols: Col[] = [{ clave: "_grupo", titulo: datos.columnas[0].titulo, tipo: "texto" }, ...detalle.columnas];
    const h2 = libro.addWorksheet("Detalle", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
    cabecera(h2, `${def.titulo} · detalle`, cols.length);
    filaTitulos(h2, cols.map((c) => c.titulo));
    formatoColumnas(h2, cols);
    for (const r of datos.filas) {
      for (const d of ops(r)) {
        h2.addRow(cols.map((c) => (c.clave === "_grupo" ? etiqueta.get(d._clave) ?? "" : valorExcel(c, d[c.clave]))));
      }
    }
    h2.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: cols.length } };
  }

  const buffer = await libro.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivo}.xlsx"`,
    },
  });
}

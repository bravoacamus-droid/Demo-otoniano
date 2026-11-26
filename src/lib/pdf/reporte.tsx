import { Document, Page, StyleSheet, Text, View, type Styles } from "@react-pdf/renderer";
import { BandaMarca, CEBRA, Fondo, MARCA, MARCA_OSCURO, PieMarca, TINTE, type EmpresaPdf } from "./marca";

// PDF de cualquier reporte (Reportes de compras, ventas, inventario, caja…) con la marca de la empresa.
// Si el reporte tiene detalle (compras/ventas de cada grupo), va debajo de su fila, como en pantalla.

const s = StyleSheet.create({
  pagina: { paddingTop: 0, paddingBottom: 40, paddingHorizontal: 0, fontSize: 8, fontFamily: "Helvetica", color: "#1c1917" },
  cuerpo: { paddingHorizontal: 28, paddingTop: 14 },
  kpis: { flexDirection: "row", marginBottom: 14 },
  kpi: { flex: 1, borderWidth: 0.75, borderColor: "#e7e5e4", borderLeftWidth: 3, borderLeftColor: MARCA, borderRadius: 4, padding: 8, marginRight: 6 },
  kpiTitulo: { fontSize: 6.5, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.4 },
  kpiValor: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 3 },
  seccion: { fontFamily: "Helvetica-Bold", fontSize: 10, color: MARCA_OSCURO, marginBottom: 2 },
  descripcion: { fontSize: 7.5, color: "#78716c", marginBottom: 6 },
  cab: { flexDirection: "row", paddingVertical: 5 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7, color: "#ffffff", paddingHorizontal: 4 },
  fila: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#e7e5e4" },
  grupo: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.75, borderBottomColor: "#bfdbfe", fontFamily: "Helvetica-Bold", color: MARCA_OSCURO },
  td: { paddingHorizontal: 4 },
  detalle: { marginLeft: 14, marginBottom: 6, marginTop: 2, borderLeftWidth: 1.5, borderLeftColor: "#bfdbfe" },
  dCab: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#d6d3d1" },
  dTh: { fontFamily: "Helvetica-Bold", fontSize: 6, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.3, paddingHorizontal: 4 },
  dFila: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.4, borderBottomColor: "#f5f5f4", fontSize: 7, color: "#44403c" },
  total: { flexDirection: "row", paddingVertical: 6, color: "#ffffff", fontFamily: "Helvetica-Bold", marginTop: 2 },
  nota: { fontSize: 7, color: "#78716c", marginTop: 8 },
  vacio: { fontSize: 8, color: "#78716c", paddingVertical: 14, textAlign: "center" },
});

/** Helvetica no trae «−» ni flechas: se cambian por equivalentes que sí dibuja */
const limpio = (t: string) => t.replace(/−/g, "-").replace(/→/g, ">").replace(/←/g, "<");

export interface ColPdf { titulo: string; derecha: boolean; ancho: number }

export interface TablaPdfProps {
  empresa: EmpresaPdf;
  /** PNG/JPG del logo; sin logo se dibujan las iniciales */
  logo?: string | Buffer | null;
  titulo: string;
  descripcion?: string;
  /** Rango de fechas (o «Al …») */
  subtitulo: string;
  generado: string;
  columnas: ColPdf[];
  filas: { celdas: string[]; fuerte?: boolean; detalle?: string[][] }[];
  /** Columnas del detalle de cada grupo (compras/ventas) */
  columnasDetalle?: ColPdf[];
  total?: string[] | null;
  /** Cifras destacadas arriba (los totales del reporte) */
  kpis?: { titulo: string; valor: string }[];
  nota?: string;
}

function Celdas({ cols, valores, estilo }: { cols: ColPdf[]; valores: string[]; estilo: Styles[string] }) {
  const suma = cols.reduce((a, c) => a + c.ancho, 0);
  return valores.map((v, i) => (
    <Text key={i} style={[estilo, { width: `${(cols[i].ancho / suma) * 100}%`, textAlign: cols[i].derecha ? "right" : "left" }]}>{limpio(v)}</Text>
  ));
}

export function ReportePdf(p: TablaPdfProps) {
  const conDetalle = Boolean(p.columnasDetalle && p.filas.some((f) => f.detalle?.length));
  const horizontal = p.columnas.length > 6 || conDetalle;
  const kpis = (p.kpis ?? []).slice(0, 5);

  return (
    <Document title={`${p.titulo} - ${p.empresa.razon_social}`} author={p.empresa.razon_social} creator="Sistema Otiniano">
      <Page size="A4" orientation={horizontal ? "landscape" : "portrait"} style={s.pagina}>
        <BandaMarca empresa={p.empresa} logo={p.logo} titulo={limpio(p.titulo)} lineas={[p.subtitulo, `Generado ${p.generado}`]} />

        <View style={s.cuerpo}>
          {kpis.length > 0 && (
            <View style={s.kpis}>
              {kpis.map((k, i) => (
                <View key={k.titulo} style={[s.kpi, i === kpis.length - 1 ? { marginRight: 0 } : {}]}>
                  <Text style={s.kpiTitulo}>{k.titulo}</Text>
                  <Text style={s.kpiValor}>{k.valor}</Text>
                </View>
              ))}
            </View>
          )}

          {p.descripcion && <Text style={s.descripcion}>{limpio(p.descripcion)}{conDetalle ? ". Debajo de cada grupo, sus operaciones." : ""}</Text>}

          {p.columnas.length === 0 || p.filas.length === 0 ? (
            <Text style={s.vacio}>{limpio(p.nota ?? "Sin datos en el rango elegido.")}</Text>
          ) : (
            <>
              <View style={s.cab} fixed><Fondo color={MARCA} /><Celdas cols={p.columnas} valores={p.columnas.map((c) => c.titulo)} estilo={s.th} /></View>
              {p.filas.map((f, i) => {
                const det = conDetalle ? f.detalle ?? [] : [];
                const esGrupo = det.length > 0 || f.fuerte;
                const fondo = esGrupo ? TINTE : i % 2 === 1 ? CEBRA : null;
                return (
                  <View key={i}>
                    {/* La fila del grupo no se separa de sus primeras operaciones */}
                    <View style={esGrupo ? s.grupo : s.fila} wrap={false} minPresenceAhead={det.length ? 40 : 0}>
                      {fondo && <Fondo color={fondo} />}
                      <Celdas cols={p.columnas} valores={f.celdas} estilo={s.td} />
                    </View>
                    {det.length > 0 && (
                      <View style={s.detalle}>
                        <View style={s.dCab}><Celdas cols={p.columnasDetalle!} valores={p.columnasDetalle!.map((c) => c.titulo)} estilo={s.dTh} /></View>
                        {det.map((d, j) => (
                          <View key={j} style={s.dFila} wrap={false}><Celdas cols={p.columnasDetalle!} valores={d} estilo={s.td} /></View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
              {p.total && <View style={s.total} wrap={false}><Fondo color={MARCA_OSCURO} /><Celdas cols={p.columnas} valores={p.total} estilo={s.td} /></View>}
              {p.nota && <Text style={s.nota}>{limpio(p.nota)}</Text>}
            </>
          )}
        </View>

        <PieMarca texto={`${p.empresa.razon_social}  ·  ${p.titulo}  ·  Documento de uso interno`} />
      </Page>
    </Document>
  );
}

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { BandaMarca, CEBRA, MARCA, MARCA_OSCURO, PieMarca, TINTE, type EmpresaPdf } from "./marca";

// Resumen de asistencia del personal (solo Gerencia): totales por trabajador y cuadro día por día.

export interface FilaResumenPdf {
  nombre: string;
  cargo: string;
  situacion: string;
  celdas: string[];
  faltas: number;
}
export interface FilaCuadroPdf {
  nombre: string;
  /** Letra por día (A, F, D, P, V), «?» sin marcar, «·» domingo sin marcar, "" fuera de su periodo */
  dias: { letra: string; extra: boolean }[];
}
export interface DatosAsistenciaPdf {
  empresa: EmpresaPdf;
  logo: Buffer | null;
  periodo: string;
  generado: string;
  columnas: { titulo: string; ancho: number }[];
  filas: FilaResumenPdf[];
  totales: string[];
  /** Bloques de hasta 31 días */
  bloques: { titulo: string; dias: { dia: string; semana: string; domingo: boolean }[]; filas: FilaCuadroPdf[] }[];
  nota: string;
}

const COLOR: Record<string, { fondo: string; texto: string }> = {
  A: { fondo: "#d1fae5", texto: "#065f46" },
  F: { fondo: "#fee2e2", texto: "#991b1b" },
  D: { fondo: TINTE, texto: "#164b8a" },
  P: { fondo: TINTE, texto: "#164b8a" },
  V: { fondo: TINTE, texto: "#164b8a" },
  "?": { fondo: "#fef3c7", texto: "#92400e" },
};

const s = StyleSheet.create({
  pagina: { paddingBottom: 40, fontSize: 8, fontFamily: "Helvetica", color: "#1c1917" },
  cuerpo: { paddingHorizontal: 28, paddingTop: 14 },
  seccion: { fontFamily: "Helvetica-Bold", fontSize: 10, color: MARCA_OSCURO, marginBottom: 6 },
  cab: { flexDirection: "row", backgroundColor: MARCA, color: "#ffffff", paddingVertical: 4 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7, paddingHorizontal: 3 },
  fila: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e7e5e4" },
  td: { paddingHorizontal: 3 },
  total: { flexDirection: "row", paddingVertical: 4, borderTopWidth: 1, borderTopColor: MARCA_OSCURO, fontFamily: "Helvetica-Bold", backgroundColor: TINTE },
  sub: { fontSize: 6.5, color: "#78716c" },
  nota: { fontSize: 7, color: "#78716c", marginTop: 8 },
  celdaDia: { width: 15, height: 13, marginHorizontal: 0.5, borderRadius: 2, alignItems: "center", justifyContent: "center" },
  leyenda: { flexDirection: "row", flexWrap: "wrap", marginTop: 6, fontSize: 7, color: "#57534e" },
});

function Encabezado({ d }: { d: DatosAsistenciaPdf }) {
  return <BandaMarca empresa={d.empresa} logo={d.logo} titulo="Resumen de asistencia" lineas={[d.periodo, `Generado ${d.generado}`]} />;
}

export function AsistenciaPdf({ d }: { d: DatosAsistenciaPdf }) {
  const suma = d.columnas.reduce((a, c) => a + c.ancho, 0);
  const ancho = (i: number) => `${(d.columnas[i].ancho / suma) * 100}%`;
  const derecha = (i: number): "left" | "right" => (i === 0 ? "left" : "right");

  return (
    <Document title={`Resumen de asistencia · ${d.periodo}`}>
      <Page size="A4" orientation="landscape" style={s.pagina}>
        <Encabezado d={d} />
        <View style={s.cuerpo}>
          <Text style={s.seccion}>Totales por trabajador</Text>
          <View style={s.cab} fixed>
            {d.columnas.map((c, i) => <Text key={c.titulo} style={[s.th, { width: ancho(i), textAlign: derecha(i) }]}>{c.titulo}</Text>)}
          </View>
          {d.filas.map((f, n) => (
            <View key={n} style={[s.fila, n % 2 === 1 ? { backgroundColor: CEBRA } : {}]} wrap={false}>
              {f.celdas.map((v, i) => (
                <View key={i} style={[s.td, { width: ancho(i) }]}>
                  <Text style={{ textAlign: derecha(i), color: i === 2 && f.faltas > 0 ? "#b91c1c" : undefined,
                    fontFamily: i === 0 || (i === 2 && f.faltas > 0) ? "Helvetica-Bold" : "Helvetica" }}>{v}</Text>
                  {i === 0 && <Text style={s.sub}>{[f.cargo, f.situacion === "cesado" ? "Cesado" : ""].filter(Boolean).join(" · ")}</Text>}
                </View>
              ))}
            </View>
          ))}
          <View style={s.total} wrap={false}>
            {d.totales.map((v, i) => <Text key={i} style={[s.td, { width: ancho(i), textAlign: derecha(i) }]}>{v}</Text>)}
          </View>
          <Text style={s.nota}>{d.nota}</Text>
        </View>
        <PieMarca texto={`${d.empresa.razon_social}  ·  Documento de uso interno, confidencial`} />
      </Page>

      {d.bloques.map((b) => (
        <Page key={b.titulo} size="A4" orientation="landscape" style={s.pagina}>
          <Encabezado d={d} />
          <View style={s.cuerpo}>
            <Text style={s.seccion}>Día por día · {b.titulo}</Text>
            <View style={[s.cab, { alignItems: "flex-end" }]} fixed>
              <Text style={[s.th, { width: 130 }]}>Trabajador</Text>
              {b.dias.map((x) => (
                <View key={x.dia} style={{ width: 16, alignItems: "center" }}>
                  <Text style={{ fontSize: 5.5, color: x.domingo ? "#7fd8fb" : "#dbeefc" }}>{x.semana}</Text>
                  <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold" }}>{x.dia}</Text>
                </View>
              ))}
            </View>
            {b.filas.map((f, n) => (
              <View key={n} style={[s.fila, { alignItems: "center" }, n % 2 === 1 ? { backgroundColor: CEBRA } : {}]} wrap={false}>
                <Text style={[s.td, { width: 130, fontFamily: "Helvetica-Bold" }]}>{f.nombre}</Text>
                {f.dias.map((x, i) => {
                  const c = COLOR[x.letra];
                  return (
                    <View key={i} style={[s.celdaDia, c ? { backgroundColor: c.fondo } : {}]}>
                      <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold", color: c?.texto ?? "#a8a29e" }}>{x.letra}{x.extra ? "+" : ""}</Text>
                    </View>
                  );
                })}
              </View>
            ))}
            <View style={s.leyenda}>
              <Text>A = asistió   F = falta   D = descanso   P = permiso   V = vacaciones   ? = sin marcar   · = domingo sin marcar (no se exige)   + = con horas extras</Text>
            </View>
          </View>
          <PieMarca texto={`${d.empresa.razon_social}  ·  Documento de uso interno, confidencial`} />
        </Page>
      ))}
    </Document>
  );
}

// pnpm demo:personal · Personal de ejemplo en la empresa demo («Sistema Otiniano») para que Gerencia vea
// asistencias, faltas, permisos, vacaciones, domingos y horas extras desde el 1 de setiembre hasta hoy.
// Se puede correr de nuevo: no duplica trabajadores (por DNI) ni pisa días ya marcados.
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const chk = (r, msg) => { if (r.error) throw new Error(`${msg}: ${r.error.message}`); return r.data; };

const emp = chk(await sb.from("empresas").select("id").eq("razon_social", "Sistema Otiniano").single(), "empresa");
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const DESDE = "2026-09-01";

// [nombre, dni, cargo, teléfono, ingreso, cese, motivo, sueldo, trabaja domingos]
const personal = [
  ["Carlos Huamán Quispe", "70112233", "Balanza", "987654321", "2023-03-01", null, null, 1800, false],
  ["Rosa Mamani Flores", "70223344", "Caja y despacho", "986543210", "2024-07-15", null, null, 1600, false],
  ["Luis Torres Vega", "70334455", "Estibador", "985432109", "2022-11-02", null, null, 1300, false],
  ["Jorge Ramos Cárdenas", "70445566", "Chofer", "984321098", "2021-05-10", null, null, 2000, false],
  ["Miguel Chávez Rojas", "70556677", "Clasificador de metales", "983210987", "2025-01-20", null, null, 1250, false],
  ["Pedro Sánchez Lazo", "70667788", "Vigilante", "982109876", "2024-02-01", null, null, 1250, true],
  ["Kevin Díaz Paredes", "70778899", "Ayudante de almacén", "981098765", "2026-10-20", null, null, 1130, false],
  ["Wilmer Salazar Ccori", "70889900", "Estibador", "980987654", "2025-06-01", "2026-10-15", "Renuncia voluntaria", 1300, false],
];

const existentes = chk(await sb.from("trabajadores").select("id, dni").eq("empresa_id", emp.id), "trabajadores");
const ids = {};
for (const [nombre, dni, cargo, telefono, fecha_ingreso, fecha_cese, motivo_cese, sueldo_mensual] of personal) {
  const ya = existentes.find((t) => t.dni === dni);
  ids[dni] = ya ? ya.id : chk(await sb.from("trabajadores").insert({ empresa_id: emp.id, nombre, dni, cargo, telefono,
    fecha_ingreso, fecha_cese, motivo_cese, sueldo_mensual }).select("id").single(), nombre).id;
}

// Azar con semilla: cada corrida da los mismos días
let semilla = 20261104;
const azar = () => ((semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296);
const sumar = (iso, d) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const filas = [];
for (const [, dni, , , ingreso, cese, , , domingos] of personal) {
  const ini = ingreso > DESDE ? ingreso : DESDE;
  const fin = cese && cese < hoy ? cese : hoy;
  for (let f = ini; f <= fin; f = sumar(f, 1)) {
    const domingo = new Date(`${f}T12:00:00Z`).getUTCDay() === 0;
    const r = azar();
    const base = { empresa_id: emp.id, trabajador_id: ids[dni], fecha: f, horas_extra: 0, extra_aprobada: false, nota: null };
    if (domingo) {
      // El vigilante cubre domingos alternos; algún otro viene un domingo a descargar
      if ((domingos && r < 0.5) || (!domingos && r < 0.06))
        filas.push({ ...base, estado: "asistio", entrada: "08:00", salida: "14:00", nota: domingos ? "Turno de domingo" : "Descarga de camión" });
      continue;
    }
    // Vacaciones de Jorge (chofer) la 2.ª semana de octubre
    if (dni === "70445566" && f >= "2026-10-12" && f <= "2026-10-17") { filas.push({ ...base, estado: "vacaciones" }); continue; }
    if (f === hoy) {
      // Hoy: Miguel faltó, Kevin aún sin marcar, el resto entró (todavía no sale)
      if (dni === "70778899") continue;
      if (dni === "70556677") { filas.push({ ...base, estado: "falta", nota: "No avisó" }); continue; }
      filas.push({ ...base, estado: "asistio", entrada: hhmm(470 + Math.floor(azar() * 25)), salida: null });
      continue;
    }
    if (r < 0.045) { filas.push({ ...base, estado: "falta", nota: azar() < 0.5 ? "No avisó" : "Avisó por teléfono" }); continue; }
    if (r < 0.07) { filas.push({ ...base, estado: "permiso", nota: ["Cita médica", "Trámite personal", "Asunto familiar"][Math.floor(azar() * 3)] }); continue; }
    const entrada = 470 + Math.floor(azar() * 25);            // 07:50 a 08:15
    const extra = azar() < 0.16 ? [1, 1.5, 2, 3][Math.floor(azar() * 4)] : 0;
    filas.push({ ...base, estado: "asistio", entrada: hhmm(entrada), salida: hhmm(entrada + (8 + extra) * 60),
      horas_extra: extra,
      // Lo anterior a la última semana ya lo aprobó Gerencia; lo reciente queda por aprobar
      extra_aprobada: extra > 0 && f < sumar(hoy, -7), aprobado_en: extra > 0 && f < sumar(hoy, -7) ? `${f}T23:00:00-05:00` : null });
  }
}

for (let i = 0; i < filas.length; i += 500)
  chk(await sb.from("asistencias").upsert(filas.slice(i, i + 500), { onConflict: "trabajador_id,fecha", ignoreDuplicates: true }), "asistencias");
console.log(`ok · ${personal.length} trabajadores · ${filas.length} días de asistencia`);

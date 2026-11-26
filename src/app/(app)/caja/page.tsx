import type { Metadata } from "next";
import Link from "next/link";
import { LockOpen } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { ETIQUETA_ORIGEN, fechaDia, fechaHora, soles } from "@/lib/formato";
import { Aviso, Encabezado, Insignia, Tarjeta } from "@/components/ui/basicos";
import { TablaDatos } from "@/components/ui/tabla";
import { Filtros, rangoLima } from "@/components/filtros";
import { BotonAnular } from "@/components/boton-anular";
import { cx } from "@/components/ui/clases";
import { PanelModulo, TituloSeccion } from "@/components/panel-modulo";
import { BotonImprimir80 } from "@/components/ticket/boton-imprimir-80";
import { AccionesCaja } from "./acciones-caja";
import { CuadreCaja } from "./cuadre-caja";
import { SITUACION } from "./prestamos-datos";
import { BotonesPrestamo, MenuPrestamo, type CuotaFila, type DevolucionFila, type PrestamoFila } from "./prestamos";
import { anularTraspaso } from "./acciones";
import { EditarTurno, MenuGasto, MenuManual, type GastoFila, type Manual, type TurnoFila } from "./menus-caja";

export const metadata: Metadata = { title: "Caja" };

type Params = { vista?: string; caja?: string; desde?: string; hasta?: string; ver?: string; categoria?: string; de?: string };

const ENLACE_ORIGEN: Record<string, string> = { compra: "/compras/", venta: "/ventas/" };
const TITULO_VISTA: Record<string, string> = { movimientos: "Movimientos de caja", gastos: "Gastos", prestamos: "Préstamos", traspasos: "Traspasos entre cajas", arqueos: "Arqueos", cierres: "Aperturas y cierres de caja" };

/** Filtro «Ver» de movimientos: lo del sistema (compras y ventas) aparte de los demás gastos y movimientos */
const GRUPOS = {
  sistema: { texto: "Compras y ventas", origenes: ["compra", "venta", "devolucion", "adelanto"] },
  gastos: { texto: "Otros gastos", origenes: ["gasto"] },
  dinero: { texto: "Ingresos y salidas de dinero", origenes: ["ajuste"] },
  prestamos: { texto: "Préstamos y devoluciones", origenes: ["prestamo"] },
  socios: { texto: "Aportes y retiros de socios", origenes: ["aporte", "retiro"] },
  traspasos: { texto: "Traspasos", origenes: ["traspaso"] },
  aperturas: { texto: "Aperturas y cierres", origenes: [] },
} as const;
type Grupo = keyof typeof GRUPOS;

export default async function CajaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const vista = sp.vista ?? "movimientos";
  const { supabase, empresa, rol } = await exigir("caja", "verTodo");
  const { desde, hasta } = rangoLima(sp.desde, sp.hasta);
  const grupo = sp.ver && sp.ver in GRUPOS ? (sp.ver as Grupo) : null;
  const puedeCorregir = puede(rol, "corregir");

  const rango = <T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(q: T) => {
    let r = q;
    if (desde) r = r.gte("fecha", desde);
    if (hasta) r = r.lt("fecha", hasta);
    return r;
  };
  const rangoTurnos = <T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(q: T) => {
    let r = q;
    if (desde) r = r.gte("abierto_en", desde);
    if (hasta) r = r.lt("abierto_en", hasta);
    return r;
  };

  // Solo la lista de la pestaña activa; todo en paralelo con los saldos
  const esArqueos = !["movimientos", "gastos", "traspasos", "cierres", "prestamos"].includes(vista);
  const conMovs = vista === "movimientos" && grupo !== "aperturas";
  // Aperturas y cierres van en el historial de movimientos (no mueven dinero: se muestran aparte del saldo)
  const conTurnos = vista === "cierres" || (vista === "movimientos" && (!grupo || grupo === "aperturas"));
  let qMov = supabase.from("v_movimientos_caja").select("*").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).order("creado_en", { ascending: false }).limit(300);
  if (sp.caja) qMov = qMov.eq("caja_id", sp.caja);
  if (grupo) qMov = qMov.in("origen", [...GRUPOS[grupo].origenes]);
  let qTur = supabase.from("v_turnos_caja").select("*").eq("empresa_id", empresa.id).order("abierto_en", { ascending: false }).limit(200);
  if (sp.caja && vista === "movimientos") qTur = qTur.eq("caja_id", sp.caja);
  let qGas = supabase.from("v_gastos").select("*").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).limit(300);
  let qGasSin = supabase.from("v_gastos_sin_caja").select("*").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).limit(300);
  // «sin» = Otros gastos (escritos a mano, sin categoría)
  if (sp.categoria === "sin") { qGas = qGas.is("categoria_id", null); qGasSin = qGasSin.is("categoria_id", null); }
  else if (sp.categoria) { qGas = qGas.eq("categoria_id", sp.categoria); qGasSin = qGasSin.eq("categoria_id", sp.categoria); }
  const de = sp.de === "caja" || sp.de === "ninguna" ? sp.de : null;

  const [{ data: saldos }, { data: cuadre }, { data: categorias }, { data: abiertos }, { data: socios }, { data: trabajadores }, { data: prestamosTodos }, rMov, rGas, rGasSin, rTra, rArq, rTur] = await Promise.all([
    supabase.from("v_saldo_caja").select("*").eq("empresa_id", empresa.id).order("orden"),
    supabase.from("v_cuadre_caja").select("*").eq("empresa_id", empresa.id).maybeSingle(),
    supabase.from("categorias_gasto").select("id, nombre").eq("empresa_id", empresa.id).eq("activo", true).order("nombre"),
    supabase.from("v_turnos_caja").select("*").eq("empresa_id", empresa.id).is("cerrado_en", null).is("anulado_en", null).order("abierto_en"),
    supabase.from("socios").select("nombre").eq("empresa_id", empresa.id).eq("activo", true).order("nombre"),
    supabase.from("trabajadores").select("nombre").eq("empresa_id", empresa.id).is("fecha_cese", null).order("nombre"),
    supabase.from("v_prestamos").select("*").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).limit(300),
    conMovs ? rango(qMov) : null,
    vista === "gastos" && de !== "ninguna" ? rango(qGas) : null,
    vista === "gastos" && de !== "caja" ? rango(qGasSin) : null,
    vista === "traspasos" ? rango(supabase.from("traspasos").select("*, origen:cajas!caja_origen_id(nombre), destino:cajas!caja_destino_id(nombre)").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).limit(200)) : null,
    esArqueos ? rango(supabase.from("v_arqueos").select("*").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).limit(200)) : null,
    conTurnos ? rangoTurnos(qTur) : null,
  ]);
  const total = (saldos ?? []).reduce((s, c) => s + Number(c.saldo), 0);
  const cajasVisibles = (saldos ?? []).filter((c) => c.activo || Number(c.saldo) !== 0);
  const cajasActivas = (saldos ?? []).filter((c) => c.activo).map((c) => ({ id: c.caja_id!, nombre: c.nombre! }));
  const movimientos = rMov ? rMov.data ?? [] : null;
  const traspasos = rTra ? rTra.data ?? [] : null;
  const arqueos = rArq ? rArq.data ?? [] : null;
  const turnos = rTur ? rTur.data ?? [] : null;
  const turnosAbiertos = abiertos ?? [];
  const prestamos = (prestamosTodos ?? []) as unknown as PrestamoFila[];
  const pendientes = prestamos.filter((p) => p.estado === "registrada" && Number(p.saldo) > 0);
  // Cronograma y devoluciones solo en la pestaña de préstamos
  const idsPrestamo = vista === "prestamos" ? prestamos.map((p) => p.id) : [];
  const [{ data: cuotasP }, { data: pagosP }] = await Promise.all([
    idsPrestamo.length ? supabase.from("v_prestamo_cuotas").select("prestamo_id, numero, vence, monto, pagado, saldo, situacion").in("prestamo_id", idsPrestamo).order("numero") : { data: [] },
    idsPrestamo.length ? supabase.from("v_prestamo_pagos").select("id, prestamo_id, fecha, monto, caja_nombre, nota, estado, creado_por_nombre, motivo_anulacion").in("prestamo_id", idsPrestamo).order("fecha", { ascending: false }) : { data: [] },
  ]);
  const agrupar = <T extends { prestamo_id: string | null }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.prestamo_id!, [...(m.get(x.prestamo_id!) ?? []), x]);
    return m;
  };
  const cuotasDe = agrupar(cuotasP ?? []);
  const pagosDe = agrupar(pagosP ?? []);
  const sumaSaldo = (t: string) => pendientes.filter((p) => p.tipo === t).reduce((a, p) => a + Math.round(Number(p.saldo) * 100), 0) / 100;
  const puedeFecha = rol === "dueno" || rol === "administrador";
  const cajasPrestamo = (saldos ?? []).filter((c) => c.activo).map((c) => ({ id: c.caja_id!, nombre: c.nombre!, saldo: String(c.saldo) }));

  // Gastos con caja y de solo registro, juntos y por fecha
  const gastos = vista === "gastos" ? [
    ...(rGas?.data ?? []).map((g) => ({ ...g, sin_caja: false })),
    ...(rGasSin?.data ?? []).map((g) => ({ ...g, caja_id: null, caja_nombre: null, sin_caja: true })),
  ].sort((a, b) => (a.fecha! < b.fecha! ? 1 : -1)) : null;

  // Registros detrás de los movimientos que se pueden corregir (ingresos/salidas a mano y gastos)
  const idsDe = (origenes: string[]) => [...new Set((movimientos ?? []).filter((m) => origenes.includes(m.origen!) && !m.anulado && m.origen_id).map((m) => m.origen_id!))];
  const idsManual = puedeCorregir ? idsDe(["ajuste", "prestamo"]) : [];
  const idsGasto = puedeCorregir ? idsDe(["gasto"]) : [];
  const [{ data: manuales }, { data: gastosMov }, { data: pagosPers }] = await Promise.all([
    idsManual.length ? supabase.from("movimientos_manuales").select("id, tipo, clase, caja_id, monto, motivo, persona, historial, mov_id, estado").in("id", idsManual) : { data: [] },
    idsGasto.length ? supabase.from("gastos").select("id, monto, concepto, categoria_id, caja_id, historial, estado").in("id", idsGasto) : { data: [] },
    // Gastos que son pagos al personal: se corrigen desde Personal → Pagos
    puedeCorregir && (idsGasto.length || vista === "gastos")
      ? supabase.from("pagos_personal").select("trabajador_id, gasto_id, gasto_sin_caja_id").eq("empresa_id", empresa.id).eq("estado", "registrada")
      : { data: [] },
  ]);
  const pagoDeGasto = new Map((pagosPers ?? []).flatMap((p) => [p.gasto_id, p.gasto_sin_caja_id].filter(Boolean).map((gid) => [gid!, p.trabajador_id])));
  const verPago = (trabajador: string) => (
    <Link href={`/personal/pagos?vista=historial&trabajador=${trabajador}`} className="whitespace-nowrap text-xs font-medium text-marca-700 hover:underline">Ver pago</Link>
  );
  const manualPorMov = new Map((manuales ?? []).filter((m) => m.estado === "registrada").map((m) => [m.mov_id, m as unknown as Manual]));
  const gastoPorId = new Map((gastosMov ?? []).filter((g) => g.estado === "registrada").map((g) => [g.id, g as unknown as GastoFila]));

  type Mov = NonNullable<typeof movimientos>[number];
  type Turno = NonNullable<typeof turnos>[number];
  type Fila =
    | { clave: string; fecha: string; tipo: "mov"; m: Mov }
    | { clave: string; fecha: string; tipo: "apertura" | "cierre"; t: Turno };
  const filas: Fila[] | null = vista === "movimientos" ? [
    ...(movimientos ?? []).map((m): Fila => ({ clave: m.id!, fecha: m.fecha!, tipo: "mov", m })),
    ...(conTurnos ? turnos ?? [] : []).flatMap((t): Fila[] => [
      { clave: `a-${t.id}`, fecha: t.abierto_en!, tipo: "apertura", t },
      ...(t.cerrado_en ? [{ clave: `c-${t.id}`, fecha: t.cerrado_en, tipo: "cierre" as const, t }] : []),
    ]),
  ].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) : null;
  const turnoFila = (t: Turno): TurnoFila => ({
    id: t.id!, numero: t.numero!, caja_nombre: t.caja_nombre!,
    contado_apertura: String(t.contado_apertura), nota_apertura: t.nota_apertura, saldo_apertura: String(t.saldo_apertura),
    cerrado_en: t.cerrado_en, contado_cierre: t.contado_cierre != null ? String(t.contado_cierre) : null, nota_cierre: t.nota_cierre,
    saldo_cierre: t.saldo_cierre != null ? String(t.saldo_cierre) : null, ajustado: !!t.ajustado,
    historial: (t.historial ?? []) as TurnoFila["historial"],
  });

  const pestana = (v: string, t: string) => (
    <Link
      key={v}
      href={`/caja?vista=${v}`}
      className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", vista === v ? "bg-superficie shadow-sm" : "text-stone-600 hover:text-stone-900")}
    >
      {t}
    </Link>
  );

  return (
    <>
      <Encabezado
        titulo="Caja"
        descripcion="Entradas y salidas de dinero, gastos, traspasos y arqueos de cada caja"
      />
      {/* Acciones a todo el ancho: «Registrar gasto» queda sola a la derecha */}
      {puede(rol, "caja") && (
        <div className="mb-4">
          <AccionesCaja
            empresaId={empresa.id}
            cajas={(saldos ?? []).filter((c) => c.activo).map((c) => ({ id: c.caja_id, nombre: c.nombre, saldo: c.saldo, tipo: c.tipo }))}
            categorias={categorias ?? []}
            puedeAjustar={rol === "dueno"}
            turnos={turnosAbiertos.map((t) => ({ id: t.id!, numero: t.numero!, caja_id: t.caja_id!, caja_nombre: t.caja_nombre!, abierto_en: t.abierto_en! }))}
            prestamos={
              <BotonesPrestamo cajas={cajasPrestamo} pendientes={pendientes} puedeFecha={puedeFecha}
                personas={[...new Set([...(socios ?? []).map((p) => p.nombre), ...(trabajadores ?? []).map((p) => p.nombre), ...prestamos.map((p) => p.persona)])]} />
            }
          />
        </div>
      )}

      {/* Cada caja filtra los movimientos; el total quita el filtro */}
      <PanelModulo
        tono="caja"
        etiqueta="Caja · hoy"
        principal={{
          titulo: "Saldo total", valor: soles(total), negativo: total < 0,
          detalle: sp.caja ? "Ver movimientos de todas las cajas" : `${cajasVisibles.length} caja(s)`,
          href: sp.caja ? "/caja?vista=movimientos" : undefined,
        }}
        celdas={cajasVisibles.map((c) => ({
          titulo: c.nombre, valor: soles(c.saldo), negativo: Number(c.saldo) < 0, activa: sp.caja === c.caja_id,
          detalle: <span className="cifra">+{soles(c.ingresos)} / −{soles(c.egresos)}</span>,
          href: `/caja?vista=movimientos&caja=${c.caja_id}`,
        }))}
      />

      {/* De dónde sale el saldo total: capital de socios + ventas − compras − gastos */}
      {cuadre && !sp.caja && <CuadreCaja c={cuadre} />}

      {/* Turno en curso: quién abrió y desde cuándo; el corte parcial se imprime sin cerrar */}
      <div className="mb-4 space-y-2">
        {turnosAbiertos.length === 0 && puede(rol, "caja") && (
          <Aviso>Ninguna caja abierta. Use <b>Abrir caja</b> al empezar el día y <b>Cerrar caja</b> al terminar para imprimir el cuadre.</Aviso>
        )}
        {turnosAbiertos.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
            <span className="inline-flex items-center gap-2">
              <LockOpen className="size-4 shrink-0" />
              <span><b>{t.caja_nombre}</b> abierta desde {fechaHora(t.abierto_en)}{t.abierto_por_nombre ? ` por ${t.abierto_por_nombre}` : ""} · turno N° {t.numero}</span>
            </span>
            <span className="inline-flex items-center gap-3">
              <span className="cifra">Abrió con <b>{soles(t.contado_apertura)}</b></span>
              {puedeCorregir && <EditarTurno t={turnoFila(t)} />}
              <BotonImprimir80 href={`/imprimir/cierre/${t.id}`} texto="Corte parcial" className="inline-flex items-center gap-1.5 font-medium hover:underline" />
            </span>
          </div>
        ))}
      </div>

      <TituloSeccion titulo={TITULO_VISTA[vista] ?? "Arqueos"} />
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-stone-200/70 p-1 sm:inline-flex">
        {pestana("movimientos", "Movimientos")}
        {pestana("gastos", "Gastos")}
        {pestana("prestamos", "Préstamos")}
        {pestana("traspasos", "Traspasos")}
        {pestana("arqueos", "Arqueos")}
        {pestana("cierres", "Cierres")}
      </div>

      {vista === "gastos" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([[null, "Todos los gastos"], ["caja", "Salieron de una caja"], ["ninguna", "No salieron de ninguna caja"]] as const).map(([v, t]) => {
            const q = new URLSearchParams({ vista: "gastos", ...(v ? { de: v } : {}), ...(sp.categoria ? { categoria: sp.categoria } : {}), ...(sp.desde ? { desde: sp.desde } : {}), ...(sp.hasta ? { hasta: sp.hasta } : {}) });
            return (
              <Link key={t} href={`/caja?${q}`}
                className={cx("rounded-full border px-3.5 py-1.5 text-sm font-medium transition", de === v ? "border-marca-600 bg-marca-600 text-white shadow-sm" : "border-stone-200 bg-superficie text-stone-700 hover:border-marca-300 hover:bg-marca-50")}>
                {t}
              </Link>
            );
          })}
          {gastos && <span className="text-sm text-stone-500">{gastos.length} registro(s)</span>}
        </div>
      )}
      {vista !== "prestamos" && <Filtros
        valores={sp}
        ocultos={vista === "gastos" && de ? { vista, de } : { vista }}
        selects={vista === "movimientos" ? [
          { nombre: "ver", etiqueta: "Ver", opciones: Object.entries(GRUPOS).map(([v, g]) => ({ valor: v, texto: g.texto })) },
          { nombre: "caja", etiqueta: "Caja", opciones: (saldos ?? []).map((c) => ({ valor: c.caja_id, texto: c.nombre })) },
        ] : vista === "gastos" ? [
          { nombre: "categoria", etiqueta: "Categoría", opciones: [...(categorias ?? []).map((c) => ({ valor: c.id, texto: c.nombre })), { valor: "sin", texto: "Otros gastos (escritos a mano)" }] },
        ] : []}
      />}

      <Tarjeta>
        {filas && (
          <TablaDatos
            filas={filas}
            clave={(f) => f.clave}
            vacio="Sin movimientos."
            columnas={[
              { titulo: "Fecha", celda: (f) => fechaHora(f.fecha) },
              { titulo: "Caja", celda: (f) => (f.tipo === "mov" ? f.m.caja_nombre : f.t.caja_nombre) },
              {
                titulo: "Origen",
                celda: (f) => f.tipo === "mov"
                  ? <Insignia tono={f.m.tipo === "ingreso" ? "verde" : "gris"}>{ETIQUETA_ORIGEN[f.m.origen!]}</Insignia>
                  : <Insignia tono={f.t.anulado_en ? "rojo" : "gris"}>{f.t.anulado_en ? "Anulada" : f.tipo === "apertura" ? "Apertura" : "Cierre"}</Insignia>,
              },
              {
                titulo: "Concepto", principal: true,
                celda: (f) => {
                  if (f.tipo === "mov") {
                    const m = f.m;
                    if (m.origen === "prestamo" && !manualPorMov.has(m.id!)) {
                      return <Link className={cx("text-marca-700 hover:underline", m.anulado && "line-through")} href="/caja?vista=prestamos">{m.concepto}</Link>;
                    }
                    return ENLACE_ORIGEN[m.origen!] && m.origen_id
                      ? <Link className="text-marca-700 hover:underline" href={`${ENLACE_ORIGEN[m.origen!]}${m.origen_id}`}>{m.concepto}</Link>
                      : <span className={m.anulado ? "text-stone-500 line-through" : ""}>{m.concepto}</span>;
                  }
                  const t = f.t;
                  const nota = f.tipo === "apertura" ? t.nota_apertura : t.nota_cierre;
                  return (
                    <>
                    <span className={t.anulado_en ? "text-stone-500 line-through" : ""}>
                      {f.tipo === "apertura" ? "Apertura" : "Cierre"} de caja N° {t.numero}
                      {f.tipo === "apertura"
                        ? <> · según el sistema {soles(t.saldo_apertura)}</>
                        : <> · sistema {soles(t.saldo_cierre)}, diferencia {soles(t.diferencia_cierre)}</>}
                      {(f.tipo === "apertura" ? t.abierto_por_nombre : t.cerrado_por_nombre) && <span className="text-stone-500"> · {f.tipo === "apertura" ? t.abierto_por_nombre : t.cerrado_por_nombre}</span>}
                    </span>
                    {nota && <span className="block text-xs text-stone-500">{nota}</span>}
                    {t.anulado_en && <span className="block text-xs text-red-700">Anulada: {t.motivo_anulacion}</span>}
                    </>
                  );
                },
              },
              {
                titulo: "Monto", alinear: "der", principal: true,
                celda: (f) => f.tipo === "mov" ? (
                  <span className={cx("cifra font-medium", f.m.anulado ? "text-stone-500 line-through" : f.m.tipo === "ingreso" ? "text-emerald-700" : "text-red-700")}>
                    {f.m.tipo === "ingreso" ? "+" : "−"}{soles(f.m.monto)}
                  </span>
                ) : (
                  // Lo contado: no suma ni resta al saldo
                  <span className={cx("cifra text-stone-600", f.t.anulado_en && "line-through")} title="Efectivo contado (no mueve el saldo)">
                    {soles(f.tipo === "apertura" ? f.t.contado_apertura : f.t.contado_cierre)}
                    <span className="block text-[11px] font-normal text-stone-500">contado</span>
                  </span>
                ),
              },
              {
                titulo: "Saldo caja", alinear: "der",
                celda: (f) => f.tipo === "mov" ? <span className="cifra">{soles(f.m.saldo_acumulado)}</span> : "—",
              },
              {
                titulo: "",
                celda: (f) => {
                  if (!puedeCorregir) return null;
                  if (f.tipo !== "mov") return f.t.anulado_en ? null : <EditarTurno t={turnoFila(f.t)} parte={f.tipo} compacto />;
                  if (f.tipo !== "mov" || f.m.anulado) return null;
                  const manual = manualPorMov.get(f.m.id!);
                  if (manual) return <MenuManual m={manual} cajas={cajasActivas} />;
                  const gasto = f.m.origen === "gasto" ? gastoPorId.get(f.m.origen_id!) : undefined;
                  if (gasto && pagoDeGasto.has(gasto.id)) return verPago(pagoDeGasto.get(gasto.id)!);
                  if (gasto) return <MenuGasto g={gasto} cajas={cajasActivas} categorias={categorias ?? []} />;
                  return null;
                },
              },
            ]}
          />
        )}
        {vista === "prestamos" && (
          <>
            {(sumaSaldo("recibido") > 0 || sumaSaldo("otorgado") > 0) && (
              <div className="grid gap-px border-b border-stone-100 bg-stone-100 sm:grid-cols-2">
                <div className="bg-superficie px-4 py-3">
                  <p className="text-xs text-stone-500">Nos prestaron · falta devolver</p>
                  <p className="cifra text-lg font-semibold text-stone-900">{soles(sumaSaldo("recibido"))}</p>
                </div>
                <div className="bg-superficie px-4 py-3">
                  <p className="text-xs text-stone-500">Prestamos · falta que nos devuelvan</p>
                  <p className="cifra text-lg font-semibold text-stone-900">{soles(sumaSaldo("otorgado"))}</p>
                </div>
              </div>
            )}
            <TablaDatos
              filas={prestamos}
              clave={(p) => p.id}
              vacio="Sin préstamos. Use «Préstamo» para registrar uno."
              columnas={[
                { titulo: "Fecha", celda: (p) => fechaHora(p.fecha) },
                {
                  titulo: "Préstamo", principal: true,
                  celda: (p) => (
                    <span className={cx("min-w-0", p.estado === "anulada" && "text-stone-500 line-through")}>
                      <Insignia tono={p.tipo === "recibido" ? "azul" : "gris"}>{p.tipo === "recibido" ? "Nos prestó" : "Le prestamos"}</Insignia>{" "}
                      <b className="font-medium">{p.persona}</b>
                      <span className="block text-xs text-stone-500">{p.motivo}</span>
                    </span>
                  ),
                },
                { titulo: "Monto", alinear: "der", celda: (p) => <span className="cifra">{soles(p.monto)}</span> },
                { titulo: "Devuelto", alinear: "der", celda: (p) => <span className="cifra">{soles(p.pagado)}</span> },
                { titulo: "Falta", alinear: "der", principal: true, celda: (p) => <span className="cifra font-semibold">{soles(p.estado === "anulada" ? 0 : p.saldo)}</span> },
                {
                  titulo: "Cuotas",
                  celda: (p) => p.estado === "anulada" || Number(p.saldo) === 0 ? <span className="text-stone-500">{p.n_cuotas} cuota(s)</span> : (
                    <span className="text-sm">
                      {p.n_cuotas > 1 ? `Cuota ${p.proxima_numero} de ${p.n_cuotas}` : "Una cuota"}
                      <span className="block text-xs text-stone-500">vence {fechaDia(p.proxima_vence)} · {soles(p.proxima_saldo)}</span>
                    </span>
                  ),
                },
                { titulo: "Estado", celda: (p) => <Insignia tono={SITUACION[p.situacion]?.tono ?? "gris"}>{SITUACION[p.situacion]?.texto ?? p.situacion}</Insignia> },
                {
                  titulo: "",
                  celda: (p) => (
                    <MenuPrestamo p={p} cajas={cajasPrestamo} puedeAnular={puedeCorregir} puedeFecha={puedeFecha} puedeDevolver={puede(rol, "caja") || puedeCorregir}
                      cuotas={(cuotasDe.get(p.id) ?? []) as unknown as CuotaFila[]} devoluciones={(pagosDe.get(p.id) ?? []) as unknown as DevolucionFila[]} />
                  ),
                },
              ]}
            />
          </>
        )}
        {gastos && (
          <TablaDatos
            filas={gastos}
            clave={(g) => g.id!}
            vacio="Sin gastos."
            columnas={[
              { titulo: "Fecha", celda: (g) => fechaHora(g.fecha) },
              { titulo: "Concepto", principal: true, celda: (g) => <span className={g.estado === "anulada" ? "text-stone-500 line-through" : ""}>{g.concepto}</span> },
              { titulo: "Categoría", celda: (g) => g.categoria_nombre ?? <span className="text-stone-500">Otro gasto</span> },
              { titulo: "Caja", celda: (g) => g.sin_caja ? <Insignia tono="gris">No salió de caja</Insignia> : g.caja_nombre },
              { titulo: "Monto", alinear: "der", principal: true, celda: (g) => <span className={cx("cifra", g.estado === "anulada" && "text-stone-500 line-through")}>{soles(g.monto)}</span> },
              {
                titulo: "", celda: (g) => g.estado === "anulada"
                  ? <Insignia tono="rojo">Anulado</Insignia>
                  : pagoDeGasto.has(g.id!) ? verPago(pagoDeGasto.get(g.id!)!)
                  : puedeCorregir && (
                    <MenuGasto
                      g={{ id: g.id!, monto: String(g.monto), concepto: g.concepto!, categoria_id: g.categoria_id, caja_id: g.caja_id, historial: (g.historial ?? []) as GastoFila["historial"] }}
                      cajas={cajasActivas} categorias={categorias ?? []}
                    />
                  ),
              },
            ]}
          />
        )}
        {traspasos && (
          <TablaDatos
            filas={traspasos}
            clave={(t) => t.id}
            vacio="Sin traspasos."
            columnas={[
              { titulo: "Fecha", celda: (t) => fechaHora(t.fecha) },
              { titulo: "Desde → Hacia", principal: true, celda: (t) => `${(t.origen as { nombre: string }).nombre} → ${(t.destino as { nombre: string }).nombre}` },
              { titulo: "Concepto", celda: (t) => t.concepto ?? "—" },
              { titulo: "Monto", alinear: "der", principal: true, celda: (t) => <span className={cx("cifra", t.estado === "anulada" && "text-stone-500 line-through")}>{soles(t.monto)}</span> },
              {
                titulo: "", celda: (t) => t.estado === "anulada"
                  ? <Insignia tono="rojo">Anulado</Insignia>
                  : puede(rol, "anular") && <BotonAnular id={t.id} accion={anularTraspaso} titulo="Anular traspaso" />,
              },
            ]}
          />
        )}
        {arqueos && (
          <TablaDatos
            filas={arqueos}
            clave={(a) => a.id}
            vacio="Sin arqueos."
            columnas={[
              { titulo: "Fecha", principal: true, celda: (a) => fechaHora(a.fecha) },
              { titulo: "Caja", celda: (a) => a.caja_nombre },
              { titulo: "Sistema", alinear: "der", celda: (a) => <span className="cifra">{soles(a.saldo_sistema)}</span> },
              { titulo: "Contado", alinear: "der", celda: (a) => <span className="cifra">{soles(a.contado)}</span> },
              { titulo: "Diferencia", alinear: "der", principal: true, celda: (a) => <span className={cx("cifra font-medium", Number(a.diferencia) < 0 ? "text-red-700" : Number(a.diferencia) > 0 ? "text-emerald-700" : "")}>{soles(a.diferencia)}</span> },
              { titulo: "Nota", celda: (a) => a.nota ?? "—" },
            ]}
          />
        )}
        {turnos && vista === "cierres" && (
          <TablaDatos
            filas={turnos}
            clave={(t) => t.id!}
            vacio="Sin aperturas ni cierres en el rango."
            columnas={[
              { titulo: "Turno", principal: true, celda: (t) => <span className={cx("font-medium", t.anulado_en && "text-stone-500 line-through")}>N° {t.numero} · {t.caja_nombre}</span> },
              { titulo: "Apertura", celda: (t) => <>{fechaHora(t.abierto_en)}{t.abierto_por_nombre && <span className="block text-xs text-stone-500">{t.abierto_por_nombre}</span>}</> },
              {
                titulo: "Cierre",
                celda: (t) => t.anulado_en
                  ? <Insignia tono="rojo">Anulada</Insignia>
                  : t.cerrado_en
                    ? <>{fechaHora(t.cerrado_en)}{t.cerrado_por_nombre && <span className="block text-xs text-stone-500">{t.cerrado_por_nombre}</span>}</>
                    : <Insignia tono="verde">Abierta</Insignia>,
              },
              { titulo: "Inicio", alinear: "der", celda: (t) => <span className="cifra">{soles(t.contado_apertura)}</span> },
              { titulo: "Sistema", alinear: "der", celda: (t) => t.cerrado_en ? <span className="cifra">{soles(t.saldo_cierre)}</span> : "—" },
              { titulo: "Contado", alinear: "der", celda: (t) => t.cerrado_en ? <span className="cifra">{soles(t.contado_cierre)}</span> : "—" },
              {
                titulo: "Diferencia", alinear: "der", principal: true,
                celda: (t) => t.cerrado_en
                  ? <span className={cx("cifra font-medium", Number(t.diferencia_cierre) < 0 ? "text-red-700" : Number(t.diferencia_cierre) > 0 ? "text-emerald-700" : "")}>{soles(t.diferencia_cierre)}</span>
                  : "—",
              },
              {
                titulo: "",
                celda: (t) => (
                  <span className="inline-flex items-center gap-1">
                    {!t.anulado_en && <BotonImprimir80 href={`/imprimir/cierre/${t.id}`} texto={t.cerrado_en ? "Imprimir" : "Corte"} className="inline-flex items-center gap-1.5 text-sm font-medium text-marca-700 hover:underline" />}
                    {puedeCorregir && !t.anulado_en && <EditarTurno t={turnoFila(t)} compacto />}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Tarjeta>
    </>
  );
}

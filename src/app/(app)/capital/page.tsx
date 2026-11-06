import type { Metadata } from "next";
import Link from "next/link";
import { FileBarChart, FileImage, LockOpen } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { fecha, fechaHora, nombrePeriodo, periodoActual, porcentaje, soles } from "@/lib/formato";
import { ETIQUETA_MOV_SOCIO, type TipoMovSocio } from "@/lib/socios";
import { Aviso, Encabezado, Insignia, Tarjeta, TituloTarjeta, type Tono } from "@/components/ui/basicos";
import { PanelModulo } from "@/components/panel-modulo";
import { TablaDatos } from "@/components/ui/tabla";
import { BotonAnular } from "@/components/boton-anular";
import { BotonImprimir80 } from "@/components/ticket/boton-imprimir-80";
import { anularAporteRetiro, reabrirMes } from "../socios/acciones";
import { AjustarCapital, CerrarMes, EditarVoucher, MovimientoSocio } from "../socios/formularios";

export const metadata: Metadata = { title: "Capital y cierres" };

function ultimosPeriodos(n: number) {
  const [a, m] = periodoActual().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const TONO_MOV: Record<TipoMovSocio, Tono> = { aporte: "verde", retiro: "ambar", retiro_utilidad: "azul", capitalizacion: "azul" };
const claseBorde = "inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 bg-superficie px-4 text-sm font-medium hover:bg-stone-50";

export default async function CapitalPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const sp = await searchParams;
  const periodo = sp.periodo && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.periodo) && sp.periodo <= periodoActual() ? sp.periodo : periodoActual();
  const { supabase, empresa, rol } = await exigir("verTodo");
  const esDueno = puede(rol, "socios");

  const [{ data: socios }, { data: saldos }, { data: movs }, { data: cajas }, { data: cierres }, { data: patrimonio }, { data: resultado }] = await Promise.all([
    supabase.from("v_capital_socio").select("*").eq("empresa_id", empresa.id).order("activo", { ascending: false }).order("porcentaje", { ascending: false }),
    supabase.from("v_utilidad_socio_saldo").select("*").eq("empresa_id", empresa.id).eq("periodo", periodo),
    supabase.from("v_aportes_retiros").select("*").eq("empresa_id", empresa.id).order("fecha", { ascending: false }).limit(200),
    supabase.from("cajas").select("id, nombre").eq("empresa_id", empresa.id).eq("activo", true).order("orden"),
    supabase.from("cierres_mes").select("*").eq("empresa_id", empresa.id).order("periodo", { ascending: false }),
    supabase.from("v_patrimonio").select("*").eq("empresa_id", empresa.id).maybeSingle(),
    supabase.from("v_resultado_mes").select("utilidad").eq("empresa_id", empresa.id).eq("periodo", periodo).maybeSingle(),
  ]);
  const activos = (socios ?? []).filter((s) => s.activo);
  const sumaPct = activos.reduce((s, x) => s + Number(x.porcentaje), 0);
  const saldoDe = (id: string | null) => saldos?.find((u) => u.socio_id === id);
  const cerrados = new Set((cierres ?? []).filter((c) => c.estado === "cerrado").map((c) => c.periodo));
  const capital = Number(patrimonio?.capital ?? 0);
  const ganancia = Number(patrimonio?.ganancia_acumulada ?? 0);
  const utilidadMes = Number(resultado?.utilidad ?? 0);
  const periodos = ultimosPeriodos(12);
  const listaSocios = activos.map((s) => ({ id: s.socio_id!, nombre: s.nombre! }));
  const listaCajas = cajas ?? [];
  const capitalizado = Number(patrimonio?.capitalizado ?? 0);

  return (
    <>
      <Encabezado
        titulo="Capital y cierres"
        descripcion="Capital = aportes + utilidad que se dejó en el negocio − retiros. La utilidad se reparte según el % de cada socio."
        acciones={
          <>
            <Link href={`/capital/mes/${periodo}`} className={claseBorde}><FileBarChart className="size-4" /> Reporte de {nombrePeriodo(periodo)}</Link>
            {esDueno && <MovimientoSocio socios={listaSocios} cajas={listaCajas} empresaId={empresa.id} periodos={periodos} />}
          </>
        }
      />

      <PanelModulo
        tono="caja"
        etiqueta="Capital · hoy"
        insignia={capital > 0 ? `${ganancia >= 0 ? "▲ La ganancia" : "▼ La pérdida"} es ${porcentaje(Math.abs((ganancia / capital) * 100))} del capital` : undefined}
        principal={{
          titulo: "Capital de los socios", valor: soles(capital),
          detalle: `${soles(patrimonio?.aportes)} aportes${capitalizado ? ` + ${soles(capitalizado)} utilidad capitalizada` : ""} − ${soles(patrimonio?.retiros)} retiros`,
        }}
        celdas={[
          {
            // Igual que «Total que tenemos» del reporte del mes: ya restado lo que debemos
            titulo: "Lo que tenemos", valor: soles(Number(patrimonio?.activos ?? 0) - Number(patrimonio?.cuentas_por_pagar ?? 0)),
            detalle: Number(patrimonio?.cuentas_por_pagar ?? 0) > 0
              ? `Caja + material + por cobrar − ${soles(patrimonio?.cuentas_por_pagar)} que debemos`
              : "Caja + material a costo + por cobrar",
          },
          {
            titulo: "Ganancia acumulada", valor: soles(ganancia), negativo: ganancia < 0,
            detalle: Number(patrimonio?.utilidad_entregada ?? 0) > 0 ? `Ya descontado lo entregado: ${soles(patrimonio?.utilidad_entregada)}` : "Desde el inicio del negocio",
          },
          {
            titulo: `Utilidad ${nombrePeriodo(periodo)}`, valor: soles(utilidadMes), negativo: utilidadMes < 0,
            detalle: cerrados.has(periodo) ? "Mes cerrado" : "Mes abierto (va cambiando)",
          },
        ]}
      />

      {Math.abs(sumaPct - 100) > 0.001 && activos.length > 0 && (
        <div className="mb-4"><Aviso>Los porcentajes de los socios activos suman {porcentaje(sumaPct)}; deberían sumar 100 %.</Aviso></div>
      )}

      <Tarjeta className="mb-4">
        <TituloTarjeta accion={
          <form method="get" className="flex items-center gap-1.5">
            <select name="periodo" defaultValue={periodo} aria-label="Mes" className="h-9 rounded-md border border-stone-300 bg-superficie px-2 text-sm">
              {ultimosPeriodos(18).map((p) => <option key={p} value={p}>{nombrePeriodo(p)}</option>)}
            </select>
            <button className="h-9 rounded-md border border-stone-300 bg-superficie px-3 text-sm font-medium text-marca-700 hover:bg-marca-50">Ver mes</button>
          </form>
        }>
          Capital y utilidad por socio · {nombrePeriodo(periodo)}
        </TituloTarjeta>
        <TablaDatos
          filas={socios ?? []}
          clave={(s) => s.socio_id!}
          vacio={<>Registre a los socios en <Link href="/socios" className="font-medium underline">Contactos → Socios</Link>.</>}
          columnas={[
            {
              titulo: "Socio", principal: true,
              celda: (s) => <Link href={`/socios/${s.socio_id}`} className={`font-medium hover:underline ${s.activo ? "text-marca-700" : "text-stone-400"}`}>{s.nombre}</Link>,
            },
            { titulo: "%", alinear: "der", celda: (s) => porcentaje(s.porcentaje) },
            { titulo: "Capital", alinear: "der", principal: true, celda: (s) => <span className="font-semibold">{soles(s.capital)}</span> },
            { titulo: "Le toca", alinear: "der", celda: (s) => soles(saldoDe(s.socio_id)?.utilidad_socio ?? 0) },
            { titulo: "Entregado", alinear: "der", celda: (s) => soles(saldoDe(s.socio_id)?.entregado ?? 0) },
            { titulo: "Dejó en el negocio", alinear: "der", celda: (s) => soles(saldoDe(s.socio_id)?.capitalizado ?? 0) },
            {
              titulo: "Falta entregar", alinear: "der",
              celda: (s) => {
                const p = Number(saldoDe(s.socio_id)?.pendiente ?? 0);
                // Negativo = se le entregó más de lo que le toca: es un adelanto
                return p < 0
                  ? <span className="block leading-tight text-amber-700"><span className="block text-[11px] font-medium uppercase tracking-wide">Adelanto</span>{soles(-p)}</span>
                  : <span className="font-medium">{soles(p)}</span>;
              },
            },
            ...(esDueno ? [{
              titulo: "",
              celda: (s: NonNullable<typeof socios>[number]) => s.activo && (
                <span className="flex flex-wrap justify-end gap-1.5">
                  <AjustarCapital socio={{ id: s.socio_id!, nombre: s.nombre!, capital: s.capital ?? 0 }} cajas={listaCajas} empresaId={empresa.id} chico />
                  {Number(saldoDe(s.socio_id)?.pendiente ?? 0) > 0 && <MovimientoSocio socios={listaSocios} cajas={listaCajas} empresaId={empresa.id} periodos={periodos}
                    boton={{ texto: "Entregar utilidad", variante: "secundario", chico: true }}
                    inicial={{
                      tipo: "retiro_utilidad", socioId: s.socio_id!, periodo,
                      monto: Number(saldoDe(s.socio_id)?.pendiente ?? 0) > 0 ? String(saldoDe(s.socio_id)?.pendiente) : undefined,
                    }} />}
                </span>
              ),
            }] : []),
          ]}
        />
        <p className="border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
          «Le toca» = utilidad del mes × % del socio. «Entregado» = lo que se le pagó de esa utilidad. «Dejó en el negocio» = utilidad
          que pasó a su capital (lo sube). Con «Entregar utilidad» se registra el pago o que la deja como capital. «Adelanto» = se le dio más de lo que le toca.
        </p>
      </Tarjeta>

      <Tarjeta className="mb-4">
        <TituloTarjeta accion={esDueno && <CerrarMes periodos={ultimosPeriodos(6).filter((p) => !cerrados.has(p))} />}>
          Cierres de mes
        </TituloTarjeta>
        <TablaDatos
          filas={cierres ?? []}
          clave={(c) => c.id}
          enlace={(c) => `/capital/mes/${c.periodo}`}
          vacio="Aún no se ha cerrado ningún mes. Al cerrar, se guarda la caja, el material por producto, las compras, las ventas y la utilidad."
          columnas={[
            { titulo: "Periodo", principal: true, celda: (c) => nombrePeriodo(c.periodo) },
            { titulo: "Estado", celda: (c) => c.estado === "cerrado" ? <Insignia tono="azul">Cerrado</Insignia> : <Insignia tono="ambar">Reabierto</Insignia> },
            { titulo: "Utilidad", alinear: "der", principal: true, celda: (c) => soles((c.snapshot as { resultado?: { utilidad?: number } })?.resultado?.utilidad ?? 0) },
            { titulo: "Fecha de cierre", celda: (c) => fecha(c.cerrado_en) },
            {
              titulo: "Reapertura", ocultarMovil: true,
              celda: (c) => c.estado === "cerrado" && esDueno
                ? <BotonAnular id={c.periodo} accion={reabrirMes} titulo={`Reabrir ${nombrePeriodo(c.periodo)}`} explicacion="Se podrán volver a registrar y anular movimientos de ese mes." etiqueta="Reabrir" textoConfirmar="Reabrir mes"
                    icono={LockOpen} peligro={false} chico etiquetaMotivo="Motivo de la reapertura" mensajeExito="Mes reabierto. Ya puede registrar y anular movimientos de ese mes." />
                : c.motivo_reapertura ? <span className="text-xs text-stone-500">{c.motivo_reapertura}</span> : null,
            },
          ]}
        />
      </Tarjeta>

      <Tarjeta>
        <TituloTarjeta>Historial de movimientos de socios</TituloTarjeta>
        <TablaDatos
          filas={movs ?? []}
          clave={(m) => m.id!}
          vacio="Sin movimientos de socios."
          columnas={[
            { titulo: "Fecha", celda: (m) => fechaHora(m.fecha) },
            { titulo: "Socio", principal: true, celda: (m) => m.socio_nombre },
            {
              titulo: "Tipo",
              celda: (m) => (
                <span className="flex flex-wrap items-center gap-1">
                  <Insignia tono={m.estado === "anulada" ? "rojo" : TONO_MOV[m.tipo as TipoMovSocio]}>
                    {ETIQUETA_MOV_SOCIO[m.tipo as TipoMovSocio]}{m.estado === "anulada" && " · anulado"}
                  </Insignia>
                  {m.periodo && <span className="text-xs text-stone-500">{nombrePeriodo(m.periodo)}</span>}
                </span>
              ),
            },
            { titulo: "Caja", celda: (m) => m.caja_nombre ?? <span className="text-stone-500">Sin mover dinero</span> },
            {
              titulo: "Monto", alinear: "der", principal: true,
              celda: (m) => <span className={m.estado === "anulada" ? "text-stone-500 line-through" : "font-medium"}>{soles(m.monto)}</span>,
            },
            {
              titulo: "Voucher",
              celda: (m) => m.voucher_url || m.voucher_numero ? (
                <span className="flex flex-wrap items-center gap-1.5 text-sm">
                  {m.voucher_numero && <span className="cifra">N° {m.voucher_numero}</span>}
                  {m.voucher_url && (
                    <a href={`/capital/voucher/${m.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-marca-700 hover:underline">
                      <FileImage className="size-3.5" /> Ver
                    </a>
                  )}
                </span>
              ) : <span className="text-stone-400">—</span>,
            },
            {
              titulo: "Nota", completo: true,
              celda: (m) => (
                <span className="block text-sm leading-tight">
                  {m.nota ?? "—"}
                  {m.estado === "anulada" && m.motivo_anulacion && <span className="block text-xs text-red-700">Anulado: {m.motivo_anulacion}</span>}
                  {m.creado_por_nombre && <span className="block text-xs text-stone-500">Registró: {m.creado_por_nombre}</span>}
                </span>
              ),
            },
            {
              titulo: "",
              celda: (m) => (
                <span className="flex flex-wrap items-center justify-end gap-1">
                  <BotonImprimir80 href={`/imprimir/aporte/${m.id}`} texto="Constancia"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-marca-700 hover:bg-marca-50" />
                  {esDueno && m.estado !== "anulada" && (
                    <>
                      <EditarVoucher mov={{ id: m.id!, voucher_numero: m.voucher_numero, voucher_url: m.voucher_url, nota: m.nota }} empresaId={empresa.id} />
                      <BotonAnular id={m.id!} accion={anularAporteRetiro} titulo="Anular movimiento de socio" chico />
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Tarjeta>
    </>
  );
}

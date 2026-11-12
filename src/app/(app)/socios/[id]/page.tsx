import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileImage } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { fechaHora, nombrePeriodo, periodoActual, porcentaje, soles } from "@/lib/formato";
import { ETIQUETA_MOV_SOCIO, type TipoMovSocio } from "@/lib/socios";
import { Dato, Encabezado, Insignia, Kpi, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { Pestanas } from "@/components/ui/pestanas";
import { TablaDatos } from "@/components/ui/tabla";
import { BotonImprimir80 } from "@/components/ticket/boton-imprimir-80";
import { AjustarCapital, MovimientoSocio } from "../formularios";

export const metadata: Metadata = { title: "Socio" };

function ultimosPeriodos(n: number) {
  const [a, m] = periodoActual().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default async function SocioDetalle({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const pestana = tab === "movimientos" || tab === "utilidad" ? tab : "resumen";
  const { supabase, rol, empresa } = await exigir("verTodo");
  const esDueno = puede(rol, "socios");
  const [{ data: s }, { data: movs }, { data: utilidad }, { data: cajas }] = await Promise.all([
    supabase.from("v_capital_socio").select("*").eq("socio_id", id).maybeSingle(),
    supabase.from("v_aportes_retiros").select("*").eq("socio_id", id).order("fecha", { ascending: false }).limit(200),
    supabase.from("v_utilidad_socio_saldo").select("*").eq("socio_id", id).order("periodo", { ascending: false }).limit(24),
    supabase.from("cajas").select("id, nombre").eq("empresa_id", empresa.id).eq("activo", true).order("orden"),
  ]);
  if (!s) notFound();
  const mes = utilidad?.find((u) => u.periodo === periodoActual());
  // Los meses en negativo son adelantos: no se restan de lo que falta entregar de los otros meses
  const pendienteTotal = (utilidad ?? []).reduce((t, u) => t + Math.max(Number(u.pendiente ?? 0), 0), 0);
  const adelantos = (utilidad ?? []).reduce((t, u) => t + Math.max(-Number(u.pendiente ?? 0), 0), 0);
  const listaCajas = cajas ?? [];
  const yo = [{ id: s.socio_id!, nombre: s.nombre! }];

  const tablaMovs = (
    <Tarjeta>
      <TituloTarjeta>Historial de movimientos</TituloTarjeta>
      <TablaDatos
        filas={movs ?? []}
        clave={(m) => m.id!}
        vacio="Sin movimientos."
        columnas={[
          { titulo: "Fecha", celda: (m) => fechaHora(m.fecha) },
          {
            titulo: "Tipo", principal: true,
            celda: (m) => (
              <span className="flex flex-wrap items-center gap-1">
                <Insignia tono={m.estado === "anulada" ? "rojo" : m.tipo === "aporte" ? "verde" : m.tipo === "retiro" ? "ambar" : "azul"}>
                  {ETIQUETA_MOV_SOCIO[m.tipo as TipoMovSocio]}{m.estado === "anulada" && " · anulado"}
                </Insignia>
                {m.periodo && <span className="text-xs text-stone-500">{nombrePeriodo(m.periodo)}</span>}
              </span>
            ),
          },
          { titulo: "Caja", celda: (m) => m.caja_nombre ?? <span className="text-stone-500">Sin mover dinero</span> },
          { titulo: "Monto", alinear: "der", principal: true, celda: (m) => <span className={m.estado === "anulada" ? "text-stone-500 line-through" : "font-medium"}>{soles(m.monto)}</span> },
          {
            titulo: "Voucher",
            celda: (m) => m.voucher_url || m.voucher_numero ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {m.voucher_numero && <span className="cifra">N° {m.voucher_numero}</span>}
                {m.voucher_url && <a href={`/capital/voucher/${m.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-marca-700 hover:underline"><FileImage className="size-3.5" /> Ver</a>}
              </span>
            ) : "—",
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
            celda: (m) => <BotonImprimir80 href={`/imprimir/aporte/${m.id}`} texto="Constancia"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-marca-700 hover:bg-marca-50" />,
          },
        ]}
      />
    </Tarjeta>
  );

  const tablaUtilidad = (
    <Tarjeta>
      <TituloTarjeta>Utilidad por mes: cuánto le toca, cuánto se le dio y cuánto falta</TituloTarjeta>
      <TablaDatos
        filas={utilidad ?? []}
        clave={(u) => u.periodo!}
        vacio="Aún no hay meses con resultado."
        columnas={[
          { titulo: "Mes", principal: true, celda: (u) => nombrePeriodo(u.periodo!) },
          { titulo: "Utilidad empresa", alinear: "der", celda: (u) => soles(u.utilidad_empresa) },
          { titulo: `Le toca (${porcentaje(s.porcentaje)})`, alinear: "der", celda: (u) => soles(u.utilidad_socio) },
          { titulo: "Entregado", alinear: "der", celda: (u) => soles(u.entregado) },
          { titulo: "Dejó en el negocio", alinear: "der", celda: (u) => soles(u.capitalizado) },
          { titulo: "Falta entregar", alinear: "der", principal: true, celda: (u) => Number(u.pendiente) < 0
            ? <span className="block leading-tight text-amber-700"><span className="block text-[11px] font-medium uppercase tracking-wide">Adelanto</span>{soles(-Number(u.pendiente))}</span>
            : <span className="font-semibold">{soles(u.pendiente)}</span> },
        ]}
      />
    </Tarjeta>
  );

  return (
    <>
      <Link href="/socios" className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ArrowLeft className="size-4" /> Socios
      </Link>
      <Encabezado
        titulo={s.nombre!}
        descripcion={<span className="flex flex-wrap items-center gap-2">{s.dni ? `DNI ${s.dni}` : "Sin DNI"} {!s.activo && <Insignia>Inactivo</Insignia>}</span>}
        acciones={esDueno && s.activo && (
          <>
            <AjustarCapital socio={{ id: s.socio_id!, nombre: s.nombre!, capital: s.capital ?? 0 }} cajas={listaCajas} empresaId={empresa.id} />
            <MovimientoSocio socios={yo} cajas={listaCajas} empresaId={empresa.id} periodos={ultimosPeriodos(12)} inicial={{ socioId: s.socio_id! }} />
          </>
        )}
      />
      <Pestanas
        base={`/socios/${id}`}
        actual={pestana}
        opciones={[
          { valor: "resumen", texto: "Resumen" },
          { valor: "movimientos", texto: "Movimientos", cantidad: (movs ?? []).length },
          { valor: "utilidad", texto: "Utilidad" },
        ]}
      />
      {pestana === "resumen" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Participación" valor={porcentaje(s.porcentaje)} />
            <Kpi titulo="Capital" valor={soles(s.capital)}
              detalle={`${soles(s.aportes)} aportes${Number(s.capitalizado) ? ` + ${soles(s.capitalizado)} utilidad` : ""} − ${soles(s.retiros)} retiros`} />
            <Kpi
              titulo={`Utilidad ${nombrePeriodo(periodoActual())}`}
              valor={soles(mes?.utilidad_socio ?? 0)}
              tono={Number(mes?.utilidad_socio ?? 0) >= 0 ? "positivo" : "negativo"}
              detalle="Según su %; el mes aún puede cambiar"
            />
            <Kpi titulo="Utilidad por entregar" valor={soles(pendienteTotal)} detalle={`${adelantos ? `Adelantos: ${soles(adelantos)} · ` : ""}Ya entregado: ${soles(s.utilidad_entregada)}`} />
          </div>
          <Tarjeta className="p-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Dato etiqueta="Nombre">{s.nombre}</Dato>
              <Dato etiqueta="DNI">{s.dni ?? "—"}</Dato>
              <Dato etiqueta="Participación">{porcentaje(s.porcentaje)}</Dato>
              <Dato etiqueta="Estado">{s.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia>Inactivo</Insignia>}</Dato>
            </dl>
          </Tarjeta>
        </>
      )}
      {pestana === "movimientos" && tablaMovs}
      {pestana === "utilidad" && tablaUtilidad}
    </>
  );
}

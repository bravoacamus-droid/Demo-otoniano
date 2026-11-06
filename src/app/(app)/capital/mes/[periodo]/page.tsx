import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { fechaHora, kg, nombrePeriodo, periodoActual, porcentaje, soles } from "@/lib/formato";
import { Aviso, Encabezado, Insignia, Kpi, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { TablaDatos } from "@/components/ui/tabla";
import { BotonImprimirPagina } from "@/components/boton-imprimir-pagina";

export const metadata: Metadata = { title: "Reporte del mes" };

type N = number | string | null | undefined;
interface Reporte {
  estado: "abierto" | "cerrado" | "reabierto";
  cerrado_en: string | null;
  generado_en: string;
  resultado: Record<"compras" | "kg_comprados" | "ventas" | "kg_vendidos" | "costo_ventas" | "merma_venta" | "merma_ajustes"
    | "merma_ajustes_kg" | "gastos" | "ajustes_caja" | "margen_bruto" | "utilidad", N> | null;
  patrimonio: Record<"caja" | "stock_costo" | "en_transito" | "por_cobrar" | "cuentas_por_cobrar" | "cuentas_por_pagar"
    | "capital" | "activos" | "ganancia_acumulada", N> | null;
  patrimonio_inicio?: Reporte["patrimonio"];
  stock: { metal: string; kg: N; costo: N }[] | null;
  compras?: { metal: string; kg: N; importe: N }[] | null;
  ventas?: { metal: string; kg: N; importe: N; costo: N; merma: N; margen: N }[] | null;
  utilidad_socios?: { socio: string; porcentaje: N; utilidad: N; entregado?: N; capitalizado?: N; pendiente?: N }[] | null;
}

const n = (v: N) => Number(v ?? 0);
const claseBorde = "no-imprimir inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 bg-superficie px-4 text-sm font-medium hover:bg-stone-50";

/** Una línea del «resumen en simple»: concepto a la izquierda, monto a la derecha */
function Linea({ texto, monto, signo, fuerte, detalle }: { texto: string; monto: N; signo?: "+" | "−" | "="; fuerte?: boolean; detalle?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${fuerte ? "border-t border-stone-200 font-semibold" : ""}`}>
      <span className="min-w-0">
        {signo && <span className="mr-1.5 inline-block w-3 text-stone-400">{signo}</span>}
        {texto}
        {detalle && <span className="block pl-[1.125rem] text-xs font-normal text-stone-500">{detalle}</span>}
      </span>
      {/* Los montos van en positivo; el signo dice si suma o resta. Rojo solo si un resultado sale negativo */}
      <span className={`cifra shrink-0 ${(!signo || signo === "=") && n(monto) < 0 ? "text-red-700" : ""}`}>{soles(monto)}</span>
    </div>
  );
}

export default async function ReporteMes({ params }: { params: Promise<{ periodo: string }> }) {
  const { periodo } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo) || periodo > periodoActual()) notFound();
  const { supabase, empresa, nombre } = await exigir("verTodo");
  const { data, error } = await supabase.rpc("reporte_mes", { p_empresa: empresa.id, p_periodo: periodo });
  if (error || !data) notFound();
  const r = data as unknown as Reporte;
  const res = r.resultado;
  const pat = r.patrimonio;
  const stock = (r.stock ?? []).filter((s) => n(s.kg) !== 0 || n(s.costo) !== 0);
  const totalStock = stock.reduce((t, s) => t + n(s.costo), 0);
  const ventas = r.ventas ?? [];
  const compras = r.compras ?? [];
  const debemos = n(pat?.cuentas_por_pagar);
  const porCobrar = n(pat?.por_cobrar) + n(pat?.cuentas_por_cobrar) + n(pat?.en_transito);
  const mermas = n(res?.merma_venta) + n(res?.merma_ajustes);
  const cerrado = r.estado === "cerrado";

  return (
    <div className="mx-auto max-w-6xl">
      {/* Membrete solo en la hoja impresa */}
      <div className="mb-4 hidden items-center justify-between gap-4 border-b-2 border-marca-700 pb-3 print:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/logo-color.png" alt="Grupo Otiniano" className="h-12 w-auto" />
        <div className="text-right text-xs text-stone-600">
          <p className="text-sm font-semibold text-stone-900">{empresa.razon_social}</p>
          {empresa.ruc && <p>RUC {empresa.ruc}</p>}
          <p>Impreso por {nombre} · {fechaHora(new Date().toISOString())}</p>
        </div>
      </div>
      <Link href={`/capital?periodo=${periodo}`} className="no-imprimir mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ArrowLeft className="size-4" /> Capital y cierres
      </Link>
      <Encabezado
        titulo={`Reporte de ${nombrePeriodo(periodo)}`}
        descripcion={
          <span className="flex flex-wrap items-center gap-2">
            {r.estado === "cerrado"
              ? <><Insignia tono="azul">Mes cerrado</Insignia> Foto guardada el {fechaHora(r.cerrado_en)}</>
              : <><Insignia tono="ambar">{r.estado === "reabierto" ? "Mes reabierto" : "Mes abierto"}</Insignia> Datos al {fechaHora(r.generado_en)}: pueden cambiar hasta cerrar el mes</>}
          </span>
        }
        acciones={<BotonImprimirPagina className={claseBorde} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi titulo={cerrado ? "Caja al cierre" : "Caja hoy"} valor={soles(pat?.caja)} detalle="Efectivo + bancos" />
        <Kpi titulo="Material en almacén" valor={soles(pat?.stock_costo)} detalle="A lo que nos costó" />
        <Kpi titulo="Compramos" valor={soles(res?.compras)} detalle={kg(res?.kg_comprados ?? 0)} />
        <Kpi titulo="Vendimos" valor={soles(res?.ventas)} detalle={kg(res?.kg_vendidos ?? 0)} />
        <Kpi titulo="Utilidad del mes" valor={soles(res?.utilidad)} tono={n(res?.utilidad) >= 0 ? "positivo" : "negativo"} detalle="Solo de lo vendido" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Tarjeta className="p-4">
          <p className="mb-2 text-sm font-semibold">¿Cuánto ganamos este mes?</p>
          <div className="text-sm">
            <Linea texto="Lo que vendimos" monto={res?.ventas} />
            <Linea signo="−" texto="Lo que nos costó ese material" monto={res?.costo_ventas} detalle="Al costo promedio de compra" />
            <Linea signo="=" texto="Ganancia en ventas" monto={res?.margen_bruto} fuerte />
            {mermas !== 0 && <Linea signo={mermas > 0 ? "−" : "+"} texto={mermas > 0 ? "Mermas y faltantes" : "Sobrantes"} monto={Math.abs(mermas)}
              detalle={`Diferencia de balanza en ventas y ajustes/conteos${n(res?.merma_ajustes_kg) ? ` (${kg(res?.merma_ajustes_kg)})` : ""}`} />}
            {n(res?.gastos) !== 0 && <Linea signo="−" texto="Gastos del mes" monto={res?.gastos} />}
            {n(res?.ajustes_caja) !== 0 && <Linea signo={n(res?.ajustes_caja) > 0 ? "+" : "−"} texto={n(res?.ajustes_caja) > 0 ? "Sobrante de caja (arqueos)" : "Faltante de caja (arqueos)"} monto={Math.abs(n(res?.ajustes_caja))} />}
            <Linea signo="=" texto="Utilidad del mes" monto={res?.utilidad} fuerte />
          </div>
          <p className="mt-3 rounded-lg bg-marca-50 px-3 py-2 text-xs text-marca-800">
            La utilidad sale solo de lo vendido: lo comprado que todavía no se vende no es ganancia ni pérdida, sigue siendo
            nuestro capital, guardado como material en el almacén.
          </p>
        </Tarjeta>

        <Tarjeta className="p-4">
          <p className="mb-2 text-sm font-semibold">¿Dónde está la plata {cerrado ? "al cierre del mes" : "hoy"}?</p>
          <div className="text-sm">
            <Linea texto="En caja (efectivo y bancos)" monto={pat?.caja} />
            <Linea signo="+" texto="En material del almacén" monto={pat?.stock_costo} detalle="Detalle por producto abajo" />
            {porCobrar !== 0 && <Linea signo="+" texto="Por cobrar" monto={porCobrar} detalle="Ventas a crédito, saldos de proveedores y material en camino" />}
            {debemos !== 0 && <Linea signo="−" texto="Lo que debemos" monto={debemos} detalle="Compras a crédito por pagar" />}
            <Linea signo="=" texto="Total que tenemos" monto={n(pat?.activos) - debemos} fuerte />
            <Linea signo="−" texto="Capital de los socios" monto={pat?.capital} />
            <Linea signo="=" texto="Ganancia acumulada" monto={pat?.ganancia_acumulada} fuerte detalle="Lo ganado desde el inicio, menos la utilidad ya entregada" />
          </div>
        </Tarjeta>
      </div>

      <Tarjeta className="mb-4">
        <TituloTarjeta>¿En qué material está la plata? (stock {cerrado ? "al cierre" : "de hoy"}, a costo)</TituloTarjeta>
        <TablaDatos
          filas={stock}
          clave={(s) => s.metal}
          vacio="No había material en el almacén."
          columnas={[
            { titulo: "Producto", principal: true, celda: (s) => s.metal },
            { titulo: "Kilos", alinear: "der", celda: (s) => kg(s.kg ?? 0) },
            { titulo: "Valor a costo", alinear: "der", principal: true, celda: (s) => <span className="font-semibold">{soles(s.costo)}</span> },
            { titulo: "% del material", alinear: "der", celda: (s) => totalStock ? porcentaje((n(s.costo) / totalStock) * 100) : "—" },
          ]}
          pie={<tr><td className="px-3 py-2.5 pl-4">Total</td><td /><td className="cifra px-3 py-2.5 text-right">{soles(totalStock)}</td><td className="pr-4" /></tr>}
          pieTarjetas={<div className="flex justify-between px-4 py-3"><span>Total material</span><span className="cifra">{soles(totalStock)}</span></div>}
        />
      </Tarjeta>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Tarjeta>
          <TituloTarjeta>Ventas del mes por producto</TituloTarjeta>
          <TablaDatos
            filas={ventas}
            clave={(v) => v.metal}
            vacio={r.ventas ? "No hubo ventas confirmadas." : "Este cierre es antiguo y no guardó el detalle por producto."}
            columnas={[
              { titulo: "Producto", principal: true, celda: (v) => v.metal },
              { titulo: "Kilos", alinear: "der", celda: (v) => kg(v.kg ?? 0) },
              { titulo: "Vendido", alinear: "der", celda: (v) => soles(v.importe) },
              { titulo: "Costó", alinear: "der", celda: (v) => soles(n(v.costo) + n(v.merma)) },
              { titulo: "Ganancia", alinear: "der", principal: true, celda: (v) => <span className={`font-semibold ${n(v.margen) < 0 ? "text-red-700" : ""}`}>{soles(v.margen)}</span> },
            ]}
          />
        </Tarjeta>
        <Tarjeta>
          <TituloTarjeta>Compras del mes por producto</TituloTarjeta>
          <TablaDatos
            filas={compras}
            clave={(c) => c.metal}
            vacio={r.compras ? "No hubo compras." : "Este cierre es antiguo y no guardó el detalle por producto."}
            columnas={[
              { titulo: "Producto", principal: true, celda: (c) => c.metal },
              { titulo: "Kilos", alinear: "der", celda: (c) => kg(c.kg ?? 0) },
              { titulo: "S/ por kg", alinear: "der", celda: (c) => n(c.kg) ? soles(n(c.importe) / n(c.kg)) : "—" },
              { titulo: "Pagado", alinear: "der", principal: true, celda: (c) => <span className="font-semibold">{soles(c.importe)}</span> },
            ]}
          />
        </Tarjeta>
      </div>

      <Tarjeta>
        <TituloTarjeta>Reparto de la utilidad entre socios</TituloTarjeta>
        {(r.utilidad_socios ?? []).length === 0
          ? <div className="p-4"><Aviso>No hay socios activos con porcentaje.</Aviso></div>
          : (
            <TablaDatos
              filas={r.utilidad_socios ?? []}
              clave={(u) => u.socio}
              columnas={[
                { titulo: "Socio", principal: true, celda: (u) => u.socio },
                { titulo: "%", alinear: "der", celda: (u) => porcentaje(u.porcentaje) },
                { titulo: "Le toca", alinear: "der", principal: true, celda: (u) => <span className="font-semibold">{soles(u.utilidad)}</span> },
                { titulo: "Entregado", alinear: "der", celda: (u) => soles(u.entregado) },
                { titulo: "Dejó en el negocio", alinear: "der", celda: (u) => soles(u.capitalizado) },
                {
                  titulo: "Falta entregar", alinear: "der",
                  celda: (u) => {
                    const p = n(u.pendiente ?? u.utilidad);
                    return p < 0
                      ? <span className="block leading-tight text-amber-700"><span className="block text-[11px] font-medium uppercase tracking-wide">Adelanto</span>{soles(-p)}</span>
                      : <span className="font-medium">{soles(p)}</span>;
                  },
                },
              ]}
            />
          )}
      </Tarjeta>
    </div>
  );
}

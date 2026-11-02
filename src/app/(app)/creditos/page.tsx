import type { Metadata } from "next";
import Link from "next/link";
import { exigir } from "@/lib/contexto";
import { fechaDia, soles } from "@/lib/formato";
import { Encabezado, Insignia, Kpi, Tarjeta } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import { TablaDatos } from "@/components/ui/tabla";
import { BarraAvance } from "@/components/avance-credito";
import { SITUACION, TIPOS_CREDITO, avanceCuotas, type Situacion, type TipoCredito } from "@/lib/creditos";

export const metadata: Metadata = { title: "Créditos" };

type Params = { tipo?: string; ver?: string };
const VER = { vigentes: "Pendientes", pagados: "Pagados", todos: "Todos" } as const;

export default async function CreditosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tipo: TipoCredito = sp.tipo === "por_pagar" ? "por_pagar" : "por_cobrar";
  const ver = (sp.ver && sp.ver in VER ? sp.ver : "vigentes") as keyof typeof VER;
  const { supabase, empresa } = await exigir("creditos");

  // Totales de los dos lados (siempre pendientes) y la lista del lado elegido
  let q = supabase.from("v_creditos").select("*").eq("empresa_id", empresa.id).eq("tipo", tipo)
    .order("proxima_vence", { ascending: true, nullsFirst: false }).order("fecha", { ascending: false }).limit(300);
  if (ver === "vigentes") q = q.in("situacion", ["al_dia", "vencido"]);
  if (ver === "pagados") q = q.eq("situacion", "pagado");
  const [{ data: lista }, { data: pendientes }] = await Promise.all([
    q,
    supabase.from("v_creditos").select("tipo, saldo, monto_vencido, situacion").eq("empresa_id", empresa.id).in("situacion", ["al_dia", "vencido"]),
  ]);
  const suma = (t: TipoCredito, campo: "saldo" | "monto_vencido") =>
    (pendientes ?? []).filter((c) => c.tipo === t).reduce((s, c) => s + Number(c[campo] ?? 0), 0);
  const vencidos = (t: TipoCredito) => (pendientes ?? []).filter((c) => c.tipo === t && c.situacion === "vencido").length;
  const href = (cambios: Params) => `/creditos?${new URLSearchParams({ tipo, ver, ...cambios })}`;
  const t = TIPOS_CREDITO[tipo];

  return (
    <>
      <Encabezado titulo="Créditos" descripcion="Ventas por cobrar y compras por pagar en cuotas: avance, vencimientos y pagos" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Nos deben (por cobrar)" valor={soles(suma("por_cobrar", "saldo"))}
          detalle={`${(pendientes ?? []).filter((c) => c.tipo === "por_cobrar").length} créditos pendientes`} />
        <Kpi titulo="Cobros vencidos" valor={soles(suma("por_cobrar", "monto_vencido"))} tono={vencidos("por_cobrar") ? "negativo" : undefined}
          detalle={vencidos("por_cobrar") ? `${vencidos("por_cobrar")} cliente(s) atrasado(s)` : "Nadie atrasado"} />
        <Kpi titulo="Debemos (por pagar)" valor={soles(suma("por_pagar", "saldo"))}
          detalle={`${(pendientes ?? []).filter((c) => c.tipo === "por_pagar").length} créditos pendientes`} />
        <Kpi titulo="Pagos vencidos" valor={soles(suma("por_pagar", "monto_vencido"))} tono={vencidos("por_pagar") ? "negativo" : undefined}
          detalle={vencidos("por_pagar") ? `${vencidos("por_pagar")} proveedor(es) por pagar` : "Todo al día"} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1" role="tablist">
          {(["por_cobrar", "por_pagar"] as const).map((x) => (
            <Link key={x} href={href({ tipo: x })} role="tab" aria-selected={tipo === x}
              className={cx("inline-flex min-h-9 items-center rounded-md px-3 py-2 text-sm font-medium", tipo === x ? "bg-superficie shadow-sm" : "text-stone-600 hover:text-stone-900")}>
              {TIPOS_CREDITO[x].texto}
            </Link>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(VER) as (keyof typeof VER)[]).map((v) => (
            <Link key={v} href={href({ ver: v })}
              className={cx("inline-flex min-h-9 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium",
                ver === v ? "border-marca-600 bg-marca-50 text-marca-700" : "border-stone-200 bg-superficie text-stone-600 hover:bg-stone-50")}>
              {VER[v]}
            </Link>
          ))}
        </div>
      </div>

      <Tarjeta>
        <TablaDatos
          filas={lista ?? []}
          clave={(c) => c.id!}
          enlace={(c) => `/creditos/${c.id}`}
          vacio={ver === "vigentes" ? `No hay créditos ${t.texto.toLowerCase()} pendientes.` : "Sin créditos con este filtro."}
          columnas={[
            { titulo: t.contraparte, principal: true, celda: (c) => <span className="font-medium">{c.contraparte}</span> },
            { titulo: t.operacion, celda: (c) => <span className="cifra">N° {c.operacion_numero}</span> },
            {
              titulo: "Avance",
              celda: (c) => (
                <span className="block min-w-32 space-y-1">
                  <BarraAvance pagado={Number(c.pagado)} total={Number(c.monto)} vencido={c.situacion === "vencido"} />
                  <span className="block text-xs text-stone-500">{avanceCuotas(c.cuotas_pagadas, c.n_cuotas)}</span>
                </span>
              ),
            },
            {
              titulo: "Próxima cuota",
              celda: (c) => c.proxima_numero ? (
                <span className="block leading-tight">
                  <span className="cifra">{fechaDia(c.proxima_vence)}</span>
                  <span className="block text-xs text-stone-500">Cuota {c.proxima_numero} · {soles(c.proxima_saldo)}</span>
                </span>
              ) : "—",
            },
            { titulo: "Falta", alinear: "der", principal: true, celda: (c) => <span className="cifra font-semibold">{soles(c.saldo)}</span> },
            {
              titulo: "Estado",
              celda: (c) => {
                const [texto, tono] = SITUACION[(c.situacion ?? "al_dia") as Situacion];
                return <Insignia tono={tono}>{c.situacion === "vencido" ? `Vencido · ${c.dias_atraso} día${c.dias_atraso === 1 ? "" : "s"}` : texto}</Insignia>;
              },
            },
          ]}
        />
      </Tarjeta>
    </>
  );
}

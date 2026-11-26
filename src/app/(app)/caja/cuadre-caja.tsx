import Link from "next/link";
import { soles } from "@/lib/formato";
import { Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import type { Database } from "@/lib/supabase/database.types";

type Cuadre = Database["public"]["Views"]["v_cuadre_caja"]["Row"];

/** Saldo de todas las cajas explicado: capital de socios + ventas − compras − gastos (cifras de v_cuadre_caja) */
export function CuadreCaja({ c }: { c: Cuadre }) {
  const filas: { texto: string; valor: number; siempre?: boolean }[] = [
    { texto: "Capital aportado por los socios", valor: Number(c.aportes), siempre: true },
    { texto: "Ventas cobradas", valor: Number(c.ventas), siempre: true },
    { texto: "Compras pagadas", valor: Number(c.compras), siempre: true },
    { texto: "Gastos", valor: Number(c.gastos), siempre: true },
    { texto: "Retiros de socios", valor: Number(c.retiros) },
    { texto: "Préstamos (recibidos y cobrados − prestados y devueltos)", valor: Number(c.prestamos) },
    { texto: "Otros ingresos y salidas (ajustes, adelantos, devoluciones)", valor: Number(c.otros) },
  ].filter((f) => f.siempre || f.valor !== 0);
  const porPagar = Number(c.compras_por_pagar);
  const porCobrar = Number(c.ventas_por_cobrar);
  const debemos = Number(c.prestamos_por_pagar);
  const nosDeben = Number(c.prestamos_por_cobrar);

  return (
    <Tarjeta className="mb-4">
      <TituloTarjeta>Cuadre de caja · cómo se llega al saldo</TituloTarjeta>
      <dl className="divide-y divide-stone-100 px-4 text-sm">
        {filas.map((f) => (
          <div key={f.texto} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="min-w-0 text-stone-700">{f.texto}</dt>
            <dd className={cx("cifra shrink-0 font-medium", f.valor > 0 ? "text-emerald-700" : f.valor < 0 ? "text-red-700" : "text-stone-500")}>
              {f.valor > 0 ? "+" : f.valor < 0 ? "−" : ""}{soles(Math.abs(f.valor))}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="font-semibold text-stone-900">Saldo en cajas</dt>
          <dd className={cx("cifra shrink-0 text-base font-semibold", Number(c.saldo) < 0 ? "text-red-700" : "text-stone-900")}>{soles(c.saldo)}</dd>
        </div>
      </dl>
      {(porPagar > 0 || porCobrar > 0 || debemos > 0 || nosDeben > 0) && (
        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-600">
          {porPagar > 0 && <>Compras a crédito por pagar: <b className="cifra">{soles(porPagar)}</b> (aún no salieron de caja). </>}
          {porCobrar > 0 && <>Ventas a crédito por cobrar: <b className="cifra">{soles(porCobrar)}</b>. </>}
          {debemos > 0 && <>Préstamos por devolver: <b className="cifra">{soles(debemos)}</b>. </>}
          {nosDeben > 0 && <>Préstamos por cobrar: <b className="cifra">{soles(nosDeben)}</b>. </>}
          {(porPagar > 0 || porCobrar > 0) && <Link href="/creditos" className="font-medium text-marca-700 hover:underline">Ver créditos</Link>}
          {(debemos > 0 || nosDeben > 0) && <> <Link href="/caja?vista=prestamos" className="font-medium text-marca-700 hover:underline">Ver préstamos</Link></>}
        </p>
      )}
    </Tarjeta>
  );
}

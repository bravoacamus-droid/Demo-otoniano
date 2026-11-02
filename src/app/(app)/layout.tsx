import { AppShell } from "@/components/shell/app-shell";
import { cookies } from "next/headers";
import { obtenerContexto } from "@/lib/contexto";
import { COOKIE_LETRA, COOKIE_MENU, COOKIE_TEMA, leerLetra, leerMenuCompacto, leerTema } from "@/lib/preferencias";
import { CLAVE_PESTANA } from "@/lib/sesion-pestana";
import { puede } from "@/lib/permisos";
import { hoyLima } from "@/lib/formato";
import type { Contexto } from "@/lib/contexto";
import type { AvisoCredito } from "@/components/shell/avisos-credito";

// Cada pestaña nueva y cada apertura de la app instalada empiezan en el login: la marca de "esta pestaña
// pasó por el login" vive en sessionStorage (se pierde al abrir otra pestaña o ventana; sobrevive a recargar).
// Sin marca: se oculta la página antes de pintarla y se cierra la sesión local (/auth/nueva-ventana).
const GUARDIA = `try{if(!sessionStorage.getItem("${CLAVE_PESTANA}")){document.documentElement.style.visibility="hidden";location.replace("/auth/nueva-ventana?next="+encodeURIComponent(location.pathname+location.search))}}catch(e){}`;

/** Gerencia: créditos con cuotas vencidas o que vencen en 3 días (campana de la barra superior) */
async function avisosCredito(ctx: Contexto): Promise<AvisoCredito[]> {
  const limite = new Date(Date.parse(`${hoyLima()}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await ctx.supabase.from("v_creditos")
    .select("id, tipo, contraparte, operacion_numero, situacion, n_cuotas, cuotas_pagadas, cuotas_vencidas, monto_vencido, dias_atraso, proxima_numero, proxima_vence, proxima_saldo, saldo")
    .eq("empresa_id", ctx.empresa.id).in("situacion", ["al_dia", "vencido"])
    .or(`situacion.eq.vencido,proxima_vence.lte.${limite}`)
    .order("dias_atraso", { ascending: false }).order("proxima_vence");
  return (data ?? []) as AvisoCredito[];
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [ctx, c] = await Promise.all([obtenerContexto(), cookies()]);
  // Sin await: la campana llega por streaming y no demora la página
  const avisos = puede(ctx.rol, "avisosCredito") ? avisosCredito(ctx) : null;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: GUARDIA }} />
      <AppShell
        rol={ctx.rol}
        nombre={ctx.nombre}
        empresa={{ id: ctx.empresa.id, razon_social: ctx.empresa.razon_social }}
        empresas={ctx.empresas}
        tema={leerTema(c.get(COOKIE_TEMA)?.value)}
        letra={leerLetra(c.get(COOKIE_LETRA)?.value)}
        compacto={leerMenuCompacto(c.get(COOKIE_MENU)?.value)}
        avisosCredito={avisos}
      >
        {children}
      </AppShell>
    </>
  );
}

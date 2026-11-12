import type { Metadata } from "next";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { exigir } from "@/lib/contexto";
import { Encabezado, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import { Campo, Input, InputNumero } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { ETIQUETA_ROL } from "@/lib/formato";
import { guardarEmpresa, guardarSerieComprobante } from "./acciones";
import { COMPROBANTES, type TipoComprobante } from "@/lib/comprobantes";
import { cargarMediosPago } from "@/lib/productos";
import { Cajas, Categorias, MediosPago } from "./secciones";
import { Usuarios } from "./usuarios";
import { Cargos, type Cargo } from "./cargos";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfiguracionPage() {
  const ctx = await exigir("configurar");
  const { supabase, empresa, userId } = ctx;
  const [{ data: miembros }, { data: cajas }, { data: categorias }, { data: uso }, medios, { data: series }, { data: cargos }] = await Promise.all([
    supabase.from("miembros").select("user_id, rol, nombre, email, activo, cargo_id").eq("empresa_id", empresa.id).order("creado_en"),
    supabase.from("cajas").select("*").eq("empresa_id", empresa.id).order("orden"),
    supabase.from("categorias_gasto").select("*").eq("empresa_id", empresa.id).order("nombre"),
    supabase.rpc("uso_consultas_doc", { p_empresa: empresa.id }),
    cargarMediosPago(ctx, false),
    supabase.from("v_series_comprobante").select("tipo, serie, ultimo, siguiente").eq("empresa_id", empresa.id),
    supabase.from("cargos").select("id, nombre, rol, secciones, activo").eq("empresa_id", empresa.id).order("activo", { ascending: false }).order("creado_en"),
  ]);
  const listaCargos = (cargos ?? []) as Cargo[];
  const usuariosPorCargo: Record<string, number> = {};
  for (const m of miembros ?? []) if (m.cargo_id && m.activo) usuariosPorCargo[m.cargo_id] = (usuariosPorCargo[m.cargo_id] ?? 0) + 1;
  const consultas = (uso ?? {}) as { total?: number; empresa?: number; hoy?: number; guardados?: number };
  const usadas = Number(consultas.total ?? 0);
  const numeracion = (series ?? []) as { tipo: TipoComprobante; serie: string; ultimo: number; siguiente: string }[];

  return (
    <>
      <Encabezado titulo="Configuración" descripcion={<>Los productos y sus precios se gestionan en <Link href="/precios" className="text-marca-700 hover:underline">Productos y precios</Link>.</>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta>
          <TituloTarjeta>Empresa</TituloTarjeta>
          <div className="p-4">
            <FormularioAccion accion={guardarEmpresa} reiniciar={false} textoBoton="Guardar datos" mensajeExito="Datos de la empresa guardados.">
              <Campo etiqueta="Razón social"><Input name="razon_social" defaultValue={empresa.razon_social} required /></Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="RUC"><Input name="ruc" inputMode="numeric" maxLength={11} defaultValue={empresa.ruc ?? ""} /></Campo>
                <Campo etiqueta="Teléfono"><Input name="telefono" defaultValue={empresa.telefono ?? ""} /></Campo>
              </div>
              <Campo etiqueta="Dirección"><Input name="direccion" defaultValue={empresa.direccion ?? ""} /></Campo>
              <Campo etiqueta="Días para limpiar una compra" ayuda="Pasado este plazo, la compra aparece como «retrasada» en Limpieza.">
                <InputNumero name="dias_seleccion" defaultValue={String(empresa.dias_seleccion ?? 2)} inputMode="numeric" />
              </Campo>
              <Campo etiqueta="Merma alta desde (%)" ayuda="Una limpieza con más merma que este % se marca en rojo para que Gerencia la revise.">
                <InputNumero name="merma_alerta_pct" defaultValue={String(Number(empresa.merma_alerta_pct ?? 5))} />
              </Campo>
              <fieldset className="rounded-lg border border-stone-200 p-3">
                <legend className="px-1 text-sm font-medium text-stone-700">Personal: horas extras y domingos</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Jornada diaria (horas)"><InputNumero name="jornada_horas" min={1} max={24} step={0.5} defaultValue={String(Number(empresa.jornada_horas ?? 8))} /></Campo>
                  <Campo etiqueta="2 primeras horas extras (+%)"><InputNumero name="hx_tasa_primeras" min={0} max={300} defaultValue={String(Number(empresa.hx_tasa_primeras ?? 25))} /></Campo>
                  <Campo etiqueta="Horas extras siguientes (+%)"><InputNumero name="hx_tasa_siguientes" min={0} max={300} defaultValue={String(Number(empresa.hx_tasa_siguientes ?? 35))} /></Campo>
                  <Campo etiqueta="Domingo trabajado (+% del día)"><InputNumero name="domingo_tasa" min={0} max={300} defaultValue={String(Number(empresa.domingo_tasa ?? 100))} /></Campo>
                </div>
                <p className="mt-2 text-xs text-stone-500">Valores de ley usuales en Perú (25 %, 35 % y 100 % sin descanso sustitutorio). Confírmelos con su contador.</p>
              </fieldset>
              <Campo etiqueta="Exigir DNI/RUC desde (S/)" ayuda="Vacío = nunca obligatorio. Por confirmar con el cliente.">
                <InputNumero name="monto_doc_obligatorio" defaultValue={empresa.monto_doc_obligatorio ?? ""} />
              </Campo>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-stone-700">Niveles de acceso que pueden digitar un precio/kg distinto al del día</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(["dueno", "administrador", "cajero"] as const).map((r) => (
                    <label key={r} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        name={`precio_${r}`}
                        defaultChecked={empresa.roles_editan_precio.includes(r)}
                        disabled={r === "dueno"}
                        className="size-4 accent-marca-600"
                      />
                      {ETIQUETA_ROL[r]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </FormularioAccion>
          </div>
        </Tarjeta>

        <div className="space-y-4">
          <Tarjeta>
            <TituloTarjeta>Numeración de comprobantes de venta</TituloTarjeta>
            <div className="space-y-3 p-4">
              <p className="text-sm text-stone-600">
                Cada venta toma sola el siguiente número de su serie; en la venta ya no se escribe. Ponga el último número que
                ya emitió para seguir su numeración (0 si empieza de cero).
              </p>
              {numeracion.map((s) => (
                <FormularioAccion key={s.tipo} accion={guardarSerieComprobante} reiniciar={false} textoBoton="Guardar"
                  mensajeExito={`Numeración de ${COMPROBANTES[s.tipo].corto.toLowerCase()} guardada.`}
                  className="grid grid-cols-2 items-end gap-2 rounded-lg border border-stone-200 p-3 sm:grid-cols-[1fr_6rem_8rem_auto]">
                  <input type="hidden" name="tipo" value={s.tipo} />
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-sm font-semibold">{COMPROBANTES[s.tipo].texto}</p>
                    <p className="text-xs text-stone-500">Próximo: <span className="cifra font-medium text-stone-700">{s.siguiente}</span></p>
                  </div>
                  <Campo etiqueta="Serie"><Input name="serie" defaultValue={s.serie ?? ""} maxLength={6} autoCapitalize="characters" required /></Campo>
                  <Campo etiqueta="Último N° emitido"><InputNumero name="ultimo" inputMode="numeric" defaultValue={String(s.ultimo ?? 0)} /></Campo>
                </FormularioAccion>
              ))}
            </div>
          </Tarjeta>
          <Tarjeta>
            <TituloTarjeta accion={<Link href="/socios" className="text-xs font-medium text-marca-700">Abrir</Link>}>Socios del negocio</TituloTarjeta>
            <p className="flex items-start gap-3 p-4 text-sm text-stone-600">
              <Handshake className="mt-0.5 size-5 shrink-0 text-stone-400" />
              <span>Participación de cada socio, aportes, retiros y utilidad que le corresponde. Es información de la sociedad: solo la edita Gerencia.</span>
            </p>
          </Tarjeta>
          <Tarjeta>
            <TituloTarjeta>Consultas DNI / RUC (RENIEC y SUNAT)</TituloTarjeta>
            <div className="space-y-3 p-4 text-sm">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-stone-600">Consultas usadas</span>
                  <span className="cifra font-semibold">{usadas} <span className="font-normal text-stone-500">de 100 gratis</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                  <div className={cx("barra-crece h-full", usadas >= 90 ? "bg-red-500" : usadas >= 70 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, usadas)}%` }} />
                </div>
              </div>
              <p className="text-stone-500">
                Hoy: {Number(consultas.hoy ?? 0)} · Documentos guardados: {Number(consultas.guardados ?? 0)}. Solo se gasta una consulta al registrar un
                proveedor o cliente nuevo; si el documento ya se consultó o ya está registrado, se reutiliza sin costo.
              </p>
            </div>
          </Tarjeta>
        </div>
        <Cargos cargos={listaCargos} usuarios={usuariosPorCargo} />
        <Usuarios miembros={miembros ?? []} yo={userId} cargos={listaCargos} />
        <Cajas cajas={cajas ?? []} />
        <MediosPago medios={medios} cajas={cajas ?? []} />
        <Categorias categorias={categorias ?? []} />
      </div>
    </>
  );
}

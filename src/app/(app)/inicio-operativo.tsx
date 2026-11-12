import Link from "next/link";
import {
  ArrowRight, BarChart3, ChevronRight, ClipboardList, Contact, PackageCheck, Scale, Tag, Truck, Wallet,
} from "lucide-react";
import type { Contexto } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { fechaHora, hoyLima, kg, numero, soles } from "@/lib/formato";
import { rangoLima } from "@/components/filtros";
import { Aviso, PuntoMetal, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import { PanelModulo } from "@/components/panel-modulo";
import { rutaPermitida, TONOS, type Tono } from "@/components/shell/modulos";

interface Hoy {
  caja: number; hoy_compras_n: number; hoy_compras_kg: number; hoy_compras_importe: number;
  hoy_ventas_n: number; hoy_ventas_kg: number; ventas_pendientes: number;
}

interface DatosAcceso { href: string; texto: string; detalle: string; icono: typeof Scale; tono: Tono }

const fechaLarga = (iso: string) => {
  const s = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${iso}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Nueva compra: el acceso grande (lo primero que se toca en el mostrador), con el azul de marca */
function AccesoPrincipal({ href, texto, detalle, icono: Icono }: Omit<DatosAcceso, "tono">) {
  return (
    <Link
      href={href}
      className="group relative col-span-2 flex min-h-28 overflow-hidden rounded-2xl bg-gradient-to-br from-[#1f86d9] via-[#1a5ca8] to-[#0f2c50] p-5 text-white shadow-lg transition-[translate,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500 focus-visible:ring-offset-2 focus-visible:ring-offset-fondo active:scale-[0.99] lg:row-span-2 lg:min-h-0 lg:flex-col lg:p-6"
    >
      <div aria-hidden className="panel-orbe pointer-events-none absolute -bottom-24 -right-16 size-64 rounded-full bg-white/10" />
      <div aria-hidden className="panel-reflejo" />
      <span className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 lg:size-16">
        <Icono className="size-7 lg:size-8" />
      </span>
      <span className="relative ml-4 min-w-0 flex-1 self-center lg:ml-0 lg:mt-auto lg:self-stretch">
        <span className="block text-2xl font-bold tracking-tight lg:text-3xl">{texto}</span>
        <span className="block text-sm text-white/85">{detalle}</span>
        <span className="mt-4 hidden items-center gap-2 text-sm font-semibold lg:inline-flex">
          Empezar <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
        </span>
      </span>
      <ChevronRight className="relative size-6 shrink-0 self-center text-white/80 transition-transform group-hover:translate-x-0.5 lg:hidden" />
    </Link>
  );
}

/** Mosaico de cada acceso: ícono del color del módulo arriba, texto abajo */
function Acceso({ href, texto, detalle, icono: Icono, tono }: DatosAcceso) {
  const t = TONOS[tono];
  return (
    <Link
      href={href}
      className="group flex min-h-32 flex-col rounded-2xl border border-stone-200 bg-superficie p-4 shadow-sm transition-[translate,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500 active:scale-[0.98]"
    >
      <span className="flex items-start justify-between gap-2">
        <span className={cx("flex size-11 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110", t.chip)}>
          <Icono className="size-5" />
        </span>
        <ArrowRight className="size-4 text-stone-400 transition-[translate,color] duration-200 group-hover:translate-x-0.5 group-hover:text-stone-700" />
      </span>
      <span className="mt-auto pt-3">
        <span className="block font-semibold leading-tight text-stone-900">{texto}</span>
        <span className="mt-0.5 block text-xs leading-snug text-stone-600">{detalle}</span>
      </span>
    </Link>
  );
}

/** Inicio de Almacén, del balancero y de Administración: el trabajo del día, sin cifras de gestión. */
export async function InicioOperativo({ ctx }: { ctx: Contexto }) {
  const { supabase, empresa, rol, nombre, userId } = ctx;
  const hoy = hoyLima();
  const rango = rangoLima(hoy, hoy);
  const esBalancero = rol === "balancero";

  let misCompras = supabase.from("v_compras").select("id, numero, fecha, proveedor_nombre, metales, kg_total, total, estado")
    .eq("empresa_id", empresa.id).gte("fecha", rango.desde!).lt("fecha", rango.hasta!)
    .order("fecha", { ascending: false }).limit(6);
  if (esBalancero) misCompras = misCompras.eq("creado_por", userId);

  const [{ data: d }, { data: compras }, { data: productos }, { data: cajas }] = await Promise.all([
    esBalancero ? Promise.resolve({ data: null }) : supabase.rpc("dashboard", { p_empresa: empresa.id }),
    misCompras,
    supabase.from("v_productos").select("id, nombre, color, precio_compra, nivel, ruta, raiz_id, tiene_hijos")
      .eq("empresa_id", empresa.id).eq("activo", true).order("clave_orden"),
    puede(rol, "caja")
      ? supabase.from("v_saldo_caja").select("caja_id, nombre, saldo").eq("empresa_id", empresa.id).eq("activo", true).order("orden")
      : Promise.resolve({ data: null }),
  ]);
  const db = (d ?? {}) as Hoy;

  // Precios agrupados por familia (producto raíz): «Cobre» con Brillante, Quemado…; la familia sin variantes va sola
  const familias = (productos ?? []).filter((p) => p.nivel === 1).map((f) => ({
    ...f,
    items: (productos ?? []).filter((p) => p.raiz_id === f.id && p.nivel! > 1 && !p.tiene_hijos)
      .map((p) => ({ ...p, etiqueta: p.ruta!.split(" › ").slice(1).join(" › ") })),
  }));

  const totalCajas = (cajas ?? []).reduce((s, c) => s + Number(c.saldo), 0);
  const mayorCaja = Math.max(1, ...(cajas ?? []).map((c) => Math.abs(Number(c.saldo))));

  // ¿El cargo del usuario tiene esa pantalla? (Configuración → Cargos y permisos)
  const ve = (href: string) => rutaPermitida(href.split("?")[0], ctx.secciones);
  // Accesos según lo que puede cada rol (el mosaico de escritorio tiene 6 lugares junto a «Nueva compra»)
  const todos: DatosAcceso[] = [
    ...(puede(rol, "vender") ? [{ href: "/vender", texto: "Nueva venta", detalle: "Despachar a un cliente", icono: Truck, tono: "ventas" as const }] : []),
    ...(puede(rol, "caja") ? [{ href: "/caja", texto: "Caja", detalle: "Gastos, traspasos y arqueo", icono: Wallet, tono: "caja" as const }] : []),
    { href: `/compras?desde=${hoy}&hasta=${hoy}`, texto: esBalancero ? "Mis compras" : "Compras de hoy", detalle: "Ver y reimprimir tickets", icono: ClipboardList, tono: "compras" },
    puede(rol, "editarPrecios")
      ? { href: "/precios", texto: "Productos y precios", detalle: "Fijar los precios del día", icono: Tag, tono: "inventario" }
      : { href: "/precios", texto: "Precios del día", detalle: "Lo que pagamos por kilo", icono: Tag, tono: "inventario" },
    ...(puede(rol, "limpiar") && !esBalancero ? [{ href: "/limpieza", texto: "Limpieza", detalle: "Volver a pesar y separar", icono: PackageCheck, tono: "inventario" as const }] : []),
    ...(puede(rol, "verReportes") ? [{ href: "/reportes", texto: "Reportes", detalle: "Compras, ventas, stock y mermas", icono: BarChart3, tono: "gestion" as const }] : []),
    ...(puede(rol, "editarTerceros") ? [{ href: "/proveedores", texto: "Proveedores", detalle: "Buscar o registrar", icono: Contact, tono: "contactos" as const }] : []),
  ];
  const accesos = todos.filter((a) => ve(a.href));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-stone-600">Hola, <span className="font-medium text-stone-800">{nombre}</span></p>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">¿Qué vamos a hacer hoy?</h1>
        </div>
        <p className="rounded-full border border-stone-200 bg-superficie px-3 py-1 text-sm font-medium text-stone-700 shadow-sm">{fechaLarga(hoy)}</p>
      </div>

      {db.ventas_pendientes > 0 && puede(rol, "vender") && ve("/ventas") && (
        <div className="mb-4">
          <Aviso>
            Hay {db.ventas_pendientes} venta(s) esperando el pesaje del comprador.{" "}
            <Link href="/ventas?estado=pendiente" className="font-medium underline">Confirmar</Link>
          </Aviso>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5 lg:grid-rows-[repeat(2,minmax(8rem,auto))]">
        {ve("/comprar") && <AccesoPrincipal href="/comprar" texto="Nueva compra" detalle="Pesar y pagar al proveedor" icono={Scale} />}
        {accesos.map((a) => <Acceso key={a.href} {...a} />)}
      </div>

      {!esBalancero && (
        <PanelModulo
          tono="compras"
          etiqueta="Movimiento de hoy"
          principal={{ titulo: "Comprado hoy", valor: kg(db.hoy_compras_kg), detalle: `${numero(db.hoy_compras_n)} compra(s)`, href: ve("/compras") ? `/compras?desde=${hoy}&hasta=${hoy}` : undefined }}
          // Siempre 3 celdas (llenan la fila): Almacén ve la caja; Administración, las ventas por confirmar
          celdas={[
            { titulo: "Pagado hoy", valor: soles(db.hoy_compras_importe), detalle: "A proveedores" },
            { titulo: "Vendido hoy (salida)", valor: kg(db.hoy_ventas_kg), detalle: `${numero(db.hoy_ventas_n)} venta(s)` },
            puede(rol, "caja")
              ? { titulo: "En caja", valor: soles(db.caja), detalle: "Todas las cajas", href: ve("/caja") ? "/caja" : undefined }
              : { titulo: "Ventas por confirmar", valor: numero(db.ventas_pendientes), detalle: "Falta el pesaje", href: ve("/ventas") ? "/ventas?estado=pendiente" : undefined },
          ]}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta className="lg:col-span-2">
          <TituloTarjeta accion={<Link href="/precios" className="text-sm font-medium text-marca-700 hover:underline">Ver todos</Link>}>
            Precios de compra de hoy
          </TituloTarjeta>
          {familias.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">Aún no hay productos.</p>
          ) : (
            // Columnas tipo mosaico: cada familia con su alto (sin huecos junto a las que tienen más variantes)
            <div className="columns-1 gap-3 p-3 sm:columns-2 sm:p-4">
              {familias.map((f) => (
                <section key={f.id} className="mb-3 break-inside-avoid overflow-hidden rounded-xl border border-stone-200 last:mb-0">
                  <header className="flex items-center justify-between gap-2 bg-stone-50 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-stone-900">
                      <PuntoMetal color={f.color} /> <span className="truncate">{f.nombre}</span>
                    </span>
                    {Number(f.precio_compra) > 0 && (
                      <span className="cifra shrink-0 text-sm font-semibold text-stone-700">
                        {soles(f.precio_compra)}<span className="text-xs font-normal text-stone-500">/kg</span>
                      </span>
                    )}
                  </header>
                  {f.items.length > 0 && (
                    <ul className="divide-y divide-stone-100">
                      {f.items.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                          <span className="min-w-0 truncate text-sm text-stone-700">{p.etiqueta}</span>
                          <span className="cifra shrink-0 text-base font-bold text-stone-900">
                            {soles(p.precio_compra)}<span className="text-xs font-normal text-stone-500">/kg</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </Tarjeta>

        <div className="space-y-4">
          {cajas && (
            <Tarjeta>
              <TituloTarjeta accion={<span className="cifra text-sm font-semibold text-stone-900">{soles(totalCajas)}</span>}>Saldo por caja</TituloTarjeta>
              <ul className="space-y-3 px-4 py-3">
                {cajas.map((c) => (
                  <li key={c.caja_id}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate text-stone-700">{c.nombre}</span>
                      <span className={cx("cifra font-semibold", Number(c.saldo) < 0 ? "text-red-700" : "text-stone-900")}>{soles(c.saldo)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100">
                      <div className="barra-crece h-full rounded-full bg-marca-600" style={{ width: `${Math.max(2, (Math.abs(Number(c.saldo)) / mayorCaja) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          <Tarjeta>
            <TituloTarjeta accion={(compras ?? []).length > 0 && ve("/compras") && (
              <Link href={`/compras?desde=${hoy}&hasta=${hoy}`} className="text-sm font-medium text-marca-700 hover:underline">Ver todas</Link>
            )}>
              {esBalancero ? "Mis compras de hoy" : "Últimas compras de hoy"}
            </TituloTarjeta>
            {(compras ?? []).length === 0 ? (
              <div className="flex flex-col items-center px-4 py-8 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-sky-50 text-sky-700"><ClipboardList className="size-6" /></span>
                <p className="mt-3 text-sm font-medium text-stone-800">Todavía no hay compras hoy</p>
                <p className="text-xs text-stone-500">La primera que registre aparecerá aquí.</p>
                {ve("/comprar") && <Link href="/comprar" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-marca-700 hover:underline">
                  Registrar compra <ArrowRight className="size-4" />
                </Link>}
              </div>
            ) : (
              <ul className="filas-entran divide-y divide-stone-100">
                {(compras ?? []).map((c) => (
                  <li key={c.id}>
                    <Link href={`/compras/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-marca-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">#{c.numero} · {c.proveedor_nombre ?? "Sin documento"}</span>
                        <span className="block truncate text-xs text-stone-500">{fechaHora(c.fecha)} · {c.metales}</span>
                      </span>
                      <span className={cx("cifra shrink-0 text-right", c.estado === "anulada" && "text-stone-500 line-through")}>
                        {soles(c.total)}<span className="block text-xs text-stone-500">{kg(c.kg_total)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>
      </div>
    </>
  );
}

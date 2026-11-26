import type { Metadata } from "next";
import { exigir } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { fecha, soles } from "@/lib/formato";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/basicos";
import { TablaDatos } from "@/components/ui/tabla";
import { Pestanas } from "@/components/ui/pestanas";
import { PanelModulo } from "@/components/panel-modulo";
import { MenuMaquina, NuevaMaquina, type Maquina } from "./formularios";
import { ESTADOS } from "./datos";

export const metadata: Metadata = { title: "Maquinaria" };

/** Inventario de máquinas, vehículos y herramientas, con lo gastado e ingresado en cada una (de v_maquinas) */
export default async function MaquinariaPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const { supabase, empresa, rol } = await exigir("maquinaria");
  const tab = ["todas", "operativo", "en_reparacion", "de_baja"].includes(sp.tab ?? "") ? sp.tab! : "todas";

  const [{ data }, { data: cajas }] = await Promise.all([
    supabase.from("v_maquinas").select("*").eq("empresa_id", empresa.id).order("nombre"),
    supabase.from("v_saldo_caja").select("caja_id, nombre, saldo, activo").eq("empresa_id", empresa.id).order("orden"),
  ]);
  const maquinas = data ?? [];
  const filas = tab === "todas" ? maquinas.filter((m) => m.estado !== "de_baja") : maquinas.filter((m) => m.estado === tab);
  const enUso = maquinas.filter((m) => m.estado !== "de_baja");
  const suma = (xs: typeof maquinas, k: "valor_compra" | "gastos" | "ingresos") => xs.reduce((a, m) => a + Math.round(Number(m[k] ?? 0) * 100), 0) / 100;
  const cuenta = (e: string) => maquinas.filter((m) => m.estado === e).length;
  const listaCajas = (cajas ?? []).filter((c) => c.activo).map((c) => ({ id: c.caja_id!, nombre: c.nombre!, saldo: String(c.saldo) }));
  const puedeEditar = puede(rol, "editarMaquinaria");
  const puedeMover = puede(rol, "moverMaquinaria");
  const puedeFecha = rol === "dueno" || rol === "administrador";

  return (
    <>
      <Encabezado
        titulo="Maquinaria"
        descripcion="Máquinas, vehículos y herramientas del negocio, con lo que se gasta e ingresa en cada una"
        acciones={puedeEditar ? <NuevaMaquina cajas={listaCajas} /> : undefined}
      />

      <PanelModulo
        tono="caja"
        etiqueta="Maquinaria · en uso"
        principal={{
          titulo: "Máquinas en uso", valor: String(enUso.reduce((a, m) => a + Number(m.cantidad ?? 1), 0)),
          detalle: `${cuenta("operativo")} operativa(s) · ${cuenta("en_reparacion")} en reparación`,
        }}
        celdas={[
          { titulo: "Valor de compra", valor: soles(suma(enUso, "valor_compra")), detalle: "Lo que costaron las que están en uso" },
          { titulo: "Gastado en ellas", valor: soles(suma(maquinas, "gastos")), detalle: "Reparaciones, combustible, repuestos…" },
          { titulo: "Ingresos", valor: soles(suma(maquinas, "ingresos")), detalle: "Alquileres, ventas…" },
        ]}
      />

      <Pestanas
        base="/maquinaria"
        actual={tab}
        opciones={[
          { valor: "todas", texto: "En uso", cantidad: enUso.length },
          { valor: "operativo", texto: "Operativas", cantidad: cuenta("operativo") },
          { valor: "en_reparacion", texto: "En reparación", cantidad: cuenta("en_reparacion") },
          { valor: "de_baja", texto: "De baja", cantidad: cuenta("de_baja") },
        ]}
      />

      <Tarjeta>
        <TablaDatos
          filas={filas}
          clave={(m) => m.id!}
          enlace={(m) => `/maquinaria/${m.id}`}
          vacio={tab === "todas" ? "Todavía no hay máquinas. Use «Nueva máquina» para registrar la primera." : "Ninguna máquina en este estado."}
          columnas={[
            {
              titulo: "Máquina", principal: true,
              celda: (m) => (
                <span className="min-w-0">
                  <span className="font-medium">{m.nombre}</span>
                  {Number(m.cantidad) > 1 && <span className="text-stone-500"> × {m.cantidad}</span>}
                  <span className="block text-xs text-stone-500">{[m.tipo, m.marca, m.modelo].filter(Boolean).join(" · ")}</span>
                </span>
              ),
            },
            { titulo: "Serie / placa", ocultarMovil: true, celda: (m) => m.serie ?? <span className="text-stone-400">—</span> },
            { titulo: "Estado", celda: (m) => <Insignia tono={ESTADOS[m.estado!]?.tono ?? "gris"}>{ESTADOS[m.estado!]?.texto ?? m.estado}</Insignia> },
            {
              titulo: "Compra", alinear: "der",
              celda: (m) => m.valor_compra != null
                ? <span className="cifra">{soles(m.valor_compra)}{m.fecha_adquisicion && <span className="block text-xs text-stone-500">{fecha(`${m.fecha_adquisicion}T12:00:00-05:00`)}</span>}</span>
                : <span className="text-stone-400">—</span>,
            },
            { titulo: "Gastos", alinear: "der", principal: true, celda: (m) => <span className="cifra">{soles(m.gastos)}</span> },
            { titulo: "Ingresos", alinear: "der", celda: (m) => <span className="cifra">{soles(m.ingresos)}</span> },
            { titulo: "Ubicación", ocultarMovil: true, celda: (m) => [m.ubicacion, m.responsable].filter(Boolean).join(" · ") || <span className="text-stone-400">—</span> },
            {
              titulo: "",
              celda: (m) => (
                <MenuMaquina m={m as unknown as Maquina} cajas={listaCajas} puedeEditar={puedeEditar} puedeMover={puedeMover} puedeFecha={puedeFecha} />
              ),
            },
          ]}
        />
      </Tarjeta>
    </>
  );
}

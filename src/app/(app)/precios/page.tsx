import type { Metadata } from "next";
import { obtenerContexto } from "@/lib/contexto";
import { puede } from "@/lib/permisos";
import { cargarProductos, cargarUnidades } from "@/lib/productos";
import { Encabezado, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { TablaPrecios } from "./tabla-precios";
import { HistorialPrecios, type CambioPrecio } from "./historial-precios";

export const metadata: Metadata = { title: "Productos y precios" };

export default async function PreciosPage() {
  const ctx = await obtenerContexto();
  const { supabase, empresa, rol } = ctx;
  const editable = puede(rol, "editarPrecios");
  const [productos, { data: historico }, unidades] = await Promise.all([
    cargarProductos(ctx, false),
    supabase.from("precios_metal").select("id, fecha, metal_id, precio_compra, precio_mayorista, precio_venta, metal:metales(nombre, color, unidad)")
      .eq("empresa_id", empresa.id).order("fecha", { ascending: false }).limit(60),
    cargarUnidades(ctx),
  ]);

  return (
    <>
      <Encabezado
        titulo="Productos y precios"
        descripcion={editable
          ? "Familia → producto → variante: cada nivel tiene su código, su precio y su stock. Cada cambio de precio queda en el histórico."
          : "Precios vigentes de compra (minorista y mayorista) y de venta por kg."}
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <TablaPrecios
            // Se remonta cuando cambian los datos guardados, para no quedar con valores viejos
            key={productos.map((m) => `${m.id}:${m.precio_compra}:${m.precio_mayorista}:${m.precio_venta}:${m.activo}:${m.padre_id}:${m.unidad}`).join("|")}
            productos={productos}
            editable={editable}
            unidades={unidades}
          />
        </div>
        {/* Se estira al alto de la tabla de productos; el histórico ocupa ese alto */}
        <Tarjeta className="flex min-w-0 flex-col xl:col-span-2">
          <TituloTarjeta>Histórico de cambios</TituloTarjeta>
          <div className="relative min-h-[28rem] flex-1">
          <div className="absolute inset-0">
          <HistorialPrecios cambios={(historico ?? []).map((h): CambioPrecio => {
            const m = h.metal as unknown as { nombre: string; color: string | null; unidad: string } | null;
            return {
              id: h.id, fecha: h.fecha, metal_id: h.metal_id, nombre: m?.nombre ?? "—", color: m?.color ?? null, unidad: m?.unidad ?? "kg",
              precio_compra: String(h.precio_compra), precio_mayorista: h.precio_mayorista != null ? String(h.precio_mayorista) : null,
              precio_venta: String(h.precio_venta),
            };
          })} />
          </div>
          </div>
        </Tarjeta>
      </div>
    </>
  );
}

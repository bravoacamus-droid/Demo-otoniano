"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Campo, Input, InputNumero } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { Boton } from "@/components/ui/boton";
import type { Producto } from "@/lib/tipos";
import { unidadCorta } from "@/lib/formato";
import type { UnidadMedida } from "@/lib/productos";
import { cambiarEstadoMetal, guardarMetal } from "./acciones";
import { SelectorPadre } from "./selector-padre";

const COLORES = ["#c2621f", "#b8862e", "#9ca3af", "#57534e", "#0f766e", "#7c3aed", "#be123c", "#2563eb"];

/** Alta/edición de un producto en cualquier nivel de la jerarquía */
export function FormMetal({ producto, padreId, productos, unidades, onListo }: {
  producto: Producto | null;
  padreId: string | null;
  productos: Producto[];
  /** Unidades activas (Configuración) */
  unidades: UnidadMedida[];
  onListo: () => void;
}) {
  const router = useRouter();
  const padre = productos.find((p) => p.id === padreId) ?? null;
  const [padreSel, setPadreSel] = useState(padreId ?? "");
  const [color, setColor] = useState(producto?.color ?? padre?.color ?? COLORES[0]);
  // Una variante nueva hereda la unidad de su familia; se puede cambiar (baterías por unidad, cobre por kg)
  const [unidad, setUnidad] = useState(producto?.unidad ?? padre?.unidad ?? "kg");
  const u = unidadCorta(unidad);
  // Un producto no puede ir dentro de sí mismo ni de sus variantes
  const prohibidos = new Set(producto ? productos.filter((p) => p.ruta === producto.ruta || p.ruta.startsWith(`${producto.ruta} › `)).map((p) => p.id) : []);
  const base = producto ?? padre;

  return (
    <div className="space-y-4">
      <FormularioAccion accion={guardarMetal} mensajeExito={producto ? "Producto actualizado." : "Producto creado."} onExito={onListo}
        textoBoton={producto ? "Guardar cambios" : "Crear producto"}>
        {producto && <input type="hidden" name="id" value={producto.id} />}
        <input type="hidden" name="color" value={color} />
        {/* div y no <label> (Campo): dentro de un label, tocar la lista vuelve a activar el botón */}
        <div className="min-w-0">
          <span className="mb-1 block text-sm font-medium text-stone-700">Dentro de</span>
          <SelectorPadre name="padre_id" valor={padreSel} onCambio={setPadreSel} productos={productos.filter((p) => !prohibidos.has(p.id))} />
          <span className="mt-1 block text-xs text-stone-500">Familia = primer nivel. Una variante puede tener sus propias variantes.</span>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Campo etiqueta="Nombre"><Input name="nombre" defaultValue={producto?.nombre ?? ""} required placeholder={padre ? `Ej.: ${padre.nombre} limpio` : "Ej.: Cobre"} /></Campo>
          <Campo etiqueta="Código"><Input name="codigo" defaultValue={producto?.codigo ?? ""} placeholder="CU-01" className="uppercase" /></Campo>
        </div>
        <div className="min-w-0">
          <span id="etiqueta-unidad" className="mb-1.5 block text-sm font-medium text-stone-700">Unidad de medida</span>
          <input type="hidden" name="unidad" value={unidad} />
          <div role="radiogroup" aria-labelledby="etiqueta-unidad" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {/* La del producto aunque esté desactivada en Configuración, para no perderla al editar */}
            {[...unidades, ...(unidades.some((x) => x.codigo === unidad) ? [] : [{ id: unidad, codigo: unidad, nombre: unidad }])].map((d) => {
              const v = d.codigo;
              const activo = unidad === v;
              return (
                <button key={v} type="button" role="radio" aria-checked={activo} onClick={() => setUnidad(v)}
                  className={`rounded-xl border px-2 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-500 ${
                    activo ? "border-marca-600 bg-marca-600 text-white shadow-sm" : "border-stone-200 bg-superficie text-stone-700 hover:border-marca-300 hover:bg-marca-50"}`}>
                  <span className="cifra block text-base font-bold leading-tight">{d.codigo}</span>
                  <span className={`block text-[11px] leading-tight ${activo ? "text-white/85" : "text-stone-500"}`}>{d.nombre}</span>
                </button>
              );
            })}
          </div>
          <span className="mt-1.5 block text-xs text-stone-500">Cómo se compra y vende: por peso o por cantidad. Stock y precios se llevan en esta unidad.</span>
        </div>
        {/* Unidad una sola vez arriba: etiquetas cortas que no saltan de línea y campos alineados */}
        <div className="space-y-3 border-t border-stone-200 pt-4">
        <p className="text-sm font-semibold text-stone-800">Precios en S/ por {u}</p>
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
          <Campo etiqueta="Compra"><InputNumero name="precio_compra" defaultValue={base?.precio_compra ?? ""} /></Campo>
          <Campo etiqueta="Mayorista"><InputNumero name="precio_mayorista" defaultValue={base?.precio_mayorista ?? ""} placeholder="= compra" /></Campo>
          <Campo etiqueta="Venta"><InputNumero name="precio_venta" defaultValue={base?.precio_venta ?? ""} /></Campo>
          <Campo etiqueta="Orden"><Input name="orden" type="number" defaultValue={producto?.orden ?? 0} /></Campo>
        </div>
        <p className="text-xs text-stone-500">Al mayorista se le paga su propio precio (no es un % automático). Vacío = el mismo que el minorista.</p>
        </div>
        <div className="border-t border-stone-200 pt-4">
          <span className="mb-1 block text-sm font-medium text-stone-700">Color de etiqueta</span>
          <div className="flex flex-wrap gap-2">
            {COLORES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`size-8 rounded-full ring-offset-2 ${color === c ? "ring-2 ring-stone-900" : ""}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>
      </FormularioAccion>
      {producto && (
        <Boton
          variante="fantasma"
          className="w-full"
          onClick={async () => {
            await cambiarEstadoMetal(producto.id, !producto.activo);
            router.refresh();
            onListo();
          }}
        >
          {producto.activo ? "Desactivar producto" : "Activar producto"}
        </Boton>
      )}
    </div>
  );
}

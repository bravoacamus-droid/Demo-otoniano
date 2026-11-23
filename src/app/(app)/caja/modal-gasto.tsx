"use client";

import { useState } from "react";
import { Paperclip, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Campo, Input, InputNumero } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { cx } from "@/components/ui/clases";
import { subirArchivo } from "@/lib/archivos";
import { SelectorOrigenDinero, claseFicha as ficha } from "@/components/selector-origen-dinero";
import { registrarGasto } from "./acciones";

type Caja = { id: string; nombre: string; saldo: string; tipo?: string | null };


/** Registrar gasto: en qué se gastó (categoría u «Otro») y de dónde salió (una caja o ninguna) */
export function ModalGasto({ abierto, onCerrar, empresaId, cajas, categorias, puedeCrearCategoria }: {
  abierto: boolean; onCerrar: () => void; empresaId: string; cajas: Caja[];
  categorias: { id: string; nombre: string }[]; puedeCrearCategoria: boolean;
}) {
  const [categoria, setCategoria] = useState("");
  const [origen, setOrigen] = useState(cajas[0]?.id ?? "ninguna");
  const [comprobante, setComprobante] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const sinCaja = origen === "ninguna";
  const cerrar = () => { setCategoria(""); setOrigen(cajas[0]?.id ?? "ninguna"); setComprobante(""); onCerrar(); };

  return (
    <Modal abierto={abierto} onCerrar={cerrar} titulo="Registrar gasto">
      <FormularioAccion accion={registrarGasto} textoBoton={sinCaja ? "Guardar gasto (no sale de caja)" : "Registrar gasto"}
        mensajeExito={sinCaja ? "Gasto anotado. No se descontó de ninguna caja." : "Gasto registrado."} onExito={cerrar}>
        <Campo etiqueta="Monto S/"><InputNumero name="monto" required autoFocus /></Campo>

        <div>
          <p id="etq-categoria" className="mb-1.5 text-sm font-medium text-stone-700">¿En qué se gastó?</p>
          <input type="hidden" name="categoria_id" value={categoria} />
          <div role="radiogroup" aria-labelledby="etq-categoria" className="flex flex-wrap gap-2">
            {categorias.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={categoria === c.id} onClick={() => setCategoria(c.id)}
                className={cx(ficha(categoria === c.id), "rounded-full px-3.5 py-1.5")}>{c.nombre}</button>
            ))}
            <button type="button" role="radio" aria-checked={categoria === "otro"} onClick={() => setCategoria("otro")}
              className={cx(ficha(categoria === "otro"), "inline-flex items-center gap-1.5 rounded-full border-dashed px-3.5 py-1.5")}>
              <Pencil className="size-3.5" /> Otro gasto
            </button>
          </div>
        </div>
        {categoria === "otro" && (
          <div className="space-y-2 rounded-xl border border-marca-200 bg-marca-50/60 p-3">
            <Campo etiqueta="Escriba en qué se gastó"><Input name="otro" required minLength={3} placeholder="Ej.: Herramientas, Detergente, Llaves" /></Campo>
            {puedeCrearCategoria && (
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input type="checkbox" name="guardar_categoria" className="size-4 accent-marca-600" />
                Guardarlo como categoría para la próxima vez
              </label>
            )}
          </div>
        )}
        <Campo etiqueta="Detalle (opcional)"><Input name="concepto" placeholder="Ej.: gasolina para las 2 motos" /></Campo>

        <SelectorOrigenDinero cajas={cajas} valor={origen} onCambio={setOrigen} />

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2.5 text-sm text-stone-600 hover:border-marca-300">
          <Paperclip className="size-4 shrink-0" />
          <span className="truncate">{subiendo ? "Subiendo…" : comprobante ? "Comprobante adjunto ✓" : "Adjuntar comprobante (opcional)"}</span>
          <input type="file" accept="image/*,application/pdf" className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setSubiendo(true);
              try { setComprobante(await subirArchivo(empresaId, "gastos", f)); } finally { setSubiendo(false); }
            }} />
        </label>
        <input type="hidden" name="comprobante_url" value={comprobante} />
      </FormularioAccion>
    </Modal>
  );
}

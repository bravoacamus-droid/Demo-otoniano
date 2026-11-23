"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Insignia, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, Select } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { Modal } from "@/components/ui/modal";
import type { MedioPagoConf } from "@/lib/tipos";
import type { UnidadMedida } from "@/lib/productos";
import { cambiarEstado, guardarCaja, guardarCategoria, guardarMedioPago, guardarUnidad } from "./acciones";

type CajaFila = { id: string; nombre: string; tipo: string; orden: number; activo: boolean };

export function Cajas({ cajas }: { cajas: CajaFila[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<CajaFila | "nueva" | null>(null);
  const actual = editando === "nueva" ? null : editando;
  return (
    <Tarjeta>
      <TituloTarjeta accion={<Boton tamano="sm" variante="secundario" onClick={() => setEditando("nueva")}><Plus className="size-4" /> Caja</Boton>}>
        Cajas
      </TituloTarjeta>
      <ul className="divide-y divide-stone-100">
        {cajas.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <button onClick={() => setEditando(c)} className={`truncate text-left font-medium hover:underline ${c.activo ? "" : "text-stone-400"}`}>{c.nombre}</button>
            <div className="flex items-center gap-3">
              <Insignia>{c.tipo === "efectivo" ? "Efectivo" : c.tipo === "banco" ? "Banco" : "Billetera"}</Insignia>
              <button onClick={async () => { await cambiarEstado("cajas", c.id, !c.activo); router.refresh(); }} className="text-xs font-medium text-stone-600 hover:text-stone-900">
                {c.activo ? "Desactivar" : "Activar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Modal abierto={editando !== null} onCerrar={() => setEditando(null)} titulo={actual ? "Editar caja" : "Nueva caja"}>
        <FormularioAccion accion={guardarCaja} onExito={() => setEditando(null)} textoBoton="Guardar" mensajeExito="Caja guardada.">
          {actual && <input type="hidden" name="id" value={actual.id} />}
          <Campo etiqueta="Nombre"><Input name="nombre" defaultValue={actual?.nombre ?? ""} required /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Tipo">
              <Select name="tipo" defaultValue={actual?.tipo ?? "efectivo"}>
                <option value="efectivo">Efectivo</option>
                <option value="banco">Banco</option>
                <option value="billetera">Billetera (Yape/Plin)</option>
              </Select>
            </Campo>
            <Campo etiqueta="Orden"><Input name="orden" type="number" defaultValue={actual?.orden ?? 0} /></Campo>
          </div>
        </FormularioAccion>
      </Modal>
    </Tarjeta>
  );
}

export function Categorias({ categorias }: { categorias: { id: string; nombre: string; activo: boolean }[] }) {
  const router = useRouter();
  return (
    <Tarjeta>
      <TituloTarjeta>Categorías de gasto</TituloTarjeta>
      <div className="flex flex-wrap gap-2 p-4">
        {categorias.map((c) => (
          <button
            key={c.id}
            onClick={async () => { await cambiarEstado("categorias_gasto", c.id, !c.activo); router.refresh(); }}
            title={c.activo ? "Clic para desactivar" : "Clic para activar"}
            className={`rounded-full border px-3 py-1 text-sm ${c.activo ? "border-stone-300 bg-superficie" : "border-dashed border-stone-300 text-stone-500 line-through"}`}
          >
            {c.nombre}
          </button>
        ))}
        <p className="w-full text-xs text-stone-500">Toque una categoría para activarla o desactivarla (las tachadas están desactivadas).</p>
      </div>
      <div className="border-t border-stone-100 p-4">
        {/* El aviso de error ocupa su propia fila debajo (no aplasta el campo) */}
        <FormularioAccion accion={guardarCategoria} textoBoton="Agregar" mensajeExito="Categoría lista. Si estaba desactivada, se volvió a activar."
          className="grid grid-cols-[1fr_auto] items-end gap-2 [&>.animar-sacudir]:order-last [&>.animar-sacudir]:col-span-2">
          <Campo etiqueta="Nueva categoría"><Input name="nombre" required placeholder="Ej.: Herramientas" /></Campo>
        </FormularioAccion>
      </div>
    </Tarjeta>
  );
}

const TIPOS_MEDIO = [["efectivo", "Efectivo"], ["yape", "Yape"], ["plin", "Plin"], ["transferencia", "Transferencia / depósito"]] as const;

/** Medios de pago editables: nombre, tipo base y la caja que usa por defecto */
export function MediosPago({ medios, cajas }: { medios: MedioPagoConf[]; cajas: CajaFila[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<MedioPagoConf | "nuevo" | null>(null);
  const actual = editando === "nuevo" ? null : editando;
  const cajaDe = (id: string | null) => cajas.find((c) => c.id === id)?.nombre ?? "Sin caja fija";
  return (
    <Tarjeta>
      <TituloTarjeta accion={<Boton tamano="sm" variante="secundario" onClick={() => setEditando("nuevo")}><Plus className="size-4" /> Medio</Boton>}>
        Medios de pago
      </TituloTarjeta>
      <ul className="divide-y divide-stone-100">
        {medios.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <button onClick={() => setEditando(m)} className={`min-w-0 text-left hover:underline ${m.activo ? "" : "text-stone-400"}`}>
              <span className="block truncate font-medium">{m.nombre}</span>
              <span className="block truncate text-xs text-stone-500">{cajaDe(m.caja_id)}</span>
            </button>
            <div className="flex items-center gap-3">
              <Insignia>{TIPOS_MEDIO.find(([v]) => v === m.tipo)?.[1] ?? m.tipo}</Insignia>
              <button onClick={async () => { await cambiarEstado("medios_pago", m.id, !m.activo); router.refresh(); }} className="text-xs font-medium text-stone-600 hover:text-stone-900">
                {m.activo ? "Desactivar" : "Activar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Al elegir el medio en una compra o venta se propone su caja.</p>
      <Modal abierto={editando !== null} onCerrar={() => setEditando(null)} titulo={actual ? "Editar medio de pago" : "Nuevo medio de pago"}>
        <FormularioAccion accion={guardarMedioPago} onExito={() => setEditando(null)} textoBoton="Guardar" mensajeExito="Medio de pago guardado.">
          {actual && <input type="hidden" name="id" value={actual.id} />}
          <Campo etiqueta="Nombre" ayuda="Ej.: Yape Jorge, BCP, Interbank"><Input name="nombre" defaultValue={actual?.nombre ?? ""} required /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Tipo">
              <Select name="tipo" defaultValue={actual?.tipo ?? "efectivo"}>
                {TIPOS_MEDIO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta="Orden"><Input name="orden" type="number" defaultValue={actual?.orden ?? 0} /></Campo>
          </div>
          <Campo etiqueta="Caja que usa">
            <Select name="caja_id" defaultValue={actual?.caja_id ?? ""}>
              <option value="">Sin caja fija (se elige al registrar)</option>
              {cajas.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Campo>
        </FormularioAccion>
      </Modal>
    </Tarjeta>
  );
}

/** Unidades de medida de los productos: se editan nombre y plural; se agregan nuevas (saco, rollo…) */
export function UnidadesMedida({ unidades }: { unidades: UnidadMedida[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<UnidadMedida | "nueva" | null>(null);
  const actual = editando === "nueva" ? null : editando;
  return (
    <Tarjeta>
      <TituloTarjeta accion={<Boton tamano="sm" variante="secundario" onClick={() => setEditando("nueva")}><Plus className="size-4" /> Unidad</Boton>}>
        Unidades de medida
      </TituloTarjeta>
      <ul className="divide-y divide-stone-100">
        {unidades.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-3">
              <span className={`cifra flex h-8 min-w-12 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-bold ${u.activo ? "bg-marca-50 text-marca-700" : "bg-stone-100 text-stone-400"}`}>{u.codigo}</span>
              <span className="min-w-0">
                <span className={`block truncate font-medium ${u.activo ? "" : "text-stone-400 line-through"}`}>{u.nombre}</span>
                {u.plural && u.plural !== u.codigo && <span className="block truncate text-xs text-stone-500">Ej.: 3 {u.plural}</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <button type="button" onClick={() => setEditando(u)} className="text-xs font-medium text-marca-700 hover:underline">Editar</button>
              {u.codigo !== "kg" && (
                <button type="button" onClick={async () => { await cambiarEstado("unidades_medida", u.id, !u.activo); router.refresh(); }}
                  className="text-xs font-medium text-stone-600 hover:text-stone-900">
                  {u.activo ? "Desactivar" : "Activar"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Se eligen al crear o editar un producto. Desactivar una unidad solo la oculta de esa lista.</p>
      <Modal abierto={editando !== null} onCerrar={() => setEditando(null)} titulo={actual ? `Editar unidad · ${actual.codigo}` : "Nueva unidad de medida"}>
        <FormularioAccion accion={guardarUnidad} onExito={() => setEditando(null)} textoBoton="Guardar" mensajeExito="Unidad guardada.">
          {actual && <input type="hidden" name="id" value={actual.id} />}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Nombre" ayuda="Ej.: Sacos"><Input name="nombre" defaultValue={actual?.nombre ?? ""} required /></Campo>
            {actual
              ? <Campo etiqueta="Abreviatura" ayuda="No se cambia: la usan los productos."><Input value={actual.codigo} disabled /></Campo>
              : <Campo etiqueta="Abreviatura" ayuda="Va junto a la cantidad: «12 saco»."><Input name="codigo" required maxLength={8} placeholder="saco" className="lowercase" /></Campo>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Plural (opcional)" ayuda="Ej.: sacos"><Input name="plural" defaultValue={actual?.plural ?? ""} /></Campo>
            <Campo etiqueta="Orden"><Input name="orden" type="number" defaultValue={actual?.orden ?? unidades.length + 1} /></Campo>
          </div>
        </FormularioAccion>
      </Modal>
    </Tarjeta>
  );
}

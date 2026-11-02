"use client";

import { useMemo, useState } from "react";
import { Plus, UserRound, X } from "lucide-react";
import { crearProveedor } from "@/app/(app)/proveedores/acciones";
import { Insignia } from "@/components/ui/basicos";
import { Modal } from "@/components/ui/modal";
import { Combobox } from "@/components/ui/combobox";
import { filtrarPorTexto } from "@/lib/buscar";
import { FormProveedor } from "@/components/form-proveedor";
import { ETIQUETA_CLASE } from "@/lib/formato";
import type { Proveedor } from "@/lib/tipos";

/**
 * Lista desplegable con todos los proveedores que se filtra al escribir las primeras letras del
 * nombre (o el DNI/RUC, que pocas veces se recuerda). Si no existe, se registra en el mismo modal.
 */
export function SelectorProveedor({
  valor, onCambio, proveedores,
}: { valor: Proveedor | null; onCambio: (p: Proveedor | null) => void; proveedores: Proveedor[] }) {
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const [nuevos, setNuevos] = useState<Proveedor[]>([]);

  const todos = useMemo(() => [...nuevos, ...proveedores], [nuevos, proveedores]);
  const filtrados = useMemo(() => filtrarPorTexto(todos, q, (p) => p.nombre, (p) => p.nro_doc), [todos, q]);

  if (valor) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-marca-200 bg-marca-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserRound className="size-5 shrink-0 text-marca-700" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-medium">
              {valor.nombre}
              <Insignia tono={valor.clase === "mayorista" ? "azul" : "gris"}>{ETIQUETA_CLASE[valor.clase] ?? "Minorista"}</Insignia>
            </p>
            <p className="text-xs text-stone-600">{valor.nro_doc ? `${valor.tipo_doc} ${valor.nro_doc}` : "Sin documento"}</p>
          </div>
        </div>
        <button type="button" onClick={() => onCambio(null)} className="rounded-md p-1.5 text-stone-500 hover:bg-superficie" aria-label="Quitar proveedor">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Combobox
        etiqueta="Proveedor"
        q={q}
        onQ={setQ}
        items={filtrados}
        total={todos.length}
        clave={(p) => p.id}
        onElegir={(p) => { onCambio(p); setQ(""); }}
        placeholder="Escriba el nombre o elija de la lista"
        fila={(p) => (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.nombre}</span>
              <span className="cifra block text-xs text-stone-500">{p.nro_doc ? `${p.tipo_doc} ${p.nro_doc}` : "Sin documento"}</span>
            </span>
            {p.clase === "mayorista" && <Insignia tono="azul">Mayorista</Insignia>}
          </>
        )}
        vacio={
          <>
            {todos.length === 0 ? "Aún no hay proveedores." : "Sin resultados."}{" "}
            <button type="button" className="font-medium text-marca-700" onClick={() => setModal(true)}>Registrar nuevo</button>
          </>
        }
      />
      <button
        type="button"
        onClick={() => setModal(true)}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-stone-300 bg-superficie px-3 text-sm font-medium hover:bg-stone-50"
      >
        <Plus className="size-4" /> Nuevo
      </button>
      <Modal abierto={modal} onCerrar={() => setModal(false)} titulo="Nuevo proveedor">
        <FormProveedor
          accion={crearProveedor}
          inicial={/^\d{8}$/.test(q.trim()) ? { tipo_doc: "DNI", nro_doc: q.trim() } : /^\d{11}$/.test(q.trim()) ? { tipo_doc: "RUC", nro_doc: q.trim() } : { nombre: q.trim() }}
          onExito={(p) => { setNuevos((n) => [p as Proveedor, ...n]); onCambio(p as Proveedor); setModal(false); setQ(""); }}
        />
      </Modal>
    </div>
  );
}

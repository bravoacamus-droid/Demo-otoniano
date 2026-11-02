"use client";

import { useMemo, useState } from "react";
import { Building2, X } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { filtrarPorTexto } from "@/lib/buscar";
import type { Comprador } from "@/lib/tipos";

/**
 * Elige el cliente (comprador) de una venta: lista con todos que se filtra por razón social, RUC o
 * persona de contacto. Empieza vacío para que no se registre una venta al cliente equivocado.
 */
export function SelectorCliente({ valor, onCambio, clientes }: {
  valor: Comprador | null; onCambio: (c: Comprador | null) => void; clientes: Comprador[];
}) {
  const [q, setQ] = useState("");
  const filtrados = useMemo(() => filtrarPorTexto(clientes, q, (c) => c.razon_social, (c) => c.ruc, (c) => c.contacto), [clientes, q]);

  if (valor) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-marca-200 bg-marca-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Building2 className="size-5 shrink-0 text-marca-700" />
          <div className="min-w-0">
            <p className="truncate font-medium">{valor.razon_social}</p>
            <p className="cifra truncate text-xs text-stone-600">{valor.ruc ? `RUC ${valor.ruc}` : "Sin RUC"}{valor.contacto && ` · ${valor.contacto}`}</p>
          </div>
        </div>
        <button type="button" onClick={() => onCambio(null)} className="rounded-md p-2 text-stone-500 hover:bg-superficie" aria-label="Quitar cliente">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <Combobox
      etiqueta="Cliente"
      q={q}
      onQ={setQ}
      items={filtrados}
      total={clientes.length}
      clave={(c) => c.id}
      onElegir={(c) => { onCambio(c); setQ(""); }}
      placeholder="Escriba la razón social o RUC, o elija de la lista"
      fila={(c) => (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{c.razon_social}</span>
          <span className="cifra block truncate text-xs text-stone-500">{c.ruc ? `RUC ${c.ruc}` : "Sin RUC"}{c.contacto && ` · ${c.contacto}`}</span>
        </span>
      )}
      vacio="Ningún cliente coincide. Regístrelo en Contactos › Clientes."
    />
  );
}

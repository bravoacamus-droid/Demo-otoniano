"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { EditarCargo, pantallasDe, type Cargo } from "./cargos";

/** Qué ve en el sistema quien tiene ese cargo, con el botón para cambiarlo ahí mismo */
export function PermisosCargo({ cargo }: { cargo: Cargo }) {
  const [editando, setEditando] = useState(false);
  const grupos = pantallasDe(cargo);
  return (
    <div className="rounded-lg border border-marca-200 bg-marca-50/60 p-3 text-sm">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-marca-800"><ShieldCheck className="size-4" /> Con el cargo «{cargo.nombre}» puede ver:</p>
        <button type="button" onClick={() => setEditando(true)}
          className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-marca-700 hover:bg-marca-100">Cambiar permisos</button>
      </div>
      {grupos === null ? (
        <p className="text-stone-700">Todo el sistema (nivel Gerencia).</p>
      ) : grupos.length === 0 ? (
        <p className="text-stone-700">Solo el Inicio.</p>
      ) : (
        <ul className="space-y-0.5 text-xs text-stone-700">
          {grupos.map((g) => <li key={g.modulo}><b className="font-semibold">{g.modulo}:</b> {g.pantallas.join(", ")}</li>)}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] text-stone-500">Los permisos son del cargo: si los cambia, cambian para todos los que tienen «{cargo.nombre}».</p>
      {/* Fuera del formulario del trabajador (no se anidan formularios) y sin que su envío llegue a él */}
      {editando && createPortal(
        <div onSubmit={(e) => e.stopPropagation()}><EditarCargo cargo={cargo} onCerrar={() => setEditando(false)} /></div>,
        document.body,
      )}
    </div>
  );
}


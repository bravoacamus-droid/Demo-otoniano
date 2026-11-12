"use client";

import { useState } from "react";
import { ChevronRight, Plus, ShieldCheck } from "lucide-react";
import { Insignia, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, Select } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { Modal } from "@/components/ui/modal";
import { MODULOS, visible, type SubItem } from "@/components/shell/modulos";
import { ETIQUETA_ROL } from "@/lib/formato";
import type { Rol } from "@/lib/tipos";
import { guardarCargo } from "./acciones";

export type Cargo = { id: string; nombre: string; rol: Rol; secciones: string[] | null; activo: boolean };

const NIVELES: { rol: Rol; texto: string; ayuda: string }[] = [
  { rol: "cajero", texto: "Almacén (básico)", ayuda: "Compras, ventas, limpieza y caja del día" },
  { rol: "administrador", texto: "Administración (intermedio)", ayuda: "Además corrige tickets; productos, precios, contactos, créditos y reportes" },
  { rol: "dueno", texto: "Gerencia (acceso total)", ayuda: "Todo, incluido capital, socios, personal y configuración" },
];

// Pantallas que se pueden marcar, agrupadas por módulo (Inicio siempre se ve)
const GRUPOS = MODULOS.filter((m) => m.id !== "inicio");
const posibles = (rol: Rol) => GRUPOS.flatMap((m) => m.items).filter((i) => visible(rol, i)).map((i) => i.href);
/** Nivel más bajo que deja entrar a una pantalla */
const nivelMinimo = (i: SubItem) => (["cajero", "administrador", "dueno"] as Rol[]).find((r) => visible(r, i)) ?? "dueno";

/** Cuántas pantallas tiene el cargo, para la lista */
function resumen(c: Cargo) {
  if (c.rol === "dueno") return "Acceso total";
  const total = posibles(c.rol);
  const n = c.secciones ? c.secciones.filter((h) => total.includes(h)).length : total.length;
  return n === total.length ? "Todas las pantallas de su nivel" : `${n} de ${total.length} pantallas`;
}

/** Cargos de la empresa: Gerencia elige a qué pantallas entra cada uno. El usuario toma el cargo en «Usuarios». */
export function Cargos({ cargos, usuarios }: { cargos: Cargo[]; usuarios: Record<string, number> }) {
  const [editando, setEditando] = useState<Cargo | "nuevo" | null>(null);
  return (
    <Tarjeta>
      <TituloTarjeta accion={<Boton tamano="sm" variante="secundario" onClick={() => setEditando("nuevo")}><Plus className="size-4" /> Cargo</Boton>}>
        Cargos y permisos
      </TituloTarjeta>
      <p className="px-4 pt-3 text-sm text-stone-600">
        Toque un cargo para elegir a qué pantallas entra. A cada usuario se le asigna su cargo en «Usuarios» y solo ve lo marcado.
      </p>
      <ul className="divide-y divide-stone-100">
        {cargos.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setEditando(c)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-marca-50 focus-visible:bg-marca-50 focus-visible:outline-none">
              <span className="min-w-0">
                <span className={`block truncate font-medium ${c.activo ? "" : "text-stone-500"}`}>{c.nombre}</span>
                <span className="block truncate text-xs text-stone-500">{resumen(c)} · {usuarios[c.id] ?? 0} usuario{(usuarios[c.id] ?? 0) === 1 ? "" : "s"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {!c.activo && <Insignia>Inactivo</Insignia>}
                <Insignia tono={c.rol === "dueno" ? "marca" : undefined}>{ETIQUETA_ROL[c.rol]}</Insignia>
                <ChevronRight aria-hidden className="size-4 text-stone-400" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editando && <EditarCargo cargo={editando === "nuevo" ? null : editando} onCerrar={() => setEditando(null)} />}
    </Tarjeta>
  );
}

function EditarCargo({ cargo, onCerrar }: { cargo: Cargo | null; onCerrar: () => void }) {
  const [rol, setRol] = useState<Rol>(cargo?.rol ?? "cajero");
  // Marcadas: arrancan como estaban (null = todas); al cambiar de nivel se conservan las que sigan permitidas
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(cargo?.secciones ?? posibles(cargo?.rol ?? "cajero")),
  );
  const permitidas = new Set(posibles(rol));
  const cuantas = [...marcadas].filter((h) => permitidas.has(h)).length;
  const alternar = (href: string, si: boolean) => setMarcadas((m) => { const n = new Set(m); if (si) n.add(href); else n.delete(href); return n; });
  const todas = (si: boolean) => setMarcadas(si ? new Set(permitidas) : new Set());
  const cambiarNivel = (nuevo: Rol) => {
    // Si tenía todo marcado, sigue con todo al subir de nivel (las pantallas que se abren quedan marcadas)
    if (cuantas === permitidas.size) setMarcadas(new Set(posibles(nuevo)));
    setRol(nuevo);
  };

  return (
    <Modal abierto onCerrar={onCerrar} titulo={cargo ? `Editar cargo · ${cargo.nombre}` : "Nuevo cargo"} ancho="max-w-2xl">
      <FormularioAccion accion={guardarCargo} onExito={onCerrar} textoBoton="Guardar cargo"
        mensajeExito="Cargo guardado. Los usuarios con este cargo verán el cambio al abrir otra pantalla o recargar.">
        {cargo && <input type="hidden" name="id" value={cargo.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre del cargo"><Input name="nombre" required defaultValue={cargo?.nombre} placeholder="Ej.: Balanza, Chofer" autoFocus={!cargo} /></Campo>
          <Campo etiqueta="Nivel de acceso" ayuda={NIVELES.find((n) => n.rol === rol)?.ayuda}>
            <Select name="rol" value={rol} onChange={(e) => cambiarNivel(e.target.value as Rol)}>
              {NIVELES.map((n) => <option key={n.rol} value={n.rol}>{n.texto}</option>)}
            </Select>
          </Campo>
        </div>

        {rol === "dueno" ? (
          <p className="flex items-start gap-2 rounded-lg bg-marca-50 px-3 py-2 text-sm text-marca-800">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" /> Nivel Gerencia: entra a todas las pantallas, incluidas Configuración y Capital. Déselo solo a personas de confianza.
          </p>
        ) : (
          <fieldset className="space-y-3">
            <legend className="sr-only">¿A qué pantallas puede entrar?</legend>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p aria-hidden className="text-sm font-medium text-stone-700">¿A qué pantallas puede entrar?</p>
              <span className="flex items-center gap-1 text-sm sm:text-xs">
                <span aria-live="polite" className="mr-1 text-stone-500">{cuantas} de {permitidas.size} marcadas</span>
                <button type="button" onClick={() => todas(true)} className="rounded px-2 py-1.5 font-medium text-marca-700 hover:bg-marca-50">Marcar todas</button>
                <button type="button" onClick={() => todas(false)} className="rounded px-2 py-1.5 font-medium text-stone-600 hover:bg-stone-100">Quitar todas</button>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {GRUPOS.map((m) => (
                <fieldset key={m.id} className="rounded-lg border border-stone-200 p-3">
                  <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    <m.icono className="size-3.5" /> {m.texto}
                  </legend>
                  <ul className="space-y-0.5">
                    {m.items.map((i) => {
                      const puede = permitidas.has(i.href);
                      return (
                        <li key={i.href}>
                          <label className={`flex min-h-9 items-center gap-2 py-1 text-sm ${puede ? "cursor-pointer" : "text-stone-500"}`}>
                            <input type="checkbox" name="seccion" value={i.href} disabled={!puede}
                              checked={puede && marcadas.has(i.href)} onChange={(e) => alternar(i.href, e.target.checked)}
                              className="size-4 accent-marca-600" />
                            {i.texto}
                            {!puede && <span className="text-xs">(solo {ETIQUETA_ROL[nivelMinimo(i)]})</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ))}
            </div>
            <p className="text-xs text-stone-500">Inicio siempre se ve. Las pantallas en gris necesitan un nivel de acceso más alto.</p>
          </fieldset>
        )}

        {cargo && (
          <Campo etiqueta="Estado">
            <Select name="activo" defaultValue={cargo.activo ? "on" : "off"}>
              <option value="on">Activo</option>
              <option value="off">Inactivo (ya no se puede asignar)</option>
            </Select>
          </Campo>
        )}
      </FormularioAccion>
    </Modal>
  );
}

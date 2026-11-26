"use client";

import { useState } from "react";
import { Ban, History, Lock, LockOpen, Pencil } from "lucide-react";
import { cx } from "@/components/ui/clases";
import { MenuPuntos, opcionMenu } from "@/components/ui/menu-puntos";
import { Modal } from "@/components/ui/modal";
import { Aviso } from "@/components/ui/basicos";
import { Campo, Input, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { fechaHora, soles } from "@/lib/formato";
import type { Resultado } from "@/lib/tipos";
import {
  anularGasto, anularGastoSinCaja, anularMovimientoManual, anularTurno, corregirApertura, corregirCierre, editarGasto, editarMovimientoManual,
} from "./acciones";

type Opcion = { id: string; nombre: string };
/** Corrección anterior guardada en `historial` (valores de antes, quién no: solo cuándo y por qué) */
type Cambio = { fecha: string; razon: string; que?: string; monto?: string | number; contado_apertura?: string | number; contado_cierre?: string | number };

const claseRojo = `${opcionMenu} text-red-700 hover:bg-red-50`;

export function ModalAnular({ id, accion, titulo, explicacion, abierto, onCerrar }: {
  id: string; accion: (p: Resultado | null, fd: FormData) => Promise<Resultado>; titulo: string; explicacion?: string;
  abierto: boolean; onCerrar: () => void;
}) {
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={titulo}>
      <FormularioAccion accion={accion} textoBoton="Confirmar anulación" variante="peligro"
        mensajeExito="Anulado. Queda en el historial con su motivo." onExito={onCerrar}>
        <input type="hidden" name="id" value={id} />
        {explicacion && <Aviso>{explicacion}</Aviso>}
        <Campo etiqueta="Motivo"><Textarea name="motivo" required minLength={3} placeholder="Ej.: se registró dos veces" /></Campo>
      </FormularioAccion>
    </Modal>
  );
}

function CampoRazon() {
  return (
    <Campo etiqueta="¿Por qué se corrige?" ayuda="Queda en el historial junto con el valor anterior.">
      <Input name="razon" required minLength={3} placeholder="Ej.: monto mal digitado" />
    </Campo>
  );
}

function Historial({ cambios, campo }: { cambios: Cambio[]; campo: "monto" | "contado_apertura" | "contado_cierre" }) {
  if (!cambios.length) return null;
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
      <p className="mb-1 inline-flex items-center gap-1 font-medium text-stone-700"><History className="size-3.5" /> Correcciones anteriores</p>
      <ul className="space-y-0.5">
        {cambios.map((c, i) => <li key={i}>{fechaHora(c.fecha)} · antes {soles(c[campo])} · {c.razon}</li>)}
      </ul>
    </div>
  );
}

export type Manual = {
  id: string; tipo: string; clase: string; caja_id: string; monto: string; motivo: string; persona: string | null; historial: Cambio[];
};

/** Ingreso/salida de dinero o préstamo: Gerencia y Administración lo corrigen o anulan */
export function MenuManual({ m, cajas }: { m: Manual; cajas: Opcion[] }) {
  const [modal, setModal] = useState<"editar" | "anular" | null>(null);
  const cerrar = () => setModal(null);
  const prestamo = m.clase === "prestamo";
  return (
    <>
      <MenuPuntos etiqueta="Opciones del movimiento" alto={100}>
        {(c) => (
          <>
            <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("editar"); }}>
              <Pencil className="size-4 text-stone-500" /> Corregir
            </button>
            <button type="button" role="menuitem" className={claseRojo} onClick={() => { c(); setModal("anular"); }}>
              <Ban className="size-4" /> Anular
            </button>
          </>
        )}
      </MenuPuntos>
      <Modal abierto={modal === "editar"} onCerrar={cerrar} titulo={`Corregir ${m.tipo === "ingreso" ? "ingreso" : "salida"} de dinero`}>
        <FormularioAccion accion={editarMovimientoManual} textoBoton="Guardar corrección" mensajeExito="Corrección guardada." onExito={cerrar} reiniciar={false}>
          <input type="hidden" name="id" value={m.id} />
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Monto S/"><InputNumero name="monto" required defaultValue={m.monto} /></Campo>
            <Campo etiqueta="Caja">
              <Select name="caja_id" required defaultValue={m.caja_id}>{cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select>
            </Campo>
          </div>
          {prestamo && <Campo etiqueta="Persona"><Input name="persona" required defaultValue={m.persona ?? ""} /></Campo>}
          <Campo etiqueta="Motivo"><Input name="motivo" required defaultValue={m.motivo} /></Campo>
          <CampoRazon />
          <Historial cambios={m.historial} campo="monto" />
        </FormularioAccion>
      </Modal>
      <ModalAnular id={m.id} accion={anularMovimientoManual} titulo="Anular movimiento" abierto={modal === "anular"} onCerrar={cerrar}
        explicacion={`El dinero ${m.tipo === "ingreso" ? "sale" : "vuelve"} de la caja y el movimiento queda tachado en el historial.`} />
    </>
  );
}

export type GastoFila = {
  id: string; monto: string; concepto: string; categoria_id: string | null; caja_id: string | null; historial: Cambio[];
};

/** Gasto con caja o de solo registro (caja_id null) */
export function MenuGasto({ g, cajas, categorias }: { g: GastoFila; cajas: Opcion[]; categorias: Opcion[] }) {
  const [modal, setModal] = useState<"editar" | "anular" | null>(null);
  const cerrar = () => setModal(null);
  const sinCaja = !g.caja_id;
  return (
    <>
      <MenuPuntos etiqueta={`Opciones de ${g.concepto}`} alto={100}>
        {(c) => (
          <>
            <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("editar"); }}>
              <Pencil className="size-4 text-stone-500" /> Corregir
            </button>
            <button type="button" role="menuitem" className={claseRojo} onClick={() => { c(); setModal("anular"); }}>
              <Ban className="size-4" /> Anular
            </button>
          </>
        )}
      </MenuPuntos>
      <Modal abierto={modal === "editar"} onCerrar={cerrar} titulo={sinCaja ? "Corregir registro" : "Corregir gasto"}>
        <FormularioAccion accion={editarGasto} textoBoton="Guardar corrección" mensajeExito="Corrección guardada." onExito={cerrar} reiniciar={false}>
          <input type="hidden" name="id" value={g.id} />
          {sinCaja && <input type="hidden" name="sin_caja" value="1" />}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Monto S/"><InputNumero name="monto" required defaultValue={g.monto} /></Campo>
            <Campo etiqueta="Categoría">
              <Select name="categoria_id" defaultValue={g.categoria_id ?? ""}>
                <option value="">—</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Select>
            </Campo>
          </div>
          <Campo etiqueta="Concepto"><Input name="concepto" required defaultValue={g.concepto} /></Campo>
          {!sinCaja && (
            <Campo etiqueta="Sale de la caja">
              <Select name="caja_id" required defaultValue={g.caja_id ?? ""}>{cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select>
            </Campo>
          )}
          <CampoRazon />
          <Historial cambios={g.historial} campo="monto" />
        </FormularioAccion>
      </Modal>
      <ModalAnular id={g.id} accion={sinCaja ? anularGastoSinCaja : anularGasto} titulo={sinCaja ? "Anular registro" : "Anular gasto"}
        abierto={modal === "anular"} onCerrar={cerrar}
        explicacion={sinCaja ? undefined : "El dinero vuelve a la caja y el gasto queda tachado en el historial."} />
    </>
  );
}

export type TurnoFila = {
  id: string; numero: number; caja_nombre: string;
  contado_apertura: string; nota_apertura: string | null; saldo_apertura: string;
  cerrado_en: string | null; contado_cierre: string | null; nota_cierre: string | null; saldo_cierre: string | null; ajustado: boolean;
  historial: Cambio[];
};

/**
 * Botón «Editar» de un turno de caja: corregir lo contado al abrir o al cerrar (motivo obligatorio, queda en el
 * historial) o anular el turno. Visible en el historial, en Cierres y en el aviso de caja abierta.
 */
export function EditarTurno({ t, parte = "apertura", compacto = false }: { t: TurnoFila; parte?: "apertura" | "cierre"; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [pestana, setPestana] = useState<"apertura" | "cierre">(parte);
  const [anular, setAnular] = useState(false);
  const cerrado = !!t.cerrado_en;
  const cambios = (q: "apertura" | "cierre") => t.historial.filter((c) => (c.que ?? "apertura") === q);
  const abrir = () => { setPestana(cerrado ? parte : "apertura"); setAbierto(true); };

  return (
    <>
      <button type="button" onClick={abrir} title={`Editar turno N° ${t.numero}`}
        className={cx("inline-flex items-center gap-1 rounded-md font-medium text-marca-700 hover:bg-marca-50", compacto ? "px-1.5 py-1 text-xs" : "px-2 py-1 text-sm")}>
        <Pencil className="size-3.5" /> Editar
      </button>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Turno N° ${t.numero} · ${t.caja_nombre}`}>
        <div className="space-y-4">
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1">
            {(["apertura", "cierre"] as const).map((p) => {
              const Icono = p === "apertura" ? LockOpen : Lock;
              const deshabilitada = p === "cierre" && !cerrado;
              return (
                <button key={p} type="button" role="tab" aria-selected={pestana === p} disabled={deshabilitada} onClick={() => setPestana(p)}
                  className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
                    pestana === p ? "bg-superficie text-marca-700 shadow-sm" : "text-stone-600 hover:text-stone-900")}>
                  <Icono className="size-4" /> {p === "apertura" ? "Apertura" : cerrado ? "Cierre" : "Cierre (aún abierta)"}
                </button>
              );
            })}
          </div>

          {pestana === "apertura" ? (
            <FormularioAccion key="apertura" accion={corregirApertura} textoBoton="Guardar corrección" mensajeExito="Apertura corregida." onExito={() => setAbierto(false)} reiniciar={false}>
              <input type="hidden" name="id" value={t.id} />
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-marca-50 p-3 text-sm">
                <span className="text-stone-600">Contado al abrir<b className="cifra block text-base text-stone-900">{soles(t.contado_apertura)}</b></span>
                <span className="text-stone-600">Según el sistema<b className="cifra block text-base text-stone-900">{soles(t.saldo_apertura)}</b></span>
              </div>
              <p className="text-xs text-stone-500">La apertura no mueve dinero: solo corrige lo que se anotó como contado.</p>
              <Campo etiqueta="Efectivo al abrir S/ (correcto)"><InputNumero name="contado" required defaultValue={t.contado_apertura} /></Campo>
              <Campo etiqueta="Nota (opcional)"><Input name="nota" defaultValue={t.nota_apertura ?? ""} /></Campo>
              <CampoRazon />
              <Historial cambios={cambios("apertura")} campo="contado_apertura" />
            </FormularioAccion>
          ) : (
            <FormularioAccion key="cierre" accion={corregirCierre} textoBoton="Guardar corrección" mensajeExito="Cierre corregido." onExito={() => setAbierto(false)} reiniciar={false}>
              <input type="hidden" name="id" value={t.id} />
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-marca-50 p-3 text-sm">
                <span className="text-stone-600">Contado al cerrar<b className="cifra block text-base text-stone-900">{soles(t.contado_cierre)}</b></span>
                <span className="text-stone-600">Según el sistema<b className="cifra block text-base text-stone-900">{soles(t.saldo_cierre)}</b></span>
              </div>
              {t.ajustado && <Aviso>Este cierre ajustó la caja a lo contado: al corregirlo, el ajuste se rehace con la diferencia nueva.</Aviso>}
              <Campo etiqueta="Efectivo al cerrar S/ (correcto)"><InputNumero name="contado" required defaultValue={t.contado_cierre ?? ""} /></Campo>
              <Campo etiqueta="Nota (opcional)"><Input name="nota" defaultValue={t.nota_cierre ?? ""} /></Campo>
              <CampoRazon />
              <Historial cambios={cambios("cierre")} campo="contado_cierre" />
            </FormularioAccion>
          )}

          <div className="border-t border-stone-200 pt-3">
            <button type="button" onClick={() => { setAbierto(false); setAnular(true); }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline">
              <Ban className="size-4" /> Anular este turno (si se abrió por error)
            </button>
          </div>
        </div>
      </Modal>
      <ModalAnular id={t.id} accion={anularTurno} titulo={`Anular turno N° ${t.numero} · ${t.caja_nombre}`}
        abierto={anular} onCerrar={() => setAnular(false)}
        explicacion="El turno queda anulado (tachado) y la caja se puede volver a abrir. La apertura no movió dinero; si el cierre ajustó la caja, ese ajuste también se anula." />
    </>
  );
}


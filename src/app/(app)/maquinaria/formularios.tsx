"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Eye, Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/basicos";
import { Campo, Input, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { MenuPuntos, opcionMenu } from "@/components/ui/menu-puntos";
import { cx } from "@/components/ui/clases";
import { Portal } from "@/components/ui/portal";
import { hoyLima, soles } from "@/lib/formato";
import { anularGasto, anularGastoSinCaja, anularMovimientoManual } from "../caja/acciones";
import { ModalAnular } from "../caja/menus-caja";
import { guardarMaquina, registrarMovimientoMaquina } from "./acciones";
import { CATEGORIAS, ESTADOS, TIPOS } from "./datos";

// Maquinaria (llamada del 26/11): fichas de máquinas, vehículos y herramientas y su dinero.
// Los gastos/ingresos son gastos e ingresos de Caja marcados con la máquina (la BD los registra).

type Caja = { id: string; nombre: string; saldo: string };
export type Maquina = {
  id: string; nombre: string; tipo: string; marca: string | null; modelo: string | null; serie: string | null; cantidad: number;
  fecha_adquisicion: string | null; valor_compra: string | null; estado: string; ubicacion: string | null;
  responsable: string | null; notas: string | null;
};


/** Crear o editar una máquina */
export function ModalMaquina({ abierto, onCerrar, m, cajas }: {
  abierto: boolean; onCerrar: () => void;
  /** Sin máquina = nueva */
  m?: Maquina;
  cajas: Caja[];
}) {
  const [pago, setPago] = useState<"no" | "caja" | "fuera">("no");
  const [estado, setEstado] = useState(m?.estado ?? "operativo");
  const nueva = !m;
  const daDeBaja = !nueva && estado === "de_baja" && m.estado !== "de_baja";
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={nueva ? "Nueva máquina" : `Editar · ${m.nombre}`} ancho="max-w-xl">
      <FormularioAccion accion={guardarMaquina} textoBoton={nueva ? "Guardar máquina" : "Guardar cambios"}
        mensajeExito={nueva ? "Máquina registrada." : "Cambios guardados."} onExito={onCerrar} reiniciar={nueva}>
        {m && <input type="hidden" name="id" value={m.id} />}
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Campo etiqueta="Nombre"><Input name="nombre" required defaultValue={m?.nombre} placeholder="Ej.: Moto carguera roja" /></Campo>
          <Campo etiqueta="Tipo">
            <Input name="tipo" required list="tipos-maquina" defaultValue={m?.tipo ?? ""} placeholder="Vehículo, balanza…" autoComplete="off" />
            <datalist id="tipos-maquina">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Marca"><Input name="marca" defaultValue={m?.marca ?? ""} /></Campo>
          <Campo etiqueta="Modelo"><Input name="modelo" defaultValue={m?.modelo ?? ""} /></Campo>
          <Campo etiqueta="Serie o placa" className="col-span-2 sm:col-span-1"><Input name="serie" defaultValue={m?.serie ?? ""} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Cantidad"><Input name="cantidad" type="number" min={1} required defaultValue={m?.cantidad ?? 1} /></Campo>
          <Campo etiqueta="Fecha de compra"><Input name="fecha_adquisicion" type="date" max={hoyLima()} defaultValue={m?.fecha_adquisicion ?? ""} /></Campo>
          <Campo etiqueta="Valor de compra S/" className="col-span-2 sm:col-span-1"><InputNumero name="valor_compra" defaultValue={m?.valor_compra ?? ""} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Ubicación"><Input name="ubicacion" defaultValue={m?.ubicacion ?? ""} placeholder="Ej.: patio, almacén" /></Campo>
          <Campo etiqueta="Responsable"><Input name="responsable" defaultValue={m?.responsable ?? ""} placeholder="Quién la usa o cuida" /></Campo>
        </div>
        {!nueva && (
          <Campo etiqueta="Estado">
            <Select name="estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
              {Object.entries(ESTADOS).map(([v, e]) => <option key={v} value={v}>{e.texto}</option>)}
            </Select>
          </Campo>
        )}
        <Campo etiqueta="Notas (opcional)"><Textarea name="notas" defaultValue={m?.notas ?? ""} placeholder="Ej.: capacidad 500 kg, mantenimiento cada 3 meses" /></Campo>

        {nueva ? (
          <fieldset className="space-y-2 rounded-lg border border-stone-200 p-3">
            <legend className="px-1 text-sm font-medium text-stone-700">¿Registrar lo que costó?</legend>
            <div role="radiogroup" aria-label="Pago de la compra" className="grid grid-cols-3 gap-1 rounded-xl bg-stone-200/70 p-1">
              {([["no", "No (ya la teníamos)"], ["caja", "Salió de caja"], ["fuera", "Pagado por fuera"]] as const).map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={pago === v} onClick={() => setPago(v)}
                  className={cx("rounded-lg px-2 py-1.5 text-xs font-medium sm:text-sm", pago === v ? "bg-superficie shadow-sm" : "text-stone-600 hover:text-stone-900")}>
                  {t}
                </button>
              ))}
            </div>
            <input type="hidden" name="pago" value={pago} />
            {/* Campo y textos siempre presentes (ocultos si no aplican): el cuadro no cambia de alto al elegir */}
            <div className={cx(pago !== "caja" && "invisible")} aria-hidden={pago !== "caja"}>
              <Campo etiqueta="Sale de la caja">
                <Select name="caja_id" required={pago === "caja"} disabled={pago !== "caja"}>
                  {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {soles(c.saldo)}</option>)}
                </Select>
              </Campo>
            </div>
            <p className="grid text-xs text-stone-500">
              {([
                ["caja", "El valor de compra sale de la caja y queda como gasto «Maquinaria» del mes."],
                ["fuera", "Queda anotado como «solo registro»: no mueve la caja ni la ganancia."],
                ["no", "Solo se registra la máquina; su valor queda como dato."],
              ] as const).map(([v, t]) => (
                <span key={v} className={cx("col-start-1 row-start-1", pago !== v && "invisible")} aria-hidden={pago !== v}>{t}</span>
              ))}
            </p>
          </fieldset>
        ) : (
          <Campo etiqueta={daDeBaja ? "¿Por qué se da de baja? (obligatorio)" : "¿Qué se cambió? (opcional)"}
            ayuda="Queda en el historial de la máquina junto con los datos anteriores.">
            <Input name="razon" required={daDeBaja} placeholder={daDeBaja ? "Ej.: se vendió, malograda sin arreglo" : "Ej.: cambio de responsable"} />
          </Campo>
        )}
      </FormularioAccion>
    </Modal>
  );
}

/** Gasto (de una caja o pagado por fuera) o ingreso (a una caja) de una máquina */
export function ModalMovimiento({ abierto, onCerrar, maquina, tipo, cajas, puedeFecha }: {
  abierto: boolean; onCerrar: () => void; maquina: { id: string; nombre: string }; tipo: "gasto" | "ingreso";
  cajas: Caja[];
  /** Gerencia y Administración ponen la fecha real; Almacén registra con la hora actual */
  puedeFecha: boolean;
}) {
  const gasto = tipo === "gasto";
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={`${gasto ? "Gasto" : "Ingreso"} · ${maquina.nombre}`}>
      <FormularioAccion accion={registrarMovimientoMaquina} textoBoton={gasto ? "Registrar gasto" : "Registrar ingreso"}
        mensajeExito={gasto ? "Gasto registrado." : "Ingreso registrado."} onExito={onCerrar}>
        <input type="hidden" name="maquina_id" value={maquina.id} />
        <input type="hidden" name="tipo" value={tipo} />
        <Campo etiqueta={gasto ? "¿En qué se gastó?" : "¿De qué es el ingreso?"}>
          <Input name="categoria" required list={`categorias-${tipo}`} autoComplete="off" placeholder={gasto ? "Reparación, combustible…" : "Alquiler, venta…"} />
          <datalist id={`categorias-${tipo}`}>{CATEGORIAS[tipo].map((c) => <option key={c} value={c} />)}</datalist>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Monto S/"><InputNumero name="monto" required /></Campo>
          <Campo etiqueta={gasto ? "¿De dónde salió?" : "Entra a la caja"}>
            <Select name="caja_id" required>
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {soles(c.saldo)}</option>)}
              {gasto && <option value="fuera">Pagado por fuera (solo registro)</option>}
            </Select>
          </Campo>
        </div>
        {puedeFecha && <Campo etiqueta="Fecha"><Input name="fecha" type="date" defaultValue={hoyLima()} max={hoyLima()} /></Campo>}
        <Campo etiqueta="Detalle (opcional)"><Input name="detalle" placeholder={gasto ? "Ej.: cambio de aceite y filtro" : "Ej.: alquiler a vecino por 2 días"} /></Campo>
        <Aviso tono="azul">
          {gasto
            ? "Sale de la caja como gasto «Maquinaria» (se ve en Caja → Gastos). «Pagado por fuera» solo lo anota."
            : "Entra a la caja como ingreso de dinero y se ve en Caja → Movimientos."}
        </Aviso>
      </FormularioAccion>
    </Modal>
  );
}

/** Botón «Nueva máquina» del encabezado */
export function NuevaMaquina({ cajas }: { cajas: Caja[] }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton onClick={() => setAbierto(true)}><Plus className="size-4" /> Nueva máquina</Boton>
      <ModalMaquina abierto={abierto} onCerrar={() => setAbierto(false)} cajas={cajas} />
    </>
  );
}

/** Botones de la ficha: editar, registrar gasto e ingreso */
export function AccionesFicha({ m, cajas, puedeEditar, puedeMover, puedeFecha }: {
  m: Maquina; cajas: Caja[]; puedeEditar: boolean; puedeMover: boolean; puedeFecha: boolean;
}) {
  const [modal, setModal] = useState<"editar" | "gasto" | "ingreso" | null>(null);
  const cerrar = () => setModal(null);
  return (
    <>
      {puedeMover && <Boton variante="secundario" onClick={() => setModal("gasto")}><ArrowUpCircle className="size-4" /> Registrar gasto</Boton>}
      {puedeMover && <Boton variante="secundario" onClick={() => setModal("ingreso")}><ArrowDownCircle className="size-4" /> Registrar ingreso</Boton>}
      {puedeEditar && <Boton variante="secundario" onClick={() => setModal("editar")}><Pencil className="size-4" /> Editar</Boton>}
      {puedeEditar && <ModalMaquina key={JSON.stringify(m)} abierto={modal === "editar"} onCerrar={cerrar} m={m} cajas={cajas} />}
      {puedeMover && (
        <>
          <ModalMovimiento abierto={modal === "gasto"} onCerrar={cerrar} maquina={m} tipo="gasto" cajas={cajas} puedeFecha={puedeFecha} />
          <ModalMovimiento abierto={modal === "ingreso"} onCerrar={cerrar} maquina={m} tipo="ingreso" cajas={cajas} puedeFecha={puedeFecha} />
        </>
      )}
    </>
  );
}

/** ⋮ de cada máquina en la lista */
export function MenuMaquina({ m, cajas, puedeEditar, puedeMover, puedeFecha }: {
  m: Maquina; cajas: Caja[]; puedeEditar: boolean; puedeMover: boolean; puedeFecha: boolean;
}) {
  const [modal, setModal] = useState<"editar" | "gasto" | "ingreso" | null>(null);
  const cerrar = () => setModal(null);
  return (
    <>
      <MenuPuntos etiqueta={`Opciones de ${m.nombre}`} alto={170}>
        {(c) => (
          <>
            <Link role="menuitem" href={`/maquinaria/${m.id}`} className={opcionMenu} onClick={c}>
              <Eye className="size-4 text-stone-500" /> Ver ficha e historial
            </Link>
            {puedeMover && m.estado !== "de_baja" && (
              <>
                <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("gasto"); }}>
                  <ArrowUpCircle className="size-4 text-stone-500" /> Registrar gasto
                </button>
                <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("ingreso"); }}>
                  <ArrowDownCircle className="size-4 text-stone-500" /> Registrar ingreso
                </button>
              </>
            )}
            {puedeEditar && (
              <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("editar"); }}>
                <Pencil className="size-4 text-stone-500" /> Editar
              </button>
            )}
          </>
        )}
      </MenuPuntos>
      <Portal>
        {puedeEditar && <ModalMaquina key={JSON.stringify(m)} abierto={modal === "editar"} onCerrar={cerrar} m={m} cajas={cajas} />}
        {puedeMover && (
          <>
            <ModalMovimiento abierto={modal === "gasto"} onCerrar={cerrar} maquina={m} tipo="gasto" cajas={cajas} puedeFecha={puedeFecha} />
            <ModalMovimiento abierto={modal === "ingreso"} onCerrar={cerrar} maquina={m} tipo="ingreso" cajas={cajas} puedeFecha={puedeFecha} />
          </>
        )}
      </Portal>
    </>
  );
}

/** «Anular» de un gasto o ingreso del historial: usa las mismas funciones de Caja */
export function AnularMovimiento({ id, tipo, origen }: { id: string; tipo: string; origen: string }) {
  const [abierto, setAbierto] = useState(false);
  const accion = tipo === "ingreso" ? anularMovimientoManual : origen === "fuera" ? anularGastoSinCaja : anularGasto;
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className="text-xs font-medium text-red-700 hover:underline">Anular</button>
      <ModalAnular id={id} accion={accion} titulo={tipo === "ingreso" ? "Anular ingreso" : "Anular gasto"} abierto={abierto} onCerrar={() => setAbierto(false)}
        explicacion={origen === "fuera" ? "Era solo un registro: no mueve la caja." : `El dinero ${tipo === "ingreso" ? "sale" : "vuelve"} de la caja y queda tachado en el historial.`} />
    </>
  );
}

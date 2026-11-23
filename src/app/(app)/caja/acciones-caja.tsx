"use client";

import { useState } from "react";
import { ArrowDownUp, ArrowLeftRight, Calculator, Lock, LockOpen, Receipt } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/basicos";
import { Campo, Input, InputNumero, Select } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { claseBoton, cx } from "@/components/ui/clases";
import { useNotificar } from "@/components/ui/notificaciones";
import { BotonImprimir80 } from "@/components/ticket/boton-imprimir-80";
import { fechaHora, soles } from "@/lib/formato";
import type { ResumenTurno } from "@/lib/tipos";
import { abrirCaja, cerrarCaja, registrarArqueo, registrarMovimientoManual, registrarTraspaso } from "./acciones";
import { ModalGasto } from "./modal-gasto";

type Caja = { id: string; nombre: string; saldo: string; tipo?: string | null };
export type TurnoAbierto = { id: string; numero: number; caja_id: string; caja_nombre: string; abierto_en: string };

export type PrestamoPendiente = { persona: string; pendiente: string };

export function AccionesCaja({
  empresaId, cajas, categorias, puedeAjustar, turnos, personas, prestamos,
}: {
  empresaId: string; cajas: Caja[]; categorias: { id: string; nombre: string }[]; puedeAjustar: boolean; turnos: TurnoAbierto[];
  /** Nombres sugeridos para un préstamo (socios y trabajadores) */
  personas: string[];
  prestamos: PrestamoPendiente[];
}) {
  const [abierto, setAbierto] = useState<"gasto" | "traspaso" | "arqueo" | "abrir" | "cierre" | "dinero" | null>(null);
  const [tipoDinero, setTipoDinero] = useState<"ingreso" | "egreso">("ingreso");
  const [clase, setClase] = useState<"ajuste" | "prestamo">("ajuste");
  const [resultadoArqueo, setResultadoArqueo] = useState<{ diferencia: number; saldo_sistema: number } | null>(null);
  const [resultadoCierre, setResultadoCierre] = useState<ResumenTurno | null>(null);
  const notificar = useNotificar();
  const cerrar = () => setAbierto(null);
  const abrirDinero = (t: "ingreso" | "egreso") => { setTipoDinero(t); setClase("ajuste"); setAbierto("dinero"); };
  const opcionesCaja = cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {soles(c.saldo)}</option>);
  const sinTurno = cajas.filter((c) => !turnos.some((t) => t.caja_id === c.id));
  const difCierre = Number(resultadoCierre?.diferencia_cierre ?? 0);

  return (
    <>
      {sinTurno.length > 0 && (
        <Boton variante={turnos.length ? "secundario" : "primario"} onClick={() => setAbierto("abrir")}><LockOpen className="size-4" /> Abrir caja</Boton>
      )}
      {turnos.length > 0 && (
        <Boton onClick={() => { setResultadoCierre(null); setAbierto("cierre"); }}><Lock className="size-4" /> Cerrar caja</Boton>
      )}

      <Modal abierto={abierto === "abrir"} onCerrar={cerrar} titulo="Abrir caja">
        <FormularioAccion
          accion={abrirCaja}
          textoBoton="Abrir caja"
          mensajeExito={false}
          onExito={(d) => {
            const r = d as { numero: number; diferencia: number };
            notificar(Number(r.diferencia) === 0
              ? { titulo: `Caja abierta · turno N° ${r.numero}` }
              : { titulo: `Caja abierta · turno N° ${r.numero}`, mensaje: `Lo contado difiere del sistema en ${soles(r.diferencia)}.`, tono: "aviso" });
            cerrar();
          }}
        >
          <p className="text-sm text-stone-600">Cuente el efectivo con que empieza el día. Al cerrar, el sistema le dará el resumen de todo lo que entró y salió.</p>
          <Aviso>La apertura solo anota lo que contó: <b>no suma dinero a la caja</b>. Para meter dinero use <b>Ingreso / salida</b>.</Aviso>
          <Campo etiqueta="Caja">
            <Select name="caja_id" required>{sinTurno.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {soles(c.saldo)}</option>)}</Select>
          </Campo>
          <Campo etiqueta="Efectivo al abrir S/"><InputNumero name="contado" required /></Campo>
          <Campo etiqueta="Nota (opcional)"><Input name="nota" /></Campo>
        </FormularioAccion>
      </Modal>

      <Modal abierto={abierto === "cierre"} onCerrar={cerrar} titulo={resultadoCierre ? `Cierre de caja · turno N° ${resultadoCierre.numero}` : "Cerrar caja"}>
        {resultadoCierre ? (
          <div className="space-y-3">
            <Aviso tono={difCierre === 0 ? "verde" : "ambar"}>
              {difCierre === 0
                ? "La caja cuadra exactamente."
                : `${difCierre > 0 ? "Sobran" : "Faltan"} ${soles(Math.abs(difCierre))} frente a ${soles(resultadoCierre.saldo_sistema)} del sistema.`}
            </Aviso>
            <dl className="divide-y divide-stone-100 rounded-lg border border-stone-200 text-sm">
              {([
                ["Saldo inicial", soles(resultadoCierre.saldo_apertura)],
                ["Ingresos", `+ ${soles(resultadoCierre.ingresos)}`],
                ["Egresos", `− ${soles(resultadoCierre.egresos)}`],
                ["Saldo esperado", soles(resultadoCierre.esperado)],
                ["Contado", soles(resultadoCierre.contado_cierre)],
              ] as const).map(([a, b]) => (
                <div key={a} className="flex justify-between px-3 py-2"><dt className="text-stone-600">{a}</dt><dd className="cifra font-medium">{b}</dd></div>
              ))}
            </dl>
            <div className="flex flex-col gap-2 sm:flex-row">
              <BotonImprimir80
                href={`/imprimir/cierre/${resultadoCierre.id}`}
                texto="Imprimir cierre"
                className={cx(claseBoton("primario"), "flex-1")}
              />
              <Boton variante="secundario" onClick={cerrar} className="flex-1">Listo</Boton>
            </div>
          </div>
        ) : (
          <FormularioAccion
            accion={cerrarCaja}
            textoBoton="Cerrar caja"
            mensajeExito="Caja cerrada."
            reiniciar={false}
            onExito={(d) => setResultadoCierre(d as ResumenTurno)}
          >
            <p className="text-sm text-stone-600">Cuente el efectivo que hay ahora. El sistema compara con lo que debería haber y le da el resumen para imprimir.</p>
            <Campo etiqueta="Turno">
              <Select name="turno_id" required>
                {turnos.map((t) => <option key={t.id} value={t.id}>{t.caja_nombre} · N° {t.numero} · desde {fechaHora(t.abierto_en)}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta="Efectivo contado S/"><InputNumero name="contado" required /></Campo>
            <Campo etiqueta="Nota (opcional)"><Input name="nota" placeholder="Ej.: faltante por vuelto mal dado" /></Campo>
            {puedeAjustar && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ajustar" className="size-4 accent-marca-600" />
                Ajustar el saldo del sistema a lo contado
              </label>
            )}
          </FormularioAccion>
        )}
      </Modal>

      <Boton variante="secundario" onClick={() => abrirDinero("ingreso")}><ArrowDownUp className="size-4" /> Ingreso / salida</Boton>
      <Boton variante="secundario" onClick={() => setAbierto("traspaso")}><ArrowLeftRight className="size-4" /> Traspaso</Boton>
      <Boton variante="secundario" onClick={() => { setResultadoArqueo(null); setAbierto("arqueo"); }}><Calculator className="size-4" /> Arqueo</Boton>

      {/* Gastos aparte, a la derecha: aquí entran los que salen de una caja y los pagados por fuera */}
      <button type="button" onClick={() => setAbierto("gasto")}
        className="flex w-full items-center gap-3 rounded-xl bg-marca-600 px-4 py-2 text-left text-white shadow-sm transition hover:bg-marca-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-300 sm:ml-auto sm:w-auto">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15"><Receipt className="size-5" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-tight">Registrar gasto</span>
          <span className="block text-xs leading-tight text-white/80">De una caja o pagado por fuera</span>
        </span>
      </button>

      <ModalGasto abierto={abierto === "gasto"} onCerrar={cerrar} empresaId={empresaId} cajas={cajas}
        categorias={categorias} puedeCrearCategoria={puedeAjustar} />

      <Modal abierto={abierto === "dinero"} onCerrar={cerrar} titulo={tipoDinero === "ingreso" ? "Ingreso de dinero" : "Salida de dinero"}>
        <FormularioAccion accion={registrarMovimientoManual} textoBoton={tipoDinero === "ingreso" ? "Registrar ingreso" : "Registrar salida"}
          mensajeExito={tipoDinero === "ingreso" ? "Ingreso registrado." : "Salida registrada."} onExito={cerrar}>
          <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1">
            {(["ingreso", "egreso"] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tipoDinero === t} onClick={() => setTipoDinero(t)}
                className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", tipoDinero === t ? "bg-superficie shadow-sm" : "text-stone-600 hover:text-stone-900")}>
                {t === "ingreso" ? "Entra dinero" : "Sale dinero"}
              </button>
            ))}
          </div>
          <input type="hidden" name="tipo" value={tipoDinero} />
          <Campo etiqueta="¿Qué es?">
            <Select name="clase" value={clase} onChange={(e) => setClase(e.target.value as "ajuste" | "prestamo")}>
              <option value="ajuste">{tipoDinero === "ingreso" ? "Ingreso de dinero (sobrante, caja no cuadró, otro)" : "Salida de dinero (faltante, otro)"}</option>
              <option value="prestamo">{tipoDinero === "ingreso" ? "Devolución de un préstamo" : "Préstamo a un socio u otra persona"}</option>
            </Select>
          </Campo>
          {clase === "prestamo" && (
            <Campo etiqueta={tipoDinero === "ingreso" ? "¿Quién devuelve?" : "¿A quién se le presta?"}
              ayuda={tipoDinero === "egreso" ? "No baja la ganancia: queda como dinero por cobrar hasta que lo devuelva." : undefined}>
              <Input name="persona" required list="personas-prestamo" autoComplete="off" placeholder="Nombre" />
              <datalist id="personas-prestamo">
                {(tipoDinero === "ingreso" ? prestamos.map((p) => p.persona) : personas).map((p) => <option key={p} value={p} />)}
              </datalist>
            </Campo>
          )}
          {clase === "prestamo" && tipoDinero === "ingreso" && prestamos.length > 0 && (
            <ul className="-mt-1 space-y-0.5 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
              {prestamos.map((p) => <li key={p.persona} className="flex justify-between gap-2"><span>{p.persona}</span><span className="cifra">debe {soles(p.pendiente)}</span></li>)}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Monto S/"><InputNumero name="monto" required /></Campo>
            <Campo etiqueta={tipoDinero === "ingreso" ? "Entra a la caja" : "Sale de la caja"}><Select name="caja_id" required>{opcionesCaja}</Select></Campo>
          </div>
          <Campo etiqueta="Motivo" ayuda="Queda en el historial de la caja.">
            <Input name="motivo" required minLength={3} placeholder={clase === "prestamo" ? "Ej.: adelanto para su viaje" : tipoDinero === "ingreso" ? "Ej.: la caja no cuadró, sobraron S/ 20" : "Ej.: faltó vuelto"} />
          </Campo>
        </FormularioAccion>
      </Modal>

      <Modal abierto={abierto === "traspaso"} onCerrar={cerrar} titulo="Traspaso entre cajas">
        <FormularioAccion accion={registrarTraspaso} textoBoton="Registrar traspaso" mensajeExito="Traspaso registrado." onExito={cerrar}>
          <Campo etiqueta="Desde"><Select name="origen" required>{opcionesCaja}</Select></Campo>
          <Campo etiqueta="Hacia"><Select name="destino" required defaultValue={cajas[1]?.id}>{opcionesCaja}</Select></Campo>
          <Campo etiqueta="Monto S/"><InputNumero name="monto" required /></Campo>
          <Campo etiqueta="Concepto (opcional)"><Input name="concepto" placeholder="Ej.: depósito al banco" /></Campo>
        </FormularioAccion>
      </Modal>

      <Modal abierto={abierto === "arqueo"} onCerrar={cerrar} titulo="Arqueo de caja">
        {resultadoArqueo ? (
          <div className="space-y-3">
            <Aviso tono={resultadoArqueo.diferencia === 0 ? "verde" : "ambar"}>
              {Number(resultadoArqueo.diferencia) === 0
                ? "La caja cuadra exactamente."
                : `Diferencia de ${soles(resultadoArqueo.diferencia)} (${Number(resultadoArqueo.diferencia) > 0 ? "sobra" : "falta"}) frente a ${soles(resultadoArqueo.saldo_sistema)} del sistema.`}
            </Aviso>
            <Boton onClick={cerrar} className="w-full">Cerrar</Boton>
          </div>
        ) : (
          <FormularioAccion
            accion={registrarArqueo}
            textoBoton="Registrar arqueo"
            mensajeExito="Arqueo registrado."
            reiniciar={false}
            onExito={(d) => setResultadoArqueo(d as { diferencia: number; saldo_sistema: number })}
          >
            <p className="text-sm text-stone-600">Cuente el efectivo y anótelo. El sistema guarda la diferencia con su saldo.</p>
            <Campo etiqueta="Caja"><Select name="caja_id" required>{opcionesCaja}</Select></Campo>
            <Campo etiqueta="Efectivo contado S/"><InputNumero name="contado" required /></Campo>
            <Campo etiqueta="Nota (opcional)"><Input name="nota" /></Campo>
            {puedeAjustar && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ajustar" className="size-4 accent-marca-600" />
                Ajustar el saldo del sistema a lo contado
              </label>
            )}
          </FormularioAccion>
        )}
      </Modal>
    </>
  );
}

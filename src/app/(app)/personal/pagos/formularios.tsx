"use client";

import { useState } from "react";
import { Ban, Banknote, History, Paperclip, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Aviso } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { MenuPuntos, opcionMenu } from "@/components/ui/menu-puntos";
import { cx } from "@/components/ui/clases";
import { SelectorOrigenDinero, claseFicha, type CajaOrigen } from "@/components/selector-origen-dinero";
import { fechaHora, nombrePeriodo, soles } from "@/lib/formato";
import { subirArchivo } from "@/lib/archivos";
import { anularPago, editarPago, registrarPago } from "./acciones";

/** Datos de cobro de la ficha del trabajador */
export type Cobro = { medio: string | null; celular: string | null; banco: string | null; cuenta: string | null; cci: string | null };
/** Lo que el modal necesita de la página: empresa (para subir el voucher) y la caja de cada medio de pago */
export type ContextoPago = { empresaId: string; cajaPorMedio: Record<string, string> };

const MEDIOS = [["efectivo", "Efectivo"], ["yape", "Yape"], ["plin", "Plin"], ["transferencia", "Transferencia"]] as const;
const destinoDe = (medio: string, c?: Cobro | null) =>
  !c ? "" : medio === "yape" || medio === "plin" ? c.celular ?? ""
    : medio === "transferencia" ? [c.banco, c.cuenta && `Cta. ${c.cuenta}`, c.cci && `CCI ${c.cci}`].filter(Boolean).join(" · ") : "";

/** Cómo y a dónde se le pagó: medio, destino (de la ficha del trabajador), N° de operación y voucher */
function CamposCobro({ medio, onMedio, cobro, inicial, ctx, onCaja }: {
  medio: string; onMedio: (m: string) => void; cobro?: Cobro | null;
  inicial?: { destino: string | null; operacion: string | null; voucher: boolean };
  ctx: ContextoPago; onCaja: (caja: string) => void;
}) {
  const [destino, setDestino] = useState(inicial?.destino ?? destinoDe(medio, cobro));
  const [voucher, setVoucher] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const elegir = (m: string) => {
    onMedio(m);
    setDestino(destinoDe(m, cobro));
    if (ctx.cajaPorMedio[m]) onCaja(ctx.cajaPorMedio[m]);
  };
  const digital = medio !== "efectivo";
  return (
    <div className="space-y-3 rounded-xl border border-stone-200 p-3">
      <div>
        <p id="etq-medio-pago" className="mb-1.5 text-sm font-medium text-stone-700">¿Cómo se le paga?</p>
        <input type="hidden" name="medio" value={medio} />
        <div role="radiogroup" aria-labelledby="etq-medio-pago" className="flex flex-wrap gap-2">
          {MEDIOS.map(([v, t]) => (
            <button key={v} type="button" role="radio" aria-checked={medio === v} onClick={() => elegir(v)} className={cx(claseFicha(medio === v), "min-w-[6.5rem] flex-1 whitespace-nowrap text-center font-semibold")}>{t}</button>
          ))}
        </div>
        {cobro?.medio && cobro.medio !== medio && (
          <p className="mt-1 text-xs text-amber-800">En su ficha cobra por {MEDIOS.find(([v]) => v === cobro.medio)?.[1]}.</p>
        )}
      </div>
      {digital && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta={medio === "transferencia" ? "Banco y cuenta de destino" : "Celular al que se envió"}
            ayuda={destinoDe(medio, cobro) ? "Tomado de la ficha del trabajador." : "Anótelo aquí (y complételo en su ficha de Personal)."}>
            <Input name="destino" required value={destino} onChange={(e) => setDestino(e.target.value)}
              inputMode={medio === "transferencia" ? "text" : "numeric"} placeholder={medio === "transferencia" ? "BCP · Cta. 191-..." : "9XXXXXXXX"} />
          </Campo>
          <Campo etiqueta="N° de operación (opcional)"><Input name="operacion" defaultValue={inicial?.operacion ?? ""} placeholder="Ej.: 08451236" /></Campo>
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2.5 text-sm text-stone-600 hover:border-marca-300">
        <Paperclip className="size-4 shrink-0" />
        <span className="truncate">
          {subiendo ? "Subiendo…" : voucher ? "Comprobante adjunto ✓"
            : inicial?.voucher ? "Ya tiene comprobante (adjunte otro para reemplazarlo)"
              : digital ? "Adjuntar voucher o captura del pago (opcional)" : "Adjuntar recibo firmado (opcional)"}
        </span>
        <input type="file" accept="image/*,application/pdf" className="sr-only"
          onChange={async (e) => {
            const a = e.target.files?.[0];
            if (!a) return;
            setSubiendo(true);
            try { setVoucher(await subirArchivo(ctx.empresaId, "vouchers-personal", a)); } finally { setSubiendo(false); }
          }} />
      </label>
      <input type="hidden" name="voucher_url" value={voucher} />
    </div>
  );
}

export const TIPOS_PAGO = {
  pago: { texto: "Pago del mes", ayuda: "Sueldo o lo que falta pagar del mes" },
  adelanto: { texto: "Adelanto", ayuda: "A cuenta del sueldo del mes" },
  bono: { texto: "Bono", ayuda: "Extra aparte del sueldo (no descuenta)" },
} as const;
export type TipoPago = keyof typeof TIPOS_PAGO;

function SelectorTipo({ valor, onCambio }: { valor: TipoPago; onCambio: (t: TipoPago) => void }) {
  return (
    <div>
      <p id="etq-tipo-pago" className="mb-1.5 text-sm font-medium text-stone-700">¿Qué se paga?</p>
      <input type="hidden" name="tipo" value={valor} />
      <div role="radiogroup" aria-labelledby="etq-tipo-pago" className="grid grid-cols-3 gap-2">
        {(Object.keys(TIPOS_PAGO) as TipoPago[]).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={valor === t} onClick={() => onCambio(t)} className={cx(claseFicha(valor === t), "text-center")}>
            <span className="block font-semibold">{TIPOS_PAGO[t].texto}</span>
            <span className={cx("block text-[11px] leading-tight", valor === t ? "text-white/80" : "text-stone-500")}>{TIPOS_PAGO[t].ayuda}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Meses para elegir: el actual y los 11 anteriores (y el que ya tenga el pago, si es más antiguo) */
function meses(actual: string, extra?: string) {
  const [a, m] = actual.split("-").map(Number);
  const lista = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 15));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  return extra && !lista.includes(extra) ? [...lista, extra] : lista;
}

export type FilaPlanilla = {
  trabajador_id: string; nombre: string; periodo: string;
  a_pagar: string; adelantos: string; pagado: string; saldo: string;
  cobro?: Cobro | null;
  /** Desglose del cálculo (sale de la BD, según la asistencia marcada) */
  desglose?: {
    sueldo: string; dias: number; extras: string; horas_extra: string; domingos: string; n_domingos: number;
    faltas: number; desc_faltas: string; tardanzas: number; minutos_tarde: number; desc_tardanzas: string;
    permisos: number; desc_permisos: string; sin_marcar: number;
  };
};

/** Cómo se llegó al monto: cada línea con su origen en la asistencia */
function Desglose({ fila }: { fila: FilaPlanilla }) {
  const d = fila.desglose;
  if (!d) return null;
  const lineas: [string, string, number][] = [
    [`Sueldo${d.dias < 30 ? ` (${d.dias} días)` : ""}`, d.sueldo, 1],
    ...(Number(d.extras) > 0 ? [[`Horas extras (${d.horas_extra} h)`, d.extras, 1] as [string, string, number]] : []),
    ...(Number(d.domingos) > 0 ? [[`Domingos trabajados (${d.n_domingos})`, d.domingos, 1] as [string, string, number]] : []),
    ...(d.faltas > 0 ? [[`Faltas (${d.faltas})`, d.desc_faltas, -1] as [string, string, number]] : []),
    ...(d.tardanzas > 0 ? [[`Tardanzas (${d.tardanzas} · ${d.minutos_tarde} min)`, d.desc_tardanzas, -1] as [string, string, number]] : []),
    ...(d.permisos > 0 && Number(d.desc_permisos) > 0 ? [[`Permisos sin goce (${d.permisos})`, d.desc_permisos, -1] as [string, string, number]] : []),
  ];
  return (
    <div className="rounded-xl border border-stone-200 text-sm">
      <p className="border-b border-stone-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Cálculo según la asistencia</p>
      <dl className="divide-y divide-stone-100">
        {lineas.map(([t, v, signo]) => (
          <div key={t} className="flex justify-between gap-2 px-3 py-1.5">
            <dt className="text-stone-600">{t}</dt>
            <dd className={cx("cifra font-medium", signo < 0 ? "text-red-700" : "text-stone-900")}>{signo < 0 ? "− " : ""}{soles(v)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-2 bg-marca-50 px-3 py-2">
          <dt className="font-semibold text-stone-900">Le corresponde</dt>
          <dd className="cifra font-bold text-marca-700">{soles(fila.a_pagar)}</dd>
        </div>
      </dl>
      {d.sin_marcar > 0 && <p className="px-3 py-2 text-xs text-amber-800">Hay {d.sin_marcar} día(s) sin marcar en la asistencia: márquelos para que el cálculo sea exacto.</p>}
    </div>
  );
}

/** Botón «Pagar» de la planilla: propone el saldo del mes como monto */
export function BotonPagar({ fila, cajas, ctx, principal = true }: { fila: FilaPlanilla; cajas: CajaOrigen[]; ctx: ContextoPago; principal?: boolean }) {
  const medioFicha = fila.cobro?.medio ?? "efectivo";
  const cajaInicial = ctx.cajaPorMedio[medioFicha] ?? cajas[0]?.id ?? "ninguna";
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoPago>("pago");
  const [medio, setMedio] = useState(medioFicha);
  const [origen, setOrigen] = useState(cajaInicial);
  const saldo = Math.max(Number(fila.saldo), 0);
  return (
    <>
      <Boton tamano="sm" variante={principal ? "primario" : "secundario"} onClick={() => { setTipo(saldo > 0 ? "pago" : "bono"); setMedio(medioFicha); setOrigen(cajaInicial); setAbierto(true); }}>
        <Banknote className="size-4" /> Pagar
      </Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Pagar a ${fila.nombre}`}>
        <FormularioAccion key={`${abierto}`} accion={registrarPago} textoBoton="Registrar pago" mensajeExito={`Pago a ${fila.nombre} registrado.`} onExito={() => setAbierto(false)}>
          <input type="hidden" name="trabajador_id" value={fila.trabajador_id} />
          <input type="hidden" name="periodo" value={fila.periodo} />
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-marca-50 p-3 text-sm">
            <span className="text-stone-600">A pagar en {nombrePeriodo(fila.periodo).toLowerCase()}<b className="cifra block text-base text-stone-900">{soles(fila.a_pagar)}</b></span>
            <span className="text-stone-600">Ya pagado<b className="cifra block text-base text-stone-900">{soles(fila.pagado)}</b></span>
            <span className="text-stone-600">Falta<b className={cx("cifra block text-base", saldo > 0 ? "text-marca-700" : "text-emerald-700")}>{soles(saldo)}</b></span>
          </div>
          <Desglose fila={fila} />
          <SelectorTipo valor={tipo} onCambio={setTipo} />
          <Campo etiqueta="Monto S/" ayuda={tipo === "pago" && saldo > 0 ? "Se propone lo que falta pagar del mes; puede cambiarlo." : undefined}>
            <InputNumero name="monto" required defaultValue={tipo === "pago" && saldo > 0 ? saldo.toFixed(2) : ""} key={tipo} />
          </Campo>
          <CamposCobro medio={medio} onMedio={setMedio} cobro={fila.cobro} ctx={ctx} onCaja={setOrigen} />
          <SelectorOrigenDinero cajas={cajas} valor={origen} onCambio={setOrigen} etiqueta="¿De qué caja sale el dinero?"
            textoFuera="Se pagó por fuera: queda en el historial del trabajador y de gastos, sin bajar ninguna caja." />
          <Campo etiqueta="Nota (opcional)"><Input name="nota" placeholder="Ej.: quincena" /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

type Cambio = { fecha: string; razon: string; monto: string | number; periodo?: string; tipo?: string };
export type PagoFila = {
  id: string; periodo: string; tipo: TipoPago; monto: string; caja_id: string | null; nota: string | null; historial: Cambio[];
  medio: string; destino: string | null; operacion: string | null; voucher: boolean;
};

/** ⋮ de un pago del historial: corregir (motivo obligatorio) o anular */
export function MenuPago({ pago, cajas, mesActual, ctx }: { pago: PagoFila; cajas: CajaOrigen[]; mesActual: string; ctx: ContextoPago }) {
  const [modal, setModal] = useState<"editar" | "anular" | null>(null);
  const [tipo, setTipo] = useState<TipoPago>(pago.tipo);
  const [medio, setMedio] = useState(pago.medio);
  const [origen, setOrigen] = useState(pago.caja_id ?? "ninguna");
  const cerrar = () => setModal(null);
  return (
    <>
      <MenuPuntos etiqueta="Opciones del pago" alto={100}>
        {(c) => (
          <>
            <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setTipo(pago.tipo); setMedio(pago.medio); setOrigen(pago.caja_id ?? "ninguna"); setModal("editar"); }}>
              <Pencil className="size-4 text-stone-500" /> Corregir pago
            </button>
            <button type="button" role="menuitem" className={`${opcionMenu} text-red-700 hover:bg-red-50`} onClick={() => { c(); setModal("anular"); }}>
              <Ban className="size-4" /> Anular pago
            </button>
          </>
        )}
      </MenuPuntos>
      <Modal abierto={modal === "editar"} onCerrar={cerrar} titulo="Corregir pago">
        <FormularioAccion accion={editarPago} textoBoton="Guardar corrección" mensajeExito="Pago corregido." onExito={cerrar} reiniciar={false}>
          <input type="hidden" name="id" value={pago.id} />
          <SelectorTipo valor={tipo} onCambio={setTipo} />
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Monto S/"><InputNumero name="monto" required defaultValue={pago.monto} /></Campo>
            <Campo etiqueta="Mes">
              <select name="periodo" defaultValue={pago.periodo} className="block w-full rounded-lg border border-stone-300 bg-superficie px-3 py-2.5 text-base sm:text-sm">
                {meses(mesActual, pago.periodo).map((p) => <option key={p} value={p}>{nombrePeriodo(p)}</option>)}
              </select>
            </Campo>
          </div>
          <CamposCobro medio={medio} onMedio={setMedio} ctx={ctx} onCaja={setOrigen}
            inicial={{ destino: pago.destino, operacion: pago.operacion, voucher: pago.voucher }} />
          <SelectorOrigenDinero cajas={cajas} valor={origen} onCambio={setOrigen} etiqueta="¿De qué caja salió el dinero?" />
          <Campo etiqueta="Nota (opcional)"><Input name="nota" defaultValue={pago.nota ?? ""} /></Campo>
          <Campo etiqueta="¿Por qué se corrige?" ayuda="Obligatorio. Queda en el historial con el valor anterior.">
            <Input name="razon" required minLength={3} placeholder="Ej.: el monto era otro" />
          </Campo>
          {pago.historial.length > 0 && (
            <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
              <p className="mb-1 inline-flex items-center gap-1 font-medium text-stone-700"><History className="size-3.5" /> Correcciones anteriores</p>
              <ul className="space-y-0.5">{pago.historial.map((h, i) => <li key={i}>{fechaHora(h.fecha)} · antes {soles(h.monto)} · {h.razon}</li>)}</ul>
            </div>
          )}
        </FormularioAccion>
      </Modal>
      <Modal abierto={modal === "anular"} onCerrar={cerrar} titulo="Anular pago">
        <FormularioAccion accion={anularPago} textoBoton="Confirmar anulación" variante="peligro" mensajeExito="Pago anulado." onExito={cerrar}>
          <input type="hidden" name="id" value={pago.id} />
          <Aviso>{pago.caja_id ? "El dinero vuelve a la caja" : "Se quita del historial de gastos"}; el pago queda tachado con su motivo.</Aviso>
          <Campo etiqueta="Motivo (obligatorio)"><Textarea name="motivo" required minLength={3} placeholder="Ej.: se registró dos veces" /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

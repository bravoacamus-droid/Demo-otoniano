"use client";

import { useState } from "react";
import { Ban, ChevronDown, HandCoins, ListOrdered, Undo2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Aviso, Insignia } from "@/components/ui/basicos";
import { Campo, Input, InputNumero, Select } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { MenuPuntos, opcionMenu } from "@/components/ui/menu-puntos";
import { claseBoton, cx } from "@/components/ui/clases";
import { fechaDia, fechaHora, hoyLima, soles } from "@/lib/formato";
import { aCentimos } from "@/lib/montos";
import { anularDevolucionPrestamo, anularPrestamo, registrarDevolucionPrestamo, registrarPrestamo } from "./acciones";
import { ModalAnular } from "./menus-caja";

// Préstamos con cuotas (llamada del 26/11). «recibido» = nos prestan (entra dinero, la empresa debe);
// «otorgado» = prestamos a alguien (sale dinero, queda por cobrar). Montos y cuotas oficiales: BD.

type Caja = { id: string; nombre: string; saldo: string };
export type TipoPrestamo = "recibido" | "otorgado";
export type PrestamoFila = {
  id: string; tipo: TipoPrestamo; persona: string; documento: string | null; fecha: string; monto: string; saldo: string;
  pagado: string; motivo: string; caja_nombre: string; n_cuotas: number; frecuencia: string; estado: string; situacion: string;
  proxima_numero: number | null; proxima_vence: string | null; proxima_saldo: string | null; creado_por_nombre: string | null;
  motivo_anulacion: string | null;
};
export type CuotaFila = { numero: number; vence: string; monto: string; pagado: string; saldo: string; situacion: string };
export type DevolucionFila = {
  id: string; fecha: string; monto: string; caja_nombre: string; nota: string | null; estado: string;
  creado_por_nombre: string | null; motivo_anulacion: string | null;
};

const FRECUENCIA: Record<string, string> = { unica: "Una sola cuota", semanal: "Semanal", quincenal: "Quincenal", mensual: "Mensual" };
export const quien = (p: { tipo: TipoPrestamo; persona: string }) =>
  p.tipo === "recibido" ? `Nos prestó ${p.persona}` : `Le prestamos a ${p.persona}`;

/** Fecha de la cuota i (0 = la primera) según la frecuencia: igual que _plan_cuotas_prestamo en la BD */
function vencimiento(primer: string, frecuencia: string, i: number) {
  const d = new Date(`${primer}T12:00:00`);
  if (frecuencia === "semanal") d.setDate(d.getDate() + 7 * i);
  else if (frecuencia === "quincenal") d.setDate(d.getDate() + 15 * i);
  else d.setMonth(d.getMonth() + i);
  return d.toISOString().slice(0, 10);
}
const primerPorDefecto = (frecuencia: string) => vencimiento(hoyLima(), frecuencia === "unica" ? "mensual" : frecuencia, 1);

/** Nuevo préstamo: quién presta o a quién, monto, caja, fecha y cronograma de cuotas (vista previa) */
export function ModalPrestamo({ abierto, onCerrar, cajas, personas, puedeFecha }: {
  abierto: boolean; onCerrar: () => void; cajas: Caja[];
  /** Nombres sugeridos: socios, trabajadores y personas de préstamos anteriores */
  personas: string[];
  /** Gerencia y Administración pueden poner la fecha real del préstamo */
  puedeFecha: boolean;
}) {
  const [tipo, setTipo] = useState<TipoPrestamo>("recibido");
  const [monto, setMonto] = useState("");
  const [cuotas, setCuotas] = useState("1");
  const [frecuencia, setFrecuencia] = useState("mensual");
  const [primer, setPrimer] = useState(() => primerPorDefecto("mensual"));
  const n = Math.min(60, Math.max(1, Math.trunc(Number(cuotas) || 1)));
  const frec = n === 1 ? "unica" : frecuencia;
  const total = aCentimos(monto || "0");
  const base = n > 0 ? Math.floor(total / n) : 0;
  const plan = total > 0 ? Array.from({ length: n }, (_, i) => ({
    numero: i + 1, vence: vencimiento(primer, frec, i), monto: (i < n - 1 ? base : total - base * (n - 1)) / 100,
  })) : [];
  const recibido = tipo === "recibido";

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Registrar préstamo" ancho="max-w-xl">
      <FormularioAccion accion={registrarPrestamo} textoBoton="Registrar préstamo" mensajeExito="Préstamo registrado."
        onExito={() => { setMonto(""); setCuotas("1"); onCerrar(); }}>
        <div role="radiogroup" aria-label="Tipo de préstamo" className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1">
          {(["recibido", "otorgado"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)}
              className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", tipo === t ? "bg-superficie shadow-sm" : "text-stone-600 hover:text-stone-900")}>
              {t === "recibido" ? "Nos prestan (entra dinero)" : "Prestamos (sale dinero)"}
            </button>
          ))}
        </div>
        <input type="hidden" name="tipo" value={tipo} />
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Campo etiqueta={recibido ? "¿Quién nos presta?" : "¿A quién le prestamos?"}>
            <Input name="persona" required list="personas-prestamo" autoComplete="off" placeholder="Nombre de la persona o empresa" />
            <datalist id="personas-prestamo">{personas.map((p) => <option key={p} value={p} />)}</datalist>
          </Campo>
          <Campo etiqueta="DNI / RUC (opcional)"><Input name="documento" inputMode="numeric" maxLength={11} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Monto S/"><InputNumero name="monto" required value={monto} onChange={(e) => setMonto(e.target.value)} /></Campo>
          <Campo etiqueta={recibido ? "Entra a la caja" : "Sale de la caja"}>
            <Select name="caja_id" required>{cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {soles(c.saldo)}</option>)}</Select>
          </Campo>
        </div>
        {puedeFecha && (
          <Campo etiqueta="Fecha del préstamo"><Input name="fecha" type="date" defaultValue={hoyLima()} max={hoyLima()} /></Campo>
        )}
        <Campo etiqueta="Motivo"><Input name="motivo" required minLength={3} placeholder={recibido ? "Ej.: capital para compras de cobre" : "Ej.: adelanto para su viaje"} /></Campo>

        <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">{recibido ? "¿Cómo lo devolvemos?" : "¿Cómo nos lo devuelve?"}</legend>
          <div className="grid grid-cols-3 gap-3">
            <Campo etiqueta="Cuotas"><Input name="cuotas" type="number" min={1} max={60} required value={cuotas} onChange={(e) => setCuotas(e.target.value)} /></Campo>
            <Campo etiqueta="Cada">
              <Select name="frecuencia" value={frec} disabled={n === 1}
                onChange={(e) => { setFrecuencia(e.target.value); setPrimer(primerPorDefecto(e.target.value)); }}>
                {n === 1 ? <option value="unica">Una sola cuota</option> : (["semanal", "quincenal", "mensual"] as const).map((f) => <option key={f} value={f}>{FRECUENCIA[f]}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta={n === 1 ? "Fecha de pago" : "Primera cuota"}>
              <Input name="primer_vencimiento" type="date" required min={hoyLima()} value={primer} onChange={(e) => setPrimer(e.target.value)} />
            </Campo>
          </div>
          {plan.length > 0 && (
            <ol aria-label="Cronograma" className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
              {plan.map((q) => (
                <li key={q.numero} className="flex justify-between gap-2">
                  <span>Cuota {q.numero} · {fechaDia(q.vence)}</span><span className="cifra font-medium">{soles(q.monto)}</span>
                </li>
              ))}
            </ol>
          )}
        </fieldset>
        {/* Los dos textos ocupan la misma celda (el otro invisible): el aviso no cambia de alto y el cuadro no salta */}
        <Aviso tono="azul">
          <span className="grid">
            <span className={cx("col-start-1 row-start-1", !recibido && "invisible")} aria-hidden={!recibido}>
              No es ganancia: la caja sube y queda como deuda hasta devolverlo. Cada devolución sale de la caja.
            </span>
            <span className={cx("col-start-1 row-start-1", recibido && "invisible")} aria-hidden={recibido}>
              No es gasto: la caja baja y queda como dinero por cobrar hasta que lo devuelva. Cada devolución entra a la caja.
            </span>
          </span>
        </Aviso>
      </FormularioAccion>
    </Modal>
  );
}

/** Devolución: elegir el préstamo (persona) y el monto; propone la próxima cuota */
export function ModalDevolucion({ abierto, onCerrar, cajas, prestamos, fijo, puedeFecha }: {
  abierto: boolean; onCerrar: () => void; cajas: Caja[];
  /** Préstamos con saldo */
  prestamos: PrestamoFila[];
  /** Préstamo ya elegido (desde su menú ⋮) */
  fijo?: string;
  puedeFecha: boolean;
}) {
  const [elegido, setElegido] = useState(fijo ?? prestamos[0]?.id ?? "");
  const p = prestamos.find((x) => x.id === (fijo ?? elegido));
  const recibido = p?.tipo === "recibido";
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Devolución de préstamo">
      {!p ? (
        <Aviso>No hay préstamos pendientes de devolver.</Aviso>
      ) : (
        <FormularioAccion accion={registrarDevolucionPrestamo} textoBoton={recibido ? "Registrar salida" : "Registrar ingreso"}
          mensajeExito="Devolución registrada." onExito={onCerrar}>
          {fijo ? (
            <input type="hidden" name="prestamo_id" value={fijo} />
          ) : (
            <Campo etiqueta="Préstamo">
              <Select name="prestamo_id" required value={elegido} onChange={(e) => setElegido(e.target.value)}>
                {prestamos.map((x) => <option key={x.id} value={x.id}>{quien(x)} · falta {soles(x.saldo)}</option>)}
              </Select>
            </Campo>
          )}
          <dl className="grid grid-cols-3 gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
            <div><dt className="text-xs text-stone-500">Prestado</dt><dd className="cifra font-medium">{soles(p.monto)}</dd></div>
            <div><dt className="text-xs text-stone-500">Devuelto</dt><dd className="cifra font-medium">{soles(p.pagado)}</dd></div>
            <div><dt className="text-xs text-stone-500">Falta</dt><dd className="cifra font-semibold">{soles(p.saldo)}</dd></div>
          </dl>
          <Aviso tono="azul">
            {recibido ? <>Devolvemos a <b>{p.persona}</b>: el dinero <b>sale</b> de la caja.</> : <><b>{p.persona}</b> nos devuelve: el dinero <b>entra</b> a la caja.</>}
            {p.proxima_numero && p.n_cuotas > 1 && <> Próxima: cuota {p.proxima_numero} de {p.n_cuotas}, vence {fechaDia(p.proxima_vence)}.</>}
          </Aviso>
          {/* key: al cambiar de préstamo se propone su próxima cuota */}
          <div key={p.id} className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Monto S/" ayuda={`Máximo ${soles(p.saldo)}`}><InputNumero name="monto" required defaultValue={p.proxima_saldo ?? p.saldo} /></Campo>
            <Campo etiqueta={recibido ? "Sale de la caja" : "Entra a la caja"}>
              <Select name="caja_id" required>{cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {soles(c.saldo)}</option>)}</Select>
            </Campo>
          </div>
          {puedeFecha && <Campo etiqueta="Fecha"><Input name="fecha" type="date" defaultValue={hoyLima()} max={hoyLima()} /></Campo>}
          <Campo etiqueta="Nota (opcional)"><Input name="nota" placeholder="Ej.: transferencia N° 123" /></Campo>
        </FormularioAccion>
      )}
    </Modal>
  );
}

/** ⋮ de cada préstamo: cronograma y devoluciones, registrar devolución, anular */
export function MenuPrestamo({ p, cuotas, devoluciones, cajas, puedeAnular, puedeFecha, puedeDevolver }: {
  p: PrestamoFila; cuotas: CuotaFila[]; devoluciones: DevolucionFila[]; cajas: Caja[];
  puedeAnular: boolean; puedeFecha: boolean; puedeDevolver: boolean;
}) {
  const [modal, setModal] = useState<"detalle" | "devolver" | "anular" | null>(null);
  const [anularPago, setAnularPago] = useState<string | null>(null);
  const cerrar = () => setModal(null);
  const vigente = p.estado === "registrada";
  const conSaldo = vigente && Number(p.saldo) > 0;
  const devActivas = devoluciones.filter((d) => d.estado === "registrada").length;
  return (
    <>
      <MenuPuntos etiqueta={`Opciones del préstamo de ${p.persona}`} alto={140}>
        {(c) => (
          <>
            <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("detalle"); }}>
              <ListOrdered className="size-4 text-stone-500" /> Cuotas y devoluciones
            </button>
            {conSaldo && puedeDevolver && (
              <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("devolver"); }}>
                <Undo2 className="size-4 text-stone-500" /> Registrar devolución
              </button>
            )}
            {vigente && puedeAnular && (
              <button type="button" role="menuitem" className={`${opcionMenu} text-red-700 hover:bg-red-50`} onClick={() => { c(); setModal("anular"); }}>
                <Ban className="size-4" /> Anular préstamo
              </button>
            )}
          </>
        )}
      </MenuPuntos>

      <Modal abierto={modal === "detalle"} onCerrar={cerrar} titulo={quien(p)} ancho="max-w-2xl">
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <div><dt className="text-xs text-stone-500">Fecha</dt><dd>{fechaHora(p.fecha)}</dd></div>
            <div><dt className="text-xs text-stone-500">Prestado</dt><dd className="cifra font-medium">{soles(p.monto)}</dd></div>
            <div><dt className="text-xs text-stone-500">Devuelto</dt><dd className="cifra font-medium">{soles(p.pagado)}</dd></div>
            <div><dt className="text-xs text-stone-500">Falta</dt><dd className="cifra font-semibold">{soles(p.saldo)}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-stone-500">Motivo</dt><dd>{p.motivo}</dd></div>
            <div><dt className="text-xs text-stone-500">Caja</dt><dd>{p.caja_nombre}</dd></div>
            <div><dt className="text-xs text-stone-500">Registró</dt><dd>{p.creado_por_nombre ?? "—"}</dd></div>
          </dl>
          {p.estado === "anulada" && <Aviso tono="rojo">Anulado: {p.motivo_anulacion}</Aviso>}

          <section>
            <h3 className="mb-1.5 font-semibold text-stone-800">Cuotas · {FRECUENCIA[p.frecuencia]?.toLowerCase()}</h3>
            <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
              {cuotas.map((q) => (
                <li key={q.numero} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>Cuota {q.numero} <span className="text-stone-500">· vence {fechaDia(q.vence)}</span></span>
                  <span className="flex items-center gap-3">
                    <span className="cifra">{soles(q.monto)}{Number(q.pagado) > 0 && Number(q.saldo) > 0 && <span className="text-xs text-stone-500"> · falta {soles(q.saldo)}</span>}</span>
                    <Insignia tono={q.situacion === "pagada" ? "verde" : q.situacion === "vencida" ? "rojo" : q.situacion === "parcial" ? "ambar" : "gris"}>
                      {q.situacion === "pagada" ? "Pagada" : q.situacion === "vencida" ? "Vencida" : q.situacion === "parcial" ? "Parcial" : "Pendiente"}
                    </Insignia>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 font-semibold text-stone-800">Devoluciones</h3>
            {devoluciones.length === 0 ? <p className="text-stone-500">Todavía no hay devoluciones.</p> : (
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                {devoluciones.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className={cx("min-w-0", d.estado === "anulada" && "text-stone-500 line-through")}>
                      {fechaHora(d.fecha)} · {d.caja_nombre}{d.nota && <span className="text-stone-500"> · {d.nota}</span>}
                      {d.creado_por_nombre && <span className="block text-xs text-stone-500">{d.creado_por_nombre}</span>}
                      {d.estado === "anulada" && <span className="block text-xs text-red-700 no-underline">Anulada: {d.motivo_anulacion}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={cx("cifra font-medium", d.estado === "anulada" ? "text-stone-500 line-through" : p.tipo === "recibido" ? "text-red-700" : "text-emerald-700")}>
                        {p.tipo === "recibido" ? "−" : "+"}{soles(d.monto)}
                      </span>
                      {puedeAnular && d.estado === "registrada" && (
                        <button type="button" onClick={() => setAnularPago(d.id)} className="text-xs font-medium text-red-700 hover:underline">Anular</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Modal>

      {conSaldo && (
        <ModalDevolucion abierto={modal === "devolver"} onCerrar={cerrar} cajas={cajas} prestamos={[p]} fijo={p.id} puedeFecha={puedeFecha} />
      )}
      <ModalAnular id={p.id} accion={anularPrestamo} titulo="Anular préstamo" abierto={modal === "anular"} onCerrar={cerrar}
        explicacion={devActivas
          ? `Tiene ${devActivas} devolución(es) registrada(s): anúlelas primero desde «Cuotas y devoluciones».`
          : `El dinero ${p.tipo === "recibido" ? "sale" : "vuelve"} de la caja y el préstamo queda tachado en el historial.`} />
      <ModalAnular id={anularPago ?? ""} accion={anularDevolucionPrestamo} titulo="Anular devolución" abierto={anularPago !== null}
        onCerrar={() => setAnularPago(null)}
        explicacion={`El dinero ${p.tipo === "recibido" ? "vuelve" : "sale"} de la caja y la cuota vuelve a quedar pendiente.`} />
    </>
  );
}

/** Botón «Préstamos» de la barra de Caja: un solo botón con menú (nuevo préstamo o devolución) para que la barra entre en una línea */
export function BotonesPrestamo({ cajas, personas, pendientes, puedeFecha }: {
  cajas: Caja[]; personas: string[]; pendientes: PrestamoFila[]; puedeFecha: boolean;
}) {
  const [modal, setModal] = useState<"nuevo" | "devolver" | null>(null);
  const cerrar = () => setModal(null);
  return (
    <>
      <MenuPuntos etiqueta="Préstamos" alto={100} claseDisparador={claseBoton("secundario")}
        disparador={<><HandCoins className="size-4" /> Préstamos <ChevronDown className="size-4 text-stone-500" /></>}>
        {(c) => (
          <>
            <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("nuevo"); }}>
              <HandCoins className="size-4 text-stone-500" /> Registrar préstamo
            </button>
            <button type="button" role="menuitem" className={opcionMenu} onClick={() => { c(); setModal("devolver"); }}>
              <Undo2 className="size-4 text-stone-500" /> Devolución de préstamo
              {pendientes.length > 0 && <span className="ml-auto rounded-full bg-marca-50 px-1.5 text-xs font-medium text-marca-700">{pendientes.length}</span>}
            </button>
          </>
        )}
      </MenuPuntos>
      <ModalPrestamo abierto={modal === "nuevo"} onCerrar={cerrar} cajas={cajas} personas={personas} puedeFecha={puedeFecha} />
      <ModalDevolucion key={pendientes.map((p) => p.id).join()} abierto={modal === "devolver"} onCerrar={cerrar} cajas={cajas}
        prestamos={pendientes} puedeFecha={puedeFecha} />
    </>
  );
}

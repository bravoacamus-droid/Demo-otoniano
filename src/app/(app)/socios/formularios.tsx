"use client";

import { useRef, useState } from "react";
import { HandCoins, Lock, Paperclip, Pencil, Plus, Search } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/basicos";
import { AvisoConsulta, useConsultaDocumento } from "@/components/consulta-documento";
import { hoyLima, nombrePeriodo, periodoActual, soles } from "@/lib/formato";
import { subirArchivo } from "@/lib/archivos";
import { aCentimos } from "@/lib/montos";
import type { Resultado } from "@/lib/tipos";
import { TIPOS_MOV_SOCIO, type TipoMovSocio } from "@/lib/socios";
import { actualizarVoucher, ajustarCapital, cerrarMes, guardarSocio, registrarMovimientoSocio } from "./acciones";

interface SocioEditable { id: string; nombre: string; dni: string | null; porcentaje: number | string; activo: boolean }

/** DNI primero: con los 8 dígitos se trae el nombre de RENIEC (o del registro si ya es proveedor/socio) */
function CamposSocio({ inicial }: { inicial?: SocioEditable }) {
  const { estado, consultar, limpiar } = useConsultaDocumento("socio");
  const dniRef = useRef<HTMLInputElement>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  const pctRef = useRef<HTMLInputElement>(null);

  async function buscar() {
    const d = await consultar("DNI", dniRef.current?.value ?? "");
    if (!d) return;
    if (nombreRef.current && d.nombre) nombreRef.current.value = d.nombre;
    if (!d.registrado || d.registrado.tipo !== "socio") pctRef.current?.focus();
  }

  return (
    <>
      {inicial && <input type="hidden" name="id" value={inicial.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="DNI">
          <div className="flex gap-1.5">
            <Input
              ref={dniRef}
              name="dni"
              inputMode="numeric"
              maxLength={8}
              defaultValue={inicial?.dni ?? ""}
              autoFocus={!inicial}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                if (v !== e.target.value) e.target.value = v;
                if (!inicial && v.length === 8) buscar();
                else if (estado.fase !== "libre") limpiar();
              }}
            />
            <Boton variante="secundario" onClick={buscar} disabled={estado.fase === "consultando"} className="shrink-0 px-3"
              aria-label="Consultar RENIEC" title="Consultar RENIEC"><Search className="size-4" /></Boton>
          </div>
        </Campo>
        <Campo etiqueta="Participación %" ayuda="Para repartir la utilidad">
          <InputNumero ref={pctRef} name="porcentaje" required defaultValue={inicial ? String(inicial.porcentaje) : undefined} />
        </Campo>
      </div>
      <AvisoConsulta estado={estado} tipo="DNI" />
      <Campo etiqueta="Nombre completo"><Input ref={nombreRef} name="nombre" required defaultValue={inicial?.nombre} /></Campo>
      {inicial && (
        <Campo etiqueta="Estado">
          <Select name="activo" defaultValue={inicial.activo ? "on" : "off"}>
            <option value="on">Activo</option>
            <option value="off">Inactivo (ya no participa del reparto)</option>
          </Select>
        </Campo>
      )}
    </>
  );
}

export function NuevoSocio() {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton onClick={() => setAbierto(true)}><Plus className="size-4" /> Nuevo socio</Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Nuevo socio">
        <FormularioAccion accion={guardarSocio} onExito={() => setAbierto(false)} textoBoton="Crear socio" mensajeExito="Socio creado.">
          <CamposSocio />
        </FormularioAccion>
      </Modal>
    </>
  );
}

export function EditarSocio({ socio }: { socio: SocioEditable }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierto(true)}><Pencil className="size-4" /> Editar datos</Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Editar socio">
        <FormularioAccion accion={guardarSocio} onExito={() => setAbierto(false)} textoBoton="Guardar cambios" mensajeExito="Socio actualizado.">
          <CamposSocio inicial={socio} />
        </FormularioAccion>
      </Modal>
    </>
  );
}

type Opcion = { id: string; nombre: string };
// Ruta ya subida de cada archivo: si la BD rechaza el movimiento, el reintento no sube otra copia
const subidos = new WeakMap<File, string>();

/** Sube el voucher (foto o PDF) antes de llamar a la acción del servidor */
function conVoucher(empresaId: string, accion: (prev: unknown, fd: FormData) => Promise<Resultado>) {
  return async (prev: Resultado | null, fd: FormData): Promise<Resultado> => {
    const archivo = fd.get("voucher_archivo");
    fd.delete("voucher_archivo");
    if (archivo instanceof File && archivo.size > 0) {
      try {
        const ruta = subidos.get(archivo) ?? await subirArchivo(empresaId, "vouchers", archivo);
        subidos.set(archivo, ruta);
        fd.set("voucher_url", ruta);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "No se pudo subir el voucher." };
      }
    }
    return accion(prev, fd);
  };
}

function CamposVoucher({ numero }: { numero?: string | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo etiqueta="N° de voucher / operación" ayuda="Si fue en efectivo, puede dejarlo vacío">
        <Input name="voucher_numero" defaultValue={numero ?? ""} placeholder="Ej.: 004512 / OP-88213" />
      </Campo>
      <Campo etiqueta="Voucher (foto o PDF)">
        <Input name="voucher_archivo" type="file" accept="image/*,application/pdf" className="py-1.5 file:mr-2 file:rounded file:border-0 file:bg-marca-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-marca-700" />
      </Campo>
    </div>
  );
}

/** Registrar un movimiento de socio. `inicial` abre el formulario ya elegido (p. ej. «Entregar utilidad» de un socio) */
export function MovimientoSocio({ socios, cajas, empresaId, periodos, inicial, boton }: {
  socios: Opcion[]; cajas: Opcion[]; empresaId: string; periodos: string[];
  inicial?: { tipo?: TipoMovSocio; socioId?: string; periodo?: string; monto?: string };
  boton?: { texto: string; variante?: "primario" | "secundario"; chico?: boolean };
}) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoMovSocio>(inicial?.tipo ?? "aporte");
  const deUtilidad = tipo === "retiro_utilidad" || tipo === "capitalizacion";
  return (
    <>
      <Boton variante={boton?.variante ?? "primario"} tamano={boton?.chico ? "sm" : undefined}
        onClick={() => { setTipo(inicial?.tipo ?? "aporte"); setAbierto(true); }} disabled={socios.length === 0}>
        {!boton?.chico && <HandCoins className="size-4" />} {boton?.texto ?? "Registrar movimiento"}
      </Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Movimiento de socio">
        <FormularioAccion accion={conVoucher(empresaId, registrarMovimientoSocio)} onExito={() => setAbierto(false)}
          textoBoton="Registrar" mensajeExito="Movimiento registrado en el historial.">
          <Campo etiqueta="¿Qué se registra?">
            <Select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovSocio)}>
              {(Object.keys(TIPOS_MOV_SOCIO) as TipoMovSocio[]).map((t) => <option key={t} value={t}>{TIPOS_MOV_SOCIO[t].texto}</option>)}
            </Select>
          </Campo>
          <p className="-mt-1 text-xs text-stone-500">{TIPOS_MOV_SOCIO[tipo].ayuda}</p>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Socio">
              <Select name="socio_id" required defaultValue={inicial?.socioId ?? (socios.length === 1 ? socios[0].id : "")}>
                {socios.length > 1 && <option value="" disabled>Elija el socio…</option>}
                {socios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
            </Campo>
            <Campo etiqueta="Monto S/"><InputNumero name="monto" required defaultValue={inicial?.monto} /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {deUtilidad && (
              <Campo etiqueta="¿De qué mes es la utilidad?">
                <Select name="periodo" required defaultValue={inicial?.periodo ?? periodos[0]}>
                  {(inicial?.periodo && !periodos.includes(inicial.periodo) ? [inicial.periodo, ...periodos] : periodos).map((p) => <option key={p} value={p}>{nombrePeriodo(p)}</option>)}
                </Select>
              </Campo>
            )}
            {tipo !== "capitalizacion" && (
              <Campo etiqueta={tipo === "aporte" ? "Entra a la caja" : "Sale de la caja"}>
                <Select name="caja_id" required defaultValue="">
                  <option value="" disabled>Elija la caja…</option>
                  {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </Select>
              </Campo>
            )}
            <Campo etiqueta="Fecha"><Input name="fecha" type="date" defaultValue={hoyLima()} max={hoyLima()} /></Campo>
          </div>
          {tipo !== "capitalizacion" && <CamposVoucher />}
          <Campo etiqueta="Nota"><Input name="nota" placeholder={deUtilidad ? "Ej.: adelanto urgente" : "Ej.: depósito en BCP"} /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

/** «Editar el capital» del socio: se escribe el capital correcto y la diferencia queda en el historial */
export function AjustarCapital({ socio, cajas, empresaId, chico = false }: {
  socio: { id: string; nombre: string; capital: number | string }; cajas: Opcion[]; empresaId: string;
  /** Botón chico para filas de tabla; en cabeceras va del tamaño normal */
  chico?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState(String(Number(socio.capital)));
  const dif = aCentimos(nuevo) - aCentimos(String(socio.capital));
  return (
    <>
      <Boton variante="secundario" tamano={chico ? "sm" : undefined} onClick={() => { setNuevo(String(Number(socio.capital))); setAbierto(true); }}><Pencil className={chico ? "size-3.5" : "size-4"} /> Editar capital</Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Capital de ${socio.nombre}`}>
        <FormularioAccion accion={conVoucher(empresaId, ajustarCapital)} onExito={() => setAbierto(false)}
          textoBoton="Guardar capital" mensajeExito="Capital actualizado.">
          <input type="hidden" name="socio_id" value={socio.id} />
          <p className="text-sm text-stone-600">
            Capital actual: <b className="cifra">{soles(socio.capital)}</b>. Escriba el capital correcto: la diferencia se
            registra como aporte o retiro, con su motivo, y queda en el historial.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Capital correcto S/"><InputNumero name="capital" required value={nuevo} onChange={(e) => setNuevo(e.target.value)} /></Campo>
            <Campo etiqueta="Fecha"><Input name="fecha" type="date" defaultValue={hoyLima()} max={hoyLima()} /></Campo>
          </div>
          <p aria-live="polite" className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
            {dif === 0 ? "No cambia nada."
              : <>Se registrará un <b>{dif > 0 ? "aporte" : "retiro"} de <span className="cifra">{soles(Math.abs(dif) / 100)}</span></b> en el historial.</>}
          </p>
          <Campo etiqueta="¿Movió dinero?" ayuda="«No» si solo corrige el registro o el aporte fue en material">
            <Select name="caja_id" defaultValue="">
              <option value="">No, solo corregir el capital</option>
              {cajas.map((c) => <option key={c.id} value={c.id}>Sí, en {c.nombre}</option>)}
            </Select>
          </Campo>
          <CamposVoucher />
          <Campo etiqueta="Motivo (obligatorio)"><Textarea name="motivo" required placeholder="Ej.: capital inicial acordado; depósito del 05/11" /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

/** Completar el N° o subir el voucher de un movimiento ya registrado */
export function EditarVoucher({ mov, empresaId }: { mov: { id: string; voucher_numero: string | null; voucher_url: string | null; nota: string | null }; empresaId: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} title="Voucher y nota"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-marca-700 hover:bg-marca-50">
        <Paperclip className="size-3.5" /> {mov.voucher_url || mov.voucher_numero ? "Voucher" : "Subir voucher"}
      </button>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Voucher del movimiento">
        <FormularioAccion accion={conVoucher(empresaId, actualizarVoucher)} onExito={() => setAbierto(false)}
          textoBoton="Guardar" mensajeExito="Voucher guardado.">
          <input type="hidden" name="id" value={mov.id} />
          {mov.voucher_url && <input type="hidden" name="voucher_url" value={mov.voucher_url} />}
          <CamposVoucher numero={mov.voucher_numero} />
          {mov.voucher_url && <p className="text-xs text-stone-500">Ya tiene un archivo; si sube otro, lo reemplaza.</p>}
          <Campo etiqueta="Nota"><Input name="nota" defaultValue={mov.nota ?? ""} /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

export function CerrarMes({ periodos }: { periodos: string[] }) {
  const [abierto, setAbierto] = useState(false);
  if (periodos.length === 0) return null;
  const hoy = periodoActual();
  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierto(true)}><Lock className="size-4" /> Cerrar mes</Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Cerrar mes">
        <FormularioAccion accion={cerrarMes} onExito={() => setAbierto(false)} textoBoton="Cerrar mes" mensajeExito="Mes cerrado. Su reporte queda guardado.">
          <Aviso>Se guarda una foto de la caja, el material por producto, las compras, las ventas y la utilidad del mes, y ya no se pueden registrar ni anular movimientos de ese mes. Gerencia puede reabrirlo indicando el motivo.</Aviso>
          <Campo etiqueta="Mes">
            <Select name="periodo" required defaultValue={periodos.find((p) => p < hoy) ?? periodos[0]}>
              {periodos.map((p) => <option key={p} value={p}>{nombrePeriodo(p)}{p === hoy ? " (mes en curso)" : ""}</option>)}
            </Select>
          </Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

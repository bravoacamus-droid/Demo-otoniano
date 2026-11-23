"use client";

import { useRef, useState } from "react";
import { KeyRound, Pencil, Search, UserRoundPlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { hoyLima } from "@/lib/formato";
import { Aviso, Insignia } from "@/components/ui/basicos";
import { AvisoConsulta, useConsultaDocumento } from "@/components/consulta-documento";
import type { Cargo } from "../configuracion/cargos";
import { PermisosCargo } from "../configuracion/permisos-cargo";
import { guardarTrabajador } from "./acciones";

export interface TrabajadorEditable {
  id: string;
  nombre: string;
  dni: string | null;
  cargo: string | null;
  telefono: string | null;
  fecha_ingreso: string;
  fecha_cese: string | null;
  motivo_cese: string | null;
  sueldo_mensual: number | string | null;
  notas: string | null;
  /** Datos para el pago: cómo cobra y a dónde se le envía */
  pago_medio?: string | null;
  pago_celular?: string | null;
  pago_banco?: string | null;
  pago_cuenta?: string | null;
  pago_cci?: string | null;
}

/** Acceso al sistema que ya tiene el trabajador (su usuario) */
export type AccesoTrabajador = { email: string | null; activo: boolean } | null;

/** Alta o edición del trabajador. El cese se registra aquí mismo (fecha + motivo); nada se borra. */
export function BotonTrabajador({ inicial, cargos: lista, acceso = null }: {
  inicial?: TrabajadorEditable;
  /** Cargos de Configuración → Cargos y permisos */
  cargos: Cargo[];
  acceso?: AccesoTrabajador;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cese, setCese] = useState(inicial?.fecha_cese ?? "");
  const [cargo, setCargo] = useState(inicial?.cargo ?? "");
  const [darAcceso, setDarAcceso] = useState(false);
  const { estado, consultar, limpiar } = useConsultaDocumento("trabajador");
  const dniRef = useRef<HTMLInputElement>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  const activos = lista.filter((c) => c.activo);
  // Un cargo antiguo escrito a mano sigue en la lista para no perderlo al editar
  const nombres = activos.map((c) => c.nombre);
  const opciones = inicial?.cargo && !nombres.includes(inicial.cargo) ? [...nombres, inicial.cargo] : nombres;
  const elegido = activos.find((c) => c.nombre === cargo);

  /** Con los 8 dígitos del DNI se trae el nombre de RENIEC (o del registro si ya está en el sistema) */
  async function buscar() {
    const d = await consultar("DNI", dniRef.current?.value ?? "");
    if (d?.nombre && nombreRef.current) nombreRef.current.value = d.nombre;
  }
  function cerrar() {
    setAbierto(false);
    setCese(inicial?.fecha_cese ?? "");
    setCargo(inicial?.cargo ?? "");
    setDarAcceso(false);
    limpiar();
  }

  return (
    <>
      {inicial ? (
        <button type="button" onClick={() => setAbierto(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-marca-700 hover:bg-marca-50">
          <Pencil className="size-3.5" /> Editar
        </button>
      ) : (
        <Boton variante="secundario" onClick={() => setAbierto(true)}><UserRoundPlus className="size-4" /> Nuevo trabajador</Boton>
      )}
      <Modal abierto={abierto} onCerrar={cerrar} titulo={inicial ? `Editar · ${inicial.nombre}` : "Nuevo trabajador"}>
        <FormularioAccion accion={guardarTrabajador} textoBoton="Guardar" reiniciar={!inicial}
          mensajeExito={inicial ? "Ficha actualizada." : "Trabajador registrado."} onExito={cerrar}>
          {inicial && <input type="hidden" name="id" value={inicial.id} />}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="DNI" ayuda="Con los 8 dígitos se trae el nombre">
              <div className="flex gap-1.5">
                <Input ref={dniRef} name="dni" inputMode="numeric" maxLength={8} defaultValue={inicial?.dni ?? ""} autoFocus={!inicial}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    if (v !== e.target.value) e.target.value = v;
                    if (!inicial && v.length === 8) buscar();
                    else if (estado.fase !== "libre") limpiar();
                  }} />
                <Boton variante="secundario" onClick={buscar} disabled={estado.fase === "consultando"} className="shrink-0 px-3"
                  aria-label="Consultar RENIEC" title="Consultar RENIEC"><Search className="size-4" /></Boton>
              </div>
            </Campo>
            <Campo etiqueta="Cargo">
              <Select name="cargo" value={cargo} onChange={(e) => setCargo(e.target.value)}>
                <option value="">Elija el cargo…</option>
                {opciones.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Campo>
          </div>
          <AvisoConsulta estado={estado} tipo="DNI" />
          {elegido && <PermisosCargo cargo={elegido} />}
          <Campo etiqueta="Nombre completo"><Input ref={nombreRef} name="nombre" required defaultValue={inicial?.nombre} /></Campo>

          {/* Acceso al sistema: su usuario queda unido a esta ficha y toma el cargo de aquí */}
          {acceso ? (
            <p className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
              <KeyRound className="size-4 text-stone-500" /> Entra al sistema con <b>{acceso.email}</b>
              {acceso.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia>Sin acceso</Insignia>}
            </p>
          ) : (
            <div className="rounded-lg border border-stone-200 p-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input type="checkbox" name="acceso" checked={darAcceso} onChange={(e) => setDarAcceso(e.target.checked)} className="mt-0.5 size-4 accent-marca-600" />
                <span>
                  <b className="font-medium">Puede entrar al sistema</b>
                  <span className="block text-xs text-stone-500">Se le crea su usuario; verá solo lo que permite su cargo.</span>
                </span>
              </label>
              {darAcceso && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Correo"><Input name="email" type="email" required autoComplete="off" /></Campo>
                  <Campo etiqueta="Contraseña inicial" ayuda="Mínimo 6 caracteres; entréguesela.">
                    <Input name="password" type="text" minLength={6} required autoComplete="off" />
                  </Campo>
                  {!cargo && <p className="text-xs font-medium text-amber-700 sm:col-span-2">Elija el cargo: define qué pantallas verá.</p>}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Fecha de ingreso"><Input type="date" name="fecha_ingreso" required max={hoyLima()} defaultValue={inicial?.fecha_ingreso ?? hoyLima()} /></Campo>
            <Campo etiqueta="Teléfono (opcional)"><Input name="telefono" inputMode="tel" defaultValue={inicial?.telefono ?? ""} /></Campo>
            <Campo etiqueta="Sueldo mensual (S/)" ayuda="Opcional; sirve para estimar horas extras y domingos">
              <InputNumero name="sueldo_mensual" defaultValue={inicial?.sueldo_mensual != null ? String(inicial.sueldo_mensual) : ""} />
            </Campo>
            {inicial && (
              <Campo etiqueta="Fecha de cese" ayuda="Último día de trabajo; vacío si sigue">
                <Input type="date" name="fecha_cese" value={cese} min={inicial.fecha_ingreso} onChange={(e) => setCese(e.target.value)} />
              </Campo>
            )}
          </div>
          <DatosPago inicial={inicial} />
          {inicial && cese && (
            <>
              <Campo etiqueta="Motivo del cese"><Input name="motivo_cese" required defaultValue={inicial.motivo_cese ?? ""} placeholder="Ej.: renuncia, fin de contrato" /></Campo>
              <Aviso>Desde el día siguiente al cese ya no aparece en la hoja de asistencia{acceso ? " y pierde su acceso al sistema" : ""}.</Aviso>
            </>
          )}
          <Campo etiqueta="Notas (opcional)"><Textarea name="notas" rows={2} defaultValue={inicial?.notas ?? ""} /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

const MEDIOS_COBRO = [
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "yape", texto: "Yape" },
  { valor: "plin", texto: "Plin" },
  { valor: "transferencia", texto: "Transferencia" },
] as const;

/** A dónde le llega el pago: se propone al pagarle desde Personal → Pagos */
function DatosPago({ inicial }: { inicial?: TrabajadorEditable }) {
  const [medio, setMedio] = useState(inicial?.pago_medio ?? "efectivo");
  return (
    <fieldset className="rounded-xl border border-stone-200 p-3">
      <legend className="px-1 text-sm font-semibold text-stone-800">Datos para el pago</legend>
      <input type="hidden" name="pago_medio" value={medio} />
      <p className="mb-2 text-xs text-stone-500">Cómo cobra su sueldo. Al pagarle, el sistema propone estos datos.</p>
      <div role="radiogroup" aria-label="Cómo cobra" className="mb-3 flex flex-wrap gap-2">
        {MEDIOS_COBRO.map((m) => (
          <button key={m.valor} type="button" role="radio" aria-checked={medio === m.valor} onClick={() => setMedio(m.valor)}
            className={`min-w-[6.5rem] flex-1 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition ${medio === m.valor ? "border-marca-600 bg-marca-600 text-white" : "border-stone-200 bg-superficie text-stone-700 hover:border-marca-300 hover:bg-marca-50"}`}>
            {m.texto}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta={`Celular Yape / Plin${medio === "yape" || medio === "plin" ? "" : " (opcional)"}`}>
          <Input name="pago_celular" inputMode="numeric" maxLength={9} required={medio === "yape" || medio === "plin"} placeholder="9XXXXXXXX" defaultValue={inicial?.pago_celular ?? ""} />
        </Campo>
        <Campo etiqueta={`Banco${medio === "transferencia" ? "" : " (opcional)"}`}>
          <Input name="pago_banco" required={medio === "transferencia"} placeholder="Ej.: BCP, Interbank, BBVA" defaultValue={inicial?.pago_banco ?? ""} />
        </Campo>
        <Campo etiqueta={`N° de cuenta${medio === "transferencia" ? "" : " (opcional)"}`}>
          <Input name="pago_cuenta" inputMode="numeric" required={medio === "transferencia"} defaultValue={inicial?.pago_cuenta ?? ""} />
        </Campo>
        <Campo etiqueta="CCI (opcional)" ayuda="20 dígitos, para transferir desde otro banco">
          <Input name="pago_cci" inputMode="numeric" maxLength={20} defaultValue={inicial?.pago_cci ?? ""} />
        </Campo>
      </div>
    </fieldset>
  );
}

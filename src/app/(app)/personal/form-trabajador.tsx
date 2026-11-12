"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Pencil, Search, ShieldCheck, UserRoundPlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { hoyLima } from "@/lib/formato";
import { Aviso, Insignia } from "@/components/ui/basicos";
import { AvisoConsulta, useConsultaDocumento } from "@/components/consulta-documento";
import { EditarCargo, pantallasDe, type Cargo } from "../configuracion/cargos";
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
}

/** Acceso al sistema que ya tiene el trabajador (su usuario) */
export type AccesoTrabajador = { email: string | null; activo: boolean } | null;

/** Qué ve en el sistema quien tiene ese cargo, con el botón para cambiarlo ahí mismo */
function PermisosCargo({ cargo }: { cargo: Cargo }) {
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
        <Boton onClick={() => setAbierto(true)}><UserRoundPlus className="size-4" /> Nuevo trabajador</Boton>
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

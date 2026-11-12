"use client";

import { useRef, useState } from "react";
import { Pencil, Search, UserRoundPlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { hoyLima } from "@/lib/formato";
import { Aviso } from "@/components/ui/basicos";
import { AvisoConsulta, useConsultaDocumento } from "@/components/consulta-documento";
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

/** Alta o edición del trabajador. El cese se registra aquí mismo (fecha + motivo); nada se borra. */
/** `cargos`: los de Configuración → Cargos y permisos */
export function BotonTrabajador({ inicial, cargos: lista }: { inicial?: TrabajadorEditable; cargos: string[] }) {
  const [abierto, setAbierto] = useState(false);
  const [cese, setCese] = useState(inicial?.fecha_cese ?? "");
  const { estado, consultar, limpiar } = useConsultaDocumento("trabajador");
  const dniRef = useRef<HTMLInputElement>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  // Un cargo antiguo escrito a mano sigue en la lista para no perderlo al editar
  const cargos = inicial?.cargo && !lista.includes(inicial.cargo) ? [...lista, inicial.cargo] : lista;

  /** Con los 8 dígitos del DNI se trae el nombre de RENIEC (o del registro si ya está en el sistema) */
  async function buscar() {
    const d = await consultar("DNI", dniRef.current?.value ?? "");
    if (d?.nombre && nombreRef.current) nombreRef.current.value = d.nombre;
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
      <Modal abierto={abierto} onCerrar={() => { setAbierto(false); setCese(inicial?.fecha_cese ?? ""); limpiar(); }} titulo={inicial ? `Editar · ${inicial.nombre}` : "Nuevo trabajador"}>
        <FormularioAccion accion={guardarTrabajador} textoBoton="Guardar" reiniciar={!inicial}
          mensajeExito={inicial ? "Ficha actualizada." : "Trabajador registrado."} onExito={() => { setAbierto(false); limpiar(); }}>
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
              <Select name="cargo" defaultValue={inicial?.cargo ?? ""}>
                <option value="">Elija el cargo…</option>
                {cargos.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Campo>
          </div>
          <AvisoConsulta estado={estado} tipo="DNI" />
          <Campo etiqueta="Nombre completo"><Input ref={nombreRef} name="nombre" required defaultValue={inicial?.nombre} /></Campo>
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
              <Aviso>Desde el día siguiente al cese ya no aparece en la hoja de asistencia.</Aviso>
            </>
          )}
          <Campo etiqueta="Notas (opcional)"><Textarea name="notas" rows={2} defaultValue={inicial?.notas ?? ""} /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

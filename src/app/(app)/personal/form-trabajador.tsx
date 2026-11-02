"use client";

import { useState } from "react";
import { Pencil, UserRoundPlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { hoyLima } from "@/lib/formato";
import { Aviso } from "@/components/ui/basicos";
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
export function BotonTrabajador({ inicial }: { inicial?: TrabajadorEditable }) {
  const [abierto, setAbierto] = useState(false);
  const [cese, setCese] = useState(inicial?.fecha_cese ?? "");
  return (
    <>
      {inicial ? (
        <button type="button" onClick={() => setAbierto(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-marca-700 hover:bg-marca-50">
          <Pencil className="size-3.5" /> Editar
        </button>
      ) : (
        <Boton onClick={() => setAbierto(true)}><UserRoundPlus className="size-4" /> Nuevo trabajador</Boton>
      )}
      <Modal abierto={abierto} onCerrar={() => { setAbierto(false); setCese(inicial?.fecha_cese ?? ""); }} titulo={inicial ? `Editar · ${inicial.nombre}` : "Nuevo trabajador"}>
        <FormularioAccion accion={guardarTrabajador} textoBoton="Guardar" reiniciar={!inicial}
          mensajeExito={inicial ? "Ficha actualizada." : "Trabajador registrado."} onExito={() => setAbierto(false)}>
          {inicial && <input type="hidden" name="id" value={inicial.id} />}
          <Campo etiqueta="Nombre completo"><Input name="nombre" required defaultValue={inicial?.nombre} autoFocus={!inicial} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="DNI (opcional)">
              <Input name="dni" inputMode="numeric" maxLength={8} defaultValue={inicial?.dni ?? ""}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); if (v !== e.target.value) e.target.value = v; }} />
            </Campo>
            <Campo etiqueta="Cargo"><Input name="cargo" defaultValue={inicial?.cargo ?? ""} placeholder="Ej.: Balanza, Chofer" /></Campo>
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

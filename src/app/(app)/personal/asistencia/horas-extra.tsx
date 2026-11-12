"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Select } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { registrarHorasExtra } from "../acciones";

/** Horas extras: casi no hay, así que no van en la hoja. Gerencia las anota aquí y quedan aprobadas. */
export function BotonHorasExtra({ trabajadores, hoy }: { trabajadores: { id: string; nombre: string }[]; hoy: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierto(true)} disabled={trabajadores.length === 0}>
        <Clock className="size-4" /> Horas extras
      </Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Anotar horas extras">
        <FormularioAccion accion={registrarHorasExtra} onExito={() => setAbierto(false)} textoBoton="Guardar"
          mensajeExito="Horas extras anotadas (ya aprobadas).">
          <p className="text-sm text-stone-600">Solo si alguien se quedó más de su jornada. Ese día queda como «asistió» y las horas cuentan en el resumen de Personal.</p>
          <Campo etiqueta="Trabajador">
            <Select name="trabajador_id" required defaultValue={trabajadores.length === 1 ? trabajadores[0].id : ""}>
              {trabajadores.length > 1 && <option value="" disabled>Elija el trabajador…</option>}
              {trabajadores.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Día"><Input type="date" name="fecha" required max={hoy} defaultValue={hoy} /></Campo>
            <Campo etiqueta="Horas extras" ayuda="0 para quitarlas"><InputNumero name="horas" required min={0} max={16} step={0.5} /></Campo>
          </div>
          <Campo etiqueta="Nota (opcional)"><Input name="nota" placeholder="Ej.: descarga de camión" /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

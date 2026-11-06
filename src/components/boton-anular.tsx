"use client";

import { useState } from "react";
import { Ban, LockOpen } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/basicos";
import type { Resultado } from "@/lib/tipos";

const ICONOS = { anular: Ban, reabrir: LockOpen };

/** Anulación con motivo obligatorio. Nada se borra: queda quién, cuándo y por qué. */
export function BotonAnular({
  id, accion, titulo, explicacion, etiqueta = "Anular", textoConfirmar = "Confirmar anulación",
  icono = "anular", peligro = true, mensajeExito = "Anulación registrada. El registro queda en el historial con su motivo.",
  etiquetaMotivo = "Motivo", chico = false,
}: {
  id: string;
  accion: (prev: Resultado | null, fd: FormData) => Promise<Resultado>;
  titulo: string;
  explicacion?: string;
  etiqueta?: string;
  textoConfirmar?: string;
  /** Nombre del ícono (no el componente: esta prop llega desde páginas del servidor) */
  icono?: keyof typeof ICONOS;
  /** false: no es una anulación (p. ej. reabrir un mes), el botón no va en rojo */
  peligro?: boolean;
  mensajeExito?: string;
  etiquetaMotivo?: string;
  /** Botón tipo enlace, para filas de tabla junto a otras acciones chicas */
  chico?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const Icono = ICONOS[icono];
  return (
    <>
      {chico ? (
        <button type="button" onClick={() => setAbierto(true)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${peligro ? "text-red-700 hover:bg-red-50" : "text-marca-700 hover:bg-marca-50"}`}>
          <Icono className="size-3.5" /> {etiqueta}
        </button>
      ) : (
        <Boton variante="secundario" onClick={() => setAbierto(true)} className={peligro ? "text-red-700" : undefined}>
          <Icono className="size-4" /> {etiqueta}
        </Boton>
      )}
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={titulo}>
        <FormularioAccion accion={accion} textoBoton={textoConfirmar} variante={peligro ? "peligro" : "primario"} mensajeExito={mensajeExito} onExito={() => setAbierto(false)}>
          <input type="hidden" name="id" value={id} />
          {explicacion && <Aviso>{explicacion}</Aviso>}
          <Campo etiqueta={etiquetaMotivo}>
            <Textarea name="motivo" required minLength={3} placeholder="Ej.: error al digitar el peso" />
          </Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

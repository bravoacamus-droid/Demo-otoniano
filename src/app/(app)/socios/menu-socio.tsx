"use client";

import { useState } from "react";
import Link from "next/link";
import { History, Pencil, Wallet } from "lucide-react";
import { MenuPuntos, opcionMenu } from "@/components/ui/menu-puntos";
import { ModalCapital, ModalEditarSocio } from "./formularios";

/** Tres puntitos de cada socio: editar sus datos (nombre, DNI, %, estado), su capital y ver su historial */
export function MenuSocio({ socio, cajas, empresaId, puedeEditar }: {
  socio: { id: string; nombre: string; dni: string | null; porcentaje: number | string; activo: boolean; capital: number | string };
  cajas: { id: string; nombre: string }[];
  empresaId: string;
  puedeEditar: boolean;
}) {
  const [modal, setModal] = useState<"datos" | "capital" | null>(null);
  const cerrarModal = () => setModal(null);
  return (
    <>
      <MenuPuntos etiqueta={`Opciones de ${socio.nombre}`}>
        {(cerrar) => (
          <>
            {puedeEditar && (
              <>
                <button type="button" role="menuitem" className={opcionMenu} onClick={() => { cerrar(); setModal("datos"); }}>
                  <Pencil className="size-4 text-stone-500" /> Editar datos y participación
                </button>
                {socio.activo && (
                  <button type="button" role="menuitem" className={opcionMenu} onClick={() => { cerrar(); setModal("capital"); }}>
                    <Wallet className="size-4 text-stone-500" /> Editar capital
                  </button>
                )}
              </>
            )}
            <Link role="menuitem" href={`/socios/${socio.id}`} className={opcionMenu} onClick={cerrar}>
              <History className="size-4 text-stone-500" /> Ver movimientos y utilidad
            </Link>
          </>
        )}
      </MenuPuntos>
      {puedeEditar && (
        <>
          <ModalEditarSocio socio={socio} abierto={modal === "datos"} onCerrar={cerrarModal} />
          <ModalCapital socio={socio} cajas={cajas} empresaId={empresaId} abierto={modal === "capital"} onCerrar={cerrarModal} />
        </>
      )}
    </>
  );
}

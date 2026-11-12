"use client";

import { useState } from "react";
import { HandCoins } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, Input, InputNumero, Select } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { soles } from "@/lib/formato";
import { registrarAdelanto } from "../acciones";

/** Dar plata al proveedor antes de que traiga su mercadería: queda a favor y se descuenta en sus compras */
export function BotonAdelanto({ proveedor, saldo, medios }: {
  proveedor: { id: string; nombre: string };
  /** Saldo a favor que ya tiene (adelantos anteriores sin descontar) */
  saldo: number;
  medios: { id: string; nombre: string; tipo: string }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const efectivo = medios.find((m) => m.tipo === "efectivo") ?? medios[0];
  return (
    <>
      <Boton onClick={() => setAbierto(true)}><HandCoins className="size-4" /> Dar adelanto</Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Adelanto a ${proveedor.nombre}`}>
        <FormularioAccion accion={registrarAdelanto} onExito={() => setAbierto(false)} textoBoton="Registrar adelanto"
          mensajeExito="Adelanto registrado. Se descontará cuando traiga su mercadería.">
          <input type="hidden" name="proveedor_id" value={proveedor.id} />
          <p className="text-sm text-stone-600">
            El dinero sale de la caja y queda <b>a favor</b>. Cuando traiga su mercadería, la compra lo descuenta sola:
            si trae menos, el resto sigue pendiente; si trae más, se le paga la diferencia.
          </p>
          {saldo > 0 && <p className="rounded-lg bg-marca-50 px-3 py-2 text-sm text-marca-800">Ya tiene <b className="cifra">{soles(saldo)}</b> pendiente; este adelanto se suma.</p>}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Monto S/"><InputNumero name="monto" required autoFocus /></Campo>
            <Campo etiqueta="Sale de">
              <Select name="medio_id" required defaultValue={efectivo?.id ?? ""}>
                {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </Select>
            </Campo>
          </div>
          <Campo etiqueta="Nota (opcional)"><Input name="nota" placeholder="Ej.: trae cobre el lunes" /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

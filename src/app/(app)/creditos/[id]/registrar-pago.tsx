"use client";

import { useState } from "react";
import { Campo, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { soles } from "@/lib/formato";
import { normalizar } from "@/lib/montos";
import type { Caja, MedioPagoConf } from "@/lib/tipos";
import { registrarPagoCredito } from "../acciones";

/**
 * Pago de una o más cuotas. Por defecto, lo que falta de la próxima cuota; se puede pagar menos
 * (pago parcial) o más (adelanta cuotas). La BD no deja pasar del saldo.
 */
export function RegistrarPago({
  creditoId, sugerido, saldo, tipo, medios, cajas,
}: {
  creditoId: string;
  /** Lo que falta de la próxima cuota */
  sugerido: number;
  saldo: number;
  tipo: "por_cobrar" | "por_pagar";
  medios: MedioPagoConf[];
  cajas: Caja[];
}) {
  const medioInicial = medios.find((m) => m.tipo === "efectivo") ?? medios[0] ?? null;
  const [medioId, setMedioId] = useState(medioInicial?.id ?? "");
  const [cajaId, setCajaId] = useState(() => medioInicial?.caja_id ?? cajas[0]?.id ?? "");
  const cobro = tipo === "por_cobrar";
  const [monto, setMonto] = useState(sugerido.toFixed(2));
  // Un doble toque en «Registrar» no paga dos veces (la BD reconoce la clave)
  const [clave] = useState(() => crypto.randomUUID());
  const valor = Number(normalizar(monto) || 0);

  return (
    <FormularioAccion accion={registrarPagoCredito} textoBoton={cobro ? "Registrar cobro" : "Registrar pago"}
      mensajeExito={cobro ? "Cobro registrado: entró a la caja." : "Pago registrado: salió de la caja."}>
      <input type="hidden" name="credito_id" value={creditoId} />
      <input type="hidden" name="clave" value={clave} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Monto S/"
          ayuda={valor > saldo + 0.001 ? <span className="text-red-700">Es más de lo que falta ({soles(saldo)})</span>
            : valor > sugerido + 0.001 ? <span className="text-marca-700">Se adelantan cuotas · falta en total {soles(saldo)}</span>
            : `Próxima cuota ${soles(sugerido)} · falta en total ${soles(saldo)}`}>
          <InputNumero name="monto" required value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        <Campo etiqueta={cobro ? "Medio de cobro" : "Medio de pago"}>
          <Select name="medio_id" value={medioId} onChange={(e) => {
            setMedioId(e.target.value);
            const caja = medios.find((m) => m.id === e.target.value)?.caja_id;
            if (caja && cajas.some((c) => c.id === caja)) setCajaId(caja);
          }}>
            {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </Select>
        </Campo>
        <Campo etiqueta={cobro ? "Entra a la caja" : "Sale de la caja"}>
          <Select name="caja_id" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </Campo>
      </div>
      <Campo etiqueta="Nota (opcional)">
        <Textarea name="nota" rows={2} placeholder="Ej.: depósito BCP, operación 123456" />
      </Campo>
    </FormularioAccion>
  );
}

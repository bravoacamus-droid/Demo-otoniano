"use client";

import { useState } from "react";
import { ArrowLeftRight, ClipboardCheck, MinusCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, InputNumero, Select, Textarea } from "@/components/ui/campos";
import { FormularioAccion } from "@/components/ui/formulario";
import { useNotificar } from "@/components/ui/notificaciones";
import { kg } from "@/lib/formato";
import { aGramos, gramosAKg } from "@/lib/montos";
import { reclasificar, registrarAjuste, registrarConteo } from "./acciones";

type M = { id: string; nombre: string; kg: string };

/** Conteo físico: muestra lo que dice el sistema, lo contado y el faltante/sobrante antes de guardar */
function CamposConteo({ metales }: { metales: M[] }) {
  const [metal, setMetal] = useState(metales[0]?.id ?? "");
  const [contado, setContado] = useState("");
  const sistema = aGramos(String(metales.find((m) => m.id === metal)?.kg ?? "0"));
  const dif = contado.trim() === "" ? null : aGramos(contado) - sistema;
  return (
    <>
      <Campo etiqueta="Producto">
        <Select name="metal_id" required value={metal} onChange={(e) => setMetal(e.target.value)}>
          {metales.map((m) => <option key={m.id} value={m.id}>{m.nombre} · {kg(m.kg)}</option>)}
        </Select>
      </Campo>
      <Campo etiqueta="Kilos contados"><InputNumero name="kg" required value={contado} onChange={(e) => setContado(e.target.value)} /></Campo>
      <dl aria-live="polite" className="grid grid-cols-3 gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
        <div><dt className="text-xs text-stone-500">Sistema</dt><dd className="cifra font-medium">{kg(gramosAKg(sistema))}</dd></div>
        <div><dt className="text-xs text-stone-500">Contado</dt><dd className="cifra font-medium">{dif === null ? "—" : kg(gramosAKg(aGramos(contado)))}</dd></div>
        <div>
          <dt className="text-xs text-stone-500">{dif === null || dif === 0 ? "Diferencia" : dif < 0 ? "Faltante" : "Sobrante"}</dt>
          <dd className={`cifra font-semibold ${dif === null || dif === 0 ? "" : dif < 0 ? "text-red-700" : "text-emerald-700"}`}>
            {dif === null ? "—" : dif === 0 ? "Cuadra" : kg(gramosAKg(Math.abs(dif)))}
          </dd>
        </div>
      </dl>
      <Campo etiqueta={dif ? "Motivo de la diferencia (obligatorio)" : "Observación (opcional)"}>
        <Textarea name="motivo" required={!!dif} placeholder="Ej.: venta que no se registró, error de balanza, material mojado" />
      </Campo>
    </>
  );
}

export function AccionesInventario({ metales }: { metales: M[] }) {
  const [abierto, setAbierto] = useState<"conteo" | "ajuste" | "reclasificar" | null>(null);
  const notificar = useNotificar();
  const cerrar = () => setAbierto(null);
  const opciones = metales.map((m) => <option key={m.id} value={m.id}>{m.nombre} · {kg(m.kg)}</option>);

  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierto("conteo")}><ClipboardCheck className="size-4" /> Conteo físico</Boton>
      <Boton variante="secundario" onClick={() => setAbierto("ajuste")}><MinusCircle className="size-4" /> Ajuste / merma</Boton>
      <Boton variante="secundario" onClick={() => setAbierto("reclasificar")}><ArrowLeftRight className="size-4" /> Reclasificar</Boton>

      <Modal abierto={abierto === "conteo"} onCerrar={cerrar} titulo="Conteo físico">
        <FormularioAccion accion={registrarConteo} textoBoton="Registrar conteo" mensajeExito={false} onExito={(m) => { notificar({ titulo: "Conteo registrado", mensaje: String(m) }); cerrar(); }}>
          <p className="text-sm text-stone-600">Pese lo que hay en el almacén. El stock queda igual a lo contado y la diferencia (faltante o sobrante) queda registrada con su motivo, quién la hizo y cuándo, en la pestaña «Ajustes y conteos».</p>
          <CamposConteo metales={metales} />
        </FormularioAccion>
      </Modal>

      <Modal abierto={abierto === "ajuste"} onCerrar={cerrar} titulo="Ajuste de inventario">
        <FormularioAccion accion={registrarAjuste} textoBoton="Registrar ajuste" mensajeExito="Ajuste registrado." onExito={cerrar}>
          <Campo etiqueta="Producto"><Select name="metal_id" required>{opciones}</Select></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Sentido">
              <Select name="sentido" defaultValue="restar">
                <option value="restar">Restar (merma / faltante)</option>
                <option value="sumar">Sumar (sobrante)</option>
              </Select>
            </Campo>
            <Campo etiqueta="Kilos"><InputNumero name="kg" required /></Campo>
          </div>
          <Campo etiqueta="Tipo">
            <Select name="tipo" defaultValue="merma">
              <option value="merma">Merma</option>
              <option value="otro">Otro</option>
            </Select>
          </Campo>
          <Campo etiqueta="Motivo"><Textarea name="motivo" required placeholder="Ej.: humedad, limpieza del material" /></Campo>
        </FormularioAccion>
      </Modal>

      <Modal abierto={abierto === "reclasificar"} onCerrar={cerrar} titulo="Reclasificar producto">
        <FormularioAccion accion={reclasificar} textoBoton="Reclasificar" mensajeExito="Reclasificación registrada." onExito={cerrar}>
          <p className="text-sm text-stone-600">Mueve kilos de un producto a otro llevando su costo (ej.: cobre quemado → cobre brillante).</p>
          <Campo etiqueta="Desde"><Select name="origen" required>{opciones}</Select></Campo>
          <Campo etiqueta="Hacia"><Select name="destino" required defaultValue="">
            <option value="" disabled>Elija el producto…</option>{opciones}
          </Select></Campo>
          <Campo etiqueta="Kilos"><InputNumero name="kg" required /></Campo>
          <Campo etiqueta="Motivo"><Textarea name="motivo" required /></Campo>
        </FormularioAccion>
      </Modal>
    </>
  );
}

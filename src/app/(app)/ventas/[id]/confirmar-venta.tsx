"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Campo, InputNumero, Select } from "@/components/ui/campos";
import { Aviso, PuntoMetal, Tarjeta, TituloTarjeta } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { aCentimos, aGramos, centimosASoles, gramosAKg, importeCentimos, normalizar } from "@/lib/montos";
import { kg } from "@/lib/formato";
import { subirArchivo } from "@/lib/archivos";
import type { Caja, MedioPagoConf } from "@/lib/tipos";
import { confirmarVenta } from "../acciones";
import { FormaPago, errorPlan, type PlanCredito } from "@/components/plan-credito";

export function ConfirmarVenta({
  ventaId, empresaId, items, cajas, medios,
}: {
  ventaId: string;
  empresaId: string;
  items: { id: string; metal: string; color: string | null; salida: string }[];
  cajas: Caja[];
  medios: MedioPagoConf[];
}) {
  const router = useRouter();
  const [datos, setDatos] = useState(() => Object.fromEntries(items.map((i) => [i.id, { recibido: "", precio: "" }])));
  const medioInicial = medios.find((m) => m.tipo === "transferencia") ?? medios[0] ?? null;
  const [medioId, setMedioId] = useState(medioInicial?.id ?? "");
  const [cajaId, setCajaId] = useState(() => medioInicial?.caja_id ?? cajas.find((c) => c.tipo === "banco")?.id ?? cajas[0]?.id ?? "");
  function elegirMedio(id: string) {
    setMedioId(id);
    const caja = medios.find((m) => m.id === id)?.caja_id;
    if (caja && cajas.some((c) => c.id === caja)) setCajaId(caja);
  }
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [plan, setPlan] = useState<PlanCredito | null>(null);
  const sinDineroAhora = !!plan && aCentimos(plan.inicial || "0") === 0;

  const total = items.reduce((s, i) => s + importeCentimos(aGramos(datos[i.id].recibido), aCentimos(datos[i.id].precio)), 0);

  async function confirmar() {
    setError(null);
    for (const i of items) {
      if (!normalizar(datos[i.id].recibido) || !normalizar(datos[i.id].precio)) {
        return setError(`Ingrese el peso recibido y el precio de ${i.metal}.`);
      }
    }
    const errCredito = plan ? errorPlan(plan, total) : null;
    if (errCredito) return setError(errCredito);
    setGuardando(true);
    try {
      const ruta = comprobante ? await subirArchivo(empresaId, "comprobantes", comprobante) : null;
      const r = await confirmarVenta({
        venta_id: ventaId,
        caja_id: cajaId,
        medio_id: medioId || null,
        comprobante_url: ruta,
        credito: plan ? { ...plan, inicial: normalizar(plan.inicial) || "0" } : null,
        items: items.map((i) => ({
          item_id: i.id,
          peso_recibido_kg: normalizar(datos[i.id].recibido),
          precio_kg: normalizar(datos[i.id].precio),
        })),
      });
      if (!r.ok) setError(r.error);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta className="border-amber-200">
      <TituloTarjeta>Confirmar pesaje del comprador</TituloTarjeta>
      <div className="space-y-3 p-4">
        <p className="text-sm text-stone-600">
          Ingrese lo que pesó y pagó el comprador. La diferencia con la salida se registra sola como merma.
        </p>
        {items.map((i) => {
          const d = datos[i.id];
          const merma = aGramos(i.salida) - aGramos(d.recibido);
          return (
            <div key={i.id} className="grid grid-cols-2 items-end gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-4">
              <div className="col-span-2 sm:col-span-1">
                <p className="flex items-center gap-2 font-semibold"><PuntoMetal color={i.color} />{i.metal}</p>
                <p className="text-xs text-stone-500">Salió {kg(i.salida)}</p>
              </div>
              <Campo etiqueta="Recibido (kg)">
                <InputNumero value={d.recibido} onChange={(e) => setDatos({ ...datos, [i.id]: { ...d, recibido: e.target.value } })} />
              </Campo>
              <Campo etiqueta="Precio S/ por kg">
                <InputNumero value={d.precio} onChange={(e) => setDatos({ ...datos, [i.id]: { ...d, precio: e.target.value } })} />
              </Campo>
              <div className="text-right text-sm">
                <p className="text-xs text-stone-500">Merma {d.recibido ? gramosAKg(merma) : "—"} kg</p>
                <p className="cifra font-semibold">S/ {centimosASoles(importeCentimos(aGramos(d.recibido), aCentimos(d.precio)))}</p>
              </div>
            </div>
          );
        })}
        <FormaPago plan={plan} onCambio={setPlan} totalCent={total} tipo="venta" />
        {sinDineroAhora && (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">No entra dinero a caja ahora. Cada cuota se cobra desde Caja y finanzas → Créditos.</p>
        )}
        <div className={sinDineroAhora ? "grid gap-3" : "grid gap-3 sm:grid-cols-3"}>
          {!sinDineroAhora && (
            <>
          <Campo etiqueta={plan ? "Medio de cobro de la inicial" : "Medio de cobro"}>
            <Select value={medioId} onChange={(e) => elegirMedio(e.target.value)}>
              {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </Select>
          </Campo>
          <Campo etiqueta={plan ? "Entra a la caja (inicial)" : "Entra a la caja"}>
            <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Campo>
            </>
          )}
          <Campo etiqueta="Archivo del comprobante (opcional)">
            <span className="relative flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-superficie px-3 text-sm text-stone-600 focus-within:ring-2 focus-within:ring-marca-500">
              <FileUp className="size-4 shrink-0" />
              <span className="truncate">{comprobante ? comprobante.name : "Adjuntar"}</span>
              <input type="file" accept="image/*,application/pdf" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
            </span>
          </Campo>
        </div>
        {error && <Aviso tono="rojo">{error}</Aviso>}
        <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <p className="cifra text-xl font-bold">S/ {centimosASoles(total)}</p>
          <Boton onClick={confirmar} disabled={guardando}>{guardando ? "Confirmando…" : plan ? "Confirmar a crédito" : "Confirmar y cobrar"}</Boton>
        </div>
      </div>
    </Tarjeta>
  );
}

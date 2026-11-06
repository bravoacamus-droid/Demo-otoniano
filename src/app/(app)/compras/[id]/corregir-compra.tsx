"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, InputNumero, Textarea } from "@/components/ui/campos";
import { Aviso } from "@/components/ui/basicos";
import { useNotificar } from "@/components/ui/notificaciones";
import { aCentimos, aGramos, gramosAKg, importeCentimos } from "@/lib/montos";
import { kg, soles } from "@/lib/formato";
import { corregirCompra } from "../acciones";

export interface LineaCorregible {
  id: string;
  producto: string;
  peso_bruto_kg: string;
  descuento_kg: string;
  precio_kg: string;
}

/** Gerencia o Administración corrigen peso, merma o precio de un ticket ya emitido; queda registrado */
export function CorregirCompra({ compra, lineas, total, abrirAlInicio = false }: {
  compra: { id: string; numero: number }; lineas: LineaCorregible[]; total: string; abrirAlInicio?: boolean;
}) {
  const router = useRouter();
  const notificar = useNotificar();
  const [abierto, setAbierto] = useState(abrirAlInicio);
  useEffect(() => {
    if (abrirAlInicio) history.replaceState(history.state, "", location.pathname);
  }, [abrirAlInicio]);
  const inicial = () => Object.fromEntries(lineas.map((l) => [l.id, {
    bruto: String(Number(l.peso_bruto_kg)), merma: String(Number(l.descuento_kg)), precio: String(Number(l.precio_kg)),
  }]));
  const [valores, setValores] = useState(inicial);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const nuevoTotal = lineas.reduce((s, l) => {
    const v = valores[l.id];
    return s + importeCentimos(Math.max(aGramos(v.bruto) - aGramos(v.merma), 0), aCentimos(v.precio));
  }, 0);
  const dif = nuevoTotal - aCentimos(total);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const r = await corregirCompra({
        compra_id: compra.id,
        motivo,
        items: lineas.map((l) => ({ item_id: l.id, peso_bruto_kg: valores[l.id].bruto, descuento_kg: valores[l.id].merma, precio_kg: valores[l.id].precio })),
      });
      if (!r.ok) return setError(r.error);
      setAbierto(false);
      setMotivo("");
      const d = Number(r.data.diferencia);
      notificar({
        titulo: `Compra N° ${compra.numero} corregida`,
        mensaje: d === 0 ? "El total no cambió." : d > 0 ? `Se pagó ${soles(d)} más: salió de caja.` : `El proveedor devuelve ${soles(-d)}: entró a caja.`,
      });
      router.refresh();
    } catch {
      setError("No se pudo guardar. Revise la conexión e intente de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Boton variante="secundario" onClick={() => { setValores(inicial()); setMotivo(""); setError(null); setAbierto(true); }}><PencilLine className="size-4" /> Corregir</Boton>
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Corregir compra N° ${compra.numero}`}>
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            El ticket emitido no lo modifica el almacén. La corrección ajusta el stock y la caja por la diferencia y queda
            registrado quién la hizo, cuándo y por qué.
          </p>
          <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {lineas.map((l) => {
              const v = valores[l.id];
              const cambia = (campo: "bruto" | "merma" | "precio", x: string) => setValores((s) => ({ ...s, [l.id]: { ...s[l.id], [campo]: x } }));
              const neto = Math.max(aGramos(v.bruto) - aGramos(v.merma), 0);
              return (
                <div key={l.id} className="space-y-2 p-3">
                  <p className="font-medium">{l.producto}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Campo etiqueta="Bruto kg"><InputNumero value={v.bruto} onChange={(e) => cambia("bruto", e.target.value)} /></Campo>
                    <Campo etiqueta="Merma kg"><InputNumero value={v.merma} onChange={(e) => cambia("merma", e.target.value)} /></Campo>
                    <Campo etiqueta="Precio S/ kg"><InputNumero value={v.precio} onChange={(e) => cambia("precio", e.target.value)} /></Campo>
                  </div>
                  <p className="cifra text-right text-xs text-stone-500">{kg(gramosAKg(neto))} neto · {soles(importeCentimos(neto, aCentimos(v.precio)) / 100)}</p>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
            <span>Total {soles(total)} → <b className="cifra">{soles(nuevoTotal / 100)}</b></span>
            {dif !== 0 && (
              <span className={`cifra font-medium ${dif > 0 ? "text-red-700" : "text-emerald-700"}`}>
                {dif > 0 ? `Sale de caja ${soles(dif / 100)}` : `Entra a caja ${soles(-dif / 100)}`}
              </span>
            )}
          </div>
          <Campo etiqueta="Motivo de la corrección (obligatorio)">
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: la balanza marcó mal; precio acordado distinto" required />
          </Campo>
          {error && <Aviso tono="rojo">{error}</Aviso>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-stone-500">{!motivo.trim() && "Escriba el motivo para poder guardar."}</p>
            <Boton onClick={guardar} disabled={guardando || !motivo.trim()}>
              {guardando && <Loader2 className="size-4 animate-spin" />} Guardar corrección
            </Boton>
          </div>
        </div>
      </Modal>
    </>
  );
}

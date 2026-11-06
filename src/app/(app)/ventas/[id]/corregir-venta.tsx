"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Boton } from "@/components/ui/boton";
import { Campo, InputNumero, Textarea } from "@/components/ui/campos";
import { Aviso } from "@/components/ui/basicos";
import { useNotificar } from "@/components/ui/notificaciones";
import { aCentimos, aGramos, importeCentimos } from "@/lib/montos";
import { kg, soles } from "@/lib/formato";
import { corregirVenta } from "../acciones";

export interface LineaVentaCorregible {
  id: string;
  producto: string;
  peso_salida_kg: string;
  peso_recibido_kg: string;
  precio_kg: string;
}

/** Gerencia o Administración corrigen el peso recibido o el precio de una venta confirmada; queda registrado */
export function CorregirVenta({ venta, lineas, total, abrirAlInicio = false, esCredito = false }: {
  venta: { id: string; numero: number }; lineas: LineaVentaCorregible[]; total: string; abrirAlInicio?: boolean;
  /** A crédito no se mueve caja: cambia el saldo y se rehacen las cuotas */
  esCredito?: boolean;
}) {
  const router = useRouter();
  const notificar = useNotificar();
  const [abierto, setAbierto] = useState(abrirAlInicio);
  useEffect(() => {
    if (abrirAlInicio) history.replaceState(history.state, "", location.pathname);
  }, [abrirAlInicio]);
  const inicial = () => Object.fromEntries(lineas.map((l) => [l.id, {
    recibido: String(Number(l.peso_recibido_kg)), precio: String(Number(l.precio_kg)),
  }]));
  const [valores, setValores] = useState(inicial);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const nuevoTotal = lineas.reduce((s, l) => s + importeCentimos(aGramos(valores[l.id].recibido), aCentimos(valores[l.id].precio)), 0);
  const dif = nuevoTotal - aCentimos(total);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const r = await corregirVenta({
        venta_id: venta.id,
        motivo,
        items: lineas.map((l) => ({ item_id: l.id, peso_recibido_kg: valores[l.id].recibido, precio_kg: valores[l.id].precio })),
      });
      if (!r.ok) return setError(r.error);
      setAbierto(false);
      setMotivo("");
      const d = Number(r.data.diferencia);
      notificar({
        titulo: `Venta N° ${venta.numero} corregida`,
        mensaje: esCredito ? "Se ajustó el saldo del crédito y se rehicieron las cuotas."
          : d === 0 ? "El total no cambió." : d > 0 ? `Se cobra ${soles(d)} más: entró a caja.` : `Se devuelve ${soles(-d)} al comprador: salió de caja.`,
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
      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Corregir venta N° ${venta.numero}`}>
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            Corrija el peso que recibió el comprador o el precio. La caja (o el crédito) se ajusta por la diferencia y queda
            registrado quién la hizo, cuándo y por qué. Lo que salió del almacén no cambia.
          </p>
          <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {lineas.map((l) => {
              const v = valores[l.id];
              const cambia = (campo: "recibido" | "precio", x: string) => setValores((s) => ({ ...s, [l.id]: { ...s[l.id], [campo]: x } }));
              return (
                <div key={l.id} className="space-y-2 p-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{l.producto}</span>
                    <span className="cifra text-xs text-stone-500">Salió {kg(l.peso_salida_kg)}</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Campo etiqueta="Recibido kg"><InputNumero value={v.recibido} onChange={(e) => cambia("recibido", e.target.value)} /></Campo>
                    <Campo etiqueta="Precio S/ kg"><InputNumero value={v.precio} onChange={(e) => cambia("precio", e.target.value)} /></Campo>
                  </div>
                  <p className="cifra text-right text-xs text-stone-500">{soles(importeCentimos(aGramos(v.recibido), aCentimos(v.precio)) / 100)}</p>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
            <span>Total {soles(total)} → <b className="cifra">{soles(nuevoTotal / 100)}</b></span>
            {dif !== 0 && (
              <span className={`cifra font-medium ${dif > 0 ? "text-emerald-700" : "text-red-700"}`}>
                {esCredito
                  ? `El saldo del crédito ${dif > 0 ? "sube" : "baja"} ${soles(Math.abs(dif) / 100)}`
                  : dif > 0 ? `Entra a caja ${soles(dif / 100)}` : `Sale de caja ${soles(-dif / 100)}`}
              </span>
            )}
          </div>
          <Campo etiqueta="Motivo de la corrección (obligatorio)">
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el comprador pesó distinto; precio acordado 35" required />
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

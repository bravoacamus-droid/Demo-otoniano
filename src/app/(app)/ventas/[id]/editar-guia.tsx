"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { Campo, Input, Select, Textarea } from "@/components/ui/campos";
import { Aviso } from "@/components/ui/basicos";
import { Boton } from "@/components/ui/boton";
import { subirArchivo } from "@/lib/archivos";
import { actualizarGuia } from "../acciones";
import { COMPROBANTES, TIPOS_COMPROBANTE, type TipoComprobante } from "@/lib/comprobantes";

export function EditarGuia({
  ventaId, empresaId, puedeEditar, guiaNumero, guiaRuta, guiaUrl, comprobanteRuta, comprobanteUrl, notas,
  comprobanteTipo, comprobanteNumero, clienteConRuc,
}: {
  ventaId: string;
  empresaId: string;
  puedeEditar: boolean;
  guiaNumero: string | null;
  guiaRuta: string | null;
  guiaUrl: string | null;
  comprobanteRuta: string | null;
  comprobanteUrl: string | null;
  notas: string | null;
  comprobanteTipo: TipoComprobante | null;
  comprobanteNumero: string | null;
  /** Sin RUC no se ofrece factura (la BD también lo exige) */
  clienteConRuc: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [numero, setNumero] = useState(guiaNumero ?? "");
  const [nota, setNota] = useState(notas ?? "");
  const [tipo, setTipo] = useState<TipoComprobante | "">(comprobanteTipo ?? "");
  const [numeroCp, setNumeroCp] = useState(comprobanteNumero ?? "");
  const [guia, setGuia] = useState<File | null>(null);
  const [comp, setComp] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await actualizarGuia({
        venta_id: ventaId,
        guia_numero: numero.trim() || null,
        guia_url: guia ? await subirArchivo(empresaId, "guias", guia) : guiaRuta,
        comprobante_url: comp ? await subirArchivo(empresaId, "comprobantes", comp) : comprobanteRuta,
        notas: nota.trim() || null,
        comprobante_tipo: tipo || null,
        comprobante_numero: tipo ? numeroCp.trim() || null : null,
      });
      if (!r.ok) setError(r.error);
      else {
        setEditando(false);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (!editando) {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <p className="font-medium">Comprobante, guía y documentos</p>
          {puedeEditar && <button onClick={() => setEditando(true)} className="text-marca-700 hover:underline">Editar</button>}
        </div>
        <p>Guía N°: <span className="font-medium">{guiaNumero ?? "—"}</span></p>
        <div className="flex flex-wrap gap-3">
          {guiaUrl && <a href={guiaUrl} target="_blank" className="inline-flex items-center gap-1 text-marca-700 hover:underline"><Paperclip className="size-3.5" />Guía</a>}
          {comprobanteUrl && <a href={comprobanteUrl} target="_blank" className="inline-flex items-center gap-1 text-marca-700 hover:underline"><Paperclip className="size-3.5" />Archivo del comprobante</a>}
        </div>
        {notas && <p className="rounded-lg bg-stone-50 p-2 text-stone-700">{notas}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Comprobante">
          <Select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoComprobante | ""); setNumeroCp(""); }}>
            <option value="">Sin registrar</option>
            {TIPOS_COMPROBANTE.map((t) => (
              <option key={t} value={t} disabled={t === "factura" && !clienteConRuc}>
                {COMPROBANTES[t].texto}{t === "factura" && !clienteConRuc ? " (el cliente no tiene RUC)" : ""}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Serie y número">
          <Input value={numeroCp} onChange={(e) => setNumeroCp(e.target.value)} disabled={!tipo}
            placeholder={tipo ? COMPROBANTES[tipo].ejemplo : "Elija el comprobante"} autoCapitalize="characters" />
        </Campo>
      </div>
      <Campo etiqueta="N° de guía de remisión"><Input value={numero} onChange={(e) => setNumero(e.target.value)} /></Campo>
      <Campo etiqueta="Archivo de guía">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setGuia(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
      </Campo>
      <Campo etiqueta="Archivo del comprobante (foto o PDF)">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setComp(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
      </Campo>
      <Campo etiqueta="Notas"><Textarea value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
      {error && <Aviso tono="rojo">{error}</Aviso>}
      <div className="flex gap-2">
        <Boton onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</Boton>
        <Boton variante="fantasma" onClick={() => setEditando(false)}>Cancelar</Boton>
      </div>
    </div>
  );
}

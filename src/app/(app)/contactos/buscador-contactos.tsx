"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Users } from "lucide-react";
import { Insignia } from "@/components/ui/basicos";
import { Combobox } from "@/components/ui/combobox";
import { claseBoton, cx } from "@/components/ui/clases";
import { TONOS } from "@/components/shell/modulos";
import { filtrarPorTexto } from "@/lib/buscar";

export interface Contacto {
  id: string;
  tipo: "proveedor" | "cliente";
  nombre: string;
  documento: string | null;
  /** Teléfono o persona de contacto */
  extra: string | null;
  mayorista: boolean;
  activo: boolean;
}

const TIPOS = {
  proveedor: { grupo: "Proveedores", texto: "Proveedor", href: "/proveedores", icono: Users },
  cliente: { grupo: "Clientes", texto: "Cliente", href: "/compradores", icono: Building2 },
} as const;

/**
 * Desplegable con todos los contactos (proveedores y clientes) que se filtra al escribir el nombre,
 * el DNI o el RUC; al elegir uno se abre su ficha. Enter sin elegir busca en el servidor (?q=).
 */
export function BuscadorContactos({ contactos, inicial, conInactivos, verClientes }: {
  contactos: Contacto[]; inicial: string; conInactivos: boolean; verClientes: boolean;
}) {
  const [q, setQ] = useState(inicial);
  const [inactivos, setInactivos] = useState(conInactivos);
  const router = useRouter();

  const visibles = useMemo(() => contactos.filter((c) => inactivos || c.activo), [contactos, inactivos]);
  // Agrupados: proveedores primero, luego clientes (dentro de cada grupo, el orden del filtro)
  const filtrados = useMemo(() => {
    const f = filtrarPorTexto(visibles, q, (c) => c.nombre, (c) => c.documento, (c) => c.extra);
    return [...f.filter((c) => c.tipo === "proveedor"), ...f.filter((c) => c.tipo === "cliente")];
  }, [visibles, q]);

  return (
    <form method="get" className="mb-4">
      <div className="flex gap-2">
        <Combobox
          etiqueta="Buscar contacto"
          name="q"
          grande
          q={q}
          onQ={setQ}
          items={filtrados}
          total={visibles.length}
          clave={(c) => `${c.tipo}-${c.id}`}
          grupo={verClientes ? (c) => TIPOS[c.tipo].grupo : undefined}
          onElegir={(c) => router.push(`${TIPOS[c.tipo].href}/${c.id}`)}
          placeholder="Escriba el nombre, DNI o RUC, o elija de la lista"
          fila={(c) => {
            const tipo = TIPOS[c.tipo];
            return (
              <>
                <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg", TONOS.contactos.chip)}>
                  <tipo.icono className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-sm font-medium", !c.activo && "text-stone-400")}>{c.nombre}</span>
                  <span className="cifra block truncate text-xs text-stone-500">
                    {c.documento ?? "Sin documento"}{c.extra && ` · ${c.extra}`}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  {c.mayorista && <Insignia tono="azul">Mayorista</Insignia>}
                  {!c.activo && <Insignia tono="rojo">Inactivo</Insignia>}
                  {!verClientes ? null : <span className="hidden sm:inline"><Insignia>{tipo.texto}</Insignia></span>}
                </span>
              </>
            );
          }}
          vacio={
            <>
              {visibles.length === 0 ? "Aún no hay contactos." : <>No encontramos “{q.trim()}”.</>}{" "}
              Registrar como{" "}
              <Link href="/proveedores" className="font-medium text-marca-700 underline">proveedor</Link>
              {verClientes && <> o <Link href="/compradores" className="font-medium text-marca-700 underline">cliente</Link></>}.
            </>
          }
        />
        <button className={cx(claseBoton("primario", "md"), "h-12 px-5")}>Buscar</button>
      </div>
      {/* filtra la lista al instante; al pulsar Buscar también aplica a los resultados */}
      <label className="mt-2 inline-flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="inactivos" value="1" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)}
          className="size-4 accent-marca-600" />
        Incluir inactivos
      </label>
    </form>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { PuntoMetal } from "@/components/ui/basicos";
import { cx } from "@/components/ui/clases";
import { Combobox } from "@/components/ui/combobox";
import { soles } from "@/lib/formato";
import { normal } from "@/lib/buscar";
import type { ClaseProveedor, Producto } from "@/lib/tipos";

/** Precio de compra sugerido según el tipo de proveedor (el mayorista cobra su propio precio) */
export function precioSugerido(p: Pick<Producto, "precio_compra" | "precio_mayorista">, clase: ClaseProveedor | null | undefined) {
  return clase === "mayorista" && p.precio_mayorista != null ? p.precio_mayorista : p.precio_compra;
}

/** «Cobre › Cable › Quemado» → familia «Cobre › Cable» y nombre «Quemado» */
export function partesRuta(ruta: string) {
  const partes = ruta.split(" › ");
  return { familia: partes.slice(0, -1).join(" › "), nombre: partes[partes.length - 1] };
}

/**
 * Elige un producto: lista desplegable agrupada por familia (escribir o abrir con la flecha) o, abajo,
 * navegación familia → producto → variante con botones grandes
 * (pensado para el celular del almacén) o se busca por nombre o código. Lo ya agregado queda
 * marcado con su cantidad de líneas y, al tocar, el botón confirma sin mover la pantalla.
 */
export function SelectorProducto({
  productos, onElegir, precio, extra, agregados, bloqueado,
}: {
  productos: Producto[];
  onElegir: (p: Producto, desdeTeclado?: boolean) => boolean | void;
  /** Texto de precio bajo cada botón (por defecto, el de compra) */
  precio?: (p: Producto) => string;
  /** Dato extra bajo cada botón (p. ej. stock) */
  extra?: (p: Producto) => React.ReactNode;
  /** Líneas ya agregadas por producto (id → cantidad) */
  agregados?: Map<string, number>;
  /** Motivo por el que no se puede elegir (p. ej. «Sin stock»); null si se puede */
  bloqueado?: (p: Producto) => string | null;
}) {
  const [padre, setPadre] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [recien, setRecien] = useState<{ id: string; texto: string; desdeLista: boolean } | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reloj.current), []);

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const hijos = useMemo(() => {
    const m = new Map<string | null, Producto[]>();
    for (const p of productos) {
      // si el padre no está en la lista (inactivo o sin stock), el hijo se muestra arriba
      const clave = p.padre_id && porId.has(p.padre_id) ? p.padre_id : null;
      m.set(clave, [...(m.get(clave) ?? []), p]);
    }
    return m;
  }, [productos, porId]);
  // si la familia abierta dejó de existir (desactivada tras refrescar), se vuelve al inicio
  const actual = padre ? porId.get(padre) ?? null : null;
  const nivel = actual ? actual.id : null;

  /** Líneas agregadas en todo lo que cuelga de un producto */
  const agregadosBajo = (id: string): number =>
    (hijos.get(id) ?? []).reduce((s, h) => s + (agregados?.get(h.id) ?? 0) + agregadosBajo(h.id), 0);

  const lista = hijos.get(nivel) ?? [];
  const etiquetaPrecio = precio ?? ((p: Producto) => `${soles(p.precio_compra)}/kg`);

  /** Familia de primer nivel (encabezado de grupo en la lista desplegable) */
  const familiaDe = (p: Producto) => p.ruta.split(" › ")[0];
  // Lista desplegable: todo lo que se puede agregar, agrupado por familia; cada familia con variantes
  // aparece al final de su grupo como «sin clasificar» (la opción menos usada)
  const elegibles = useMemo(() => {
    const orden = new Map<string, number>();
    for (const p of productos) if (!orden.has(familiaDe(p))) orden.set(familiaDe(p), orden.size);
    return productos
      .filter((p) => !bloqueado?.(p))
      .map((p, i) => ({ p, i, g: orden.get(familiaDe(p))!, general: hijos.has(p.id) }))
      .sort((a, b) => a.g - b.g || Number(a.general) - Number(b.general) || a.i - b.i)
      .map((x) => x.p);
  }, [productos, hijos, bloqueado]);
  // Texto normalizado una vez por producto (sin tildes, minúsculas) para filtrar al escribir
  const indice = useMemo(() => elegibles.map((p) => {
    const ruta = normal(p.ruta);
    return { p, ruta, palabras: ruta.split(/[s›]+/), codigo: normal(p.codigo ?? "") };
  }), [elegibles]);
  const texto = normal(q.trim());
  // Al escribir: primero los que tienen una palabra (o el código) que empieza así, luego los que lo contienen
  const resultados = useMemo(() => {
    if (!texto) return elegibles;
    const empieza: Producto[] = [];
    const contiene: Producto[] = [];
    for (const x of indice) {
      if (x.codigo.startsWith(texto) || x.palabras.some((w) => w.startsWith(texto))) empieza.push(x.p);
      else if (x.ruta.includes(texto)) contiene.push(x.p);
    }
    return [...empieza, ...contiene];
  }, [indice, elegibles, texto]);
  /** Las variantes sin color propio toman el de su familia */
  const colorDe = (p: Producto): string | null => p.color ?? (p.padre_id && porId.has(p.padre_id) ? colorDe(porId.get(p.padre_id)!) : null);

  function elegir(p: Producto, desdeTeclado = false, desdeLista = desdeTeclado) {
    if (bloqueado?.(p)) return;
    // false = no se agregó (p. ej. en venta ya estaba y solo se fue a su línea): sin «Agregado ✓»
    const agrego = onElegir(p, desdeTeclado) !== false;
    setQ("");
    if (!agrego) return;
    setRecien({ id: p.id, texto: p.ruta, desdeLista });
    clearTimeout(reloj.current);
    reloj.current = setTimeout(() => setRecien(null), 1000);
  }
  function tocar(p: Producto) {
    // tocar una familia la abre (no agrega «Cobre» genérico por error)
    if (hijos.has(p.id)) setPadre(p.id);
    else elegir(p);
  }

  return (
    <div className="space-y-2">
      {/* Lista desplegable (escribir o abrir con la flecha) — los botones de abajo siguen para el celular */}
      <Combobox
        q={q} onQ={setQ} items={resultados} total={elegibles.length} clave={(p) => p.id}
        onElegir={(p, teclado) => elegir(p, teclado, true)}
        grupo={texto ? undefined : familiaDe}
        etiqueta="Agregar producto"
        placeholder="Escriba o elija de la lista"
        vacio={bloqueado ? "Sin productos con stock que coincidan." : "Sin productos que coincidan."}
        fila={(p) => <FilaProducto p={p} color={colorDe(p)} general={hijos.has(p.id)} conFamilia={!!texto} precio={etiquetaPrecio(p)}
          extra={extra?.(p)} n={agregados?.get(p.id) ?? 0} />}
      />
      {recien?.desdeLista && (
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-marca-700">
          <Check className="size-4 shrink-0" /> Agregado: {recien.texto}
        </p>
      )}

      {!actual && productos.length > 0 && <p className="pt-1 text-xs text-stone-500">o toque un producto:</p>}

      {/* Familia abierta: encabezado visible con «Volver» al nivel anterior */}
      {actual && (
        <div className="flex items-center gap-2 rounded-lg bg-marca-50 px-1.5 py-1.5">
          <button type="button" onClick={() => setPadre(actual.padre_id && porId.has(actual.padre_id) ? actual.padre_id : null)}
            className="flex min-h-10 shrink-0 items-center gap-0.5 rounded-md px-2 text-sm font-medium text-marca-700 hover:bg-marca-100">
            <ChevronLeft className="size-4" /> Volver
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-base font-semibold text-stone-900">
              <PuntoMetal color={actual.color} /> <span className="truncate">{actual.nombre}</span>
            </p>
            {actual.nivel > 1 && <p className="truncate text-xs text-stone-500">{partesRuta(actual.ruta).familia}</p>}
          </div>
          {actual.nivel > 1 && (
            <button type="button" onClick={() => setPadre(null)} className="min-h-10 shrink-0 rounded-md px-2 text-xs font-medium text-marca-700 hover:bg-marca-100">
              Todos
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {lista.map((p) => {
          const conHijos = hijos.has(p.id);
          const nVar = hijos.get(p.id)?.length ?? 0;
          const nBajo = conHijos ? agregadosBajo(p.id) : 0;
          return (
            <BotonProducto key={p.id} p={p} onClick={() => tocar(p)}
              detalle={conHijos
                ? <span className={cx(nBajo > 0 && "font-medium text-marca-700")}>{nVar} variante{nVar === 1 ? "" : "s"}{nBajo > 0 && ` · ${nBajo} agregada${nBajo === 1 ? "" : "s"}`}</span>
                : etiquetaPrecio(p)}
              extra={extra?.(p)} conHijos={conHijos} n={conHijos ? 0 : agregados?.get(p.id) ?? 0}
              recien={recien?.id === p.id} bloqueo={conHijos ? null : bloqueado?.(p) ?? null} />
          );
        })}
        {/* El propio nivel (sin clasificar) al final: es la opción menos usada; sin stock, no se ofrece */}
        {actual && !bloqueado?.(actual) && (
          <BotonProducto p={actual} onClick={() => elegir(actual)} general
            titulo={`${actual.nombre} sin clasificar`} detalle={<>Si no sabe la variante · {etiquetaPrecio(actual)}</>}
            extra={extra?.(actual)} n={agregados?.get(actual.id) ?? 0}
            recien={recien?.id === actual.id} bloqueo={bloqueado?.(actual) ?? null} />
        )}
      </div>
      {productos.length === 0 && <p className="py-3 text-center text-sm text-stone-500">No hay productos disponibles.</p>}
      <p aria-live="polite" className="sr-only">{recien ? `Agregado: ${recien.texto}` : ""}</p>
    </div>
  );
}

/** Fila de la lista desplegable: dentro de su grupo basta el resto de la ruta; al buscar, la ruta completa */
function FilaProducto({ p, color, general, conFamilia, precio, extra, n }: {
  p: Producto;
  color: string | null;
  general: boolean;
  conFamilia: boolean;
  precio: string;
  extra?: React.ReactNode;
  n: number;
}) {
  const partes = p.ruta.split(" › ");
  const nombre = conFamilia || partes.length === 1 ? p.ruta : partes.slice(1).join(" › ");
  return (
    <>
      {n > 0 ? <Check className="size-4 shrink-0 text-marca-700" /> : <PuntoMetal color={color} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {nombre}{general && <span className="font-normal text-stone-500"> · sin clasificar</span>}
        </span>
        {(p.codigo || extra || n > 0) && (
          <span className="block truncate text-xs text-stone-500">
            {p.codigo && <span className="mr-1.5 font-mono">{p.codigo}</span>}
            {n > 0 && <span className="mr-1.5 font-medium text-marca-700">Agregado{n > 1 ? ` ×${n}` : ""}</span>}
            {extra}
          </span>
        )}
      </span>
      <span className="cifra shrink-0 text-sm text-stone-700">{precio}</span>
    </>
  );
}

function BotonProducto({ p, onClick, titulo, detalle, extra, conHijos, general, n, recien, bloqueo }: {
  p: Producto;
  onClick: () => void;
  titulo?: string;
  detalle: React.ReactNode;
  extra?: React.ReactNode;
  conHijos?: boolean;
  general?: boolean;
  /** Cuántas líneas de este producto ya están agregadas */
  n: number;
  recien: boolean;
  bloqueo: string | null;
}) {
  const agregado = n > 0;
  return (
    <button type="button" onClick={onClick} disabled={!!bloqueo}
      className={cx(
        "relative flex min-h-14 items-center gap-2 rounded-xl border px-3 py-2 text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        recien ? "border-marca-700 bg-marca-100"
          : agregado ? "border-marca-700 bg-marca-50 ring-1 ring-marca-700"
            : general ? "border-dashed border-stone-300 bg-superficie hover:border-marca-300"
              : "border-stone-200 bg-stone-50 hover:border-marca-300",
      )}>
      {agregado ? <Check className="size-4 shrink-0 text-marca-700" /> : <PuntoMetal color={p.color} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{titulo ?? p.nombre}</span>
        <span className={cx("cifra block truncate text-xs", recien ? "font-medium text-marca-700" : "text-stone-500")}>
          {recien ? "Agregado ✓"
            : bloqueo ? bloqueo
              : <>{p.codigo && !conHijos && <span className="mr-1 font-mono">{p.codigo}</span>}{detalle}</>}
        </span>
        {extra && !bloqueo && <span className="block truncate text-xs">{extra}</span>}
        {agregado && <span className="sr-only">, agregado{n > 1 ? ` ×${n}` : ""}</span>}
      </span>
      {conHijos && <ChevronRight className="size-4 shrink-0 text-stone-400" />}
      {n > 1 && (
        <span className="cifra absolute -right-1.5 -top-1.5 rounded-full bg-marca-600 px-1.5 text-[11px] font-semibold text-white">×{n}</span>
      )}
    </button>
  );
}

/** Opciones de un <select> agrupadas por familia (los celulares no respetan la sangría con espacios) */
export function OpcionesProducto({ productos, excluir }: { productos: Producto[]; excluir?: string }) {
  const grupos: { familia: string; items: Producto[] }[] = [];
  for (const p of productos) {
    if (p.id === excluir) continue;
    const familia = p.nivel === 1 ? p.nombre : p.ruta.split(" › ")[0];
    const g = grupos.find((x) => x.familia === familia);
    if (g) g.items.push(p);
    else grupos.push({ familia, items: [p] });
  }
  return (
    <>
      {grupos.map((g) => (
        <optgroup key={g.familia} label={g.familia}>
          {g.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nivel > 1 ? p.ruta.split(" › ").slice(1).join(" › ") : p.tiene_hijos ? `${p.nombre} (sin clasificar)` : p.nombre}{p.codigo ? ` · ${p.codigo}` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

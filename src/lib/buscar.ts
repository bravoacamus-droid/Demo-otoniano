/** Minúsculas y sin tildes, para comparar lo que se escribe con nombres */
export const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Filtra una lista por lo escrito: con dígitos busca por el documento (primero los que empiezan así)
 * y el dato extra (teléfono); con letras, primero los que tienen una palabra que empieza así y luego
 * los que lo contienen en cualquier parte del nombre o del dato extra.
 */
export function filtrarPorTexto<T>(
  items: T[], q: string, nombre: (x: T) => string, documento: (x: T) => string | null | undefined,
  extra?: (x: T) => string | null | undefined,
): T[] {
  const texto = normal(q.trim());
  if (!texto) return items;
  const empieza: T[] = [];
  const contiene: T[] = [];
  if (/^\d+$/.test(texto)) {
    const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
    for (const x of items) {
      const doc = digitos(documento(x));
      if (doc.startsWith(texto)) empieza.push(x);
      else if (doc.includes(texto) || digitos(extra?.(x)).includes(texto)) contiene.push(x);
    }
  } else {
    for (const x of items) {
      const n = normal(nombre(x));
      if (n.split(/\s+/).some((w) => w.startsWith(texto))) empieza.push(x);
      else if (n.includes(texto) || normal(extra?.(x) ?? "").includes(texto)) contiene.push(x);
    }
  }
  return [...empieza, ...contiene];
}

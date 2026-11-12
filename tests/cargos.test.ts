import { describe, expect, it } from "vitest";
import { modulosPara, rutaPermitida } from "@/components/shell/modulos";

describe("Pantallas por cargo", () => {
  const balanza = ["/comprar", "/precios"];
  it("deja entrar solo a lo marcado y a sus rutas de apoyo", () => {
    expect(rutaPermitida("/comprar", balanza)).toBe(true);
    expect(rutaPermitida("/compras/abc/ticket", balanza)).toBe(true);   // el ticket que acaba de emitir
    expect(rutaPermitida("/compras", balanza)).toBe(false);
    expect(rutaPermitida("/compras/reportes", balanza)).toBe(false);
    expect(rutaPermitida("/caja", balanza)).toBe(false);
    expect(rutaPermitida("/ventas/xyz", balanza)).toBe(false);
  });
  it("Inicio, Mi cuenta, impresión y sin cargo restringido siempre pasan", () => {
    for (const r of ["/", "/cuenta", "/imprimir/compra/1", "/sin-permiso"]) expect(rutaPermitida(r, balanza)).toBe(true);
    expect(rutaPermitida("/caja", null)).toBe(true);
  });
  it("el menú muestra solo lo marcado", () => {
    const hrefs = modulosPara("cajero", balanza).flatMap((m) => m.items.map((i) => i.href));
    expect(hrefs).toEqual(["/", "/comprar", "/precios"]);
  });
});

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR permite compilar producción aparte (p. ej. .next-prod) sin pisar el pnpm dev en curso
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Indicador de Next (solo en pnpm dev) a la derecha: a la izquierda tapaba el botón de contraer el menú
  devIndicators: { position: "bottom-right" },
  // «Despacho» pasó a llamarse «Limpieza» (reunión del 23/10): los enlaces viejos siguen funcionando
  async redirects() {
    return [{ source: "/despacho", destination: "/limpieza", permanent: false }];
  },
  serverExternalPackages: ["@react-pdf/renderer", "exceljs"],
  // pdfkit carga Helvetica con un import dinámico (#standard-fonts/...) que el rastreo de archivos no ve:
  // sin esto, en Vercel todo PDF fallaba con «Cannot find module .../standard-fonts/Helvetica.cjs»
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/**", "./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/data/**"],
  },
  experimental: {
    // Caché del router en el navegador: volver a una sección ya visitada o precargada (enlaces del
    // menú con prefetch) es inmediato. 30 s como máximo; registrar algo invalida todo al instante
    // (las acciones llaman revalidatePath).
    staleTimes: { dynamic: 30, static: 30 },
  },
};

export default nextConfig;

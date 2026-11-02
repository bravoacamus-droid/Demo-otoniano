import { EsqueletoEncabezado, EsqueletoTabla } from "@/components/ui/esqueleto";

/** Encabezado y la hoja del día */
export default function Cargando() {
  return (
    <>
      <EsqueletoEncabezado />
      <EsqueletoTabla filas={5} />
    </>
  );
}

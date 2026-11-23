import { EsqueletoEncabezado, EsqueletoKpis, EsqueletoTabla } from "@/components/ui/esqueleto";

/** Mismo orden que la página: encabezado, indicadores y la lista de trabajadores */
export default function Cargando() {
  return (
    <>
      <EsqueletoEncabezado acciones={false} />
      <EsqueletoKpis />
      <EsqueletoTabla filas={6} />
    </>
  );
}

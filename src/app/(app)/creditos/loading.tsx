import { EsqueletoEncabezado, EsqueletoKpis, EsqueletoTabla } from "@/components/ui/esqueleto";

/** Mismo orden que la página: encabezado, totales por cobrar/pagar y la lista */
export default function Cargando() {
  return (
    <>
      <EsqueletoEncabezado acciones={false} />
      <EsqueletoKpis />
      <EsqueletoTabla filas={6} />
    </>
  );
}

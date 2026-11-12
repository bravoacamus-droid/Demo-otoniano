import { BotonLink } from "@/components/ui/boton";
import { RefrescarMenu } from "./refrescar-menu";

export default function SinPermiso() {
  return (
    <div className="mx-auto max-w-sm py-16 text-center">
      <RefrescarMenu />
      <h1 className="text-lg font-semibold">Su cargo no tiene acceso a esta pantalla</h1>
      <p className="mt-2 text-sm text-stone-500">Si la necesita, pídale a Gerencia que la marque en su cargo (Configuración → Cargos y permisos).</p>
      <BotonLink href="/" variante="secundario" className="mt-4">Ir al inicio</BotonLink>
    </div>
  );
}

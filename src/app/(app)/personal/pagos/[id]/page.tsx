import { redirect } from "next/navigation";

/** El historial de pagos es uno solo (con filtro por trabajador): esta ruta lleva ahí */
export default async function HistorialTrabajador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/personal/pagos?vista=historial&trabajador=${encodeURIComponent(id)}`);
}

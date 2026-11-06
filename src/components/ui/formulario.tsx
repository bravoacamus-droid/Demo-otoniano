"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { Resultado } from "@/lib/tipos";
import { Aviso } from "./basicos";
import { Boton } from "./boton";
import type { Variante } from "./clases";
import { useNotificar } from "./notificaciones";

type Accion = (prev: Resultado | null, fd: FormData) => Promise<Resultado>;

/**
 * Envuelve un server action que devuelve Resultado: muestra el error, deshabilita el botón
 * mientras guarda, confirma con una notificación y llama a onExito (o refresca) cuando sale bien.
 * `mensajeExito={false}` cuando la pantalla ya muestra su propia confirmación.
 * Las acciones no llaman revalidatePath (haría esperar al botón mientras se re-arma toda la página):
 * el refresco va aquí, en segundo plano, después de confirmar.
 */
export function FormularioAccion({
  accion, children, textoBoton = "Guardar", variante = "primario", onExito, className, reiniciar = true,
  mensajeExito = "Cambios guardados correctamente.", confirmar,
}: {
  accion: Accion;
  children: React.ReactNode;
  textoBoton?: string;
  variante?: Variante;
  onExito?: (data: unknown) => void;
  className?: string;
  reiniciar?: boolean;
  mensajeExito?: string | false;
  /** Pregunta antes de enviar (acciones que liberan pagos o no se deshacen fácil) */
  confirmar?: string;
}) {
  const [estado, enviar, pendiente] = useActionState<Resultado | null, FormData>(accion, null);
  const [, iniciar] = useTransition();
  const router = useRouter();
  const notificar = useNotificar();
  const formRef = useRef<HTMLFormElement>(null);
  const exitoRef = useRef({ onExito, mensajeExito });
  exitoRef.current = { onExito, mensajeExito };

  useEffect(() => {
    if (estado?.ok) {
      if (reiniciar) formRef.current?.reset();
      const { onExito, mensajeExito } = exitoRef.current;
      if (mensajeExito) notificar({ titulo: mensajeExito });
      if (onExito) onExito(estado.data);
      router.refresh();
    }
  }, [estado, reiniciar, router, notificar]);

  return (
    // Se envía desde onSubmit y no con <form action>: React 19 vacía el formulario al terminar la acción
    // aunque devuelva un error, y el usuario perdería lo escrito. Al salir bien lo reinicia el efecto de arriba.
    <form ref={formRef} className={className ?? "space-y-3"}
      onSubmit={(e) => {
        e.preventDefault();
        if (pendiente || (confirmar && !window.confirm(confirmar))) return;
        const fd = new FormData(e.currentTarget);
        iniciar(() => enviar(fd));
      }}>
      {children}
      {estado && !estado.ok && <div className="animar-sacudir"><Aviso tono="rojo">{estado.error}</Aviso></div>}
      <Boton type="submit" variante={variante} disabled={pendiente} className="w-full sm:w-auto">
        {pendiente ? <><Loader2 className="size-4 animate-spin" /> Guardando…</> : textoBoton}
      </Boton>
    </form>
  );
}

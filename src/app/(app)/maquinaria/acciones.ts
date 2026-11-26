"use server";

import { obtenerContexto } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import { hoyLima } from "@/lib/formato";
import type { Resultado } from "@/lib/tipos";

/** Fecha elegida en el formulario (hoy = ahora mismo; otro día = mediodía de Lima de ese día) */
const fechaLima = (fd: FormData) => {
  const f = texto(fd, "fecha");
  return f && f !== hoyLima() ? `${f}T12:00:00-05:00` : undefined;
};

/** Crear (sin id) o editar una máquina. Al crearla puede registrarse lo que costó: de una caja o pagado por fuera */
export async function guardarMaquina(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const valor = normalizar(texto(fd, "valor_compra") ?? "");
  const pago = texto(fd, "pago");
  // Parámetros sin valor por defecto en la BD: van siempre, con null si están vacíos
  const nulo = <T,>(v: T | null | undefined) => (v ?? null) as T;
  const { data, error } = await supabase.rpc("guardar_maquina", {
    p_empresa: empresa.id, p_id: nulo(texto(fd, "id")), p_nombre: texto(fd, "nombre") ?? "", p_tipo: texto(fd, "tipo") ?? "",
    p_marca: texto(fd, "marca") ?? "", p_modelo: texto(fd, "modelo") ?? "", p_serie: texto(fd, "serie") ?? "",
    p_cantidad: Number(texto(fd, "cantidad") ?? "1") || 1, p_fecha_adquisicion: nulo(texto(fd, "fecha_adquisicion")),
    p_valor_compra: nulo(valor ? Number(valor) : null), p_estado: texto(fd, "estado") ?? "operativo",
    p_ubicacion: texto(fd, "ubicacion") ?? "", p_responsable: texto(fd, "responsable") ?? "", p_notas: texto(fd, "notas") ?? "",
    p_razon: texto(fd, "razon") ?? undefined,
    p_pago: pago === "caja" || pago === "fuera" ? pago : undefined,
    p_caja: pago === "caja" ? texto(fd, "caja_id") ?? undefined : undefined,
  });
  if (error) return fallo(error);
  return ok(data);
}

/** Gasto (de una caja o pagado por fuera) o ingreso (a una caja) de una máquina */
export async function registrarMovimientoMaquina(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const monto = normalizar(texto(fd, "monto") ?? "");
  if (!monto) return fallo("Ingrese el monto.");
  const caja = texto(fd, "caja_id");
  const { error } = await supabase.rpc("registrar_movimiento_maquina", {
    p_maquina: texto(fd, "maquina_id")!, p_tipo: texto(fd, "tipo") ?? "", p_categoria: texto(fd, "categoria") ?? "",
    p_monto: Number(monto), p_caja: caja && caja !== "fuera" ? caja : undefined,
    p_detalle: texto(fd, "detalle") ?? undefined, p_fecha: fechaLima(fd),
  });
  if (error) return fallo(error);
  return ok(null);
}

"use server";

import { obtenerContexto } from "@/lib/contexto";
import { fallo, ok, texto } from "@/lib/acciones";
import { normalizar } from "@/lib/montos";
import type { Resultado, ResumenTurno } from "@/lib/tipos";

function monto(fd: FormData, campo = "monto") {
  return normalizar(texto(fd, campo) ?? "");
}

/**
 * Gasto: sale de una caja (caja_id) o «ninguna» = solo registro (herramientas, combustible pagado por fuera…).
 * Categoría «otro»: se escribe en qué se gastó; Gerencia puede guardarlo como categoría nueva.
 */
export async function registrarGasto(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa, rol } = await obtenerContexto();
  const m = monto(fd);
  if (!m) return fallo("Ingrese el monto.");
  const origen = texto(fd, "caja_id");
  if (!origen) return fallo("Elija de dónde salió el dinero.");
  let categoria = texto(fd, "categoria_id");
  let concepto = texto(fd, "concepto");
  if (categoria === "otro") {
    const otro = texto(fd, "otro");
    if (!otro) return fallo("Escriba en qué se gastó.");
    categoria = null;
    if (fd.get("guardar_categoria") === "on" && rol === "dueno") {
      // Si ya existe (aunque esté desactivada) se reutiliza
      const { data: hay } = await supabase.from("categorias_gasto").select("id").eq("empresa_id", empresa.id).ilike("nombre", otro).maybeSingle();
      if (hay) {
        categoria = hay.id;
        await supabase.from("categorias_gasto").update({ activo: true }).eq("id", hay.id);
      } else {
        const { data: nueva, error } = await supabase.from("categorias_gasto").insert({ empresa_id: empresa.id, nombre: otro }).select("id").single();
        if (error) return fallo(error);
        categoria = nueva.id;
      }
      concepto = concepto ?? otro;
    } else {
      concepto = concepto ? `${otro}: ${concepto}` : otro;
    }
  } else if (!concepto && categoria) {
    // Sin detalle: el concepto es la categoría
    const { data: c } = await supabase.from("categorias_gasto").select("nombre").eq("id", categoria).maybeSingle();
    concepto = c?.nombre ?? null;
  }
  if (!concepto) return fallo("Elija la categoría o escriba el detalle del gasto.");

  const { error } = origen === "ninguna"
    ? await supabase.rpc("registrar_gasto_sin_caja", {
      p_empresa: empresa.id, p_monto: Number(m), p_concepto: concepto,
      p_categoria: categoria ?? undefined, p_comprobante_url: texto(fd, "comprobante_url") ?? undefined,
    })
    : await supabase.rpc("registrar_gasto", {
      p_empresa: empresa.id, p_caja: origen, p_monto: m, p_concepto: concepto,
      p_categoria: categoria, p_comprobante_url: texto(fd, "comprobante_url"),
    });
  if (error) return fallo(error);
  return ok(null);
}

export async function corregirCierre(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const m = monto(fd, "contado");
  if (!m) return fallo("Ingrese el efectivo contado al cerrar (puede ser 0).");
  const { error } = await supabase.rpc("corregir_cierre", {
    p_turno: texto(fd, "id")!, p_contado: Number(m), p_nota: texto(fd, "nota")!, p_razon: texto(fd, "razon")!,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularGasto(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_gasto", { p_gasto: texto(fd, "id"), p_motivo: texto(fd, "motivo") });
  if (error) return fallo(error);
  return ok(null);
}

export async function registrarTraspaso(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const m = monto(fd);
  if (!m) return fallo("Ingrese el monto.");
  const { error } = await supabase.rpc("registrar_traspaso", {
    p_empresa: empresa.id, p_origen: texto(fd, "origen"), p_destino: texto(fd, "destino"),
    p_monto: m, p_concepto: texto(fd, "concepto"),
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularTraspaso(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_traspaso", { p_traspaso: texto(fd, "id"), p_motivo: texto(fd, "motivo") });
  if (error) return fallo(error);
  return ok(null);
}

export async function registrarArqueo(_: unknown, fd: FormData): Promise<Resultado<{ diferencia: number; saldo_sistema: number }>> {
  const { supabase, empresa } = await obtenerContexto();
  const m = monto(fd, "contado");
  if (!m) return fallo("Ingrese el efectivo contado.");
  const { data, error } = await supabase.rpc("registrar_arqueo", {
    p_empresa: empresa.id, p_caja: texto(fd, "caja_id"), p_contado: m, p_nota: texto(fd, "nota"),
    p_ajustar: fd.get("ajustar") === "on",
  });
  if (error) return fallo(error);
  return ok(data as { diferencia: number; saldo_sistema: number });
}

export async function abrirCaja(_: unknown, fd: FormData): Promise<Resultado<{ numero: number; diferencia: number }>> {
  const { supabase, empresa } = await obtenerContexto();
  const m = monto(fd, "contado");
  if (!m) return fallo("Ingrese el efectivo con que empieza la caja (puede ser 0).");
  const { data, error } = await supabase.rpc("abrir_caja", {
    p_empresa: empresa.id, p_caja: texto(fd, "caja_id")!, p_contado: Number(m), p_nota: texto(fd, "nota") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(data as { numero: number; diferencia: number });
}

export async function cerrarCaja(_: unknown, fd: FormData): Promise<Resultado<ResumenTurno>> {
  const { supabase } = await obtenerContexto();
  const m = monto(fd, "contado");
  if (!m) return fallo("Ingrese el efectivo contado al cierre (puede ser 0).");
  const { data, error } = await supabase.rpc("cerrar_caja", {
    p_turno: texto(fd, "turno_id")!, p_contado: Number(m), p_nota: texto(fd, "nota") ?? undefined,
    p_ajustar: fd.get("ajustar") === "on",
  });
  if (error) return fallo(error);
  return ok(data as unknown as ResumenTurno);
}

/** Ingreso o salida de dinero a mano (sobrante, faltante, otro) o préstamo / devolución de préstamo */
export async function registrarMovimientoManual(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const m = monto(fd);
  if (!m) return fallo("Ingrese el monto.");
  const tipo = texto(fd, "tipo") === "egreso" ? "egreso" : "ingreso";
  const { error } = await supabase.rpc("registrar_movimiento_manual", {
    p_empresa: empresa.id, p_caja: texto(fd, "caja_id")!, p_tipo: tipo, p_clase: texto(fd, "clase") ?? "ajuste",
    p_monto: Number(m), p_motivo: texto(fd, "motivo")!, p_persona: texto(fd, "persona") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function editarMovimientoManual(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const m = monto(fd);
  if (!m) return fallo("Ingrese el monto.");
  const { error } = await supabase.rpc("editar_movimiento_manual", {
    p_id: texto(fd, "id")!, p_caja: texto(fd, "caja_id")!, p_monto: Number(m), p_motivo: texto(fd, "motivo")!,
    p_persona: texto(fd, "persona") ?? "", p_razon: texto(fd, "razon")!,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularMovimientoManual(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_movimiento_manual", { p_id: texto(fd, "id")!, p_motivo: texto(fd, "motivo")! });
  if (error) return fallo(error);
  return ok(null);
}

export async function editarGasto(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const m = monto(fd);
  if (!m) return fallo("Ingrese el monto.");
  const sinCaja = fd.get("sin_caja") === "1";
  const { error } = sinCaja
    ? await supabase.rpc("editar_gasto_sin_caja", {
      p_id: texto(fd, "id")!, p_monto: Number(m), p_concepto: texto(fd, "concepto")!,
      p_categoria: texto(fd, "categoria_id")!, p_razon: texto(fd, "razon")!,
    })
    : await supabase.rpc("editar_gasto", {
      p_gasto: texto(fd, "id")!, p_monto: Number(m), p_concepto: texto(fd, "concepto")!,
      p_categoria: texto(fd, "categoria_id")!, p_caja: texto(fd, "caja_id")!, p_razon: texto(fd, "razon")!,
    });
  if (error) return fallo(error);
  return ok(null);
}

/** Bienes o gastos pagados por fuera (no salen de ninguna caja): solo quedan registrados */
export async function registrarGastoSinCaja(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase, empresa } = await obtenerContexto();
  const m = monto(fd);
  if (!m) return fallo("Ingrese el monto.");
  const { error } = await supabase.rpc("registrar_gasto_sin_caja", {
    p_empresa: empresa.id, p_monto: Number(m), p_concepto: texto(fd, "concepto")!,
    p_categoria: texto(fd, "categoria_id") ?? undefined, p_comprobante_url: texto(fd, "comprobante_url") ?? undefined,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularGastoSinCaja(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_gasto_sin_caja", { p_id: texto(fd, "id")!, p_motivo: texto(fd, "motivo")! });
  if (error) return fallo(error);
  return ok(null);
}

export async function corregirApertura(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const m = monto(fd, "contado");
  if (!m) return fallo("Ingrese el efectivo contado al abrir (puede ser 0).");
  const { error } = await supabase.rpc("corregir_apertura", {
    p_turno: texto(fd, "id")!, p_contado: Number(m), p_nota: texto(fd, "nota")!, p_razon: texto(fd, "razon")!,
  });
  if (error) return fallo(error);
  return ok(null);
}

export async function anularTurno(_: unknown, fd: FormData): Promise<Resultado> {
  const { supabase } = await obtenerContexto();
  const { error } = await supabase.rpc("anular_turno", { p_turno: texto(fd, "id")!, p_motivo: texto(fd, "motivo")! });
  if (error) return fallo(error);
  return ok(null);
}

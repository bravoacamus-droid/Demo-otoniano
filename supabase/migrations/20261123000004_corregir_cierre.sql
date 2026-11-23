-- =============================================================================
-- Corregir el cierre de caja (pedido del 23/11): Gerencia/Administración corrigen el efectivo contado al
-- cerrar y la nota, con motivo obligatorio. Si ese cierre ajustó la caja, el ajuste se rehace con la
-- diferencia nueva (el anterior queda anulado). El historial guarda el valor anterior (que = 'cierre').
-- =============================================================================

create or replace function corregir_cierre(p_turno uuid, p_contado numeric, p_nota text, p_razon text)
returns void
language plpgsql security definer set search_path = public
as $$
declare t turnos_caja;
begin
  select * into t from turnos_caja where id = p_turno for update;
  if not found then raise exception 'Turno no encontrado.'; end if;
  perform exigir_rol(t.empresa_id, '{dueno,administrador}');
  if t.anulado_en is not null then raise exception 'El turno N° % está anulado.', t.numero; end if;
  if t.cerrado_en is null then raise exception 'El turno N° % aún no se cierra.', t.numero; end if;
  if p_contado is null or p_contado < 0 then raise exception 'El monto contado no puede ser negativo.'; end if;
  if _texto(p_razon) is null then raise exception 'Indique por qué se corrige.'; end if;

  update turnos_caja
     set contado_cierre = round(p_contado, 2), nota_cierre = _texto(p_nota),
         historial = historial || jsonb_build_array(jsonb_build_object(
           'que', 'cierre', 'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'contado_cierre', t.contado_cierre, 'nota_cierre', t.nota_cierre))
   where id = p_turno
  returning * into t;

  if t.ajustado then
    update movimientos_caja set anulado = true where origen = 'ajuste' and origen_id = p_turno and not anulado;
    if t.diferencia_cierre <> 0 then
      perform _mov_caja(t.empresa_id, t.caja_id, t.cerrado_en,
                        case when t.diferencia_cierre > 0 then 'ingreso'::tipo_mov_caja else 'egreso'::tipo_mov_caja end,
                        'ajuste', t.id, abs(t.diferencia_cierre), 'Ajuste por cierre de caja N° ' || t.numero || ' (corregido)');
    end if;
  end if;
end $$;

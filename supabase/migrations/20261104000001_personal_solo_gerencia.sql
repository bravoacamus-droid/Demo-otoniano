-- =============================================================================
-- Personal solo para Gerencia (pedido del 04/11): fichas, sueldos, ingreso/cese y asistencia
-- los ve y los registra únicamente el dueño. Administración y Almacén no ven nada del personal.
-- =============================================================================
drop policy trabajadores_select on trabajadores;
drop policy trabajadores_insert on trabajadores;
drop policy trabajadores_update on trabajadores;
drop policy asistencias_select on asistencias;

create policy trabajadores_select on trabajadores for select to authenticated
  using (tiene_rol(empresa_id, '{dueno}'));
create policy trabajadores_insert on trabajadores for insert to authenticated
  with check (tiene_rol(empresa_id, '{dueno}'));
create policy trabajadores_update on trabajadores for update to authenticated
  using (tiene_rol(empresa_id, '{dueno}')) with check (tiene_rol(empresa_id, '{dueno}'));
create policy asistencias_select on asistencias for select to authenticated
  using (tiene_rol(empresa_id, '{dueno}'));

-- Igual que en 20261102000005, pero solo Gerencia marca la asistencia
create or replace function guardar_asistencia(p_empresa uuid, p_fecha date, p_filas jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  f        jsonb;
  t        trabajadores;
  v_estado estado_asistencia;
  v_horas  numeric(5,2);
  v_n      integer := 0;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  if p_fecha is null then raise exception 'Indique la fecha.'; end if;
  if p_fecha > (now() at time zone 'America/Lima')::date then
    raise exception 'No se puede registrar asistencia de días futuros.';
  end if;

  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    continue when _texto(f->>'estado') is null;
    select * into t from trabajadores where id = (f->>'trabajador_id')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Trabajador no válido.'; end if;
    if p_fecha < t.fecha_ingreso or (t.fecha_cese is not null and p_fecha > t.fecha_cese) then
      raise exception '% no trabajaba en la empresa el %.', t.nombre, to_char(p_fecha, 'DD/MM/YYYY');
    end if;
    v_estado := (f->>'estado')::estado_asistencia;
    v_horas  := round(coalesce(nullif(f->>'horas_extra', '')::numeric, 0), 2);
    if v_horas < 0 or v_horas > 16 then raise exception 'Horas extras de % fuera de rango (0 a 16).', t.nombre; end if;
    if v_estado <> 'asistio' then v_horas := 0; end if;

    insert into asistencias (empresa_id, trabajador_id, fecha, estado, entrada, salida, horas_extra, nota, registrado_por)
    values (p_empresa, t.id, p_fecha, v_estado, nullif(f->>'entrada', '')::time, nullif(f->>'salida', '')::time,
            v_horas, _texto(f->>'nota'), auth.uid())
    on conflict (trabajador_id, fecha) do update
       set estado = excluded.estado, entrada = excluded.entrada, salida = excluded.salida,
           horas_extra = excluded.horas_extra, nota = excluded.nota,
           registrado_por = excluded.registrado_por, actualizado_en = now(),
           extra_aprobada = asistencias.extra_aprobada and asistencias.horas_extra = excluded.horas_extra,
           aprobado_por = case when asistencias.horas_extra = excluded.horas_extra then asistencias.aprobado_por end,
           aprobado_en  = case when asistencias.horas_extra = excluded.horas_extra then asistencias.aprobado_en end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

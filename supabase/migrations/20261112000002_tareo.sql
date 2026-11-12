-- =============================================================================
-- Tareo mensual (pedido del Sr. Otiniano, 12/11)
--  · La asistencia se marca en una cuadrícula del mes (trabajador × día): solo el estado de cada casilla.
--  · Las horas extras salen de la hoja: casi no hay. Si alguna vez hay, Gerencia las anota aparte y quedan
--    aprobadas (las anota quien las aprueba).
-- =============================================================================

/** Casillas del tareo: p_celdas = [{ trabajador_id, fecha, estado }]. Cambiar el estado no toca horario ni nota;
    si deja de ser «asistió», las horas extras de ese día se quitan. */
create or replace function guardar_tareo(p_empresa uuid, p_celdas jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  c        jsonb;
  t        trabajadores;
  v_fecha  date;
  v_estado estado_asistencia;
  v_n      integer := 0;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  for c in select * from jsonb_array_elements(coalesce(p_celdas, '[]'::jsonb)) loop
    continue when _texto(c->>'estado') is null;
    v_fecha  := (c->>'fecha')::date;
    v_estado := (c->>'estado')::estado_asistencia;
    if v_fecha > (now() at time zone 'America/Lima')::date then
      raise exception 'No se puede registrar asistencia de días futuros.';
    end if;
    select * into t from trabajadores where id = (c->>'trabajador_id')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Trabajador no válido.'; end if;
    if v_fecha < t.fecha_ingreso or (t.fecha_cese is not null and v_fecha > t.fecha_cese) then
      raise exception '% no trabajaba en la empresa el %.', t.nombre, to_char(v_fecha, 'DD/MM/YYYY');
    end if;

    insert into asistencias (empresa_id, trabajador_id, fecha, estado, registrado_por)
    values (p_empresa, t.id, v_fecha, v_estado, auth.uid())
    on conflict (trabajador_id, fecha) do update
       set estado = excluded.estado, registrado_por = excluded.registrado_por, actualizado_en = now(),
           horas_extra    = case when excluded.estado = 'asistio' then asistencias.horas_extra else 0 end,
           extra_aprobada = excluded.estado = 'asistio' and asistencias.extra_aprobada,
           entrada        = case when excluded.estado = 'asistio' then asistencias.entrada end,
           salida         = case when excluded.estado = 'asistio' then asistencias.salida end
     where asistencias.estado is distinct from excluded.estado;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

/** Gerencia anota horas extras de un día (0 = quitarlas). El día queda como «asistió» y las horas, aprobadas. */
create or replace function registrar_horas_extra(p_empresa uuid, p_trabajador uuid, p_fecha date, p_horas numeric, p_nota text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t       trabajadores;
  v_horas numeric(5,2) := round(coalesce(p_horas, 0), 2);
begin
  perform exigir_rol(p_empresa, '{dueno}');
  if p_fecha is null or p_fecha > (now() at time zone 'America/Lima')::date then
    raise exception 'Indique un día que ya pasó.';
  end if;
  if v_horas < 0 or v_horas > 16 then raise exception 'Las horas extras deben estar entre 0 y 16.'; end if;
  select * into t from trabajadores where id = p_trabajador and empresa_id = p_empresa;
  if not found then raise exception 'Trabajador no válido.'; end if;
  if p_fecha < t.fecha_ingreso or (t.fecha_cese is not null and p_fecha > t.fecha_cese) then
    raise exception '% no trabajaba en la empresa el %.', t.nombre, to_char(p_fecha, 'DD/MM/YYYY');
  end if;

  insert into asistencias (empresa_id, trabajador_id, fecha, estado, horas_extra, extra_aprobada, aprobado_por, aprobado_en, nota, registrado_por)
  values (p_empresa, t.id, p_fecha, 'asistio', v_horas, v_horas > 0, auth.uid(), now(), _texto(p_nota), auth.uid())
  on conflict (trabajador_id, fecha) do update
     set estado = 'asistio', horas_extra = v_horas, extra_aprobada = v_horas > 0,
         aprobado_por = auth.uid(), aprobado_en = now(),
         nota = coalesce(_texto(p_nota), asistencias.nota), actualizado_en = now();
end $$;

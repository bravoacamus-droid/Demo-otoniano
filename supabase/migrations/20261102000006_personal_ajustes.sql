-- =============================================================================
-- Ajustes a Personal (revisión del 02/11):
--  · El resumen solo cuenta asistencias dentro del periodo de trabajo (ingreso..cese) y nunca
--    días futuros como «sin marcar».
--  · No se puede mover el ingreso o el cese dejando asistencias fuera del nuevo periodo.
--  · «Aprobar» solo aprueba lo que Gerencia tenía en pantalla (p_visto_en): lo marcado después
--    queda por aprobar.
-- =============================================================================
create or replace function resumen_personal(p_empresa uuid, p_desde date, p_hasta date)
returns table (
  trabajador_id uuid, nombre text, cargo text, situacion text, sueldo_mensual numeric,
  asistencias integer, faltas integer, descansos integer, permisos integer, vacaciones integer,
  dias_por_marcar integer, domingos_trabajados integer,
  horas_extra numeric, horas_aprobadas numeric, horas_pendientes numeric,
  horas_25 numeric, horas_35 numeric,
  monto_horas numeric, monto_domingos numeric, monto_total numeric)
language sql stable security invoker set search_path = public
as $$
  with e as (select * from empresas where id = p_empresa),
  t as (
    select v.*, greatest(v.fecha_ingreso, p_desde) as ini, least(coalesce(v.fecha_cese, p_hasta), p_hasta, (now() at time zone 'America/Lima')::date) as fin
      from v_trabajadores v
     where v.empresa_id = p_empresa and v.fecha_ingreso <= p_hasta and (v.fecha_cese is null or v.fecha_cese >= p_desde)),
  a as (
    select s.trabajador_id,
           count(*) filter (where s.estado = 'asistio')                                  as asistencias,
           count(*) filter (where s.estado = 'falta')                                    as faltas,
           count(*) filter (where s.estado = 'descanso')                                 as descansos,
           count(*) filter (where s.estado = 'permiso')                                  as permisos,
           count(*) filter (where s.estado = 'vacaciones')                               as vacaciones,
           count(*) filter (where s.estado = 'asistio' and extract(isodow from s.fecha) = 7) as domingos,
           count(*) filter (where extract(isodow from s.fecha) <> 7)                     as marcados_lab,
           coalesce(sum(s.horas_extra), 0)                                               as horas,
           coalesce(sum(s.horas_extra) filter (where s.extra_aprobada), 0)               as aprobadas,
           -- Por día: las 2 primeras horas extras a la primera tasa, el resto a la segunda (solo aprobadas)
           coalesce(sum(least(s.horas_extra, 2)) filter (where s.extra_aprobada), 0)     as h25,
           coalesce(sum(greatest(s.horas_extra - 2, 0)) filter (where s.extra_aprobada), 0) as h35
      from asistencias s
      join t on t.id = s.trabajador_id
     where s.fecha between t.ini and t.fin          -- solo dentro de su periodo de trabajo
     group by s.trabajador_id)
  select t.id, t.nombre, t.cargo, t.situacion, t.sueldo_mensual,
         coalesce(a.asistencias, 0)::int, coalesce(a.faltas, 0)::int, coalesce(a.descansos, 0)::int,
         coalesce(a.permisos, 0)::int, coalesce(a.vacaciones, 0)::int,
         greatest(0, (select count(*) from generate_series(t.ini, t.fin, interval '1 day') d
                       where extract(isodow from d) <> 7) - coalesce(a.marcados_lab, 0))::int,
         coalesce(a.domingos, 0)::int,
         coalesce(a.horas, 0), coalesce(a.aprobadas, 0), coalesce(a.horas, 0) - coalesce(a.aprobadas, 0),
         coalesce(a.h25, 0), coalesce(a.h35, 0),
         round(x.valor_hora * (coalesce(a.h25, 0) * (1 + e.hx_tasa_primeras / 100)
                              + coalesce(a.h35, 0) * (1 + e.hx_tasa_siguientes / 100)), 2),
         round(x.valor_hora * e.jornada_horas * e.domingo_tasa / 100 * coalesce(a.domingos, 0), 2),
         round(x.valor_hora * (coalesce(a.h25, 0) * (1 + e.hx_tasa_primeras / 100)
                              + coalesce(a.h35, 0) * (1 + e.hx_tasa_siguientes / 100)), 2)
           + round(x.valor_hora * e.jornada_horas * e.domingo_tasa / 100 * coalesce(a.domingos, 0), 2)
    from t
    cross join e
    left join a on a.trabajador_id = t.id
    cross join lateral (select t.sueldo_mensual / 30 / e.jornada_horas as valor_hora) x
   order by t.situacion, t.nombre
$$;

create or replace function trg_trabajador_fechas()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if exists (select 1 from asistencias a
              where a.trabajador_id = new.id
                and (a.fecha < new.fecha_ingreso or (new.fecha_cese is not null and a.fecha > new.fecha_cese))) then
    raise exception 'Hay asistencia registrada de % fuera de esas fechas (antes del ingreso o después del cese). Corríjala primero.', new.nombre;
  end if;
  return new;
end $$;

create trigger trabajadores_fechas before update of fecha_ingreso, fecha_cese on trabajadores
  for each row execute function trg_trabajador_fechas();

drop function aprobar_horas_extra(uuid, date, date, uuid);

create or replace function aprobar_horas_extra(
  p_empresa uuid, p_desde date, p_hasta date, p_trabajador uuid default null, p_visto_en timestamptz default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  update asistencias
     set extra_aprobada = true, aprobado_por = auth.uid(), aprobado_en = now()
   where empresa_id = p_empresa and fecha between p_desde and p_hasta
     and horas_extra > 0 and not extra_aprobada
     and (p_trabajador is null or trabajador_id = p_trabajador)
     and (p_visto_en is null or actualizado_en <= p_visto_en);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- =============================================================================
-- Permisos de ejecución (igual que en 006): nada para anónimos; internas solo service_role
-- =============================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname like '\_%' or f.proname like 'admin\_%' or f.proname = 'siguiente_numero' then
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;
end $$;

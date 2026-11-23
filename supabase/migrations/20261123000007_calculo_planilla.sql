-- =============================================================================
-- Cálculo automático de la planilla (pedido del 23/11): según lo marcado en la asistencia el sistema
-- calcula cuánto se le debe a cada trabajador, sin que Gerencia saque cuentas.
--  · Tardanza: asistió tarde. Cuenta como día trabajado y descuenta los minutos de retraso al valor del
--    minuto (sueldo / 30 / jornada / 60). Minutos: los anotados; si no, la hora de entrada menos la hora
--    oficial; si tampoco hay hora, los minutos por defecto de la empresa.
--  · Falta: descuenta un día (sueldo / 30) si la empresa lo indica (por defecto sí).
--  · Permiso: con goce no descuenta (por defecto); sin goce descuenta un día.
--  · Descanso y vacaciones no descuentan. Horas extras aprobadas y domingos suman (como antes).
--  · En la hoja del día, «asistió» con entrada pasada la tolerancia queda como tardanza sola.
--  Todo es configurable por empresa ([CONFIRMAR] con el contador).
-- =============================================================================

alter table empresas
  add column hora_entrada         time    not null default '08:00',
  add column tolerancia_min       integer not null default 10 check (tolerancia_min between 0 and 120),
  add column tardanza_min_def     integer not null default 15 check (tardanza_min_def between 0 and 480),
  add column descontar_faltas     boolean not null default true,
  add column permiso_con_goce     boolean not null default true;

alter table asistencias
  add column minutos_tarde integer not null default 0 check (minutos_tarde between 0 and 600);

-- Igual que en 20261112000002; «tardanza» conserva horario y horas extras como «asistió»
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
           horas_extra    = case when excluded.estado in ('asistio', 'tardanza') then asistencias.horas_extra else 0 end,
           extra_aprobada = excluded.estado in ('asistio', 'tardanza') and asistencias.extra_aprobada,
           entrada        = case when excluded.estado in ('asistio', 'tardanza') then asistencias.entrada end,
           salida         = case when excluded.estado in ('asistio', 'tardanza') then asistencias.salida end,
           minutos_tarde  = case when excluded.estado = 'tardanza' then asistencias.minutos_tarde else 0 end
     where asistencias.estado is distinct from excluded.estado;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Igual que en 20261104000001; tardanza (marcada o por la hora de entrada) y sus minutos
create or replace function guardar_asistencia(p_empresa uuid, p_fecha date, p_filas jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  f        jsonb;
  t        trabajadores;
  e        empresas;
  v_estado estado_asistencia;
  v_horas  numeric(5,2);
  v_ent    time;
  v_min    integer;
  v_n      integer := 0;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  select * into e from empresas where id = p_empresa;
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
    v_ent    := nullif(f->>'entrada', '')::time;
    v_horas  := round(coalesce(nullif(f->>'horas_extra', '')::numeric, 0), 2);
    v_min    := coalesce(nullif(f->>'minutos_tarde', '')::integer, 0);
    if v_horas < 0 or v_horas > 16 then raise exception 'Horas extras de % fuera de rango (0 a 16).', t.nombre; end if;
    if v_min < 0 or v_min > 600 then raise exception 'Minutos de tardanza de % fuera de rango.', t.nombre; end if;
    -- Llegó pasada la tolerancia: tardanza automática
    if v_estado = 'asistio' and v_ent is not null and v_ent > e.hora_entrada + make_interval(mins => e.tolerancia_min) then
      v_estado := 'tardanza';
    end if;
    if v_estado not in ('asistio', 'tardanza') then v_horas := 0; end if;
    if v_estado <> 'tardanza' then v_min := 0; end if;

    insert into asistencias (empresa_id, trabajador_id, fecha, estado, entrada, salida, horas_extra, minutos_tarde, nota, registrado_por)
    values (p_empresa, t.id, p_fecha, v_estado, v_ent, nullif(f->>'salida', '')::time,
            v_horas, v_min, _texto(f->>'nota'), auth.uid())
    on conflict (trabajador_id, fecha) do update
       set estado = excluded.estado, entrada = excluded.entrada, salida = excluded.salida,
           horas_extra = excluded.horas_extra, minutos_tarde = excluded.minutos_tarde, nota = excluded.nota,
           registrado_por = excluded.registrado_por, actualizado_en = now(),
           extra_aprobada = asistencias.extra_aprobada and asistencias.horas_extra = excluded.horas_extra,
           aprobado_por = case when asistencias.horas_extra = excluded.horas_extra then asistencias.aprobado_por end,
           aprobado_en  = case when asistencias.horas_extra = excluded.horas_extra then asistencias.aprobado_en end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Igual que en 20261112000002; si el día era tardanza, sigue siéndolo
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
     set estado = case when asistencias.estado = 'tardanza' then 'tardanza'::estado_asistencia else 'asistio'::estado_asistencia end,
         horas_extra = v_horas, extra_aprobada = v_horas > 0,
         aprobado_por = auth.uid(), aprobado_en = now(),
         nota = coalesce(_texto(p_nota), asistencias.nota), actualizado_en = now();
end $$;

-- Resumen por trabajador: igual que en 20261102000006 (la tardanza cuenta como asistencia) + tardanzas y
-- descuentos al final. Cambian las columnas: se vuelve a crear (y planilla_mes, que la usa).
drop function planilla_mes(uuid, text);
drop function resumen_personal(uuid, date, date);

create function resumen_personal(p_empresa uuid, p_desde date, p_hasta date)
returns table (
  trabajador_id uuid, nombre text, cargo text, situacion text, sueldo_mensual numeric,
  asistencias integer, faltas integer, descansos integer, permisos integer, vacaciones integer,
  dias_por_marcar integer, domingos_trabajados integer,
  horas_extra numeric, horas_aprobadas numeric, horas_pendientes numeric,
  horas_25 numeric, horas_35 numeric,
  monto_horas numeric, monto_domingos numeric, monto_total numeric,
  tardanzas integer, minutos_tarde integer, desc_faltas numeric, desc_tardanzas numeric, desc_permisos numeric)
language sql stable security invoker set search_path = public
as $$
  with e as (select * from empresas where id = p_empresa),
  t as (
    select v.*, greatest(v.fecha_ingreso, p_desde) as ini, least(coalesce(v.fecha_cese, p_hasta), p_hasta, (now() at time zone 'America/Lima')::date) as fin
      from v_trabajadores v
     where v.empresa_id = p_empresa and v.fecha_ingreso <= p_hasta and (v.fecha_cese is null or v.fecha_cese >= p_desde)),
  a as (
    select s.trabajador_id,
           count(*) filter (where s.estado in ('asistio', 'tardanza'))                   as asistencias,
           count(*) filter (where s.estado = 'falta')                                    as faltas,
           count(*) filter (where s.estado = 'descanso')                                 as descansos,
           count(*) filter (where s.estado = 'permiso')                                  as permisos,
           count(*) filter (where s.estado = 'vacaciones')                               as vacaciones,
           count(*) filter (where s.estado in ('asistio', 'tardanza') and extract(isodow from s.fecha) = 7) as domingos,
           count(*) filter (where extract(isodow from s.fecha) <> 7)                     as marcados_lab,
           coalesce(sum(s.horas_extra), 0)                                               as horas,
           coalesce(sum(s.horas_extra) filter (where s.extra_aprobada), 0)               as aprobadas,
           coalesce(sum(least(s.horas_extra, 2)) filter (where s.extra_aprobada), 0)     as h25,
           coalesce(sum(greatest(s.horas_extra - 2, 0)) filter (where s.extra_aprobada), 0) as h35,
           count(*) filter (where s.estado = 'tardanza')                                 as tardanzas,
           -- Minutos de cada tardanza: anotados > hora de entrada − hora oficial > por defecto
           coalesce(sum(coalesce(nullif(s.minutos_tarde, 0),
                                 nullif(greatest(0, (extract(epoch from (s.entrada - (select hora_entrada from e))) / 60)::int), 0),
                                 (select tardanza_min_def from e))) filter (where s.estado = 'tardanza'), 0) as min_tarde
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
           + round(x.valor_hora * e.jornada_horas * e.domingo_tasa / 100 * coalesce(a.domingos, 0), 2),
         coalesce(a.tardanzas, 0)::int,
         coalesce(a.min_tarde, 0)::int,
         case when e.descontar_faltas then round(coalesce(t.sueldo_mensual, 0) / 30 * coalesce(a.faltas, 0), 2) else 0 end,
         round(coalesce(x.valor_hora, 0) / 60 * coalesce(a.min_tarde, 0), 2),
         case when e.permiso_con_goce then 0 else round(coalesce(t.sueldo_mensual, 0) / 30 * coalesce(a.permisos, 0), 2) end
    from t
    cross join e
    left join a on a.trabajador_id = t.id
    cross join lateral (select t.sueldo_mensual / 30 / e.jornada_horas as valor_hora) x
   order by t.situacion, t.nombre
$$;

-- Planilla del mes con descuentos: a pagar = sueldo del mes − faltas − tardanzas − permisos sin goce
--   + horas extras + domingos (nunca negativo). Saldo = a pagar − adelantos − pagos (el bono va aparte).
create function planilla_mes(p_empresa uuid, p_periodo text)
returns table (
  trabajador_id uuid, nombre text, cargo text, situacion text, sueldo_mensual numeric, dias_mes integer,
  faltas integer, sueldo_periodo numeric, monto_extras numeric, monto_domingos numeric, a_pagar numeric,
  adelantos numeric, pagos numeric, bonos numeric, pagado numeric, saldo numeric, ultimo_pago timestamptz,
  tardanzas integer, minutos_tarde integer, permisos integer, desc_faltas numeric, desc_tardanzas numeric,
  desc_permisos numeric, descuentos numeric, horas_extra numeric, domingos integer, dias_por_marcar integer)
language sql stable security invoker set search_path = public
as $$
  with lim as (
    select to_date(p_periodo || '-01', 'YYYY-MM-DD') as ini,
           (to_date(p_periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as fin),
  r as (select x.* from lim, resumen_personal(p_empresa, lim.ini, lim.fin) x),
  pg as (
    select trabajador_id,
           coalesce(sum(monto) filter (where tipo = 'adelanto'), 0) as adelantos,
           coalesce(sum(monto) filter (where tipo = 'pago'), 0)     as pagos,
           coalesce(sum(monto) filter (where tipo = 'bono'), 0)     as bonos,
           max(fecha) as ultimo
      from pagos_personal
     where empresa_id = p_empresa and periodo = p_periodo and estado = 'registrada'
     group by trabajador_id)
  select r.trabajador_id, r.nombre, r.cargo, r.situacion, r.sueldo_mensual, d.dias, r.faltas,
         s.sueldo, r.monto_horas, r.monto_domingos,
         ap.a_pagar,
         coalesce(pg.adelantos, 0), coalesce(pg.pagos, 0), coalesce(pg.bonos, 0),
         coalesce(pg.adelantos, 0) + coalesce(pg.pagos, 0) + coalesce(pg.bonos, 0),
         ap.a_pagar - coalesce(pg.adelantos, 0) - coalesce(pg.pagos, 0),
         pg.ultimo,
         r.tardanzas, r.minutos_tarde, r.permisos, r.desc_faltas, r.desc_tardanzas, r.desc_permisos,
         ds.descuentos, r.horas_aprobadas, r.domingos_trabajados, r.dias_por_marcar
    from r
    cross join lim
    join trabajadores t on t.id = r.trabajador_id
    left join pg on pg.trabajador_id = r.trabajador_id
    cross join lateral (
      select least(30, (least(coalesce(t.fecha_cese, lim.fin), lim.fin) - greatest(t.fecha_ingreso, lim.ini) + 1))::int as dias) d
    cross join lateral (select round(coalesce(t.sueldo_mensual, 0) / 30 * greatest(d.dias, 0), 2) as sueldo) s
    cross join lateral (select coalesce(r.desc_faltas, 0) + coalesce(r.desc_tardanzas, 0) + coalesce(r.desc_permisos, 0) as descuentos) ds
    cross join lateral (
      select greatest(0, s.sueldo - ds.descuentos + coalesce(r.monto_horas, 0) + coalesce(r.monto_domingos, 0)) as a_pagar) ap
   order by r.situacion, r.nombre
$$;

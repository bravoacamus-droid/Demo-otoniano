-- =============================================================================
-- Reunión del 02/11: control del PERSONAL.
--  · Ficha del trabajador: fecha de ingreso y de cese (con motivo), cargo y sueldo (opcional).
--  · Asistencia diaria: asistió / falta / descanso / permiso / vacaciones, entrada y salida,
--    horas extras del día. Los domingos trabajados salen solos (la fecha es domingo y asistió).
--  · Las horas extras las aprueba Gerencia; el resumen separa aprobadas y pendientes.
--  · Montos estimados (solo si hay sueldo): valor hora = sueldo / 30 / jornada; las 2 primeras
--    horas extras del día con +25 %, las siguientes con +35 %; domingo trabajado sin descanso
--    sustitutorio: + 100 % del valor día. [CONFIRMAR] con el contador: tasas y jornada quedan
--    configurables por empresa (empresas.hx_tasa_*, domingo_tasa, jornada_horas).
--  · Sueldos y asistencia: solo Gerencia y Administración (RLS).
-- =============================================================================
alter table empresas
  add column jornada_horas       numeric(4,2) not null default 8   check (jornada_horas > 0 and jornada_horas <= 24),
  add column hx_tasa_primeras    numeric(5,2) not null default 25  check (hx_tasa_primeras >= 0),
  add column hx_tasa_siguientes  numeric(5,2) not null default 35  check (hx_tasa_siguientes >= 0),
  add column domingo_tasa        numeric(5,2) not null default 100 check (domingo_tasa >= 0);

create table trabajadores (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) > 0),
  dni             text check (dni is null or dni ~ '^\d{8}$'),
  cargo           text,
  telefono        text,
  fecha_ingreso   date not null,
  fecha_cese      date,
  motivo_cese     text,
  sueldo_mensual  numeric(12,2) check (sueldo_mensual is null or sueldo_mensual >= 0),
  notas           text,
  creado_por      uuid default auth.uid(),
  creado_en       timestamptz not null default now(),
  check (fecha_cese is null or fecha_cese >= fecha_ingreso)
);
create unique index trabajadores_dni_uq on trabajadores (empresa_id, dni) where dni is not null;
create index on trabajadores (empresa_id);

create type estado_asistencia as enum ('asistio', 'falta', 'descanso', 'permiso', 'vacaciones');

create table asistencias (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  trabajador_id   uuid not null references trabajadores(id),
  fecha           date not null,
  estado          estado_asistencia not null,
  entrada         time,
  salida          time,
  horas_extra     numeric(5,2) not null default 0 check (horas_extra >= 0 and horas_extra <= 16),
  extra_aprobada  boolean not null default false,
  aprobado_por    uuid,
  aprobado_en     timestamptz,
  nota            text,
  registrado_por  uuid default auth.uid(),
  actualizado_en  timestamptz not null default now(),
  unique (trabajador_id, fecha),
  check (estado = 'asistio' or horas_extra = 0)
);
create index on asistencias (empresa_id, fecha);

alter table trabajadores enable row level security;
alter table asistencias enable row level security;
create policy trabajadores_select on trabajadores for select to authenticated
  using (tiene_rol(empresa_id, '{dueno,administrador}'));
create policy trabajadores_insert on trabajadores for insert to authenticated
  with check (tiene_rol(empresa_id, '{dueno,administrador}'));
create policy trabajadores_update on trabajadores for update to authenticated
  using (tiene_rol(empresa_id, '{dueno,administrador}')) with check (tiene_rol(empresa_id, '{dueno,administrador}'));
create policy asistencias_select on asistencias for select to authenticated
  using (tiene_rol(empresa_id, '{dueno,administrador}'));
create trigger trabajadores_no_borrar before delete on trabajadores
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();
create trigger asistencias_no_borrar before delete on asistencias
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();

-- Trabajadores con su situación a hoy (Lima)
create view v_trabajadores with (security_invoker = on) as
select t.*,
       case when t.fecha_cese is not null and t.fecha_cese < (now() at time zone 'America/Lima')::date
            then 'cesado' else 'activo' end as situacion,
       coalesce(t.fecha_cese, (now() at time zone 'America/Lima')::date) - t.fecha_ingreso as dias_en_empresa
  from trabajadores t;

-- -----------------------------------------------------------------------------
-- Asistencia de un día: p_filas = [{ trabajador_id, estado, entrada, salida, horas_extra, nota }]
-- Una fila sin estado no se toca. Si cambian las horas extras, vuelven a quedar por aprobar.
-- -----------------------------------------------------------------------------
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
  perform exigir_rol(p_empresa, '{dueno,administrador}');
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

-- Gerencia aprueba las horas extras de un periodo (de un trabajador o de todos)
create or replace function aprobar_horas_extra(p_empresa uuid, p_desde date, p_hasta date, p_trabajador uuid default null)
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
     and (p_trabajador is null or trabajador_id = p_trabajador);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- -----------------------------------------------------------------------------
-- Resumen por trabajador en un periodo (los que estuvieron en la empresa en esas fechas).
-- dias_por_marcar = días de lunes a sábado dentro de su periodo de trabajo sin registro.
-- -----------------------------------------------------------------------------
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
    select v.*, greatest(v.fecha_ingreso, p_desde) as ini, least(coalesce(v.fecha_cese, p_hasta), p_hasta) as fin
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
     where s.empresa_id = p_empresa and s.fecha between p_desde and p_hasta
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

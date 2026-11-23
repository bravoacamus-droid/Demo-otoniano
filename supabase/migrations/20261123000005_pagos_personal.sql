-- =============================================================================
-- Pagos al personal (pedido del 23/11): el pago de sueldos se hace desde el sistema.
--  · Cada pago es de un trabajador y un mes (periodo AAAA-MM): «pago» (sueldo / liquidación del mes),
--    «adelanto» (a cuenta del mes) o «bono» (gratificación, extra).
--  · Sale de una caja (gasto + movimiento de caja) o se paga por fuera (gastos_sin_caja). En ambos casos
--    queda en el historial de gastos con la categoría «Personal»; el que sale de caja baja la ganancia.
--  · A pagar del mes = sueldo proporcional a los días en la empresa dentro del mes (sueldo / 30 por día,
--    tope 30) + horas extras aprobadas + domingos (resumen_personal). Las faltas no se descuentan solas:
--    [CONFIRMAR] con el contador; el monto del pago se puede ajustar a mano.
--  · Corregir = anular el gasto vinculado y crear otro (historial con valor anterior y motivo).
--    Esos gastos no se corrigen ni anulan desde Caja: se hace desde Personal.
--  · Solo Gerencia (igual que el resto de Personal).
-- =============================================================================

create table pagos_personal (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  trabajador_id       uuid not null references trabajadores(id),
  periodo             text not null check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  tipo                text not null check (tipo in ('pago', 'adelanto', 'bono')),
  fecha               timestamptz not null default now(),
  monto               numeric(14,2) not null check (monto > 0),
  caja_id             uuid references cajas(id),              -- null = pagado por fuera
  nota                text,
  gasto_id            uuid references gastos(id),
  gasto_sin_caja_id   uuid references gastos_sin_caja(id),
  estado              estado_doc not null default 'registrada',
  historial           jsonb not null default '[]',
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now(),
  anulado_por         uuid,
  anulado_en          timestamptz,
  motivo_anulacion    text
);
create index on pagos_personal (empresa_id, periodo);
create index on pagos_personal (trabajador_id, fecha desc);

alter table pagos_personal enable row level security;
create policy pagos_personal_select on pagos_personal for select to authenticated using (tiene_rol(empresa_id, '{dueno}'));
create trigger pagos_personal_no_borrar before delete on pagos_personal
  for each row execute function trg_no_borrar();

create view v_pagos_personal with (security_invoker = on) as
select p.*, t.nombre as trabajador_nombre, t.cargo, c.nombre as caja_nombre, m.nombre as creado_por_nombre
  from pagos_personal p
  join trabajadores t on t.id = p.trabajador_id
  left join cajas c on c.id = p.caja_id
  left join miembros m on m.empresa_id = p.empresa_id and m.user_id = p.creado_por;

-- Categoría de gasto «Personal» (se crea o se reactiva si hace falta)
create or replace function _categoria_personal(p_empresa uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from categorias_gasto where empresa_id = p_empresa and lower(nombre) = 'personal' limit 1;
  if v_id is null then
    insert into categorias_gasto (empresa_id, nombre) values (p_empresa, 'Personal') returning id into v_id;
  else
    update categorias_gasto set activo = true where id = v_id and not activo;
  end if;
  return v_id;
end $$;

-- Crea el gasto del pago (con caja o sin caja) y lo enlaza
create or replace function _gasto_de_pago(p pagos_personal, p_nombre text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_cat      uuid := _categoria_personal(p.empresa_id);
  v_concepto text := initcap(p.tipo) || ' de ' || p_nombre || ' · ' || p.periodo || coalesce(' · ' || p.nota, '');
  v_id       uuid;
begin
  if p.caja_id is not null then
    perform _validar_caja(p.empresa_id, p.caja_id);
    insert into gastos (empresa_id, fecha, categoria_id, monto, caja_id, concepto, creado_por)
    values (p.empresa_id, p.fecha, v_cat, p.monto, p.caja_id, v_concepto, auth.uid())
    returning id into v_id;
    perform _mov_caja(p.empresa_id, p.caja_id, p.fecha, 'egreso', 'gasto', v_id, p.monto, v_concepto);
    update pagos_personal set gasto_id = v_id, gasto_sin_caja_id = null where id = p.id;
  else
    insert into gastos_sin_caja (empresa_id, fecha, categoria_id, monto, concepto, creado_por)
    values (p.empresa_id, p.fecha, v_cat, p.monto, v_concepto, auth.uid())
    returning id into v_id;
    update pagos_personal set gasto_sin_caja_id = v_id, gasto_id = null where id = p.id;
  end if;
end $$;

-- Anula el gasto vinculado (al corregir o anular el pago)
create or replace function _anular_gasto_de_pago(p pagos_personal, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p.gasto_id is not null then
    update movimientos_caja set anulado = true where origen = 'gasto' and origen_id = p.gasto_id;
    update gastos set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = p_motivo
     where id = p.gasto_id and estado = 'registrada';
  end if;
  if p.gasto_sin_caja_id is not null then
    update gastos_sin_caja set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = p_motivo
     where id = p.gasto_sin_caja_id and estado = 'registrada';
  end if;
end $$;

create or replace function registrar_pago_personal(
  p_empresa uuid, p_trabajador uuid, p_periodo text, p_tipo text, p_monto numeric,
  p_caja uuid default null, p_nota text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  t trabajadores;
  p pagos_personal;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  select * into t from trabajadores where id = p_trabajador and empresa_id = p_empresa;
  if not found then raise exception 'Trabajador no encontrado.'; end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido (use AAAA-MM).'; end if;
  if p_tipo is null or p_tipo not in ('pago', 'adelanto', 'bono') then raise exception 'Tipo de pago no válido.'; end if;
  if p_monto is null or round(p_monto, 2) <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;

  insert into pagos_personal (empresa_id, trabajador_id, periodo, tipo, monto, caja_id, nota, creado_por)
  values (p_empresa, p_trabajador, p_periodo, p_tipo, round(p_monto, 2), p_caja, _texto(p_nota), auth.uid())
  returning * into p;
  perform _gasto_de_pago(p, t.nombre);
  return p.id;
end $$;

-- Corrige monto, caja (o por fuera), tipo, mes o nota con motivo obligatorio
create or replace function editar_pago_personal(
  p_id uuid, p_periodo text, p_tipo text, p_monto numeric, p_caja uuid, p_nota text, p_razon text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  p pagos_personal;
  v_nombre text;
begin
  select * into p from pagos_personal where id = p_id for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  perform exigir_rol(p.empresa_id, '{dueno}');
  if p.estado = 'anulada' then raise exception 'El pago está anulado.'; end if;
  if _texto(p_razon) is null then raise exception 'Indique por qué se corrige.'; end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido (use AAAA-MM).'; end if;
  if p_tipo is null or p_tipo not in ('pago', 'adelanto', 'bono') then raise exception 'Tipo de pago no válido.'; end if;
  if p_monto is null or round(p_monto, 2) <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  select nombre into v_nombre from trabajadores where id = p.trabajador_id;

  perform _anular_gasto_de_pago(p, 'Corrección del pago: ' || _texto(p_razon));
  update pagos_personal
     set periodo = p_periodo, tipo = p_tipo, monto = round(p_monto, 2), caja_id = p_caja, nota = _texto(p_nota),
         historial = historial || jsonb_build_array(jsonb_build_object(
           'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'periodo', p.periodo, 'tipo', p.tipo, 'monto', p.monto, 'caja_id', p.caja_id, 'nota', p.nota))
   where id = p_id
  returning * into p;
  perform _gasto_de_pago(p, v_nombre);
end $$;

create or replace function anular_pago_personal(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare p pagos_personal;
begin
  select * into p from pagos_personal where id = p_id for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  perform exigir_rol(p.empresa_id, '{dueno}');
  if p.estado = 'anulada' then raise exception 'El pago ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  perform _anular_gasto_de_pago(p, 'Pago anulado: ' || _texto(p_motivo));
  update pagos_personal
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_id;
end $$;

-- Planilla del mes: lo que corresponde, lo pagado (pagos, adelantos y bonos) y el saldo de cada trabajador
create or replace function planilla_mes(p_empresa uuid, p_periodo text)
returns table (
  trabajador_id uuid, nombre text, cargo text, situacion text, sueldo_mensual numeric, dias_mes integer,
  faltas integer, sueldo_periodo numeric, monto_extras numeric, monto_domingos numeric, a_pagar numeric,
  adelantos numeric, pagos numeric, bonos numeric, pagado numeric, saldo numeric, ultimo_pago timestamptz)
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
         s.sueldo + coalesce(r.monto_horas, 0) + coalesce(r.monto_domingos, 0) as a_pagar,
         coalesce(pg.adelantos, 0), coalesce(pg.pagos, 0), coalesce(pg.bonos, 0),
         coalesce(pg.adelantos, 0) + coalesce(pg.pagos, 0) + coalesce(pg.bonos, 0) as pagado,
         s.sueldo + coalesce(r.monto_horas, 0) + coalesce(r.monto_domingos, 0)
           - coalesce(pg.adelantos, 0) - coalesce(pg.pagos, 0) as saldo,   -- el bono va aparte del sueldo
         pg.ultimo
    from r
    cross join lim
    join trabajadores t on t.id = r.trabajador_id
    left join pg on pg.trabajador_id = r.trabajador_id
    cross join lateral (
      select least(30, (least(coalesce(t.fecha_cese, lim.fin), lim.fin) - greatest(t.fecha_ingreso, lim.ini) + 1))::int as dias) d
    cross join lateral (select round(coalesce(t.sueldo_mensual, 0) / 30 * greatest(d.dias, 0), 2) as sueldo) s
   order by r.situacion, r.nombre
$$;

-- -----------------------------------------------------------------------------
-- Los gastos de un pago al personal se corrigen desde Personal, no desde Caja
-- (mismas funciones que en 20261123000002, con ese control al inicio)
-- -----------------------------------------------------------------------------
create or replace function _exigir_no_pago(p_gasto uuid, p_sin_caja uuid)
returns void
language plpgsql stable set search_path = public
as $$
begin
  if exists (select 1 from pagos_personal
              where estado = 'registrada' and (gasto_id = p_gasto or gasto_sin_caja_id = p_sin_caja)) then
    raise exception 'Este gasto es un pago al personal: corríjalo o anúlelo desde Personal → Pagos.';
  end if;
end $$;

create or replace function editar_gasto(
  p_gasto uuid, p_monto numeric, p_concepto text, p_categoria uuid, p_caja uuid, p_razon text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  g       gastos;
  v_monto numeric(14,2) := round(p_monto, 2);
begin
  select * into g from gastos where id = p_gasto for update;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  perform exigir_rol(g.empresa_id, '{dueno,administrador}');
  perform _exigir_no_pago(p_gasto, null);
  if g.estado = 'anulada' then raise exception 'El gasto está anulado.'; end if;
  if _texto(p_razon) is null then raise exception 'Indique por qué se corrige.'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  if _texto(p_concepto) is null then raise exception 'Indique el concepto del gasto.'; end if;
  if p_categoria is not null and not exists (select 1 from categorias_gasto where id = p_categoria and empresa_id = g.empresa_id) then
    raise exception 'Categoría no válida.';
  end if;
  perform _validar_caja(g.empresa_id, p_caja);

  update movimientos_caja set anulado = true where origen = 'gasto' and origen_id = p_gasto and not anulado;
  perform _mov_caja(g.empresa_id, p_caja, g.fecha, 'egreso', 'gasto', g.id, v_monto,
                    _texto(p_concepto) || ' (corregido)', g.comprobante_url);
  update gastos
     set monto = v_monto, concepto = _texto(p_concepto), categoria_id = p_categoria, caja_id = p_caja,
         historial = historial || jsonb_build_array(jsonb_build_object(
           'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'monto', g.monto, 'concepto', g.concepto, 'categoria_id', g.categoria_id, 'caja_id', g.caja_id))
   where id = p_gasto;
end $$;

create or replace function anular_gasto(p_gasto uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare g gastos;
begin
  select * into g from gastos where id = p_gasto for update;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  perform exigir_rol(g.empresa_id, '{dueno,administrador}');
  perform _exigir_no_pago(p_gasto, null);
  if g.estado = 'anulada' then raise exception 'El gasto ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  update movimientos_caja set anulado = true where origen = 'gasto' and origen_id = p_gasto;
  update gastos set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_gasto;
end $$;

create or replace function editar_gasto_sin_caja(
  p_id uuid, p_monto numeric, p_concepto text, p_categoria uuid, p_razon text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  g       gastos_sin_caja;
  v_monto numeric(14,2) := round(p_monto, 2);
begin
  select * into g from gastos_sin_caja where id = p_id for update;
  if not found then raise exception 'Registro no encontrado.'; end if;
  perform exigir_rol(g.empresa_id, '{dueno,administrador}');
  perform _exigir_no_pago(null, p_id);
  if g.estado = 'anulada' then raise exception 'El registro está anulado.'; end if;
  if _texto(p_razon) is null then raise exception 'Indique por qué se corrige.'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  if _texto(p_concepto) is null then raise exception 'Indique el concepto.'; end if;
  if p_categoria is not null and not exists (select 1 from categorias_gasto where id = p_categoria and empresa_id = g.empresa_id) then
    raise exception 'Categoría no válida.';
  end if;
  update gastos_sin_caja
     set monto = v_monto, concepto = _texto(p_concepto), categoria_id = p_categoria,
         historial = historial || jsonb_build_array(jsonb_build_object(
           'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'monto', g.monto, 'concepto', g.concepto, 'categoria_id', g.categoria_id))
   where id = p_id;
end $$;

create or replace function anular_gasto_sin_caja(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare g gastos_sin_caja;
begin
  select * into g from gastos_sin_caja where id = p_id for update;
  if not found then raise exception 'Registro no encontrado.'; end if;
  perform exigir_rol(g.empresa_id, '{dueno,administrador}');
  perform _exigir_no_pago(null, p_id);
  if g.estado = 'anulada' then raise exception 'El registro ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  update gastos_sin_caja
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_id;
end $$;

revoke execute on function _categoria_personal(uuid) from public, anon, authenticated;
revoke execute on function _gasto_de_pago(pagos_personal, text) from public, anon, authenticated;
revoke execute on function _anular_gasto_de_pago(pagos_personal, text) from public, anon, authenticated;
revoke execute on function _exigir_no_pago(uuid, uuid) from public, anon, authenticated;

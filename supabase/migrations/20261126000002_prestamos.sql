-- =============================================================================
-- Préstamos con cuotas (llamada del 26/11, Sr. Otiniano)
--  · recibido: una persona le presta a la empresa → ENTRA dinero a la caja; la empresa le debe.
--    Cada devolución es una SALIDA de caja.
--  · otorgado: la empresa le presta a una persona (socio, trabajador, otro) → SALE dinero; queda
--    por cobrar. Cada devolución que esa persona hace es un INGRESO.
--  · Cronograma en cuotas (única, semanal, quincenal o mensual) como los créditos: los pagos se
--    aplican a las cuotas en orden; lo pagado de cada cuota se calcula (v_prestamo_cuotas).
--  · No cambia la ganancia: recibido = más caja y más deuda; otorgado = menos caja y más por cobrar.
--  · Reemplaza el «préstamo» de Ingreso/salida (movimientos_manuales clase 'prestamo', sin uso
--    en producción); lo ya registrado así sigue contando igual.
-- =============================================================================
create table prestamos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  tipo                text not null check (tipo in ('recibido', 'otorgado')),
  persona             text not null check (length(trim(persona)) > 0),  -- quién presta / a quién se presta
  documento           text,                                             -- DNI/RUC opcional
  fecha               timestamptz not null,
  monto               numeric(14,2) not null check (monto > 0),
  caja_id             uuid not null references cajas(id),
  motivo              text not null check (length(trim(motivo)) > 0),
  n_cuotas            integer not null check (n_cuotas between 1 and 60),
  frecuencia          text not null check (frecuencia in ('unica', 'semanal', 'quincenal', 'mensual')),
  primer_vencimiento  date not null,
  mov_id              uuid references movimientos_caja(id),
  estado              estado_doc not null default 'registrada',
  anulado_por         uuid,
  anulado_en          timestamptz,
  motivo_anulacion    text,
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now()
);
create index on prestamos (empresa_id, estado, tipo);

create table prestamo_cuotas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  prestamo_id  uuid not null references prestamos(id) on delete cascade,
  numero       integer not null,
  vence        date not null,
  monto        numeric(14,2) not null check (monto > 0),
  unique (prestamo_id, numero)
);

create table prestamo_pagos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  prestamo_id       uuid not null references prestamos(id),
  fecha             timestamptz not null,
  monto             numeric(14,2) not null check (monto > 0),
  caja_id           uuid not null references cajas(id),
  nota              text,
  mov_id            uuid references movimientos_caja(id),
  estado            estado_doc not null default 'registrada',
  anulado_por       uuid,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now()
);
create index on prestamo_pagos (prestamo_id);

alter table prestamos enable row level security;
alter table prestamo_cuotas enable row level security;
alter table prestamo_pagos enable row level security;
create policy prestamos_select on prestamos for select to authenticated using (es_miembro(empresa_id));
create policy prestamo_cuotas_select on prestamo_cuotas for select to authenticated using (es_miembro(empresa_id));
create policy prestamo_pagos_select on prestamo_pagos for select to authenticated using (es_miembro(empresa_id));
create trigger prestamos_no_borrar before delete on prestamos
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();
create trigger prestamo_pagos_no_borrar before delete on prestamo_pagos
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();

-- -----------------------------------------------------------------------------
-- Vistas: cuotas con lo pagado (en orden) y préstamos con su avance
-- -----------------------------------------------------------------------------
create view v_prestamo_cuotas with (security_invoker = on) as
select q.*, p.tipo, p.estado as prestamo_estado,
       x.pagado,
       q.monto - x.pagado as saldo,
       case when q.monto - x.pagado = 0 then 'pagada'
            when q.vence < (now() at time zone 'America/Lima')::date then 'vencida'
            when x.pagado > 0 then 'parcial'
            else 'pendiente' end as situacion
  from prestamo_cuotas q
  join prestamos p on p.id = q.prestamo_id
  cross join lateral (select coalesce(sum(monto), 0) as total from prestamo_pagos
                       where prestamo_id = q.prestamo_id and estado = 'registrada') t
  cross join lateral (select coalesce(sum(monto), 0) as antes from prestamo_cuotas q2
                       where q2.prestamo_id = q.prestamo_id and q2.numero < q.numero) a
  cross join lateral (select least(q.monto, greatest(0, t.total - a.antes)) as pagado) x;

create view v_prestamos with (security_invoker = on) as
select p.*,
       c.nombre as caja_nombre,
       coalesce(mi.nombre, mi.email) as creado_por_nombre,
       pg.pagado,
       p.monto - pg.pagado as saldo,
       pg.n_pagos,
       q.cuotas_pagadas, q.cuotas_vencidas, q.monto_vencido,
       q.proxima_numero, q.proxima_vence, q.proxima_saldo,
       case when p.estado = 'anulada' then 'anulado'
            when p.monto - pg.pagado = 0 then 'pagado'
            when q.cuotas_vencidas > 0 then 'vencido'
            else 'al_dia' end as situacion
  from prestamos p
  join cajas c on c.id = p.caja_id
  left join miembros mi on mi.empresa_id = p.empresa_id and mi.user_id = p.creado_por
  cross join lateral (select coalesce(sum(monto), 0) as pagado, count(*) as n_pagos from prestamo_pagos
                       where prestamo_id = p.id and estado = 'registrada') pg
  cross join lateral (
    select count(*) filter (where situacion = 'pagada')                as cuotas_pagadas,
           count(*) filter (where situacion = 'vencida')               as cuotas_vencidas,
           coalesce(sum(saldo) filter (where situacion = 'vencida'), 0) as monto_vencido,
           (array_agg(numero order by numero) filter (where saldo > 0))[1] as proxima_numero,
           (array_agg(vence order by numero) filter (where saldo > 0))[1]  as proxima_vence,
           (array_agg(saldo order by numero) filter (where saldo > 0))[1]  as proxima_saldo
      from v_prestamo_cuotas where prestamo_id = p.id) q;

create view v_prestamo_pagos with (security_invoker = on) as
select pp.*, p.tipo, p.persona, c.nombre as caja_nombre, coalesce(mi.nombre, mi.email) as creado_por_nombre
  from prestamo_pagos pp
  join prestamos p on p.id = pp.prestamo_id
  join cajas c on c.id = pp.caja_id
  left join miembros mi on mi.empresa_id = pp.empresa_id and mi.user_id = pp.creado_por;

-- -----------------------------------------------------------------------------
-- Funciones
-- -----------------------------------------------------------------------------
-- Gerencia y Administración pueden poner la fecha real (p. ej. un préstamo de ayer); Almacén registra con la hora actual
create or replace function _fecha_prestamo(p_rol rol_miembro, p_fecha timestamptz)
returns timestamptz
language plpgsql stable as $$
begin
  if p_fecha is null or p_rol not in ('dueno', 'administrador') then return now(); end if;
  if p_fecha > now() + interval '5 minutes' then raise exception 'La fecha no puede ser futura.'; end if;
  return p_fecha;
end $$;

create or replace function _plan_cuotas_prestamo(p_prestamo uuid)
returns void
language plpgsql set search_path = public
as $$
declare
  p      prestamos;
  v_base numeric(14,2);
  i      integer;
begin
  select * into p from prestamos where id = p_prestamo;
  v_base := trunc(p.monto / p.n_cuotas, 2);
  if v_base <= 0 then raise exception 'El monto es muy pequeño para % cuotas.', p.n_cuotas; end if;
  for i in 1..p.n_cuotas loop
    insert into prestamo_cuotas (empresa_id, prestamo_id, numero, vence, monto)
    values (p.empresa_id, p.id, i,
            case p.frecuencia
              when 'semanal'   then p.primer_vencimiento + 7 * (i - 1)
              when 'quincenal' then p.primer_vencimiento + 15 * (i - 1)
              else (p.primer_vencimiento + make_interval(months => i - 1))::date
            end,
            case when i < p.n_cuotas then v_base else p.monto - v_base * (p.n_cuotas - 1) end);
  end loop;
end $$;

-- p_tipo: 'recibido' (nos prestan: entra dinero) u 'otorgado' (prestamos: sale dinero)
create or replace function registrar_prestamo(
  p_empresa uuid, p_tipo text, p_persona text, p_monto numeric, p_caja uuid, p_motivo text,
  p_cuotas integer default 1, p_frecuencia text default 'mensual', p_primer_vencimiento date default null,
  p_fecha timestamptz default null, p_documento text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rol    rol_miembro;
  v_monto  numeric(14,2) := round(p_monto, 2);
  v_n      integer := coalesce(p_cuotas, 1);
  v_frec   text := lower(coalesce(_texto(p_frecuencia), 'mensual'));
  v_fecha  timestamptz;
  v_hoy    date;
  v_primer date;
  p        prestamos;
  v_mov    uuid;
begin
  v_rol := exigir_rol(p_empresa, '{dueno,administrador,cajero}');
  if p_tipo is null or p_tipo not in ('recibido', 'otorgado') then raise exception 'Indique si le prestan a la empresa o si la empresa presta.'; end if;
  if _texto(p_persona) is null then
    raise exception '%', case when p_tipo = 'recibido' then 'Indique quién le presta a la empresa.' else 'Indique a quién se le presta.' end;
  end if;
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo del préstamo.'; end if;
  perform _validar_caja(p_empresa, p_caja);
  if v_n < 1 or v_n > 60 then raise exception 'Las cuotas deben ser entre 1 y 60.'; end if;
  if v_n = 1 then v_frec := 'unica';
  elsif v_frec not in ('semanal', 'quincenal', 'mensual') then
    raise exception 'Con varias cuotas elija si son semanales, quincenales o mensuales.';
  end if;

  v_fecha := _fecha_prestamo(v_rol, p_fecha);
  v_hoy := (v_fecha at time zone 'America/Lima')::date;
  v_primer := coalesce(p_primer_vencimiento,
                       case v_frec when 'semanal' then v_hoy + 7 when 'quincenal' then v_hoy + 15
                                   else (v_hoy + interval '1 month')::date end);
  if v_primer < v_hoy then raise exception 'La primera cuota no puede vencer antes de la fecha del préstamo.'; end if;

  insert into prestamos (empresa_id, tipo, persona, documento, fecha, monto, caja_id, motivo, n_cuotas, frecuencia,
                         primer_vencimiento, creado_por)
  values (p_empresa, p_tipo, _texto(p_persona), _texto(p_documento), v_fecha, v_monto, p_caja, _texto(p_motivo), v_n,
          v_frec, v_primer, auth.uid())
  returning * into p;
  perform _plan_cuotas_prestamo(p.id);

  v_mov := _mov_caja(p_empresa, p_caja, v_fecha,
                     case when p_tipo = 'recibido' then 'ingreso'::tipo_mov_caja else 'egreso'::tipo_mov_caja end,
                     'prestamo', p.id, v_monto,
                     case when p_tipo = 'recibido' then 'Préstamo recibido de ' else 'Préstamo a ' end
                       || p.persona || ': ' || p.motivo
                       || case when v_n > 1 then ' (' || v_n || ' cuotas)' else '' end);
  update prestamos set mov_id = v_mov where id = p.id;
  return jsonb_build_object('id', p.id, 'monto', v_monto, 'cuotas', v_n);
end $$;

-- Devolución: si nos prestaron, la empresa devuelve (SALE dinero); si prestamos, la persona devuelve (ENTRA)
create or replace function registrar_pago_prestamo(
  p_prestamo uuid, p_monto numeric, p_caja uuid, p_fecha timestamptz default null, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  p        prestamos;
  v_rol    rol_miembro;
  v_monto  numeric(14,2) := round(coalesce(p_monto, 0), 2);
  v_saldo  numeric(14,2);
  v_fecha  timestamptz;
  v_num    integer;
  v_mov    uuid;
  v_id     uuid;
begin
  select * into p from prestamos where id = p_prestamo for update;
  if not found then raise exception 'Préstamo no encontrado.'; end if;
  v_rol := exigir_rol(p.empresa_id, '{dueno,administrador,cajero}');
  if p.estado = 'anulada' then raise exception 'El préstamo está anulado.'; end if;
  if v_monto <= 0 then raise exception 'El monto de la devolución debe ser mayor a cero.'; end if;
  select p.monto - coalesce(sum(monto), 0) into v_saldo from prestamo_pagos where prestamo_id = p.id and estado = 'registrada';
  if v_saldo <= 0 then raise exception 'Este préstamo ya está devuelto por completo.'; end if;
  if v_monto > v_saldo then raise exception 'La devolución (S/ %) es mayor a lo que falta (S/ %).', v_monto, v_saldo; end if;
  perform _validar_caja(p.empresa_id, p_caja);
  v_fecha := _fecha_prestamo(v_rol, p_fecha);
  if v_fecha < p.fecha then
    raise exception 'La devolución no puede ser anterior al préstamo (%).', to_char(p.fecha at time zone 'America/Lima', 'DD/MM/YYYY');
  end if;

  select numero into v_num from v_prestamo_cuotas where prestamo_id = p.id and saldo > 0 order by numero limit 1;
  v_mov := _mov_caja(p.empresa_id, p_caja, v_fecha,
                     case when p.tipo = 'recibido' then 'egreso'::tipo_mov_caja else 'ingreso'::tipo_mov_caja end,
                     'prestamo', p.id, v_monto,
                     case when p.tipo = 'recibido' then 'Devolución de préstamo a ' else 'Devolución de préstamo de ' end
                       || p.persona || case when p.n_cuotas > 1 then ' (cuota ' || v_num || ' de ' || p.n_cuotas || ')' else '' end
                       || coalesce(': ' || _texto(p_nota), ''));
  insert into prestamo_pagos (empresa_id, prestamo_id, fecha, monto, caja_id, nota, mov_id, creado_por)
  values (p.empresa_id, p.id, v_fecha, v_monto, p_caja, _texto(p_nota), v_mov, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'monto', v_monto, 'saldo', v_saldo - v_monto, 'cuota', v_num);
end $$;

create or replace function anular_pago_prestamo(p_pago uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare g prestamo_pagos;
begin
  select * into g from prestamo_pagos where id = p_pago for update;
  if not found then raise exception 'Devolución no encontrada.'; end if;
  perform exigir_rol(g.empresa_id, '{dueno,administrador}');
  if g.estado = 'anulada' then raise exception 'La devolución ya está anulada.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  update movimientos_caja set anulado = true where id = g.mov_id;
  update prestamo_pagos
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_pago;
end $$;

create or replace function anular_prestamo(p_prestamo uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare p prestamos;
begin
  select * into p from prestamos where id = p_prestamo for update;
  if not found then raise exception 'Préstamo no encontrado.'; end if;
  perform exigir_rol(p.empresa_id, '{dueno,administrador}');
  if p.estado = 'anulada' then raise exception 'El préstamo ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  if exists (select 1 from prestamo_pagos where prestamo_id = p.id and estado = 'registrada') then
    raise exception 'El préstamo tiene devoluciones registradas. Anúlelas primero.';
  end if;
  update movimientos_caja set anulado = true where id = p.mov_id;
  update prestamos
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_prestamo;
end $$;

revoke execute on function _fecha_prestamo(rol_miembro, timestamptz) from public, anon, authenticated;
revoke execute on function _plan_cuotas_prestamo(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Patrimonio: lo prestado por cobrar suma; lo que nos prestaron y falta devolver es deuda
-- (igual que 20261123000002 + préstamos; columna nueva al final)
-- -----------------------------------------------------------------------------
create or replace view v_patrimonio with (security_invoker = on) as
select e.id as empresa_id,
       cj.caja,
       st.stock_costo,
       st.stock_precio_venta,
       tr.en_transito,
       ap.aportes, ap.retiros,
       ap.aportes + ap.capitalizado - ap.retiros                                           as capital,
       cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar           as activos,
       cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar - cr.por_pagar - pr.por_pagar
         - (ap.aportes + ap.capitalizado - ap.retiros)                                     as ganancia_acumulada,
       pc.por_cobrar,
       cr.por_cobrar as cuentas_por_cobrar,
       cr.por_pagar  as cuentas_por_pagar,
       ap.capitalizado,
       ap.utilidad_entregada,
       pr.por_pagar  as prestamos_por_pagar
  from empresas e
  cross join lateral (
    select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) as caja
      from movimientos_caja where empresa_id = e.id and not anulado) cj
  cross join lateral (
    select round(coalesce(sum(s.costo_total), 0), 2)            as stock_costo,
           round(coalesce(sum(s.kg * m.precio_venta), 0), 2)    as stock_precio_venta
      from stock_metal s join metales m on m.id = s.metal_id
     where s.empresa_id = e.id) st
  cross join lateral (
    select round(coalesce(sum(vi.costo_total), 0), 2) as en_transito
      from venta_items vi join ventas v on v.id = vi.venta_id
     where v.empresa_id = e.id and v.estado = 'pendiente') tr
  cross join lateral (
    select coalesce(sum(monto) filter (where tipo = 'aporte'), 0)          as aportes,
           coalesce(sum(monto) filter (where tipo = 'retiro'), 0)          as retiros,
           coalesce(sum(monto) filter (where tipo = 'capitalizacion'), 0)  as capitalizado,
           coalesce(sum(monto) filter (where tipo = 'retiro_utilidad'), 0) as utilidad_entregada
      from aportes_retiros where empresa_id = e.id and estado = 'registrada') ap
  cross join lateral (
    select coalesce((select sum(p.monto - coalesce((select sum(g.monto) from prestamo_pagos g
                                                     where g.prestamo_id = p.id and g.estado = 'registrada'), 0))
                       from prestamos p
                      where p.empresa_id = e.id and p.estado = 'registrada' and p.tipo = 'recibido'), 0) as por_pagar) pr
  cross join lateral (
    select coalesce((select sum(importe) from selecciones_compra
                      where empresa_id = e.id and estado = 'registrada' and cobrar), 0)
         + coalesce((select sum(monto) from adelantos_proveedor
                      where empresa_id = e.id and estado = 'registrada'), 0)
         - coalesce((select sum(saldo_aplicado) from compras
                      where empresa_id = e.id and estado = 'registrada'), 0)
         + coalesce((select sum(case when tipo = 'egreso' then monto else -monto end) from movimientos_manuales
                      where empresa_id = e.id and clase = 'prestamo' and estado = 'registrada'), 0)
         + coalesce((select sum(p.monto - coalesce((select sum(g.monto) from prestamo_pagos g
                                                     where g.prestamo_id = p.id and g.estado = 'registrada'), 0))
                       from prestamos p
                      where p.empresa_id = e.id and p.estado = 'registrada' and p.tipo = 'otorgado'), 0)
         - coalesce((select sum(monto) from devoluciones_proveedor
                      where empresa_id = e.id and estado = 'registrada'), 0) as por_cobrar) pc
  cross join lateral (
    select coalesce(sum(s.saldo) filter (where s.tipo = 'por_cobrar'), 0) as por_cobrar,
           coalesce(sum(s.saldo) filter (where s.tipo = 'por_pagar'), 0)  as por_pagar
      from (select c.tipo, c.monto - coalesce((select sum(p.monto) from credito_pagos p
                                                where p.credito_id = c.id and p.estado = 'registrada'), 0) as saldo
              from creditos c where c.empresa_id = e.id and c.estado = 'registrada') s) cr;

create or replace function patrimonio_al(p_empresa uuid, p_hasta timestamptz)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with
  cj as (select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) as caja
           from movimientos_caja where empresa_id = p_empresa and not anulado and fecha < p_hasta),
  st as (select round(coalesce(sum(costo_total), 0), 2) as stock_costo
           from kardex where empresa_id = p_empresa and not anulado and fecha < p_hasta),
  tr as (select round(coalesce(sum(vi.costo_total), 0), 2) as en_transito
           from venta_items vi join ventas v on v.id = vi.venta_id
          where v.empresa_id = p_empresa and v.estado <> 'anulada' and v.fecha < p_hasta
            and (v.fecha_confirmacion is null or v.fecha_confirmacion >= p_hasta)),
  ap as (select coalesce(sum(monto) filter (where tipo = 'aporte'), 0)          as aportes,
                coalesce(sum(monto) filter (where tipo = 'retiro'), 0)          as retiros,
                coalesce(sum(monto) filter (where tipo = 'capitalizacion'), 0)  as capitalizado,
                coalesce(sum(monto) filter (where tipo = 'retiro_utilidad'), 0) as utilidad_entregada
           from aportes_retiros where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta),
  -- Saldo de cada préstamo a esa fecha (solo lo devuelto antes de p_hasta)
  ps as (select p.tipo, p.monto - coalesce((select sum(g.monto) from prestamo_pagos g
                                             where g.prestamo_id = p.id and g.estado = 'registrada'
                                               and g.fecha < p_hasta), 0) as saldo
           from prestamos p
          where p.empresa_id = p_empresa and p.estado = 'registrada' and p.fecha < p_hasta),
  pr as (select coalesce(sum(saldo) filter (where tipo = 'recibido'), 0) as por_pagar,
                coalesce(sum(saldo) filter (where tipo = 'otorgado'), 0) as por_cobrar
           from ps),
  pc as (select coalesce((select sum(importe) from selecciones_compra
                           where empresa_id = p_empresa and estado = 'registrada' and cobrar and fecha < p_hasta), 0)
              + coalesce((select sum(monto) from adelantos_proveedor
                           where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta), 0)
              - coalesce((select sum(saldo_aplicado) from compras
                           where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta), 0)
              + coalesce((select sum(case when tipo = 'egreso' then monto else -monto end) from movimientos_manuales
                           where empresa_id = p_empresa and clase = 'prestamo' and estado = 'registrada' and fecha < p_hasta), 0)
              + (select por_cobrar from pr)
              - coalesce((select sum(monto) from devoluciones_proveedor
                           where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta), 0) as por_cobrar),
  cr as (select coalesce(sum(s.saldo) filter (where s.tipo = 'por_cobrar'), 0) as por_cobrar,
                coalesce(sum(s.saldo) filter (where s.tipo = 'por_pagar'), 0)  as por_pagar
           from (select c.tipo, c.monto
                        - coalesce((select sum(a.monto) from credito_ajustes a
                                     where a.credito_id = c.id and a.fecha >= p_hasta), 0)
                        - coalesce((select sum(p.monto) from credito_pagos p
                                     where p.credito_id = c.id and p.estado = 'registrada'
                                       and p.fecha < p_hasta), 0) as saldo
                   from creditos c
                  where c.empresa_id = p_empresa and c.estado = 'registrada' and c.fecha < p_hasta) s)
  select jsonb_build_object(
           'caja', cj.caja, 'stock_costo', st.stock_costo, 'en_transito', tr.en_transito,
           'por_cobrar', pc.por_cobrar,
           'cuentas_por_cobrar', cr.por_cobrar, 'cuentas_por_pagar', cr.por_pagar,
           'prestamos_por_pagar', pr.por_pagar,
           'aportes', ap.aportes, 'retiros', ap.retiros,
           'capitalizado', ap.capitalizado, 'utilidad_entregada', ap.utilidad_entregada,
           'capital', ap.aportes + ap.capitalizado - ap.retiros,
           'activos', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar,
           'ganancia_acumulada', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar
                                 - cr.por_pagar - pr.por_pagar - (ap.aportes + ap.capitalizado - ap.retiros))
    from cj, st, tr, ap, pr, pc, cr
   where es_miembro(p_empresa)
$$;

-- -----------------------------------------------------------------------------
-- Cuadre de caja: los préstamos en su propia línea (antes iban en «otros»)
-- -----------------------------------------------------------------------------
create or replace view v_cuadre_caja with (security_invoker = on) as
with m as (
  select empresa_id, origen,
         sum(case when tipo = 'ingreso' then monto else -monto end) as neto
    from movimientos_caja
   where not anulado
   group by empresa_id, origen
),
cr as (
  select empresa_id,
         coalesce(sum(saldo) filter (where tipo = 'por_pagar'), 0)  as compras_por_pagar,
         coalesce(sum(saldo) filter (where tipo = 'por_cobrar'), 0) as ventas_por_cobrar
    from v_creditos
   where estado = 'registrada'
   group by empresa_id
),
pr as (
  select empresa_id,
         coalesce(sum(saldo) filter (where tipo = 'recibido'), 0) as prestamos_por_pagar,
         coalesce(sum(saldo) filter (where tipo = 'otorgado'), 0) as prestamos_por_cobrar
    from v_prestamos
   where estado = 'registrada'
   group by empresa_id
)
select e.id as empresa_id,
       coalesce(sum(m.neto) filter (where m.origen = 'aporte'), 0)  as aportes,
       coalesce(sum(m.neto) filter (where m.origen = 'venta'), 0)   as ventas,
       coalesce(sum(m.neto) filter (where m.origen = 'compra'), 0)  as compras,
       coalesce(sum(m.neto) filter (where m.origen = 'gasto'), 0)   as gastos,
       coalesce(sum(m.neto) filter (where m.origen = 'retiro'), 0)  as retiros,
       coalesce(sum(m.neto) filter (where m.origen not in ('aporte', 'venta', 'compra', 'gasto', 'retiro', 'prestamo')), 0) as otros,
       coalesce(sum(m.neto), 0) as saldo,
       coalesce(max(cr.compras_por_pagar), 0) as compras_por_pagar,
       coalesce(max(cr.ventas_por_cobrar), 0) as ventas_por_cobrar,
       coalesce(sum(m.neto) filter (where m.origen = 'prestamo'), 0) as prestamos,
       coalesce(max(pr.prestamos_por_pagar), 0)  as prestamos_por_pagar,
       coalesce(max(pr.prestamos_por_cobrar), 0) as prestamos_por_cobrar
  from empresas e
  left join m on m.empresa_id = e.id
  left join cr on cr.empresa_id = e.id
  left join pr on pr.empresa_id = e.id
 group by e.id;

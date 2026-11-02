-- =============================================================================
-- Reunión del 02/11: compras y ventas a CRÉDITO, en una o varias cuotas.
--  · Contado (lo de siempre): el dinero sale/entra de la caja en el acto.
--  · Crédito: la mercadería entra/sale del stock en el acto, el dinero no. La compra deja una
--    cuenta por pagar al proveedor y la venta una cuenta por cobrar al comprador, con su
--    cronograma de cuotas (única, semanal, quincenal o mensual) y, si se quiere, una inicial
--    que sí pasa por caja en el momento.
--  · Cada pago (registrar_pago_credito) mueve la caja; se aplica a las cuotas en orden, así
--    que lo pagado de cada cuota se calcula (v_credito_cuotas), no se guarda.
--  · Patrimonio: + cuentas por cobrar − cuentas por pagar (la compra/venta a crédito no cambia
--    el patrimonio; el resultado del mes tampoco: se reconoce al comprar/confirmar la venta).
--  · Anular la compra/venta exige anular antes sus pagos; corregir una compra a crédito
--    recalcula el cronograma (sin pagos) y no mueve caja.
-- =============================================================================
create type tipo_credito as enum ('por_pagar', 'por_cobrar');

create table creditos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  tipo                tipo_credito not null,
  compra_id           uuid unique references compras(id),
  venta_id            uuid unique references ventas(id),
  proveedor_id        uuid references proveedores(id),
  comprador_id        uuid references compradores(id),
  fecha               timestamptz not null,
  monto               numeric(14,2) not null check (monto > 0),       -- lo financiado (sin la inicial)
  inicial             numeric(14,2) not null default 0 check (inicial >= 0),
  n_cuotas            integer not null check (n_cuotas between 1 and 60),
  frecuencia          text not null check (frecuencia in ('unica', 'semanal', 'quincenal', 'mensual')),
  primer_vencimiento  date not null,
  estado              estado_doc not null default 'registrada',
  anulado_por         uuid,
  anulado_en          timestamptz,
  motivo_anulacion    text,
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now(),
  check ((tipo = 'por_pagar' and compra_id is not null and venta_id is null and proveedor_id is not null)
      or (tipo = 'por_cobrar' and venta_id is not null and compra_id is null and comprador_id is not null))
);
create index on creditos (empresa_id, estado, tipo);

create table credito_cuotas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  credito_id  uuid not null references creditos(id) on delete cascade,
  numero      integer not null,
  vence       date not null,
  monto       numeric(14,2) not null check (monto > 0),
  unique (credito_id, numero)
);

create table credito_pagos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  credito_id        uuid not null references creditos(id),
  fecha             timestamptz not null,
  monto             numeric(14,2) not null check (monto > 0),
  caja_id           uuid not null references cajas(id),
  medio_pago        medio_pago not null,
  medio_id          uuid references medios_pago(id),
  mov_id            uuid references movimientos_caja(id),
  nota              text,
  estado            estado_doc not null default 'registrada',
  anulado_por       uuid,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now()
);
create index on credito_pagos (credito_id);

alter table creditos enable row level security;
alter table credito_cuotas enable row level security;
alter table credito_pagos enable row level security;
create policy creditos_select on creditos for select to authenticated using (es_miembro(empresa_id));
create policy credito_cuotas_select on credito_cuotas for select to authenticated using (es_miembro(empresa_id));
create policy credito_pagos_select on credito_pagos for select to authenticated using (es_miembro(empresa_id));
-- El cronograma se recalcula al corregir una compra (se reemplazan sus cuotas): sin trigger de no borrar
create trigger creditos_no_borrar before delete on creditos
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();
create trigger credito_pagos_no_borrar before delete on credito_pagos
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();

-- -----------------------------------------------------------------------------
-- Cronograma: cuotas iguales (la última absorbe los céntimos), desde el primer vencimiento
-- -----------------------------------------------------------------------------
create or replace function _plan_cuotas(p_credito uuid)
returns void
language plpgsql set search_path = public
as $$
declare
  c      creditos;
  v_base numeric(14,2);
  i      integer;
begin
  select * into c from creditos where id = p_credito;
  v_base := trunc(c.monto / c.n_cuotas, 2);
  if v_base <= 0 then raise exception 'El monto a crédito es muy pequeño para % cuotas.', c.n_cuotas; end if;
  for i in 1..c.n_cuotas loop
    insert into credito_cuotas (empresa_id, credito_id, numero, vence, monto)
    values (c.empresa_id, c.id, i,
            case c.frecuencia
              when 'semanal'   then c.primer_vencimiento + 7 * (i - 1)
              when 'quincenal' then c.primer_vencimiento + 15 * (i - 1)
              else (c.primer_vencimiento + make_interval(months => i - 1))::date
            end,
            case when i < c.n_cuotas then v_base else c.monto - v_base * (c.n_cuotas - 1) end);
  end loop;
end $$;

-- p_plan: { "cuotas": 3, "frecuencia": "mensual", "primer_vencimiento": "2026-12-02", "inicial": "500" }
create or replace function _crear_credito(
  p_empresa uuid, p_tipo tipo_credito, p_compra uuid, p_venta uuid, p_proveedor uuid, p_comprador uuid,
  p_fecha timestamptz, p_monto numeric, p_inicial numeric, p_plan jsonb)
returns uuid
language plpgsql set search_path = public
as $$
declare
  v_n      integer := coalesce(nullif(p_plan->>'cuotas', '')::integer, 1);
  v_frec   text := lower(coalesce(_texto(p_plan->>'frecuencia'), 'mensual'));
  v_hoy    date := (p_fecha at time zone 'America/Lima')::date;
  v_primer date;
  v_id     uuid;
begin
  if v_n < 1 or v_n > 60 then raise exception 'Las cuotas deben ser entre 1 y 60.'; end if;
  if v_n = 1 then v_frec := 'unica';
  elsif v_frec not in ('semanal', 'quincenal', 'mensual') then
    raise exception 'Con varias cuotas elija si son semanales, quincenales o mensuales.';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto a crédito debe ser mayor a cero.'; end if;
  v_primer := coalesce(nullif(p_plan->>'primer_vencimiento', '')::date,
                       case v_frec when 'semanal' then v_hoy + 7 when 'quincenal' then v_hoy + 15
                                   else (v_hoy + interval '1 month')::date end);
  if v_primer < v_hoy then raise exception 'La primera cuota no puede vencer antes de la fecha de la operación.'; end if;

  insert into creditos (empresa_id, tipo, compra_id, venta_id, proveedor_id, comprador_id, fecha, monto, inicial,
                        n_cuotas, frecuencia, primer_vencimiento)
  values (p_empresa, p_tipo, p_compra, p_venta, p_proveedor, p_comprador, p_fecha, p_monto, coalesce(p_inicial, 0),
          v_n, v_frec, v_primer)
  returning id into v_id;
  perform _plan_cuotas(v_id);
  return v_id;
end $$;

-- Inicial del crédito: se valida contra lo que hay que pagar/cobrar en total
create or replace function _inicial_credito(p_plan jsonb, p_total numeric)
returns numeric
language plpgsql immutable set search_path = public
as $$
declare v numeric(14,2) := round(coalesce(nullif(p_plan->>'inicial', '')::numeric, 0), 2);
begin
  if v < 0 or v >= p_total then
    raise exception 'La inicial debe ser menor al total (S/ %).', p_total;
  end if;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Vistas: cuotas con lo pagado (los pagos se aplican en orden) y créditos con su avance
-- -----------------------------------------------------------------------------
create view v_credito_cuotas with (security_invoker = on) as
select q.*, c.tipo, c.estado as credito_estado,
       x.pagado,
       q.monto - x.pagado as saldo,
       case when q.monto - x.pagado = 0 then 'pagada'
            when q.vence < (now() at time zone 'America/Lima')::date then 'vencida'
            when x.pagado > 0 then 'parcial'
            else 'pendiente' end as situacion
  from credito_cuotas q
  join creditos c on c.id = q.credito_id
  cross join lateral (select coalesce(sum(monto), 0) as total from credito_pagos
                       where credito_id = q.credito_id and estado = 'registrada') p
  cross join lateral (select coalesce(sum(monto), 0) as antes from credito_cuotas q2
                       where q2.credito_id = q.credito_id and q2.numero < q.numero) a
  cross join lateral (select least(q.monto, greatest(0, p.total - a.antes)) as pagado) x;

create view v_creditos with (security_invoker = on) as
select c.*,
       coalesce(pr.nombre, cp.razon_social)     as contraparte,
       coalesce(pr.nro_doc, cp.ruc)             as contraparte_doc,
       coalesce(co.numero, ve.numero)           as operacion_numero,
       c.monto + c.inicial                      as total_operacion,
       pg.pagado,
       c.monto - pg.pagado                      as saldo,
       pg.n_pagos,
       q.cuotas_pagadas, q.cuotas_vencidas, q.monto_vencido,
       q.proxima_numero, q.proxima_vence, q.proxima_saldo,
       coalesce((now() at time zone 'America/Lima')::date - q.primera_vencida, 0) as dias_atraso,
       case when c.estado = 'anulada' then 'anulado'
            when c.monto - pg.pagado = 0 then 'pagado'
            when q.cuotas_vencidas > 0 then 'vencido'
            else 'al_dia' end as situacion
  from creditos c
  left join proveedores pr on pr.id = c.proveedor_id
  left join compradores cp on cp.id = c.comprador_id
  left join compras co on co.id = c.compra_id
  left join ventas ve on ve.id = c.venta_id
  cross join lateral (select coalesce(sum(monto), 0) as pagado, count(*) as n_pagos from credito_pagos
                       where credito_id = c.id and estado = 'registrada') pg
  cross join lateral (
    select count(*) filter (where situacion = 'pagada')                  as cuotas_pagadas,
           count(*) filter (where situacion = 'vencida')                 as cuotas_vencidas,
           coalesce(sum(saldo) filter (where situacion = 'vencida'), 0)  as monto_vencido,
           min(vence) filter (where situacion = 'vencida')               as primera_vencida,
           (array_agg(numero order by numero) filter (where saldo > 0))[1] as proxima_numero,
           (array_agg(vence order by numero) filter (where saldo > 0))[1]  as proxima_vence,
           (array_agg(saldo order by numero) filter (where saldo > 0))[1]  as proxima_saldo
      from v_credito_cuotas where credito_id = c.id) q;

create view v_credito_pagos with (security_invoker = on) as
select p.*, ca.nombre as caja_nombre,
       coalesce(mp.nombre, initcap(p.medio_pago::text)) as medio_nombre,
       m.nombre as creado_por_nombre
  from credito_pagos p
  join cajas ca on ca.id = p.caja_id
  left join medios_pago mp on mp.id = p.medio_id
  left join miembros m on m.empresa_id = p.empresa_id and m.user_id = p.creado_por;

-- -----------------------------------------------------------------------------
-- Pagos de cuotas: mueven la caja (egreso si le pagamos al proveedor, ingreso si nos paga
-- el comprador). Se aplican a las cuotas en orden; no se puede pagar más que el saldo.
-- -----------------------------------------------------------------------------
create or replace function registrar_pago_credito(
  p_credito  uuid,
  p_monto    numeric,
  p_medio    uuid default null,
  p_caja     uuid default null,
  p_fecha    timestamptz default null,
  p_nota     text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c        creditos;
  v_rol    rol_miembro;
  v_medio  medios_pago;
  v_tipo   medio_pago := 'efectivo';
  v_caja   uuid := p_caja;
  v_monto  numeric(14,2) := round(coalesce(p_monto, 0), 2);
  v_pagado numeric(14,2);
  v_saldo  numeric(14,2);
  v_num    integer;
  v_fecha  timestamptz;
  v_doc    text;
  v_mov    uuid;
  v_id     uuid;
begin
  select * into c from creditos where id = p_credito for update;
  if not found then raise exception 'Crédito no encontrado.'; end if;
  v_rol := exigir_rol(c.empresa_id, '{dueno,administrador,cajero}');
  if c.estado = 'anulada' then raise exception 'El crédito está anulado.'; end if;
  if v_monto <= 0 then raise exception 'El monto del pago debe ser mayor a cero.'; end if;

  select coalesce(sum(monto), 0) into v_pagado from credito_pagos where credito_id = c.id and estado = 'registrada';
  v_saldo := c.monto - v_pagado;
  if v_saldo <= 0 then raise exception 'Este crédito ya está pagado.'; end if;
  if v_monto > v_saldo then raise exception 'El pago (S/ %) es mayor a lo que falta (S/ %).', v_monto, v_saldo; end if;

  if p_medio is not null then
    v_medio := _medio_pago(c.empresa_id, p_medio);
    v_tipo  := v_medio.tipo;
    v_caja  := coalesce(p_caja, v_medio.caja_id);
  end if;
  if v_caja is null then raise exception 'Elija la caja del pago.'; end if;
  perform _validar_caja(c.empresa_id, v_caja);
  v_fecha := _fecha_operacion(v_rol, p_fecha);

  -- Cuota que empieza a cubrir este pago (para el concepto del movimiento)
  select numero into v_num from v_credito_cuotas where credito_id = c.id and saldo > 0 order by numero limit 1;
  if c.tipo = 'por_pagar' then
    select 'Compra N° ' || numero into v_doc from compras where id = c.compra_id;
  else
    select 'Venta N° ' || numero into v_doc from ventas where id = c.venta_id;
  end if;

  v_mov := _mov_caja(c.empresa_id, v_caja, v_fecha,
                     case when c.tipo = 'por_pagar' then 'egreso'::tipo_mov_caja else 'ingreso'::tipo_mov_caja end,
                     case when c.tipo = 'por_pagar' then 'compra'::origen_mov_caja else 'venta'::origen_mov_caja end,
                     coalesce(c.compra_id, c.venta_id), v_monto,
                     'Pago de crédito · ' || v_doc || ' (cuota ' || v_num || ' de ' || c.n_cuotas || ')');

  insert into credito_pagos (empresa_id, credito_id, fecha, monto, caja_id, medio_pago, medio_id, mov_id, nota)
  values (c.empresa_id, c.id, v_fecha, v_monto, v_caja, v_tipo, p_medio, v_mov, _texto(p_nota))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'monto', v_monto, 'saldo', v_saldo - v_monto, 'cuota', v_num);
end $$;

create or replace function anular_pago_credito(p_pago uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare p credito_pagos;
begin
  select * into p from credito_pagos where id = p_pago for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  perform exigir_rol(p.empresa_id, '{dueno,administrador}');
  if p.estado = 'anulada' then raise exception 'El pago ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  update movimientos_caja set anulado = true where id = p.mov_id;
  update credito_pagos
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_pago;
end $$;

-- -----------------------------------------------------------------------------
-- Anular la compra/venta: primero sus pagos de crédito; el crédito queda anulado con ella
-- -----------------------------------------------------------------------------
create or replace function trg_credito_anulacion()
returns trigger
language plpgsql set search_path = public
as $$
declare c creditos;
begin
  if new.estado::text <> 'anulada' or old.estado::text = 'anulada' then return new; end if;
  if tg_table_name = 'compras' then
    select * into c from creditos where compra_id = new.id and estado = 'registrada';
  else
    select * into c from creditos where venta_id = new.id and estado = 'registrada';
  end if;
  if not found then return new; end if;
  if exists (select 1 from credito_pagos where credito_id = c.id and estado = 'registrada') then
    raise exception 'La % N° % tiene pagos de crédito registrados. Anule primero esos pagos (Créditos).',
      case when tg_table_name = 'compras' then 'compra' else 'venta' end, new.numero;
  end if;
  update creditos
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(),
         motivo_anulacion = coalesce(new.motivo_anulacion, 'Operación anulada')
   where id = c.id;
  return new;
end $$;

create trigger compras_credito_anulacion before update of estado on compras
  for each row execute function trg_credito_anulacion();
create trigger ventas_credito_anulacion before update of estado on ventas
  for each row execute function trg_credito_anulacion();

-- -----------------------------------------------------------------------------
-- Patrimonio: + cuentas por cobrar (ventas a crédito) − cuentas por pagar (compras a crédito)
-- (columnas nuevas al final; activos y ganancia las incluyen)
-- -----------------------------------------------------------------------------
create or replace view v_patrimonio with (security_invoker = on) as
select e.id as empresa_id,
       cj.caja,
       st.stock_costo,
       st.stock_precio_venta,
       tr.en_transito,
       ap.aportes, ap.retiros,
       ap.aportes - ap.retiros                                                             as capital,
       cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar           as activos,
       cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar - cr.por_pagar
         - (ap.aportes - ap.retiros)                                                       as ganancia_acumulada,
       pc.por_cobrar,
       cr.por_cobrar as cuentas_por_cobrar,
       cr.por_pagar  as cuentas_por_pagar
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
    select coalesce(sum(monto) filter (where tipo = 'aporte'), 0) as aportes,
           coalesce(sum(monto) filter (where tipo = 'retiro'), 0) as retiros
      from aportes_retiros where empresa_id = e.id and estado = 'registrada') ap
  cross join lateral (
    select coalesce((select sum(importe) from selecciones_compra
                      where empresa_id = e.id and estado = 'registrada' and cobrar), 0)
         - coalesce((select sum(saldo_aplicado) from compras
                      where empresa_id = e.id and estado = 'registrada'), 0)
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
  ap as (select coalesce(sum(monto) filter (where tipo = 'aporte'), 0) as aportes,
                coalesce(sum(monto) filter (where tipo = 'retiro'), 0) as retiros
           from aportes_retiros where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta),
  pc as (select coalesce((select sum(importe) from selecciones_compra
                           where empresa_id = p_empresa and estado = 'registrada' and cobrar and fecha < p_hasta), 0)
              - coalesce((select sum(saldo_aplicado) from compras
                           where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta), 0)
              - coalesce((select sum(monto) from devoluciones_proveedor
                           where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta), 0) as por_cobrar),
  cr as (select coalesce(sum(s.saldo) filter (where s.tipo = 'por_cobrar'), 0) as por_cobrar,
                coalesce(sum(s.saldo) filter (where s.tipo = 'por_pagar'), 0)  as por_pagar
           from (select c.tipo, c.monto - coalesce((select sum(p.monto) from credito_pagos p
                                                     where p.credito_id = c.id and p.estado = 'registrada'
                                                       and p.fecha < p_hasta), 0) as saldo
                   from creditos c
                  where c.empresa_id = p_empresa and c.estado = 'registrada' and c.fecha < p_hasta) s)
  select jsonb_build_object(
           'caja', cj.caja, 'stock_costo', st.stock_costo, 'en_transito', tr.en_transito,
           'por_cobrar', pc.por_cobrar,
           'cuentas_por_cobrar', cr.por_cobrar, 'cuentas_por_pagar', cr.por_pagar,
           'aportes', ap.aportes, 'retiros', ap.retiros, 'capital', ap.aportes - ap.retiros,
           'activos', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar,
           'ganancia_acumulada', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar
                                 - cr.por_pagar - (ap.aportes - ap.retiros))
    from cj, st, tr, ap, pc, cr
   where es_miembro(p_empresa)
$$;

-- =============================================================================
-- Compra: + p_credito (al final). Mismo cuerpo que en 20261023000002, salvo el pago.
-- =============================================================================
drop function registrar_compra(uuid, jsonb, uuid, medio_pago, uuid, text, text, uuid, timestamptz, boolean, uuid);

create or replace function registrar_compra(
  p_empresa          uuid,
  p_items            jsonb,
  p_caja             uuid default null,
  p_medio_pago       medio_pago default 'efectivo',
  p_proveedor        uuid default null,
  p_notas            text default null,
  p_foto_ticket_url  text default null,
  p_clave            uuid default null,
  p_fecha            timestamptz default null,
  p_aplicar_saldo    boolean default false,
  p_medio            uuid default null,
  p_credito          jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rol      rol_miembro;
  v_emp      empresas;
  v_prov     proveedores;
  v_clase    text := 'minorista';
  v_medio    medios_pago;
  v_tipo     medio_pago := coalesce(p_medio_pago, 'efectivo');
  v_caja     uuid := p_caja;
  v_compra   compras;
  v_item     jsonb;
  v_metal    metales;
  v_ci       compra_items;
  v_bruto    numeric(12,3);
  v_desc     numeric(12,3);
  v_sug      numeric(14,2);
  v_precio   numeric(14,2);
  v_total    numeric(14,2) := 0;
  v_aplicado numeric(14,2) := 0;
  v_fecha    timestamptz;
  v_inicial  numeric(14,2) := 0;
  v_credito  uuid;
begin
  v_rol := exigir_rol(p_empresa, '{dueno,administrador,cajero,balancero}');
  v_fecha := _fecha_operacion(v_rol, p_fecha);

  -- Idempotencia: si el celular reintenta, devolvemos la misma compra
  if p_clave is not null then
    select * into v_compra from compras where empresa_id = p_empresa and clave_idempotencia = p_clave;
    if found then
      return jsonb_build_object('id', v_compra.id, 'numero', v_compra.numero, 'total', v_compra.total,
                                'saldo_aplicado', v_compra.saldo_aplicado, 'repetida', true);
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregue al menos un producto a la compra.';
  end if;

  select * into v_emp from empresas where id = p_empresa;
  if p_medio is not null then
    v_medio := _medio_pago(p_empresa, p_medio);
    v_tipo  := v_medio.tipo;
    v_caja  := coalesce(p_caja, v_medio.caja_id);
  end if;
  if v_caja is null then raise exception 'Elija la caja de la que sale el pago.'; end if;
  perform _validar_caja(p_empresa, v_caja);

  if p_proveedor is not null then
    -- Bloqueo del proveedor: dos compras simultáneas no aplican el mismo saldo a favor
    select * into v_prov from proveedores where id = p_proveedor and empresa_id = p_empresa for update;
    if not found then raise exception 'Proveedor no válido.'; end if;
    if not v_prov.activo then raise exception 'El proveedor % está desactivado.', v_prov.nombre; end if;
    v_clase := v_prov.clase;
  end if;

  insert into compras (empresa_id, numero, fecha, proveedor_id, caja_id, medio_pago, medio_id, notas,
                       foto_ticket_url, clave_idempotencia, creado_por)
  values (p_empresa, siguiente_numero(p_empresa, 'compra'), v_fecha, p_proveedor, v_caja, v_tipo, p_medio,
          _texto(p_notas), _texto(p_foto_ticket_url), p_clave, auth.uid())
  returning * into v_compra;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_metal from metales
     where id = (v_item->>'metal_id')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Producto no válido.'; end if;
    if not v_metal.activo then raise exception 'El producto % está desactivado.', v_metal.nombre; end if;

    v_sug    := _precio_sugerido(v_metal, v_clase);
    v_bruto  := round(coalesce(nullif(v_item->>'peso_bruto_kg', '')::numeric, 0), 3);
    v_desc   := round(coalesce(nullif(v_item->>'descuento_kg', '')::numeric, 0), 3);
    v_precio := round(coalesce(nullif(v_item->>'precio_kg', '')::numeric, v_sug), 2);

    if v_bruto <= 0 then
      raise exception 'El peso bruto de % debe ser mayor a cero.', v_metal.nombre;
    end if;
    if v_desc < 0 or v_desc >= v_bruto then
      raise exception 'La merma de % debe ser menor al peso bruto.', v_metal.nombre;
    end if;
    if v_precio < 0 then
      raise exception 'El precio de % no puede ser negativo.', v_metal.nombre;
    end if;
    if v_precio <> v_sug and not (v_rol = any(v_emp.roles_editan_precio)) then
      raise exception 'No tiene permiso para cambiar el precio de % (precio del día %: S/ %).',
        v_metal.nombre, v_clase, v_sug;
    end if;

    insert into compra_items (empresa_id, compra_id, metal_id, peso_bruto_kg, descuento_kg, precio_kg)
    values (p_empresa, v_compra.id, v_metal.id, v_bruto, v_desc, v_precio)
    returning * into v_ci;

    perform _stock_entrada(p_empresa, v_metal.id, v_ci.peso_neto_kg, v_ci.importe, v_fecha,
                           'compra', 'compras', v_compra.id);
    v_total := v_total + v_ci.importe;
  end loop;

  if v_total <= 0 then
    raise exception 'El total de la compra debe ser mayor a cero.';
  end if;

  if v_emp.monto_doc_obligatorio is not null and v_total >= v_emp.monto_doc_obligatorio
     and (p_proveedor is null or v_prov.tipo_doc = 'SIN_DOC') then
    raise exception 'Para compras desde S/ % se requiere el DNI o RUC del proveedor.', v_emp.monto_doc_obligatorio;
  end if;

  if p_aplicar_saldo and p_proveedor is not null then
    v_aplicado := greatest(0, least(_saldo_proveedor(p_proveedor), v_total));
  end if;

  update compras set total = v_total, saldo_aplicado = v_aplicado where id = v_compra.id;
  if p_credito is not null then
    -- A crédito: solo la inicial sale de caja; el resto queda por pagar al proveedor
    if p_proveedor is null then
      raise exception 'Para comprar a crédito elija al proveedor (no puede ser «Sin documento»).';
    end if;
    v_inicial := _inicial_credito(p_credito, v_total - v_aplicado);
    if v_inicial > 0 then
      perform _mov_caja(p_empresa, v_caja, v_fecha, 'egreso', 'compra', v_compra.id, v_inicial,
                        'Compra N° ' || v_compra.numero || ' · inicial (crédito)');
    end if;
    v_credito := _crear_credito(p_empresa, 'por_pagar', v_compra.id, null, p_proveedor, null, v_fecha,
                                v_total - v_aplicado - v_inicial, v_inicial, p_credito);
  elsif v_total - v_aplicado > 0 then
    perform _mov_caja(p_empresa, v_caja, v_fecha, 'egreso', 'compra', v_compra.id, v_total - v_aplicado,
                      'Compra N° ' || v_compra.numero
                      || case when v_aplicado > 0 then ' (descuento a favor S/ ' || v_aplicado || ')' else '' end);
  end if;

  return jsonb_build_object('id', v_compra.id, 'numero', v_compra.numero, 'total', v_total,
                            'saldo_aplicado', v_aplicado, 'credito_id', v_credito, 'repetida', false);
end $$;

-- Corrección de una compra a crédito: sin caja; se rehace el cronograma (si aún no tiene pagos)
create or replace function corregir_compra(p_compra uuid, p_items jsonb, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v          compras;
  v_sel      selecciones_compra;
  it         record;
  v_dato     jsonb;
  v_bruto    numeric(12,3);
  v_desc     numeric(12,3);
  v_precio   numeric(14,2);
  v_nuevo    compra_items;
  v_antes    jsonb := '[]'::jsonb;
  v_despues  jsonb := '[]'::jsonb;
  v_total    numeric(14,2);
  v_aplicado numeric(14,2);
  v_dif      numeric(14,2);
  v_cred     creditos;
begin
  select * into v from compras where id = p_compra for update;
  if not found then raise exception 'Compra no encontrada.'; end if;
  perform exigir_rol(v.empresa_id, '{dueno,administrador}');
  if v.estado = 'anulada' then raise exception 'La compra N° % está anulada.', v.numero; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la corrección.'; end if;

  select * into v_sel from selecciones_compra where compra_id = p_compra and estado = 'registrada';
  if found and (v_sel.kg > 0 or v_sel.kg_traslado > 0) then
    raise exception 'La compra N° % ya pasó por limpieza (N° %) con merma o traslados. Anule primero esa limpieza.',
      v.numero, v_sel.numero;
  end if;

  for it in
    select ci.*, m.nombre as metal_nombre
      from compra_items ci join metales m on m.id = ci.metal_id
     where ci.compra_id = p_compra
     order by ci.metal_id, ci.id
  loop
    select e.val into v_dato from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as e(val)
     where (e.val->>'item_id')::uuid = it.id
     limit 1;
    continue when v_dato is null;

    v_bruto  := round(coalesce(nullif(v_dato->>'peso_bruto_kg', '')::numeric, it.peso_bruto_kg), 3);
    v_desc   := round(coalesce(nullif(v_dato->>'descuento_kg', '')::numeric, it.descuento_kg), 3);
    v_precio := round(coalesce(nullif(v_dato->>'precio_kg', '')::numeric, it.precio_kg), 2);
    v_dato   := null;
    if v_bruto <= 0 then raise exception 'El peso bruto de % debe ser mayor a cero.', it.metal_nombre; end if;
    if v_desc < 0 or v_desc >= v_bruto then raise exception 'La merma de % debe ser menor al peso bruto.', it.metal_nombre; end if;
    if v_precio < 0 then raise exception 'El precio de % no puede ser negativo.', it.metal_nombre; end if;
    continue when v_bruto = it.peso_bruto_kg and v_desc = it.descuento_kg and v_precio = it.precio_kg;

    update compra_items set peso_bruto_kg = v_bruto, descuento_kg = v_desc, precio_kg = v_precio
     where id = it.id
    returning * into v_nuevo;
    perform _stock_correccion(v.empresa_id, it.metal_id, v_nuevo.peso_neto_kg - it.peso_neto_kg,
                              v_nuevo.importe - it.importe, p_compra);

    v_antes := v_antes || jsonb_build_object('item_id', it.id, 'producto', it.metal_nombre,
      'peso_bruto_kg', it.peso_bruto_kg, 'descuento_kg', it.descuento_kg, 'precio_kg', it.precio_kg, 'importe', it.importe);
    v_despues := v_despues || jsonb_build_object('item_id', it.id, 'producto', it.metal_nombre,
      'peso_bruto_kg', v_nuevo.peso_bruto_kg, 'descuento_kg', v_nuevo.descuento_kg, 'precio_kg', v_nuevo.precio_kg,
      'importe', v_nuevo.importe);
  end loop;

  if jsonb_array_length(v_despues) = 0 then raise exception 'No hay cambios que guardar.'; end if;

  select coalesce(sum(importe), 0) into v_total from compra_items where compra_id = p_compra;
  if v_total <= 0 then raise exception 'El total de la compra debe ser mayor a cero.'; end if;
  v_aplicado := least(v.saldo_aplicado, v_total);
  -- Lo que cambia el pago: más importe = sale más de caja; menos = el proveedor devuelve
  v_dif := (v_total - v_aplicado) - (v.total - v.saldo_aplicado);

  -- A crédito: no se mueve caja; cambia lo que se le debe al proveedor y se rehace el cronograma
  select * into v_cred from creditos where compra_id = p_compra and estado = 'registrada' for update;
  if found then
    if exists (select 1 from credito_pagos where credito_id = v_cred.id and estado = 'registrada') then
      raise exception 'La compra N° % ya tiene pagos de crédito. Anúlelos antes de corregirla.', v.numero;
    end if;
    if v_total - v_aplicado - v_cred.inicial <= 0 then
      raise exception 'Con la corrección el total (S/ %) no cubre la inicial ya pagada (S/ %).', v_total - v_aplicado, v_cred.inicial;
    end if;
    update creditos set monto = v_total - v_aplicado - v_cred.inicial where id = v_cred.id;
    delete from credito_cuotas where credito_id = v_cred.id;
    perform _plan_cuotas(v_cred.id);
    v_dif := 0;
  end if;

  update compras
     set total = v_total, saldo_aplicado = v_aplicado, corregido_en = now(), corregido_por = auth.uid()
   where id = p_compra;

  if v_dif <> 0 then
    perform _mov_caja(v.empresa_id, v.caja_id, now(),
                      case when v_dif > 0 then 'egreso'::tipo_mov_caja else 'ingreso'::tipo_mov_caja end,
                      'compra', p_compra, abs(v_dif), 'Corrección de compra N° ' || v.numero);
  end if;

  insert into correcciones_compra (empresa_id, compra_id, motivo, antes, despues, total_antes, total, creado_por)
  values (v.empresa_id, p_compra, _texto(p_motivo), v_antes, v_despues, v.total, v_total, auth.uid());

  return jsonb_build_object('id', p_compra, 'numero', v.numero, 'total_antes', v.total, 'total', v_total,
                            'diferencia', v_dif);
end $$;

-- =============================================================================
-- Venta: el crédito se decide al confirmar (con el precio del comprador)
-- =============================================================================
drop function confirmar_venta(uuid, jsonb, uuid, medio_pago, text, timestamptz, uuid);

create or replace function confirmar_venta(
  p_venta            uuid,
  p_items            jsonb,
  p_caja             uuid default null,
  p_medio_pago       medio_pago default 'transferencia',
  p_comprobante_url  text default null,
  p_fecha            timestamptz default null,
  p_medio            uuid default null,
  p_credito          jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v          ventas;
  v_rol      rol_miembro;
  v_medio    medios_pago;
  v_tipo     medio_pago := coalesce(p_medio_pago, 'transferencia');
  v_caja     uuid := p_caja;
  it         record;
  v_dato     jsonb;
  v_recibido numeric(12,3);
  v_precio   numeric(14,2);
  v_vendido  numeric(16,4);
  v_total    numeric(14,2);
  v_fecha    timestamptz;
  v_inicial  numeric(14,2) := 0;
begin
  select * into v from ventas where id = p_venta for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  v_rol := exigir_rol(v.empresa_id, '{dueno,administrador,cajero}');
  if v.estado <> 'pendiente' then
    raise exception 'La venta N° % no está pendiente (estado: %).', v.numero, v.estado;
  end if;
  if p_medio is not null then
    v_medio := _medio_pago(v.empresa_id, p_medio);
    v_tipo  := v_medio.tipo;
    v_caja  := coalesce(p_caja, v_medio.caja_id);
  end if;
  if v_caja is null then raise exception 'Elija la caja a la que entra el cobro.'; end if;
  perform _validar_caja(v.empresa_id, v_caja);
  v_fecha := _fecha_operacion(v_rol, p_fecha);

  for it in
    select vi.*, m.nombre as metal_nombre
      from venta_items vi join metales m on m.id = vi.metal_id
     where vi.venta_id = p_venta
  loop
    select e.val into v_dato from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as e(val)
     where (e.val->>'item_id')::uuid = it.id
     limit 1;
    if v_dato is null or _texto(v_dato->>'peso_recibido_kg') is null or _texto(v_dato->>'precio_kg') is null then
      raise exception 'Falta el peso recibido o el precio de %.', it.metal_nombre;
    end if;
    v_recibido := round((v_dato->>'peso_recibido_kg')::numeric, 3);
    v_precio   := round((v_dato->>'precio_kg')::numeric, 2);
    if v_recibido < 0 or v_precio < 0 then
      raise exception 'Peso recibido y precio de % no pueden ser negativos.', it.metal_nombre;
    end if;
    if v_recibido > round(it.peso_salida_kg * 1.02, 3) then
      raise exception 'El peso recibido de % (% kg) es mayor a lo que salió (% kg). Revise el dato.',
        it.metal_nombre, v_recibido, it.peso_salida_kg;
    end if;
    v_vendido := round(it.costo_total * v_recibido / it.peso_salida_kg, 2);

    update venta_items
       set peso_recibido_kg = v_recibido,
           precio_kg        = v_precio,
           costo_vendido    = v_vendido,
           merma_costo      = it.costo_total - v_vendido
     where id = it.id;
    v_dato := null;
  end loop;

  select coalesce(sum(importe), 0) into v_total from venta_items where venta_id = p_venta;

  update ventas
     set total = v_total, caja_id = v_caja, medio_pago = v_tipo, medio_id = p_medio, estado = 'confirmada',
         fecha_confirmacion = v_fecha, confirmado_por = auth.uid(),
         comprobante_url = coalesce(_texto(p_comprobante_url), comprobante_url)
   where id = p_venta;

  if p_credito is not null then
    -- A crédito: solo la inicial entra a caja; el resto queda por cobrar al comprador
    if v_total <= 0 then raise exception 'El total de la venta debe ser mayor a cero para darla a crédito.'; end if;
    v_inicial := _inicial_credito(p_credito, v_total);
    if v_inicial > 0 then
      perform _mov_caja(v.empresa_id, v_caja, v_fecha, 'ingreso', 'venta', p_venta, v_inicial,
                        'Venta N° ' || v.numero || ' · inicial (crédito)');
    end if;
    perform _crear_credito(v.empresa_id, 'por_cobrar', null, p_venta, null, v.comprador_id, v_fecha,
                           v_total - v_inicial, v_inicial, p_credito);
  elsif v_total > 0 then
    perform _mov_caja(v.empresa_id, v_caja, v_fecha, 'ingreso', 'venta', p_venta, v_total,
                      'Venta N° ' || v.numero);
  end if;

  return jsonb_build_object('id', p_venta, 'numero', v.numero, 'total', v_total);
end $$;

drop function registrar_venta(uuid, uuid, jsonb, text, text, text, uuid, timestamptz, uuid, medio_pago, text, uuid,
                              tipo_comprobante, text);

create or replace function registrar_venta(
  p_empresa            uuid,
  p_comprador          uuid,
  p_items              jsonb,
  p_guia_numero        text default null,
  p_guia_url           text default null,
  p_notas              text default null,
  p_clave              uuid default null,
  p_fecha              timestamptz default null,
  p_caja               uuid default null,
  p_medio_pago         medio_pago default null,
  p_comprobante_url    text default null,
  p_medio              uuid default null,
  p_comprobante_tipo   tipo_comprobante default null,
  p_comprobante_numero text default null,
  p_credito            jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rol       rol_miembro;
  v_venta     ventas;
  v_comp      compradores;
  v_item      jsonb;
  v_metal     metales;
  v_salida    numeric(12,3);
  v_costo     numeric(16,4);
  v_item_id   uuid;
  v_fecha     timestamptz;
  v_conf      jsonb := '[]'::jsonb;
  v_completa  boolean := true;
  v_numero_cp text;
begin
  v_rol := exigir_rol(p_empresa, '{dueno,administrador,cajero}');
  v_fecha := _fecha_operacion(v_rol, p_fecha);

  if p_clave is not null then
    select * into v_venta from ventas where empresa_id = p_empresa and clave_idempotencia = p_clave;
    if found then
      return jsonb_build_object('id', v_venta.id, 'numero', v_venta.numero, 'estado', v_venta.estado, 'repetida', true);
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregue al menos un producto a la venta.';
  end if;

  select * into v_comp from compradores where id = p_comprador and empresa_id = p_empresa;
  if not found then raise exception 'Comprador no válido.'; end if;
  if not v_comp.activo then raise exception 'El comprador % está desactivado.', v_comp.razon_social; end if;
  v_numero_cp := _validar_comprobante_venta(p_comprador, p_comprobante_tipo, p_comprobante_numero);

  insert into ventas (empresa_id, numero, fecha, comprador_id, guia_numero, guia_url, notas,
                      comprobante_tipo, comprobante_numero, clave_idempotencia, creado_por)
  values (p_empresa, siguiente_numero(p_empresa, 'venta'), v_fecha, p_comprador, _texto(p_guia_numero),
          _texto(p_guia_url), _texto(p_notas), p_comprobante_tipo, v_numero_cp, p_clave, auth.uid())
  returning * into v_venta;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_metal from metales
     where id = (v_item->>'metal_id')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Producto no válido.'; end if;

    v_salida := round(coalesce(nullif(v_item->>'peso_salida_kg', '')::numeric, 0), 3);
    if v_salida <= 0 then
      raise exception 'El peso de salida de % debe ser mayor a cero.', v_metal.nombre;
    end if;

    -- La BD bloquea vender más que el stock (mensaje claro en _stock_salida)
    v_costo := _stock_salida(p_empresa, v_metal.id, v_salida, v_fecha, 'venta', 'ventas', v_venta.id);

    insert into venta_items (empresa_id, venta_id, metal_id, peso_salida_kg, costo_kg, costo_total)
    values (p_empresa, v_venta.id, v_metal.id, v_salida, round(v_costo / v_salida, 4), v_costo)
    returning id into v_item_id;

    if _texto(v_item->>'peso_recibido_kg') is not null and _texto(v_item->>'precio_kg') is not null then
      v_conf := v_conf || jsonb_build_object('item_id', v_item_id,
                                             'peso_recibido_kg', v_item->>'peso_recibido_kg',
                                             'precio_kg', v_item->>'precio_kg');
    else
      v_completa := false;
    end if;
  end loop;

  if p_credito is not null and not (v_completa and (p_caja is not null or p_medio is not null)) then
    raise exception 'Para vender a crédito ingrese el peso recibido y el precio de cada producto (o confirme la venta después).';
  end if;
  if v_completa and (p_caja is not null or p_medio is not null) then
    perform confirmar_venta(v_venta.id, v_conf, p_caja, coalesce(p_medio_pago, 'transferencia'),
                            p_comprobante_url, v_fecha, p_medio, p_credito);
    v_venta.estado := 'confirmada';
  end if;

  return jsonb_build_object('id', v_venta.id, 'numero', v_venta.numero, 'estado', v_venta.estado, 'repetida', false);
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

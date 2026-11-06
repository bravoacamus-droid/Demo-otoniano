-- =============================================================================
-- Reunión del 06/11 con el Sr. Otiniano
--  1. Capital por socio: voucher (N° y archivo) en cada aporte, ajuste del capital,
--     utilidad entregada al socio y utilidad que deja como capital (por mes).
--  2. Conteo físico: queda el stock del sistema, lo contado y el faltante/sobrante;
--     el motivo es obligatorio si no cuadra.
--  3. Corregir una venta confirmada (peso recibido y precio) con motivo obligatorio.
--  4. Reporte del mes: caja, material por producto, compras, ventas y utilidad.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sociedad
-- -----------------------------------------------------------------------------
alter table aportes_retiros
  alter column caja_id drop not null,
  add column voucher_numero text,
  add column voucher_url    text,
  -- Mes de la utilidad que se entrega o se capitaliza
  add column periodo        text check (periodo is null or periodo ~ '^\d{4}-(0[1-9]|1[0-2])$');

alter table aportes_retiros
  -- Sin caja: aporte/retiro = ajuste del capital sin movimiento de dinero; capitalización nunca mueve caja
  add constraint aportes_retiros_caja_ck check (
    (tipo = 'capitalizacion' and caja_id is null) or tipo in ('aporte', 'retiro')
    or (tipo = 'retiro_utilidad' and caja_id is not null)),
  add constraint aportes_retiros_periodo_ck check ((tipo in ('retiro_utilidad', 'capitalizacion')) = (periodo is not null));

create or replace function registrar_movimiento_socio(
  p_empresa uuid, p_socio uuid, p_tipo tipo_aporte, p_monto numeric,
  p_caja uuid default null, p_fecha timestamptz default null, p_nota text default null,
  p_voucher_numero text default null, p_voucher_url text default null, p_periodo text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_rol     rol_miembro;
  v_id      uuid;
  v_fecha   timestamptz;
  v_monto   numeric(14,2) := round(p_monto, 2);
  v_caja    uuid := p_caja;
  v_periodo text;
  s         socios;
begin
  v_rol := exigir_rol(p_empresa, '{dueno}');
  v_fecha := _fecha_operacion(v_rol, p_fecha);
  select * into s from socios where id = p_socio and empresa_id = p_empresa;
  if not found then raise exception 'Socio no válido.'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;

  if p_tipo in ('retiro_utilidad', 'capitalizacion') then
    v_periodo := _texto(p_periodo);
    if v_periodo is null or v_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'Indique de qué mes es la utilidad.';
    end if;
    if v_periodo > periodo_de(v_fecha) then raise exception 'No se puede entregar utilidad de un mes futuro.'; end if;
  end if;

  if p_tipo = 'capitalizacion' then
    v_caja := null;
  elsif v_caja is null then
    if p_tipo = 'retiro_utilidad' then raise exception 'Elija la caja de la que sale el dinero.'; end if;
    if _texto(p_nota) is null then
      raise exception 'Sin caja no se mueve dinero: explique el motivo del ajuste de capital.';
    end if;
  else
    perform _validar_caja(p_empresa, v_caja);
  end if;

  insert into aportes_retiros (empresa_id, socio_id, fecha, tipo, monto, caja_id, nota,
                               voucher_numero, voucher_url, periodo, creado_por)
  values (p_empresa, p_socio, v_fecha, p_tipo, v_monto, v_caja, _texto(p_nota),
          _texto(p_voucher_numero), _texto(p_voucher_url), v_periodo, auth.uid())
  returning id into v_id;

  if v_caja is not null then
    perform _mov_caja(p_empresa, v_caja, v_fecha,
                      case when p_tipo = 'aporte' then 'ingreso'::tipo_mov_caja else 'egreso'::tipo_mov_caja end,
                      case when p_tipo = 'aporte' then 'aporte'::origen_mov_caja else 'retiro'::origen_mov_caja end,
                      v_id, v_monto,
                      case p_tipo when 'aporte' then 'Aporte de ' || s.nombre
                                  when 'retiro' then 'Retiro de capital de ' || s.nombre
                                  else 'Utilidad ' || v_periodo || ' entregada a ' || s.nombre end);
  end if;
  return v_id;
end $$;

-- «Editar el capital» del socio: registra la diferencia como aporte o retiro (queda en el historial)
create or replace function ajustar_capital_socio(
  p_empresa uuid, p_socio uuid, p_capital numeric, p_motivo text,
  p_caja uuid default null, p_fecha timestamptz default null,
  p_voucher_numero text default null, p_voucher_url text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actual numeric(14,2);
  v_dif    numeric(14,2);
begin
  perform exigir_rol(p_empresa, '{dueno}');
  if p_capital is null or p_capital < 0 then raise exception 'El capital no puede ser negativo.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo del cambio de capital.'; end if;
  select coalesce(sum(case tipo when 'aporte' then monto when 'capitalizacion' then monto
                                when 'retiro' then -monto else 0 end), 0)
    into v_actual
    from aportes_retiros where socio_id = p_socio and empresa_id = p_empresa and estado = 'registrada';
  v_dif := round(p_capital, 2) - v_actual;
  if v_dif = 0 then raise exception 'El capital del socio ya es S/ %.', v_actual; end if;
  return registrar_movimiento_socio(
    p_empresa, p_socio, case when v_dif > 0 then 'aporte'::tipo_aporte else 'retiro'::tipo_aporte end, abs(v_dif),
    p_caja, p_fecha, 'Ajuste de capital (de S/ ' || v_actual || ' a S/ ' || round(p_capital, 2) || '): ' || _texto(p_motivo),
    p_voucher_numero, p_voucher_url, null);
end $$;

-- Completar el voucher (N°, archivo) o la nota de un movimiento ya registrado
create or replace function actualizar_aporte_voucher(p_id uuid, p_voucher_numero text, p_voucher_url text, p_nota text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a aportes_retiros;
begin
  select * into a from aportes_retiros where id = p_id for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  perform exigir_rol(a.empresa_id, '{dueno}');
  if a.estado = 'anulada' then raise exception 'El movimiento está anulado.'; end if;
  update aportes_retiros
     set voucher_numero = _texto(p_voucher_numero), voucher_url = _texto(p_voucher_url),
         nota = coalesce(_texto(p_nota), nota)
   where id = p_id;
end $$;

drop view v_aportes_retiros;
create view v_aportes_retiros with (security_invoker = on) as
select a.*, s.nombre as socio_nombre, c.nombre as caja_nombre, c.tipo::text as caja_tipo,
       coalesce(mi.nombre, mi.email) as creado_por_nombre
  from aportes_retiros a
  join socios s on s.id = a.socio_id
  left join cajas c on c.id = a.caja_id
  left join miembros mi on mi.empresa_id = a.empresa_id and mi.user_id = a.creado_por;

-- Capital = aportes + utilidad capitalizada − retiros de capital (la utilidad entregada no baja el capital)
create or replace view v_capital_socio with (security_invoker = on) as
select s.empresa_id, s.id as socio_id, s.nombre, s.dni, s.porcentaje, s.activo,
       coalesce(sum(a.monto) filter (where a.tipo = 'aporte'), 0) as aportes,
       coalesce(sum(a.monto) filter (where a.tipo = 'retiro'), 0) as retiros,
       coalesce(sum(case a.tipo when 'aporte' then a.monto when 'capitalizacion' then a.monto
                                when 'retiro' then -a.monto else 0 end), 0) as capital,
       coalesce(sum(a.monto) filter (where a.tipo = 'capitalizacion'), 0)  as capitalizado,
       coalesce(sum(a.monto) filter (where a.tipo = 'retiro_utilidad'), 0) as utilidad_entregada
  from socios s
  left join aportes_retiros a on a.socio_id = s.id and a.estado = 'registrada'
 group by s.empresa_id, s.id, s.nombre, s.dni, s.porcentaje, s.activo;

-- Por socio y mes: cuánto le toca, cuánto se le dio, cuánto dejó como capital y cuánto falta
create view v_utilidad_socio_saldo with (security_invoker = on) as
with
mov as (
  select socio_id, periodo,
         sum(monto) filter (where tipo = 'retiro_utilidad') as entregado,
         sum(monto) filter (where tipo = 'capitalizacion')  as capitalizado
    from aportes_retiros
   where estado = 'registrada' and periodo is not null
   group by 1, 2),
p as (
  select empresa_id, periodo from v_resultado_mes
  union
  select empresa_id, periodo from aportes_retiros where periodo is not null and estado = 'registrada')
select s.empresa_id, s.id as socio_id, s.nombre, s.porcentaje, s.activo, p.periodo,
       coalesce(r.utilidad, 0)                                as utilidad_empresa,
       round(coalesce(r.utilidad, 0) * s.porcentaje / 100, 2) as utilidad_socio,
       coalesce(m.entregado, 0)                               as entregado,
       coalesce(m.capitalizado, 0)                            as capitalizado,
       round(coalesce(r.utilidad, 0) * s.porcentaje / 100, 2)
         - coalesce(m.entregado, 0) - coalesce(m.capitalizado, 0) as pendiente
  from socios s
  join p on p.empresa_id = s.empresa_id
  left join v_resultado_mes r on r.empresa_id = s.empresa_id and r.periodo = p.periodo
  left join mov m on m.socio_id = s.id and m.periodo = p.periodo
 where s.activo or m.socio_id is not null;

-- Patrimonio: mismas columnas (+2 al final); el capital suma lo capitalizado
create or replace view v_patrimonio with (security_invoker = on) as
select e.id as empresa_id,
       cj.caja,
       st.stock_costo,
       st.stock_precio_venta,
       tr.en_transito,
       ap.aportes, ap.retiros,
       ap.aportes + ap.capitalizado - ap.retiros                                           as capital,
       cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar           as activos,
       cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar - cr.por_pagar
         - (ap.aportes + ap.capitalizado - ap.retiros)                                     as ganancia_acumulada,
       pc.por_cobrar,
       cr.por_cobrar as cuentas_por_cobrar,
       cr.por_pagar  as cuentas_por_pagar,
       ap.capitalizado,
       ap.utilidad_entregada
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
  ap as (select coalesce(sum(monto) filter (where tipo = 'aporte'), 0)          as aportes,
                coalesce(sum(monto) filter (where tipo = 'retiro'), 0)          as retiros,
                coalesce(sum(monto) filter (where tipo = 'capitalizacion'), 0)  as capitalizado,
                coalesce(sum(monto) filter (where tipo = 'retiro_utilidad'), 0) as utilidad_entregada
           from aportes_retiros where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta),
  pc as (select coalesce((select sum(importe) from selecciones_compra
                           where empresa_id = p_empresa and estado = 'registrada' and cobrar and fecha < p_hasta), 0)
              - coalesce((select sum(saldo_aplicado) from compras
                           where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta), 0)
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
           'aportes', ap.aportes, 'retiros', ap.retiros,
           'capitalizado', ap.capitalizado, 'utilidad_entregada', ap.utilidad_entregada,
           'capital', ap.aportes + ap.capitalizado - ap.retiros,
           'activos', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar,
           'ganancia_acumulada', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar
                                 - cr.por_pagar - (ap.aportes + ap.capitalizado - ap.retiros))
    from cj, st, tr, ap, pc, cr
   where es_miembro(p_empresa)
$$;

-- -----------------------------------------------------------------------------
-- 2. Conteo físico con evidencia
-- -----------------------------------------------------------------------------
alter table ajustes_inventario
  add column kg_sistema numeric(12,3),
  add column kg_contado numeric(12,3);

create or replace function registrar_conteo(p_empresa uuid, p_metal uuid, p_kg_contado numeric, p_motivo text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_sistema numeric(12,3);
  v_contado numeric(12,3) := round(p_kg_contado, 3);
  v_dif     numeric(12,3);
  v_id      uuid;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  if v_contado is null or v_contado < 0 then raise exception 'Los kilos contados no pueden ser negativos.'; end if;
  if not exists (select 1 from metales where id = p_metal and empresa_id = p_empresa) then
    raise exception 'Producto no válido.';
  end if;
  perform _stock_lock(p_empresa, p_metal);
  select coalesce(kg, 0) into v_sistema from stock_metal where metal_id = p_metal and empresa_id = p_empresa;
  v_sistema := coalesce(v_sistema, 0);
  v_dif := v_contado - v_sistema;
  if v_dif = 0 then return null; end if;
  if _texto(p_motivo) is null then
    raise exception 'Hay un % de % kg (sistema % kg, contado % kg). Indique el motivo: venta sin registrar, error de balanza, etc.',
      case when v_dif < 0 then 'faltante' else 'sobrante' end, abs(v_dif), v_sistema, v_contado;
  end if;
  v_id := registrar_ajuste(p_empresa, p_metal, v_dif, _texto(p_motivo), 'conteo');
  update ajustes_inventario set kg_sistema = v_sistema, kg_contado = v_contado where id = v_id;
  return v_id;
end $$;

drop view v_ajustes;
create view v_ajustes with (security_invoker = on) as
select a.*, m.nombre as metal_nombre, coalesce(p.ruta, m.nombre) as metal_ruta,
       coalesce(mi.nombre, mi.email) as creado_por_nombre
  from ajustes_inventario a
  join metales m on m.id = a.metal_id
  left join v_productos p on p.id = a.metal_id
  left join miembros mi on mi.empresa_id = a.empresa_id and mi.user_id = a.creado_por;

-- -----------------------------------------------------------------------------
-- 3. Corregir una venta confirmada
-- -----------------------------------------------------------------------------
alter table ventas
  add column corregido_en  timestamptz,
  add column corregido_por uuid;

create table correcciones_venta (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  venta_id    uuid not null references ventas(id),
  fecha       timestamptz not null default now(),
  motivo      text not null,
  antes       jsonb not null,
  despues     jsonb not null,
  total_antes numeric(14,2) not null,
  total       numeric(14,2) not null,
  creado_por  uuid default auth.uid()
);
create index on correcciones_venta (venta_id);
alter table correcciones_venta enable row level security;
create policy correcciones_venta_select on correcciones_venta for select to authenticated using (es_miembro(empresa_id));
create trigger correcciones_venta_no_borrar before delete on correcciones_venta
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();
create trigger correcciones_venta_periodo before insert or update or delete on correcciones_venta
  for each row execute function trg_periodo_abierto();

create view v_correcciones_venta with (security_invoker = on) as
select c.*, coalesce(m.nombre, m.email) as creado_por_nombre
  from correcciones_venta c
  left join miembros m on m.empresa_id = c.empresa_id and m.user_id = c.creado_por;

create or replace function corregir_venta(p_venta uuid, p_items jsonb, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v          ventas;
  it         record;
  v_dato     jsonb;
  v_recibido numeric(12,3);
  v_precio   numeric(14,2);
  v_vendido  numeric(16,4);
  v_nuevo    venta_items;
  v_antes    jsonb := '[]'::jsonb;
  v_despues  jsonb := '[]'::jsonb;
  v_total    numeric(14,2);
  v_dif      numeric(14,2);
  v_cred     creditos;
begin
  select * into v from ventas where id = p_venta for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  perform exigir_rol(v.empresa_id, '{dueno,administrador}');
  if v.estado = 'anulada' then raise exception 'La venta N° % está anulada.', v.numero; end if;
  if v.estado <> 'confirmada' then
    raise exception 'La venta N° % aún no tiene el pesaje del comprador: confírmela con los datos correctos.', v.numero;
  end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la corrección.'; end if;

  for it in
    select vi.*, m.nombre as metal_nombre
      from venta_items vi join metales m on m.id = vi.metal_id
     where vi.venta_id = p_venta
     order by vi.metal_id, vi.id
  loop
    select e.val into v_dato from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as e(val)
     where (e.val->>'item_id')::uuid = it.id
     limit 1;
    continue when v_dato is null;

    v_recibido := round(coalesce(nullif(v_dato->>'peso_recibido_kg', '')::numeric, it.peso_recibido_kg), 3);
    v_precio   := round(coalesce(nullif(v_dato->>'precio_kg', '')::numeric, it.precio_kg), 2);
    v_dato     := null;
    if v_recibido < 0 or v_precio < 0 then
      raise exception 'Peso recibido y precio de % no pueden ser negativos.', it.metal_nombre;
    end if;
    if v_recibido > round(it.peso_salida_kg * 1.02, 3) then
      raise exception 'El peso recibido de % (% kg) es mayor a lo que salió (% kg). Revise el dato.',
        it.metal_nombre, v_recibido, it.peso_salida_kg;
    end if;
    continue when v_recibido = it.peso_recibido_kg and v_precio = it.precio_kg;

    v_vendido := round(it.costo_total * v_recibido / it.peso_salida_kg, 2);
    update venta_items
       set peso_recibido_kg = v_recibido, precio_kg = v_precio,
           costo_vendido = v_vendido, merma_costo = it.costo_total - v_vendido
     where id = it.id
    returning * into v_nuevo;

    v_antes := v_antes || jsonb_build_object('item_id', it.id, 'producto', it.metal_nombre,
      'peso_salida_kg', it.peso_salida_kg, 'peso_recibido_kg', it.peso_recibido_kg, 'precio_kg', it.precio_kg,
      'importe', it.importe);
    v_despues := v_despues || jsonb_build_object('item_id', it.id, 'producto', it.metal_nombre,
      'peso_salida_kg', v_nuevo.peso_salida_kg, 'peso_recibido_kg', v_nuevo.peso_recibido_kg,
      'precio_kg', v_nuevo.precio_kg, 'importe', v_nuevo.importe);
  end loop;

  if jsonb_array_length(v_despues) = 0 then raise exception 'No hay cambios que guardar.'; end if;

  select coalesce(sum(importe), 0) into v_total from venta_items where venta_id = p_venta;
  -- Más importe = entra más a caja; menos = se le devuelve al comprador
  v_dif := v_total - v.total;

  -- A crédito: no se mueve caja; cambia lo que nos debe el comprador y se rehace el cronograma
  select * into v_cred from creditos where venta_id = p_venta and estado = 'registrada' for update;
  if found then
    if exists (select 1 from credito_pagos where credito_id = v_cred.id and estado = 'registrada') then
      raise exception 'La venta N° % ya tiene cobros de crédito. Anúlelos antes de corregirla.', v.numero;
    end if;
    if v_total - v_cred.inicial <= 0 then
      raise exception 'Con la corrección el total (S/ %) no cubre la inicial ya cobrada (S/ %).', v_total, v_cred.inicial;
    end if;
    insert into credito_ajustes (empresa_id, credito_id, fecha, monto, motivo)
    values (v.empresa_id, v_cred.id, now(), (v_total - v_cred.inicial) - v_cred.monto, _texto(p_motivo));
    update creditos set monto = v_total - v_cred.inicial where id = v_cred.id;
    delete from credito_cuotas where credito_id = v_cred.id;
    perform _plan_cuotas(v_cred.id);
    v_dif := 0;
  end if;

  update ventas set total = v_total, corregido_en = now(), corregido_por = auth.uid() where id = p_venta;

  if v_dif <> 0 then
    perform _mov_caja(v.empresa_id, v.caja_id, now(),
                      case when v_dif > 0 then 'ingreso'::tipo_mov_caja else 'egreso'::tipo_mov_caja end,
                      'venta', p_venta, abs(v_dif), 'Corrección de venta N° ' || v.numero);
  end if;

  insert into correcciones_venta (empresa_id, venta_id, motivo, antes, despues, total_antes, total, creado_por)
  values (v.empresa_id, p_venta, _texto(p_motivo), v_antes, v_despues, v.total, v_total, auth.uid());

  return jsonb_build_object('id', p_venta, 'numero', v.numero, 'total_antes', v.total, 'total', v_total,
                            'diferencia', v_dif);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Reporte del mes (lo que se guarda al cerrar y lo que se ve con el mes abierto)
-- -----------------------------------------------------------------------------
create or replace function _foto_mes(p_empresa uuid, p_periodo text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with lim as (
    select ((p_periodo || '-01')::date)::timestamp at time zone 'America/Lima' as ini,
           ((p_periodo || '-01')::date + interval '1 month')::timestamp at time zone 'America/Lima' as fin)
  select jsonb_build_object(
    'periodo',     p_periodo,
    'resultado',   (select to_jsonb(r) - 'empresa_id' from v_resultado_mes r
                     where r.empresa_id = p_empresa and r.periodo = p_periodo),
    'patrimonio',  patrimonio_al(p_empresa, lim.fin),
    'patrimonio_inicio', patrimonio_al(p_empresa, lim.ini),
    -- Material al cierre: en qué producto está la plata (a costo promedio)
    'stock',       (select jsonb_agg(jsonb_build_object('metal', coalesce(p.ruta, m.nombre), 'kg', x.kg,
                                                        'costo', round(x.costo, 2))
                                     order by coalesce(p.clave_orden, m.nombre))
                      from (select metal_id, sum(kg) as kg, sum(costo_total) as costo
                              from kardex where empresa_id = p_empresa and not anulado and fecha < lim.fin
                             group by metal_id) x
                      join metales m on m.id = x.metal_id
                      left join v_productos p on p.id = x.metal_id
                     where x.kg <> 0 or round(x.costo, 2) <> 0),
    'compras',     (select jsonb_agg(jsonb_build_object('metal', coalesce(p.ruta, m.nombre), 'kg', x.kg,
                                                        'importe', x.importe)
                                     order by coalesce(p.clave_orden, m.nombre))
                      from (select ci.metal_id, sum(ci.peso_neto_kg) as kg, sum(ci.importe) as importe
                              from compras co join compra_items ci on ci.compra_id = co.id
                             where co.empresa_id = p_empresa and co.estado = 'registrada'
                               and periodo_de(co.fecha) = p_periodo
                             group by ci.metal_id) x
                      join metales m on m.id = x.metal_id
                      left join v_productos p on p.id = x.metal_id),
    -- Ventas: lo vendido, lo que costó ese material y la ganancia de cada producto
    'ventas',      (select jsonb_agg(jsonb_build_object('metal', coalesce(p.ruta, m.nombre), 'kg', x.kg,
                                                        'importe', x.importe, 'costo', round(x.costo, 2),
                                                        'merma', round(x.merma, 2),
                                                        'margen', round(x.importe - x.costo - x.merma, 2))
                                     order by coalesce(p.clave_orden, m.nombre))
                      from (select vi.metal_id, sum(vi.peso_recibido_kg) as kg, sum(vi.importe) as importe,
                                   sum(vi.costo_vendido) as costo, sum(vi.merma_costo) as merma
                              from ventas ve join venta_items vi on vi.venta_id = ve.id
                             where ve.empresa_id = p_empresa and ve.estado = 'confirmada'
                               and periodo_de(coalesce(ve.fecha_confirmacion, ve.fecha)) = p_periodo
                             group by vi.metal_id) x
                      join metales m on m.id = x.metal_id
                      left join v_productos p on p.id = x.metal_id),
    'utilidad_socios', (select jsonb_agg(jsonb_build_object('socio', nombre, 'porcentaje', porcentaje,
                                                            'utilidad', utilidad_socio, 'entregado', entregado,
                                                            'capitalizado', capitalizado, 'pendiente', pendiente)
                                         order by porcentaje desc, nombre)
                          from v_utilidad_socio_saldo where empresa_id = p_empresa and periodo = p_periodo),
    'generado_en', now())
  from lim
$$;
revoke execute on function _foto_mes(uuid, text) from public, anon, authenticated;

create or replace function cerrar_mes(p_empresa uuid, p_periodo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_actual cierres_mes;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  if p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Periodo inválido (use AAAA-MM).'; end if;
  if p_periodo > periodo_de(now()) then raise exception 'No se puede cerrar un periodo futuro.'; end if;

  select * into v_actual from cierres_mes where empresa_id = p_empresa and periodo = p_periodo;
  if found and v_actual.estado = 'cerrado' then raise exception 'El periodo % ya está cerrado.', p_periodo; end if;

  insert into cierres_mes (empresa_id, periodo, estado, snapshot, cerrado_por, cerrado_en)
  values (p_empresa, p_periodo, 'cerrado', _foto_mes(p_empresa, p_periodo), auth.uid(), now())
  on conflict (empresa_id, periodo) do update
     set estado = 'cerrado', snapshot = excluded.snapshot, cerrado_por = excluded.cerrado_por, cerrado_en = now();
end $$;

-- Mes cerrado: lo guardado al cerrar (lo que falte en cierres antiguos se completa con lo actual).
-- La utilidad entregada a cada socio siempre es la actual: se puede pagar después del cierre.
create or replace function reporte_mes(p_empresa uuid, p_periodo text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  c      cierres_mes;
  v_foto jsonb;
begin
  perform exigir_rol(p_empresa, '{dueno,socio}');
  if p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Periodo inválido (use AAAA-MM).'; end if;
  v_foto := _foto_mes(p_empresa, p_periodo);
  select * into c from cierres_mes where empresa_id = p_empresa and periodo = p_periodo;
  if found and c.estado = 'cerrado' then
    v_foto := (v_foto || c.snapshot) || jsonb_build_object('utilidad_socios', v_foto->'utilidad_socios');
  end if;
  return v_foto || jsonb_build_object('estado', coalesce(c.estado::text, 'abierto'), 'cerrado_en', c.cerrado_en);
end $$;

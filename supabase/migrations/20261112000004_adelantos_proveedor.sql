-- =============================================================================
-- Adelantos a proveedores (pedido del Sr. Otiniano, 12/11)
--  · El proveedor pide plata antes de traer su mercadería: sale de caja y queda como SALDO A FAVOR
--    de la empresa (el mismo que dejan los descuentos de limpieza).
--  · Cuando trae su producto, la compra descuenta ese saldo (registrar_compra con p_aplicar_saldo):
--    si trae menos, se descuenta lo que vale y el resto sigue pendiente; si trae más, se paga la diferencia.
--  · Patrimonio: la caja baja y la cuenta por cobrar sube lo mismo (no cambia la ganancia).
--  · Anular un adelanto solo se puede si su saldo aún no se usó en compras.
-- =============================================================================

create table adelantos_proveedor (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  proveedor_id      uuid not null references proveedores(id),
  fecha             timestamptz not null default now(),
  monto             numeric(14,2) not null check (monto > 0),
  caja_id           uuid not null references cajas(id),
  medio_pago        medio_pago not null default 'efectivo',
  medio_id          uuid references medios_pago(id),
  mov_id            uuid references movimientos_caja(id),
  nota              text,
  estado            estado_doc not null default 'registrada',
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now(),
  anulado_por       uuid,
  anulado_en        timestamptz,
  motivo_anulacion  text
);
create index on adelantos_proveedor (proveedor_id);
create index on adelantos_proveedor (empresa_id, fecha desc);

alter table adelantos_proveedor enable row level security;
create policy adelantos_proveedor_select on adelantos_proveedor for select to authenticated using (es_miembro(empresa_id));
create trigger adelantos_proveedor_no_borrar before delete on adelantos_proveedor
  for each row execute function trg_no_borrar();

-- Saldo a favor = descuentos de limpieza + adelantos − lo descontado en compras − lo devuelto en efectivo
create or replace function _saldo_proveedor(p_proveedor uuid)
returns numeric
language sql stable set search_path = public
as $$
  select coalesce((select sum(importe) from selecciones_compra
                    where proveedor_id = p_proveedor and estado = 'registrada' and cobrar), 0)
       + coalesce((select sum(monto) from adelantos_proveedor
                    where proveedor_id = p_proveedor and estado = 'registrada'), 0)
       - coalesce((select sum(saldo_aplicado) from compras
                    where proveedor_id = p_proveedor and estado = 'registrada'), 0)
       - coalesce((select sum(monto) from devoluciones_proveedor
                    where proveedor_id = p_proveedor and estado = 'registrada'), 0)
$$;
revoke execute on function _saldo_proveedor(uuid) from public, anon, authenticated;

-- Mismas columnas (+ adelantos al final)
create or replace view v_saldo_proveedor with (security_invoker = on) as
select p.empresa_id, p.id as proveedor_id, p.nombre, p.tipo_doc, p.nro_doc, p.telefono,
       coalesce(d.descontado, 0) as descontado,
       coalesce(a.aplicado, 0)   as aplicado,
       coalesce(r.devuelto, 0)   as devuelto,
       coalesce(d.descontado, 0) + coalesce(ad.adelantos, 0) - coalesce(a.aplicado, 0) - coalesce(r.devuelto, 0) as saldo,
       coalesce(ad.adelantos, 0) as adelantos
  from proveedores p
  left join lateral (select sum(importe) as descontado from selecciones_compra
                      where proveedor_id = p.id and estado = 'registrada' and cobrar) d on true
  left join lateral (select sum(saldo_aplicado) as aplicado from compras
                      where proveedor_id = p.id and estado = 'registrada') a on true
  left join lateral (select sum(monto) as devuelto from devoluciones_proveedor
                      where proveedor_id = p.id and estado = 'registrada') r on true
  left join lateral (select sum(monto) as adelantos from adelantos_proveedor
                      where proveedor_id = p.id and estado = 'registrada') ad on true;

/** Dar un adelanto al proveedor: sale de la caja del medio elegido y queda como saldo a favor */
create or replace function registrar_adelanto_proveedor(
  p_empresa uuid, p_proveedor uuid, p_monto numeric, p_medio uuid default null, p_caja uuid default null,
  p_nota text default null, p_fecha timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rol   rol_miembro;
  v_prov  proveedores;
  v_medio medios_pago;
  v_tipo  medio_pago := 'efectivo';
  v_caja  uuid := p_caja;
  v_monto numeric(14,2) := round(coalesce(p_monto, 0), 2);
  v_fecha timestamptz;
  v_id    uuid;
  v_mov   uuid;
begin
  v_rol := exigir_rol(p_empresa, '{dueno,administrador,cajero}');
  select * into v_prov from proveedores where id = p_proveedor and empresa_id = p_empresa for update;
  if not found then raise exception 'Proveedor no válido.'; end if;
  if not v_prov.activo then raise exception 'El proveedor % está desactivado.', v_prov.nombre; end if;
  if v_monto <= 0 then raise exception 'El monto del adelanto debe ser mayor a cero.'; end if;
  if p_medio is not null then
    v_medio := _medio_pago(p_empresa, p_medio);
    v_tipo  := v_medio.tipo;
    v_caja  := coalesce(p_caja, v_medio.caja_id);
  end if;
  if v_caja is null then raise exception 'Elija la caja de la que sale el adelanto.'; end if;
  perform _validar_caja(p_empresa, v_caja);
  v_fecha := _fecha_operacion(v_rol, p_fecha);

  insert into adelantos_proveedor (empresa_id, proveedor_id, fecha, monto, caja_id, medio_pago, medio_id, nota, creado_por)
  values (p_empresa, p_proveedor, v_fecha, v_monto, v_caja, v_tipo, p_medio, _texto(p_nota), auth.uid())
  returning id into v_id;
  v_mov := _mov_caja(p_empresa, v_caja, v_fecha, 'egreso', 'adelanto', v_id, v_monto,
                     'Adelanto a ' || v_prov.nombre || coalesce(' · ' || _texto(p_nota), ''));
  update adelantos_proveedor set mov_id = v_mov where id = v_id;
  return jsonb_build_object('id', v_id, 'saldo', _saldo_proveedor(p_proveedor));
end $$;

/** Anular un adelanto mal registrado: devuelve el dinero a la caja. No si ya se descontó en compras. */
create or replace function anular_adelanto_proveedor(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a adelantos_proveedor;
begin
  select * into a from adelantos_proveedor where id = p_id for update;
  if not found then raise exception 'Adelanto no encontrado.'; end if;
  perform exigir_rol(a.empresa_id, '{dueno}');
  if a.estado = 'anulada' then raise exception 'El adelanto ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  perform 1 from proveedores where id = a.proveedor_id for update;
  if _saldo_proveedor(a.proveedor_id) < a.monto then
    raise exception 'Parte de este adelanto ya se descontó en compras: no se puede anular (saldo pendiente S/ %).',
      _saldo_proveedor(a.proveedor_id);
  end if;
  update movimientos_caja set anulado = true where origen = 'adelanto' and origen_id = p_id;
  update adelantos_proveedor
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_id;
end $$;

-- Patrimonio: igual que en 20261106000002, el «por cobrar» de proveedores suma los adelantos
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
         + coalesce((select sum(monto) from adelantos_proveedor
                      where empresa_id = e.id and estado = 'registrada'), 0)
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
              + coalesce((select sum(monto) from adelantos_proveedor
                           where empresa_id = p_empresa and estado = 'registrada' and fecha < p_hasta), 0)
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

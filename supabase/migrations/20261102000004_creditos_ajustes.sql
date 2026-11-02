-- =============================================================================
-- Ajustes a los créditos (revisión del 02/11):
--  · Anular una compra/venta espera a un pago de cuota en curso (bloqueo del crédito) y,
--    si ese pago se registró, no deja anular: la caja no queda con un pago huérfano.
--  · Pagos de cuotas: idempotentes (p_clave) y nunca con fecha anterior a la operación.
--  · Corregir una compra a crédito deja el ajuste con su fecha (credito_ajustes), así el
--    patrimonio de días/meses anteriores (patrimonio_al, cierres) no cambia.
--  · dashboard() devuelve las cuentas por cobrar y por pagar (la tarjeta del inicio cuadra).
--  · Resumen del turno de caja: los pagos de cuotas salen aparte («Pago de crédito»).
--  · Reintento de una compra a crédito: la respuesta trae el crédito.
-- =============================================================================
alter table credito_pagos add column clave uuid;
create unique index credito_pagos_clave_uq on credito_pagos (credito_id, clave) where clave is not null;

create table credito_ajustes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  credito_id  uuid not null references creditos(id),
  fecha       timestamptz not null default now(),
  monto       numeric(14,2) not null,          -- + aumenta la deuda, − la reduce
  motivo      text,
  creado_por  uuid default auth.uid()
);
create index on credito_ajustes (credito_id);
alter table credito_ajustes enable row level security;
create policy credito_ajustes_select on credito_ajustes for select to authenticated using (es_miembro(empresa_id));
create trigger credito_ajustes_no_borrar before delete on credito_ajustes
  for each row when (pg_trigger_depth() = 0) execute function trg_no_borrar();

create or replace function trg_credito_anulacion()
returns trigger
language plpgsql set search_path = public
as $$
declare c creditos;
begin
  if new.estado::text <> 'anulada' or old.estado::text = 'anulada' then return new; end if;
  if tg_table_name = 'compras' then
    select * into c from creditos where compra_id = new.id and estado = 'registrada' for update;
  else
    select * into c from creditos where venta_id = new.id and estado = 'registrada' for update;
  end if;
  -- for update: espera a un pago en curso del mismo crédito; el exists de abajo ya lo ve
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

drop function registrar_pago_credito(uuid, numeric, uuid, uuid, timestamptz, text);

create or replace function registrar_pago_credito(
  p_credito  uuid,
  p_monto    numeric,
  p_medio    uuid default null,
  p_caja     uuid default null,
  p_fecha    timestamptz default null,
  p_nota     text default null,
  p_clave    uuid default null)
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
  v_rep    credito_pagos;
begin
  select * into c from creditos where id = p_credito for update;
  if not found then raise exception 'Crédito no encontrado.'; end if;
  v_rol := exigir_rol(c.empresa_id, '{dueno,administrador,cajero}');
  if c.estado = 'anulada' then raise exception 'El crédito está anulado.'; end if;
  -- Idempotencia: un doble envío del mismo formulario no registra dos pagos
  if p_clave is not null then
    select * into v_rep from credito_pagos where credito_id = c.id and clave = p_clave;
    if found then
      return jsonb_build_object('id', v_rep.id, 'monto', v_rep.monto, 'repetida', true);
    end if;
  end if;
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
  if v_fecha < c.fecha then
    raise exception 'El pago no puede ser anterior a la operación (%).', to_char(c.fecha at time zone 'America/Lima', 'DD/MM/YYYY');
  end if;

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

  insert into credito_pagos (empresa_id, credito_id, fecha, monto, caja_id, medio_pago, medio_id, mov_id, nota, clave)
  values (c.empresa_id, c.id, v_fecha, v_monto, v_caja, v_tipo, p_medio, v_mov, _texto(p_nota), p_clave)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'monto', v_monto, 'saldo', v_saldo - v_monto, 'cuota', v_num);
end $$;

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
    -- El ajuste queda con su fecha: el patrimonio de días anteriores no cambia (patrimonio_al)
    insert into credito_ajustes (empresa_id, credito_id, fecha, monto, motivo)
    values (v.empresa_id, v_cred.id, now(), (v_total - v_aplicado - v_cred.inicial) - v_cred.monto, _texto(p_motivo));
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
                                'saldo_aplicado', v_compra.saldo_aplicado,
                                'credito_id', (select id from creditos where compra_id = v_compra.id), 'repetida', true);
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
           'aportes', ap.aportes, 'retiros', ap.retiros, 'capital', ap.aportes - ap.retiros,
           'activos', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar,
           'ganancia_acumulada', cj.caja + st.stock_costo + tr.en_transito + pc.por_cobrar + cr.por_cobrar
                                 - cr.por_pagar - (ap.aportes - ap.retiros))
    from cj, st, tr, ap, pc, cr
   where es_miembro(p_empresa)
$$;

create or replace function dashboard(p_empresa uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'caja',               p.caja,
    'stock_costo',        p.stock_costo,
    'stock_precio_venta', p.stock_precio_venta,
    'en_transito',        p.en_transito,
    'por_cobrar',         p.por_cobrar,
    'cuentas_por_cobrar', p.cuentas_por_cobrar,
    'cuentas_por_pagar',  p.cuentas_por_pagar,
    'capital',            p.capital,
    'activos',            p.activos,
    'ganancia_acumulada', p.ganancia_acumulada,
    'periodo',            periodo_de(now()),
    'utilidad_mes',       coalesce(r.utilidad, 0),
    'ventas_mes',         coalesce(r.ventas, 0),
    'compras_mes',        coalesce(r.compras, 0),
    'gastos_mes',         coalesce(r.gastos, 0),
    'merma_mes',          coalesce(r.merma_total, 0),
    'hoy_compras_n',      hc.n, 'hoy_compras_kg', hc.kg, 'hoy_compras_importe', hc.importe,
    'hoy_ventas_n',       hv.n, 'hoy_ventas_kg', hv.kg,
    'ventas_pendientes',  (select count(*) from ventas where empresa_id = p_empresa and estado = 'pendiente'),
    'por_seleccionar',    (select count(*) from v_compras where empresa_id = p_empresa and por_seleccionar),
    'selecciones_retrasadas', (select count(*) from v_compras where empresa_id = p_empresa and retrasada))
  from v_patrimonio p
  left join v_resultado_mes r on r.empresa_id = p.empresa_id and r.periodo = periodo_de(now())
  cross join lateral (
    select count(distinct co.id) as n, coalesce(sum(ci.peso_neto_kg), 0) as kg, coalesce(sum(ci.importe), 0) as importe
      from compras co join compra_items ci on ci.compra_id = co.id
     where co.empresa_id = p_empresa and co.estado = 'registrada'
       and (co.fecha at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date) hc
  cross join lateral (
    select count(distinct ve.id) as n, coalesce(sum(vi.peso_salida_kg), 0) as kg
      from ventas ve join venta_items vi on vi.venta_id = ve.id
     where ve.empresa_id = p_empresa and ve.estado <> 'anulada'
       and (ve.fecha at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date) hv
  where p.empresa_id = p_empresa
$$;

create or replace function resumen_turno(p_turno uuid)
returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  t      v_turnos_caja;
  v_hasta timestamptz;
  v_ing  numeric(14,2);
  v_egr  numeric(14,2);
  v_esp  numeric(14,2);
  v_sist numeric(14,2);
  v_det  jsonb;
  v_anul integer;
begin
  select * into t from v_turnos_caja where id = p_turno;
  if not found then raise exception 'Turno no encontrado.'; end if;
  v_hasta := coalesce(t.cerrado_en, clock_timestamp());

  select coalesce(sum(monto) filter (where tipo = 'ingreso' and not anulado), 0),
         coalesce(sum(monto) filter (where tipo = 'egreso' and not anulado), 0),
         count(*) filter (where anulado)
    into v_ing, v_egr, v_anul
    from movimientos_caja
   where caja_id = t.caja_id and creado_en >= t.abierto_en and creado_en <= v_hasta;

  select coalesce(jsonb_agg(jsonb_build_object('origen', origen, 'tipo', tipo, 'cantidad', n, 'monto', total)
                            order by tipo desc, total desc), '[]'::jsonb)
    into v_det
    -- Los pagos de cuotas de créditos van aparte de las compras y ventas del día
    from (select case when exists (select 1 from credito_pagos cp where cp.mov_id = m.id) then 'pago_credito'
                      else m.origen::text end as origen,
                 m.tipo, count(*) as n, sum(m.monto) as total
            from movimientos_caja m
           where m.caja_id = t.caja_id and m.creado_en >= t.abierto_en and m.creado_en <= v_hasta and not m.anulado
           group by 1, 2) x;

  v_esp  := t.saldo_apertura + v_ing - v_egr;
  v_sist := coalesce(t.saldo_cierre, saldo_caja(t.caja_id));

  return jsonb_build_object(
    'id', t.id, 'numero', t.numero, 'caja', t.caja_nombre, 'caja_id', t.caja_id,
    'abierto_en', t.abierto_en, 'abierto_por', t.abierto_por_nombre,
    'cerrado_en', t.cerrado_en, 'cerrado_por', t.cerrado_por_nombre,
    'saldo_apertura', t.saldo_apertura, 'contado_apertura', t.contado_apertura,
    'diferencia_apertura', t.diferencia_apertura,
    'ingresos', v_ing, 'egresos', v_egr, 'esperado', v_esp,
    -- Cambios fuera del turno que mueven el saldo (p. ej. anular una compra de otro día)
    'otros', v_sist - v_esp,
    'saldo_sistema', v_sist,
    'contado_cierre', t.contado_cierre, 'diferencia_cierre', t.diferencia_cierre,
    'ajustado', t.ajustado, 'nota_apertura', t.nota_apertura, 'nota_cierre', t.nota_cierre,
    'anulados', v_anul, 'detalle', v_det);
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

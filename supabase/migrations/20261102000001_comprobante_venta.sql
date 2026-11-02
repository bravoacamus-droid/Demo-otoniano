-- =============================================================================
-- Reunión del 02/11: cada venta registra con qué comprobante se le vendió al cliente.
--  · factura    → cliente con RUC (le sirve para el crédito fiscal); la BD lo exige.
--  · boleta     → boleta de venta (persona natural / cliente sin RUC).
--  · nota_venta → venta interna, sin comprobante de SUNAT.
-- Solo se registra el tipo y la serie-número que se emitió aparte (la emisión
-- electrónica a SUNAT es de la fase 4). La guía de remisión sigue en guia_numero:
-- respalda el traslado del material, no la venta.
-- Las ventas anteriores quedan sin tipo (se muestran «—» y se pueden completar).
-- =============================================================================
create type tipo_comprobante as enum ('factura', 'boleta', 'nota_venta');

alter table ventas
  add column comprobante_tipo   tipo_comprobante,
  add column comprobante_numero text;

-- Factura solo a clientes con RUC; la serie-número se guarda en mayúsculas y sin espacios sobrantes
create or replace function _validar_comprobante_venta(
  p_comprador uuid, p_tipo tipo_comprobante, p_numero text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare v_comp compradores;
begin
  if p_tipo = 'factura' then
    select * into v_comp from compradores where id = p_comprador;
    if v_comp.ruc is null then
      raise exception 'Para emitir factura, el cliente % debe tener RUC. Regístrelo o use boleta.', v_comp.razon_social;
    end if;
  end if;
  if p_tipo is null then return null; end if;
  return upper(_texto(p_numero));
end $$;

-- -----------------------------------------------------------------------------
-- registrar_venta: + p_comprobante_tipo, p_comprobante_numero (al final, con default)
-- -----------------------------------------------------------------------------
drop function registrar_venta(uuid, uuid, jsonb, text, text, text, uuid, timestamptz, uuid, medio_pago, text, uuid);

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
  p_comprobante_numero text default null)
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

  if v_completa and (p_caja is not null or p_medio is not null) then
    perform confirmar_venta(v_venta.id, v_conf, p_caja, coalesce(p_medio_pago, 'transferencia'),
                            p_comprobante_url, v_fecha, p_medio);
    v_venta.estado := 'confirmada';
  end if;

  return jsonb_build_object('id', v_venta.id, 'numero', v_venta.numero, 'estado', v_venta.estado, 'repetida', false);
end $$;

-- -----------------------------------------------------------------------------
-- Detalle de la venta: guía, documentos y comprobante (la factura suele emitirse
-- después, cuando el cliente confirma su pesaje)
-- -----------------------------------------------------------------------------
drop function actualizar_venta_guia(uuid, text, text, text, text);

create or replace function actualizar_venta_guia(
  p_venta              uuid,
  p_guia_numero        text,
  p_guia_url           text,
  p_comprobante_url    text,
  p_notas              text,
  p_comprobante_tipo   tipo_comprobante default null,
  p_comprobante_numero text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v ventas;
begin
  select * into v from ventas where id = p_venta;
  if not found then raise exception 'Venta no encontrada.'; end if;
  perform exigir_rol(v.empresa_id, '{dueno,administrador,cajero}');
  update ventas
     set guia_numero = _texto(p_guia_numero), guia_url = _texto(p_guia_url),
         comprobante_url = _texto(p_comprobante_url), notas = _texto(p_notas),
         comprobante_tipo = p_comprobante_tipo,
         comprobante_numero = _validar_comprobante_venta(v.comprador_id, p_comprobante_tipo, p_comprobante_numero)
   where id = p_venta;
end $$;

-- -----------------------------------------------------------------------------
-- v_ventas: se vuelve a crear para que ve.* incluya las columnas nuevas
-- -----------------------------------------------------------------------------
drop view v_ventas;
create view v_ventas with (security_invoker = on) as
select ve.*,
       periodo_de(coalesce(ve.fecha_confirmacion, ve.fecha)) as periodo,
       cp.razon_social as comprador_nombre,
       cp.ruc          as comprador_ruc,
       ca.nombre       as caja_nombre,
       case when ve.medio_pago is null then null
            else coalesce(mp.nombre, initcap(ve.medio_pago::text)) end as medio_nombre,
       i.kg_salida, i.kg_recibido, i.merma_kg, i.merma_costo, i.costo_total, i.costo_vendido,
       i.metales, i.metal_ids,
       case when i.kg_recibido > 0 then round(ve.total / i.kg_recibido, 4) end as precio_promedio
  from ventas ve
  join compradores cp on cp.id = ve.comprador_id
  left join cajas ca on ca.id = ve.caja_id
  left join medios_pago mp on mp.id = ve.medio_id
  left join lateral (
    select coalesce(sum(vi.peso_salida_kg), 0)      as kg_salida,
           sum(vi.peso_recibido_kg)                 as kg_recibido,
           sum(vi.merma_kg)                         as merma_kg,
           round(sum(vi.merma_costo), 2)            as merma_costo,
           round(sum(vi.costo_total), 2)            as costo_total,
           round(sum(vi.costo_vendido), 2)          as costo_vendido,
           string_agg(distinct m.nombre, ', ')      as metales,
           array_agg(distinct vi.metal_id)          as metal_ids
      from venta_items vi join metales m on m.id = vi.metal_id
     where vi.venta_id = ve.id
  ) i on true;

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

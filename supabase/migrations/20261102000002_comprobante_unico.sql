-- =============================================================================
-- Ajustes al comprobante de venta (revisión del 02/11):
--  · La serie-número no se repite entre ventas vigentes del mismo tipo (en SUNAT es única
--    por emisor): mensaje claro en la validación y un índice único como respaldo.
--  · Una venta que ya tenía factura se puede seguir editando (guía, notas, número)
--    aunque al cliente le hayan quitado el RUC después; el RUC se exige al pasar a factura.
-- =============================================================================
drop function _validar_comprobante_venta(uuid, tipo_comprobante, text);

create or replace function _validar_comprobante_venta(
  p_comprador uuid, p_tipo tipo_comprobante, p_numero text, p_venta uuid default null)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_comp   compradores;
  v_numero text;
  v_otra   integer;
begin
  if p_tipo is null then return null; end if;
  if p_tipo = 'factura'
     and not exists (select 1 from ventas where id = p_venta and comprobante_tipo = 'factura') then
    select * into v_comp from compradores where id = p_comprador;
    if v_comp.ruc is null then
      raise exception 'Para emitir factura, el cliente % debe tener RUC. Regístrelo o use boleta.', v_comp.razon_social;
    end if;
  end if;

  v_numero := upper(_texto(p_numero));
  if v_numero is not null then
    select ve.numero into v_otra from ventas ve
     where ve.empresa_id = (select empresa_id from compradores where id = p_comprador)
       and ve.comprobante_tipo = p_tipo and ve.comprobante_numero = v_numero
       and ve.estado <> 'anulada' and ve.id is distinct from p_venta
     limit 1;
    if found then
      raise exception 'El N° % ya está registrado en la venta #%.', v_numero, v_otra;
    end if;
  end if;
  return v_numero;
end $$;

create unique index ventas_comprobante_uq on ventas (empresa_id, comprobante_tipo, comprobante_numero)
  where comprobante_numero is not null and estado <> 'anulada';

-- actualizar_venta_guia: pasa la venta para no chocar consigo misma ni re-exigir RUC a una factura existente
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
         comprobante_numero = _validar_comprobante_venta(v.comprador_id, p_comprobante_tipo, p_comprobante_numero, p_venta)
   where id = p_venta;
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

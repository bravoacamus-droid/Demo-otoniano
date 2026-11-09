-- =============================================================================
-- Reunión del 09/11 con el Sr. Otiniano
--  1. Historiales, tickets y PDF muestran el producto con su familia («Cobre › Brillante»),
--     no solo el último nivel («Brillante»).
--  2. Comprobante de venta con correlativo automático por tipo (serie configurable):
--     el número lo pone la BD y no se escribe a mano.
--  3. Reportes de compras y ventas: detalle de cada grupo (se despliega en pantalla).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nombre completo del producto en las vistas de compras y ventas
-- -----------------------------------------------------------------------------
-- v_compras y v_ventas no tienen vistas que dependan de ellas (se recrean igual que en 23/10 y 02/11)
drop view v_compras;
create view v_compras with (security_invoker = on) as
select co.*,
       periodo_de(co.fecha) as periodo,
       p.nombre   as proveedor_nombre,
       p.tipo_doc as proveedor_tipo_doc,
       p.nro_doc  as proveedor_nro_doc,
       p.clase    as proveedor_clase,
       ca.nombre  as caja_nombre,
       coalesce(mp.nombre, initcap(co.medio_pago::text)) as medio_nombre,
       i.kg_total, i.kg_bruto, i.kg_merma_compra, i.metales, i.metal_ids,
       case when i.kg_total > 0 then round(co.total / i.kg_total, 4) end as precio_promedio,
       s.id as seleccion_id, s.numero as seleccion_numero, s.kg as seleccion_kg, s.importe as seleccion_importe,
       s.kg_traslado as seleccion_traslado_kg,
       case when s.id is not null and i.kg_total > 0 then round(s.kg * 100 / i.kg_total, 2) end as merma_pct,
       coalesce(s.id is not null and i.kg_total > 0 and s.kg * 100 / i.kg_total > e.merma_alerta_pct, false) as merma_alta,
       co.estado = 'registrada' and s.id is null as por_seleccionar,
       co.estado = 'registrada' and s.id is null
         and (now() at time zone 'America/Lima')::date - (co.fecha at time zone 'America/Lima')::date > e.dias_seleccion as retrasada
  from compras co
  join empresas e on e.id = co.empresa_id
  left join proveedores p on p.id = co.proveedor_id
  join cajas ca on ca.id = co.caja_id
  left join medios_pago mp on mp.id = co.medio_id
  left join selecciones_compra s on s.compra_id = co.id and s.estado = 'registrada'
  left join lateral (
    select coalesce(sum(ci.peso_neto_kg), 0)  as kg_total,
           coalesce(sum(ci.peso_bruto_kg), 0) as kg_bruto,
           coalesce(sum(ci.descuento_kg), 0)  as kg_merma_compra,
           string_agg(distinct coalesce(vp.ruta, m.nombre), ', ') as metales,
           array_agg(distinct ci.metal_id)     as metal_ids
      from compra_items ci join metales m on m.id = ci.metal_id
      left join v_productos vp on vp.id = ci.metal_id
     where ci.compra_id = co.id
  ) i on true;

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
           string_agg(distinct coalesce(vp.ruta, m.nombre), ', ') as metales,
           array_agg(distinct vi.metal_id)          as metal_ids
      from venta_items vi join metales m on m.id = vi.metal_id
      left join v_productos vp on vp.id = vi.metal_id
     where vi.venta_id = ve.id
  ) i on true;

-- Líneas: metal_nombre pasa a ser la ruta completa (tickets, comprobantes PDF, detalle y reportes)
create or replace view v_compra_items with (security_invoker = on) as
select ci.*,
       co.numero, co.fecha, co.estado, co.proveedor_id, co.medio_pago,
       periodo_de(co.fecha) as periodo,
       (co.fecha at time zone 'America/Lima')::date as dia,
       coalesce(vp.ruta, m.nombre) as metal_nombre, m.color as metal_color,
       p.nombre as proveedor_nombre
  from compra_items ci
  join compras co on co.id = ci.compra_id
  join metales m on m.id = ci.metal_id
  left join v_productos vp on vp.id = ci.metal_id
  left join proveedores p on p.id = co.proveedor_id;

create or replace view v_venta_items with (security_invoker = on) as
select vi.*,
       ve.numero, ve.fecha, ve.fecha_confirmacion, ve.estado, ve.comprador_id,
       periodo_de(coalesce(ve.fecha_confirmacion, ve.fecha)) as periodo,
       (coalesce(ve.fecha_confirmacion, ve.fecha) at time zone 'America/Lima')::date as dia,
       coalesce(vp.ruta, m.nombre) as metal_nombre, m.color as metal_color,
       cp.razon_social as comprador_nombre
  from venta_items vi
  join ventas ve on ve.id = vi.venta_id
  join metales m on m.id = vi.metal_id
  left join v_productos vp on vp.id = vi.metal_id
  join compradores cp on cp.id = ve.comprador_id;

-- -----------------------------------------------------------------------------
-- 2. Correlativo de comprobantes de venta
-- -----------------------------------------------------------------------------
-- Una serie por tipo y empresa; «ultimo» = último número ya emitido (el siguiente es ultimo + 1).
-- Gerencia/Administración ajustan serie y último número para continuar su numeración real.
create table series_comprobante (
  empresa_id uuid not null references empresas(id) on delete cascade,
  tipo       tipo_comprobante not null,
  serie      text not null check (serie ~ '^[A-Z0-9]{1,6}$'),
  ultimo     integer not null default 0 check (ultimo >= 0),
  primary key (empresa_id, tipo)
);
alter table series_comprobante enable row level security;
create policy series_comprobante_select on series_comprobante for select to authenticated using (es_miembro(empresa_id));

create or replace function _serie_por_defecto(p_tipo tipo_comprobante)
returns text language sql immutable as $$
  select case p_tipo when 'factura' then 'F001' when 'boleta' then 'B001' else 'NV01' end
$$;

-- Toma el siguiente número de la serie (bloquea la fila: dos ventas a la vez no repiten número).
-- Si el número ya lo tiene una venta vigente (p. ej. se bajó el «último» a mano), salta al siguiente libre.
create or replace function _siguiente_comprobante(p_empresa uuid, p_tipo tipo_comprobante)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_serie text; v_n integer; v_numero text;
begin
  insert into series_comprobante (empresa_id, tipo, serie, ultimo)
  values (p_empresa, p_tipo, _serie_por_defecto(p_tipo), 1)
  on conflict (empresa_id, tipo) do update set ultimo = series_comprobante.ultimo + 1
  returning serie, ultimo into v_serie, v_n;
  loop
    v_numero := v_serie || '-' || lpad(v_n::text, 6, '0');
    exit when not exists (select 1 from ventas where empresa_id = p_empresa and comprobante_tipo = p_tipo
                                                  and comprobante_numero = v_numero and estado <> 'anulada');
    v_n := v_n + 1;
  end loop;
  update series_comprobante set ultimo = v_n where empresa_id = p_empresa and tipo = p_tipo and ultimo <> v_n;
  return v_numero;
end $$;

-- El número no se escribe: al registrar con tipo, o al cambiar el tipo, se toma el siguiente;
-- si el tipo no cambia, el número emitido se conserva.
create or replace function _trg_comprobante_venta()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.comprobante_tipo is null then
    new.comprobante_numero := null;
  elsif tg_op = 'INSERT' or new.comprobante_tipo is distinct from old.comprobante_tipo or old.comprobante_numero is null then
    new.comprobante_numero := _siguiente_comprobante(new.empresa_id, new.comprobante_tipo);
  else
    new.comprobante_numero := old.comprobante_numero;
  end if;
  return new;
end $$;

create trigger ventas_comprobante before insert or update of comprobante_tipo, comprobante_numero on ventas
  for each row execute function _trg_comprobante_venta();

-- Serie y último número emitido (para continuar la numeración que ya se usa)
create or replace function configurar_serie_comprobante(
  p_empresa uuid, p_tipo tipo_comprobante, p_serie text, p_ultimo integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_serie text := upper(trim(coalesce(p_serie, '')));
begin
  perform exigir_rol(p_empresa, '{dueno,administrador}');
  if v_serie !~ '^[A-Z0-9]{1,6}$' then
    raise exception 'La serie debe tener de 1 a 6 letras o números (por ejemplo F001).';
  end if;
  if p_ultimo is null or p_ultimo < 0 then raise exception 'El último número emitido no puede ser negativo.'; end if;
  insert into series_comprobante (empresa_id, tipo, serie, ultimo)
  values (p_empresa, p_tipo, v_serie, p_ultimo)
  on conflict (empresa_id, tipo) do update set serie = excluded.serie, ultimo = excluded.ultimo;
end $$;

-- (serie por defecto escrita aquí: la vista corre con los permisos de quien consulta)
-- Lo que verá la pantalla de venta: serie y siguiente número de cada tipo (exista o no la fila)
create view v_series_comprobante with (security_invoker = on) as
select e.id as empresa_id, t.tipo,
       coalesce(s.serie, case t.tipo when 'factura' then 'F001' when 'boleta' then 'B001' else 'NV01' end) as serie,
       coalesce(s.ultimo, 0) as ultimo,
       coalesce(s.serie, case t.tipo when 'factura' then 'F001' when 'boleta' then 'B001' else 'NV01' end) || '-' || lpad((coalesce(s.ultimo, 0) + 1)::text, 6, '0') as siguiente
  from empresas e
  cross join unnest(enum_range(null::tipo_comprobante)) as t(tipo)
  left join series_comprobante s on s.empresa_id = e.id and s.tipo = t.tipo
 where es_miembro(e.id);

-- -----------------------------------------------------------------------------
-- 3. Reportes con detalle: cada línea con la misma clave de grupo que el resumen
-- -----------------------------------------------------------------------------
create or replace function rpt_compras_detalle(p_empresa uuid, p_desde date, p_hasta date, p_agrupar text default 'dia')
returns table (clave text, etiqueta text, compra_id uuid, numero integer, fecha timestamptz, proveedor text,
               producto text, kg numeric, precio numeric, importe numeric)
language sql stable
as $$
  select k.clave, k.etiqueta, i.compra_id, i.numero, i.fecha, coalesce(i.proveedor_nombre, 'Sin documento'),
         i.metal_nombre, i.peso_neto_kg, i.precio_kg, i.importe
    from v_compra_items i
    left join v_productos vp on vp.id = i.metal_id
    left join metales fam on fam.id = vp.raiz_id
    left join proveedores pv on pv.id = i.proveedor_id
    cross join lateral (select
      case p_agrupar when 'mes' then i.periodo when 'metal' then i.metal_id::text
                     when 'familia' then coalesce(vp.raiz_id::text, i.metal_id::text)
                     when 'semana' then to_char(date_trunc('week', i.dia), 'YYYY-MM-DD')
                     when 'anio' then to_char(i.dia, 'YYYY')
                     when 'clase' then coalesce(pv.clase, 'sin')
                     when 'proveedor' then coalesce(i.proveedor_id::text, '-') else i.dia::text end as clave,
      case p_agrupar when 'mes' then i.periodo when 'metal' then i.metal_nombre
                     when 'familia' then coalesce(fam.nombre, i.metal_nombre)
                     when 'semana' then 'Semana del ' || to_char(date_trunc('week', i.dia), 'DD/MM/YYYY')
                     when 'anio' then to_char(i.dia, 'YYYY')
                     when 'clase' then case pv.clase when 'mayorista' then 'Mayoristas' when 'minorista' then 'Minoristas'
                                                     else 'Sin proveedor' end
                     when 'proveedor' then coalesce(i.proveedor_nombre, 'Sin documento') else to_char(i.dia, 'DD/MM/YYYY') end as etiqueta) k
   where i.empresa_id = p_empresa and i.estado = 'registrada' and i.dia between p_desde and p_hasta
   order by i.fecha desc, i.numero desc, i.id
$$;

create or replace function rpt_compras(p_empresa uuid, p_desde date, p_hasta date, p_agrupar text default 'dia')
returns table (clave text, etiqueta text, n_compras bigint, kg numeric, importe numeric, precio_promedio numeric)
language sql stable
as $$
  select d.clave, d.etiqueta, count(distinct d.compra_id), sum(d.kg), sum(d.importe),
         case when sum(d.kg) > 0 then round(sum(d.importe) / sum(d.kg), 4) end
    from rpt_compras_detalle(p_empresa, p_desde, p_hasta, p_agrupar) d
   group by d.clave, d.etiqueta
   order by case when p_agrupar in ('metal', 'proveedor', 'familia', 'clase') then null else d.clave end,
            sum(d.importe) desc
$$;

create or replace function rpt_ventas_detalle(p_empresa uuid, p_desde date, p_hasta date, p_agrupar text default 'mes')
returns table (clave text, etiqueta text, venta_id uuid, numero integer, fecha timestamptz, comprador text,
               producto text, kg_salida numeric, kg_recibido numeric, merma_kg numeric, precio numeric, importe numeric)
language sql stable
as $$
  select k.clave, k.etiqueta, i.venta_id, i.numero, coalesce(i.fecha_confirmacion, i.fecha), i.comprador_nombre,
         i.metal_nombre, i.peso_salida_kg, i.peso_recibido_kg, i.merma_kg, i.precio_kg, i.importe
    from v_venta_items i
    left join v_productos vp on vp.id = i.metal_id
    left join metales fam on fam.id = vp.raiz_id
    cross join lateral (select
      case p_agrupar when 'dia' then i.dia::text when 'metal' then i.metal_id::text
                     when 'familia' then coalesce(vp.raiz_id::text, i.metal_id::text)
                     when 'semana' then to_char(date_trunc('week', i.dia), 'YYYY-MM-DD')
                     when 'anio' then to_char(i.dia, 'YYYY')
                     when 'comprador' then i.comprador_id::text else i.periodo end as clave,
      case p_agrupar when 'dia' then to_char(i.dia, 'DD/MM/YYYY') when 'metal' then i.metal_nombre
                     when 'familia' then coalesce(fam.nombre, i.metal_nombre)
                     when 'semana' then 'Semana del ' || to_char(date_trunc('week', i.dia), 'DD/MM/YYYY')
                     when 'anio' then to_char(i.dia, 'YYYY')
                     when 'comprador' then i.comprador_nombre else i.periodo end as etiqueta) k
   where i.empresa_id = p_empresa and i.estado = 'confirmada' and i.dia between p_desde and p_hasta
   order by coalesce(i.fecha_confirmacion, i.fecha) desc, i.numero desc, i.id
$$;

create or replace function rpt_ventas(p_empresa uuid, p_desde date, p_hasta date, p_agrupar text default 'mes')
returns table (clave text, etiqueta text, n_ventas bigint, kg_salida numeric, kg_recibido numeric,
               merma_kg numeric, importe numeric, precio_promedio numeric)
language sql stable
as $$
  select d.clave, d.etiqueta,
         count(distinct d.venta_id), sum(d.kg_salida), sum(d.kg_recibido), sum(d.merma_kg), sum(d.importe),
         case when sum(d.kg_recibido) > 0 then round(sum(d.importe) / sum(d.kg_recibido), 4) end
    from rpt_ventas_detalle(p_empresa, p_desde, p_hasta, p_agrupar) d
   group by d.clave, d.etiqueta
   order by case when p_agrupar in ('metal', 'comprador', 'familia') then null else d.clave end,
            sum(d.importe) desc
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

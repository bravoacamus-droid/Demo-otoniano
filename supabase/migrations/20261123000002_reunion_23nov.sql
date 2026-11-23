-- =============================================================================
-- Reunión del 23/11 con el Sr. Otiniano
--  1. Unidad de medida por producto: kg, toneladas, unidades, cajas o baldes. Las cantidades siguen en
--     las mismas columnas (*_kg, stock_metal.kg): en un producto «por unidad» el número son unidades y
--     el precio es por unidad. Un nivel que junta variantes de distinta unidad lo avisa (unidades_distintas).
--  2. Ingresos y salidas de dinero a mano (movimientos_manuales), siempre con motivo:
--     · clase 'ajuste': sobrante, faltante u otro ingreso/salida → movimiento de caja 'ajuste'
--       (entra en resultados igual que los ajustes de arqueo y de cierre).
--     · clase 'prestamo': préstamo a un socio u otra persona (egreso) o su devolución (ingreso):
--       la caja baja y lo por cobrar sube lo mismo (no cambia la ganancia).
--     Gerencia y Administración los corrigen (se anula el movimiento de caja y se crea otro, con
--     historial) o los anulan con motivo.
--  3. Gastos: Gerencia y Administración los corrigen o anulan. «Solo registro» (gastos_sin_caja): bienes
--     o gastos pagados por fuera (p. ej. dos motos cargueras) que no salen de la caja ni bajan la
--     ganancia; quedan para tenerlos presentes.
--  4. Apertura de caja: se corrige (efectivo contado y nota) o se anula con motivo. Una caja con su
--     turno anulado puede volver a abrirse. La apertura NO mete dinero: solo anota lo contado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Unidad de medida
-- -----------------------------------------------------------------------------
update metales set unidad = 'kg' where unidad not in ('kg', 't', 'und', 'caja', 'balde');
alter table metales add constraint metales_unidad_ck check (unidad in ('kg', 't', 'und', 'caja', 'balde'));

-- Mismas columnas (+ metal_unidad al final)
create or replace view v_compra_items with (security_invoker = on) as
select ci.*,
       co.numero, co.fecha, co.estado, co.proveedor_id, co.medio_pago,
       periodo_de(co.fecha) as periodo,
       (co.fecha at time zone 'America/Lima')::date as dia,
       coalesce(vp.ruta, m.nombre) as metal_nombre, m.color as metal_color,
       p.nombre as proveedor_nombre,
       m.unidad as metal_unidad
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
       cp.razon_social as comprador_nombre,
       m.unidad as metal_unidad
  from venta_items vi
  join ventas ve on ve.id = vi.venta_id
  join metales m on m.id = vi.metal_id
  left join v_productos vp on vp.id = vi.metal_id
  join compradores cp on cp.id = ve.comprador_id;

-- Stock por nivel: + unidad del producto y si sus variantes con stock usan unidades distintas
create or replace view v_stock_arbol with (security_invoker = on) as
with d as (
  select p.id, p.ancestros, p.precio_venta, p.unidad, coalesce(s.kg, 0) as kg, coalesce(s.costo_total, 0) as costo
    from v_productos p left join stock_metal s on s.metal_id = p.id),
l as (
  select metal_id,
         min(fecha) filter (where kg_en_stock > 0)              as llegada,
         coalesce(sum(kg_en_stock) filter (where por_seleccionar), 0) as por_limpiar,
         bool_or(retrasado and kg_en_stock > 0)                 as retrasado
    from v_lotes group by metal_id)
select p.empresa_id, p.id as metal_id, p.padre_id, p.codigo, p.nombre, p.color, p.orden, p.activo,
       p.nivel, p.ruta, p.clave_orden, p.tiene_hijos,
       p.precio_compra, p.precio_mayorista, p.precio_venta,
       coalesce(sp.kg, 0) as kg_propio,
       x.kg, x.costo_total,
       round(x.costo_total, 2) as valor_costo,
       case when x.kg > 0 then round(x.costo_total / x.kg, 4) end as costo_promedio,
       x.valor_venta,
       y.llegada_antigua, y.kg_por_limpiar, coalesce(y.retrasado, false) as retrasado,
       p.unidad, x.unidades_distintas
  from v_productos p
  left join stock_metal sp on sp.metal_id = p.id
  cross join lateral (
    select coalesce(sum(d.kg), 0) as kg, coalesce(sum(d.costo), 0) as costo_total,
           round(coalesce(sum(d.kg * d.precio_venta), 0), 2) as valor_venta,
           count(distinct d.unidad) filter (where d.kg <> 0) > 1 as unidades_distintas
      from d where p.id = any(d.ancestros)) x
  cross join lateral (
    select min(l.llegada) as llegada_antigua, coalesce(sum(l.por_limpiar), 0) as kg_por_limpiar, bool_or(l.retrasado) as retrasado
      from l join d on d.id = l.metal_id where p.id = any(d.ancestros)) y;

-- -----------------------------------------------------------------------------
-- 2. Ingresos y salidas de dinero (con motivo) y préstamos
-- -----------------------------------------------------------------------------
create table movimientos_manuales (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  fecha             timestamptz not null default now(),
  tipo              tipo_mov_caja not null,
  clase             text not null check (clase in ('ajuste', 'prestamo')),
  caja_id           uuid not null references cajas(id),
  monto             numeric(14,2) not null check (monto > 0),
  motivo            text not null check (length(trim(motivo)) > 0),
  persona           text,                                  -- a quién se prestó / quién devuelve
  mov_id            uuid references movimientos_caja(id),  -- movimiento de caja vigente
  estado            estado_doc not null default 'registrada',
  historial         jsonb not null default '[]',           -- correcciones: valores anteriores, quién y por qué
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now(),
  anulado_por       uuid,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  check (clase <> 'prestamo' or persona is not null)
);
create index on movimientos_manuales (empresa_id, fecha desc);

alter table movimientos_manuales enable row level security;
create policy movimientos_manuales_select on movimientos_manuales for select to authenticated using (es_miembro(empresa_id));
create trigger movimientos_manuales_no_borrar before delete on movimientos_manuales
  for each row execute function trg_no_borrar();

create view v_movimientos_manuales with (security_invoker = on) as
select mm.*, c.nombre as caja_nombre, mc.nombre as creado_por_nombre, periodo_de(mm.fecha) as periodo
  from movimientos_manuales mm
  join cajas c on c.id = mm.caja_id
  left join miembros mc on mc.empresa_id = mm.empresa_id and mc.user_id = mm.creado_por;

-- Préstamos pendientes por persona (lo prestado menos lo devuelto)
create view v_prestamos_pendientes with (security_invoker = on) as
select empresa_id, min(persona) as persona,
       sum(case when tipo = 'egreso' then monto else -monto end) as pendiente,
       max(fecha) as ultimo
  from movimientos_manuales
 where clase = 'prestamo' and estado = 'registrada'
 group by empresa_id, lower(trim(persona))
having sum(case when tipo = 'egreso' then monto else -monto end) <> 0;

create or replace function _concepto_manual(p_tipo tipo_mov_caja, p_clase text, p_motivo text, p_persona text)
returns text
language sql immutable
as $$
  select case
    when p_clase = 'prestamo' and p_tipo = 'egreso' then 'Préstamo a ' || p_persona || ': ' || p_motivo
    when p_clase = 'prestamo'                       then 'Devolución de préstamo de ' || p_persona || ': ' || p_motivo
    when p_tipo = 'ingreso'                         then 'Ingreso de dinero: ' || p_motivo
    else 'Salida de dinero: ' || p_motivo
  end
$$;

-- Lo que una persona aún debe de sus préstamos (sin contar p_excluir, el registro que se corrige)
create or replace function _prestamo_pendiente(p_empresa uuid, p_persona text, p_excluir uuid default null)
returns numeric
language sql stable set search_path = public
as $$
  select coalesce(sum(case when tipo = 'egreso' then monto else -monto end), 0)
    from movimientos_manuales
   where empresa_id = p_empresa and clase = 'prestamo' and estado = 'registrada'
     and lower(trim(persona)) = lower(trim(p_persona))
     and (p_excluir is null or id <> p_excluir)
$$;

-- Valida los datos de un ingreso/salida manual (alta o corrección)
create or replace function _validar_manual(
  p_empresa uuid, p_tipo tipo_mov_caja, p_clase text, p_monto numeric, p_motivo text, p_persona text,
  p_excluir uuid default null)
returns void
language plpgsql stable set search_path = public
as $$
declare v_pend numeric;
begin
  if p_clase is null or p_clase not in ('ajuste', 'prestamo') then raise exception 'Tipo de movimiento no válido.'; end if;
  if p_tipo is null then raise exception 'Indique si es ingreso o salida.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo.'; end if;
  if p_clase = 'prestamo' then
    if _texto(p_persona) is null then raise exception 'Indique la persona del préstamo.'; end if;
    if p_tipo = 'ingreso' then
      v_pend := _prestamo_pendiente(p_empresa, p_persona, p_excluir);
      if v_pend <= 0 then raise exception '% no tiene préstamos pendientes.', _texto(p_persona); end if;
      if round(p_monto, 2) > v_pend then
        raise exception '% solo debe S/ %. Revise el monto.', _texto(p_persona), v_pend;
      end if;
    end if;
  end if;
end $$;

create or replace function registrar_movimiento_manual(
  p_empresa uuid, p_caja uuid, p_tipo tipo_mov_caja, p_clase text, p_monto numeric, p_motivo text,
  p_persona text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_monto numeric(14,2) := round(p_monto, 2);
  v_pers  text := case when p_clase = 'prestamo' then _texto(p_persona) end;
  m       movimientos_manuales;
  v_mov   uuid;
begin
  perform exigir_rol(p_empresa, '{dueno,administrador,cajero}');
  perform _validar_caja(p_empresa, p_caja);
  perform _validar_manual(p_empresa, p_tipo, p_clase, v_monto, p_motivo, v_pers);

  insert into movimientos_manuales (empresa_id, tipo, clase, caja_id, monto, motivo, persona, creado_por)
  values (p_empresa, p_tipo, p_clase, p_caja, v_monto, _texto(p_motivo), v_pers, auth.uid())
  returning * into m;

  v_mov := _mov_caja(p_empresa, p_caja, m.fecha, p_tipo,
                     case when p_clase = 'prestamo' then 'prestamo'::origen_mov_caja else 'ajuste'::origen_mov_caja end,
                     m.id, v_monto, _concepto_manual(p_tipo, p_clase, m.motivo, v_pers));
  update movimientos_manuales set mov_id = v_mov where id = m.id;
  return jsonb_build_object('id', m.id);
end $$;

-- Corrige caja, monto, motivo o persona. El movimiento de caja anterior queda anulado (se ve tachado)
-- y se crea otro con la misma fecha; el historial guarda los valores anteriores.
create or replace function editar_movimiento_manual(
  p_id uuid, p_caja uuid, p_monto numeric, p_motivo text, p_persona text, p_razon text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m       movimientos_manuales;
  v_monto numeric(14,2) := round(p_monto, 2);
  v_pers  text;
  v_mov   uuid;
begin
  select * into m from movimientos_manuales where id = p_id for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  perform exigir_rol(m.empresa_id, '{dueno,administrador}');
  if m.estado = 'anulada' then raise exception 'El movimiento está anulado.'; end if;
  if _texto(p_razon) is null then raise exception 'Indique por qué se corrige.'; end if;
  v_pers := case when m.clase = 'prestamo' then _texto(p_persona) end;
  perform _validar_caja(m.empresa_id, p_caja);
  perform _validar_manual(m.empresa_id, m.tipo, m.clase, v_monto, p_motivo, v_pers, m.id);
  -- Un préstamo no puede quedar menor a lo que ya devolvieron de él
  if m.clase = 'prestamo' and m.tipo = 'egreso'
     and _prestamo_pendiente(m.empresa_id, m.persona, m.id)
         + (case when lower(trim(m.persona)) = lower(trim(v_pers)) then v_monto else 0 end) < 0 then
    raise exception 'A % ya le registraron devoluciones por más de S/ %.', m.persona, v_monto;
  end if;

  update movimientos_caja set anulado = true where id = m.mov_id;
  v_mov := _mov_caja(m.empresa_id, p_caja, m.fecha, m.tipo,
                     case when m.clase = 'prestamo' then 'prestamo'::origen_mov_caja else 'ajuste'::origen_mov_caja end,
                     m.id, v_monto, _concepto_manual(m.tipo, m.clase, _texto(p_motivo), v_pers) || ' (corregido)');
  update movimientos_manuales
     set caja_id = p_caja, monto = v_monto, motivo = _texto(p_motivo), persona = v_pers, mov_id = v_mov,
         historial = historial || jsonb_build_array(jsonb_build_object(
           'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'caja_id', m.caja_id, 'monto', m.monto, 'motivo', m.motivo, 'persona', m.persona))
   where id = p_id;
end $$;

create or replace function anular_movimiento_manual(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare m movimientos_manuales;
begin
  select * into m from movimientos_manuales where id = p_id for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  perform exigir_rol(m.empresa_id, '{dueno,administrador}');
  if m.estado = 'anulada' then raise exception 'El movimiento ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  if m.clase = 'prestamo' and m.tipo = 'egreso' and _prestamo_pendiente(m.empresa_id, m.persona, m.id) < 0 then
    raise exception 'Ese préstamo ya tiene devoluciones registradas. Anule primero las devoluciones.';
  end if;
  update movimientos_caja set anulado = true where id = m.mov_id;
  update movimientos_manuales
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Gastos: corrección, anulación por Administración y «solo registro»
-- -----------------------------------------------------------------------------
alter table gastos add column historial jsonb not null default '[]';

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

-- Igual que en 004, ahora también Administración
create or replace function anular_gasto(p_gasto uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare g gastos;
begin
  select * into g from gastos where id = p_gasto for update;
  if not found then raise exception 'Gasto no encontrado.'; end if;
  perform exigir_rol(g.empresa_id, '{dueno,administrador}');
  if g.estado = 'anulada' then raise exception 'El gasto ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  update movimientos_caja set anulado = true where origen = 'gasto' and origen_id = p_gasto;
  update gastos set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_gasto;
end $$;

-- Solo registro: no sale de ninguna caja ni entra en resultados
create table gastos_sin_caja (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  fecha             timestamptz not null default now(),
  categoria_id      uuid references categorias_gasto(id),
  monto             numeric(14,2) not null check (monto > 0),
  concepto          text not null check (length(trim(concepto)) > 0),
  comprobante_url   text,
  estado            estado_doc not null default 'registrada',
  historial         jsonb not null default '[]',
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now(),
  anulado_por       uuid,
  anulado_en        timestamptz,
  motivo_anulacion  text
);
create index on gastos_sin_caja (empresa_id, fecha desc);

alter table gastos_sin_caja enable row level security;
create policy gastos_sin_caja_select on gastos_sin_caja for select to authenticated using (es_miembro(empresa_id));
create trigger gastos_sin_caja_no_borrar before delete on gastos_sin_caja
  for each row execute function trg_no_borrar();

create view v_gastos_sin_caja with (security_invoker = on) as
select g.*, cg.nombre as categoria_nombre, periodo_de(g.fecha) as periodo
  from gastos_sin_caja g
  left join categorias_gasto cg on cg.id = g.categoria_id;

create or replace function registrar_gasto_sin_caja(
  p_empresa uuid, p_monto numeric, p_concepto text, p_categoria uuid default null, p_comprobante_url text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_monto numeric(14,2) := round(p_monto, 2);
begin
  perform exigir_rol(p_empresa, '{dueno,administrador,cajero}');
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  if _texto(p_concepto) is null then raise exception 'Indique el concepto.'; end if;
  if p_categoria is not null and not exists (select 1 from categorias_gasto where id = p_categoria and empresa_id = p_empresa) then
    raise exception 'Categoría no válida.';
  end if;
  insert into gastos_sin_caja (empresa_id, categoria_id, monto, concepto, comprobante_url, creado_por)
  values (p_empresa, p_categoria, v_monto, _texto(p_concepto), _texto(p_comprobante_url), auth.uid())
  returning id into v_id;
  return v_id;
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
  if g.estado = 'anulada' then raise exception 'El registro ya está anulado.'; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  update gastos_sin_caja
     set estado = 'anulada', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = _texto(p_motivo)
   where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Apertura de caja: corregir o anular
-- -----------------------------------------------------------------------------
alter table turnos_caja
  add column anulado_en       timestamptz,
  add column anulado_por      uuid,
  add column motivo_anulacion text,
  add column historial        jsonb not null default '[]';

drop index turnos_caja_un_abierto;
create unique index turnos_caja_un_abierto on turnos_caja (caja_id) where cerrado_en is null and anulado_en is null;

-- t.* toma las columnas nuevas
drop view v_turnos_caja;
create view v_turnos_caja with (security_invoker = on) as
select t.*, c.nombre as caja_nombre, c.tipo as caja_tipo,
       ma.nombre as abierto_por_nombre, mc.nombre as cerrado_por_nombre
  from turnos_caja t
  join cajas c on c.id = t.caja_id
  left join miembros ma on ma.empresa_id = t.empresa_id and ma.user_id = t.abierto_por
  left join miembros mc on mc.empresa_id = t.empresa_id and mc.user_id = t.cerrado_por;

-- Igual que en 20261020000003; un turno anulado ya no cuenta como caja abierta
create or replace function abrir_caja(p_empresa uuid, p_caja uuid, p_contado numeric, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c cajas;
  t turnos_caja;
begin
  perform exigir_rol(p_empresa, '{dueno,cajero}');
  c := _validar_caja(p_empresa, p_caja);
  if p_contado is null or p_contado < 0 then raise exception 'El monto contado no puede ser negativo.'; end if;
  perform 1 from cajas where id = p_caja for update;  -- dos aperturas a la vez: una espera a la otra
  if exists (select 1 from turnos_caja where caja_id = p_caja and cerrado_en is null and anulado_en is null) then
    raise exception 'La caja % ya está abierta. Ciérrela antes de abrir otro turno.', c.nombre;
  end if;

  insert into turnos_caja (empresa_id, caja_id, numero, saldo_apertura, contado_apertura, nota_apertura, abierto_por)
  values (p_empresa, p_caja, siguiente_numero(p_empresa, 'turno_caja'), saldo_caja(p_caja), round(p_contado, 2),
          _texto(p_nota), auth.uid())
  returning * into t;

  return jsonb_build_object('id', t.id, 'numero', t.numero, 'saldo_apertura', t.saldo_apertura,
                            'contado_apertura', t.contado_apertura, 'diferencia', t.diferencia_apertura);
end $$;

create or replace function cerrar_caja(p_turno uuid, p_contado numeric, p_nota text default null, p_ajustar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rol rol_miembro;
  t     turnos_caja;
begin
  select * into t from turnos_caja where id = p_turno for update;
  if not found then raise exception 'Turno no encontrado.'; end if;
  v_rol := exigir_rol(t.empresa_id, '{dueno,cajero}');
  if t.anulado_en is not null then raise exception 'El turno N° % está anulado.', t.numero; end if;
  if t.cerrado_en is not null then raise exception 'El turno N° % ya está cerrado.', t.numero; end if;
  if p_contado is null or p_contado < 0 then raise exception 'El monto contado no puede ser negativo.'; end if;
  if p_ajustar and v_rol <> 'dueno' then raise exception 'Solo el dueño puede ajustar la caja.'; end if;

  update turnos_caja
     set cerrado_en = clock_timestamp(), cerrado_por = auth.uid(), saldo_cierre = saldo_caja(t.caja_id),
         contado_cierre = round(p_contado, 2), nota_cierre = _texto(p_nota)
   where id = p_turno
  returning * into t;

  if p_ajustar and t.diferencia_cierre <> 0 then
    perform _mov_caja(t.empresa_id, t.caja_id, now(),
                      case when t.diferencia_cierre > 0 then 'ingreso'::tipo_mov_caja else 'egreso'::tipo_mov_caja end,
                      'ajuste', t.id, abs(t.diferencia_cierre), 'Ajuste por cierre de caja N° ' || t.numero);
    update turnos_caja set ajustado = true where id = p_turno;
  end if;

  return resumen_turno(p_turno);
end $$;

-- Corrige el efectivo contado al abrir (y la nota). No mueve dinero: la apertura solo anota lo contado.
create or replace function corregir_apertura(p_turno uuid, p_contado numeric, p_nota text, p_razon text)
returns void
language plpgsql security definer set search_path = public
as $$
declare t turnos_caja;
begin
  select * into t from turnos_caja where id = p_turno for update;
  if not found then raise exception 'Turno no encontrado.'; end if;
  perform exigir_rol(t.empresa_id, '{dueno,administrador}');
  if t.anulado_en is not null then raise exception 'El turno N° % está anulado.', t.numero; end if;
  if p_contado is null or p_contado < 0 then raise exception 'El monto contado no puede ser negativo.'; end if;
  if _texto(p_razon) is null then raise exception 'Indique por qué se corrige.'; end if;
  update turnos_caja
     set contado_apertura = round(p_contado, 2), nota_apertura = _texto(p_nota),
         historial = historial || jsonb_build_array(jsonb_build_object(
           'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'contado_apertura', t.contado_apertura, 'nota_apertura', t.nota_apertura))
   where id = p_turno;
end $$;

-- Anula una apertura hecha por error. Si el cierre ajustó la caja, ese ajuste también se anula.
create or replace function anular_turno(p_turno uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public
as $$
declare t turnos_caja;
begin
  select * into t from turnos_caja where id = p_turno for update;
  if not found then raise exception 'Turno no encontrado.'; end if;
  perform exigir_rol(t.empresa_id, '{dueno,administrador}');
  if t.anulado_en is not null then raise exception 'El turno N° % ya está anulado.', t.numero; end if;
  if _texto(p_motivo) is null then raise exception 'Indique el motivo de la anulación.'; end if;
  update movimientos_caja set anulado = true where origen = 'ajuste' and origen_id = p_turno and not anulado;
  update turnos_caja
     set anulado_en = now(), anulado_por = auth.uid(), motivo_anulacion = _texto(p_motivo)
   where id = p_turno;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Patrimonio: igual que en 20261112000004; lo por cobrar suma los préstamos pendientes
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
         + coalesce((select sum(case when tipo = 'egreso' then monto else -monto end) from movimientos_manuales
                      where empresa_id = e.id and clase = 'prestamo' and estado = 'registrada'), 0)
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
              + coalesce((select sum(case when tipo = 'egreso' then monto else -monto end) from movimientos_manuales
                           where empresa_id = p_empresa and clase = 'prestamo' and estado = 'registrada' and fecha < p_hasta), 0)
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

revoke execute on function _concepto_manual(tipo_mov_caja, text, text, text) from public, anon, authenticated;
revoke execute on function _prestamo_pendiente(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function _validar_manual(uuid, tipo_mov_caja, text, numeric, text, text, uuid) from public, anon, authenticated;

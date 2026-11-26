-- =============================================================================
-- Maquinaria (llamada del 26/11, Sr. Otiniano): inventario de máquinas, vehículos y herramientas del
-- negocio (motos cargueras, balanzas, prensas, compresora…) con su historial de gastos e ingresos.
--  · maquinas: ficha (tipo, marca, modelo, serie/placa, cantidad, compra, estado, ubicación,
--    responsable). Se crea y edita (Gerencia y Administración; cada edición queda en historial) y se
--    da de baja con motivo; no se borra.
--  · El dinero NO va aparte: un gasto de máquina ES un gasto (gastos, categoría «Maquinaria») o un
--    «solo registro» (gastos_sin_caja) si se pagó por fuera; un ingreso (alquiler, venta de chatarra
--    de la máquina…) ES un ingreso de dinero (movimientos_manuales, clase ajuste). Se marcan con
--    maquina_id y maquina_categoria: así la caja, el cuadre y los resultados cuadran solos, y se
--    corrigen o anulan con las mismas funciones de Caja.
-- =============================================================================
create table maquinas (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  nombre             text not null check (length(trim(nombre)) > 0),
  tipo               text not null default 'Equipo' check (length(trim(tipo)) > 0),
  marca              text,
  modelo             text,
  serie              text,                                   -- N° de serie o placa
  cantidad           integer not null default 1 check (cantidad > 0),
  fecha_adquisicion  date,
  valor_compra       numeric(14,2) check (valor_compra >= 0),
  estado             text not null default 'operativo' check (estado in ('operativo', 'en_reparacion', 'de_baja')),
  ubicacion          text,
  responsable        text,
  notas              text,
  historial          jsonb not null default '[]',             -- ediciones: valores anteriores, cuándo, quién y por qué
  creado_por         uuid default auth.uid(),
  creado_en          timestamptz not null default now()
);
create index on maquinas (empresa_id, estado);

alter table maquinas enable row level security;
create policy maquinas_select on maquinas for select to authenticated using (es_miembro(empresa_id));
create trigger maquinas_no_borrar before delete on maquinas
  for each row execute function trg_no_borrar();

alter table gastos               add column maquina_id uuid references maquinas(id), add column maquina_categoria text;
alter table gastos_sin_caja      add column maquina_id uuid references maquinas(id), add column maquina_categoria text;
alter table movimientos_manuales add column maquina_id uuid references maquinas(id), add column maquina_categoria text;
create index on gastos (maquina_id) where maquina_id is not null;
create index on gastos_sin_caja (maquina_id) where maquina_id is not null;
create index on movimientos_manuales (maquina_id) where maquina_id is not null;

-- -----------------------------------------------------------------------------
-- Vistas: historial de dinero de cada máquina y fichas con sus totales
-- -----------------------------------------------------------------------------
create view v_maquina_movimientos with (security_invoker = on) as
select g.id, g.empresa_id, g.maquina_id, g.fecha, 'gasto'::text as tipo, 'caja'::text as origen,
       coalesce(g.maquina_categoria, 'Otro') as categoria, g.concepto as detalle, g.monto,
       g.caja_id, c.nombre as caja_nombre, g.estado, g.motivo_anulacion,
       coalesce(mi.nombre, mi.email) as creado_por_nombre, g.creado_en
  from gastos g
  join cajas c on c.id = g.caja_id
  left join miembros mi on mi.empresa_id = g.empresa_id and mi.user_id = g.creado_por
 where g.maquina_id is not null
union all
select g.id, g.empresa_id, g.maquina_id, g.fecha, 'gasto', 'fuera',
       coalesce(g.maquina_categoria, 'Otro'), g.concepto, g.monto,
       null, null, g.estado, g.motivo_anulacion,
       coalesce(mi.nombre, mi.email), g.creado_en
  from gastos_sin_caja g
  left join miembros mi on mi.empresa_id = g.empresa_id and mi.user_id = g.creado_por
 where g.maquina_id is not null
union all
select m.id, m.empresa_id, m.maquina_id, m.fecha, 'ingreso', 'caja',
       coalesce(m.maquina_categoria, 'Otro'), m.motivo, m.monto,
       m.caja_id, c.nombre, m.estado, m.motivo_anulacion,
       coalesce(mi.nombre, mi.email), m.creado_en
  from movimientos_manuales m
  join cajas c on c.id = m.caja_id
  left join miembros mi on mi.empresa_id = m.empresa_id and mi.user_id = m.creado_por
 where m.maquina_id is not null;

create view v_maquinas with (security_invoker = on) as
select q.*,
       coalesce(mi.nombre, mi.email) as creado_por_nombre,
       t.gastos, t.gastos_caja, t.gastos_fuera, t.ingresos, t.n_movimientos, t.ultimo_movimiento
  from maquinas q
  left join miembros mi on mi.empresa_id = q.empresa_id and mi.user_id = q.creado_por
  cross join lateral (
    select coalesce(sum(monto) filter (where tipo = 'gasto'), 0)                    as gastos,
           coalesce(sum(monto) filter (where tipo = 'gasto' and origen = 'caja'), 0)  as gastos_caja,
           coalesce(sum(monto) filter (where tipo = 'gasto' and origen = 'fuera'), 0) as gastos_fuera,
           coalesce(sum(monto) filter (where tipo = 'ingreso'), 0)                  as ingresos,
           count(*)                                                                 as n_movimientos,
           max(fecha)                                                               as ultimo_movimiento
      from v_maquina_movimientos where maquina_id = q.id and estado = 'registrada') t;

-- -----------------------------------------------------------------------------
-- Funciones
-- -----------------------------------------------------------------------------
create or replace function _categoria_maquinaria(p_empresa uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from categorias_gasto where empresa_id = p_empresa and lower(nombre) = 'maquinaria' limit 1;
  if v_id is null then
    insert into categorias_gasto (empresa_id, nombre) values (p_empresa, 'Maquinaria') returning id into v_id;
  else
    update categorias_gasto set activo = true where id = v_id and not activo;
  end if;
  return v_id;
end $$;

-- Gasto o ingreso de una máquina.
--  p_tipo 'gasto': con p_caja sale de esa caja (gasto «Maquinaria»); sin caja = pagado por fuera (solo registro).
--  p_tipo 'ingreso': entra a p_caja (obligatoria) como ingreso de dinero.
create or replace function registrar_movimiento_maquina(
  p_maquina uuid, p_tipo text, p_categoria text, p_monto numeric, p_caja uuid default null,
  p_detalle text default null, p_fecha timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  q       maquinas;
  v_rol   rol_miembro;
  v_monto numeric(14,2) := round(p_monto, 2);
  v_cat   text := coalesce(_texto(p_categoria), 'Otro');
  v_fecha timestamptz;
  v_texto text;
  v_id    uuid;
  v_mov   uuid;
begin
  select * into q from maquinas where id = p_maquina;
  if not found then raise exception 'Máquina no encontrada.'; end if;
  v_rol := exigir_rol(q.empresa_id, '{dueno,administrador,cajero}');
  if p_tipo is null or p_tipo not in ('gasto', 'ingreso') then raise exception 'Indique si es gasto o ingreso.'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  if p_tipo = 'ingreso' and p_caja is null then raise exception 'Elija la caja a la que entra el dinero.'; end if;
  if p_caja is not null then perform _validar_caja(q.empresa_id, p_caja); end if;
  -- Gerencia y Administración pueden poner la fecha real; Almacén registra con la hora actual
  v_fecha := case when p_fecha is null or v_rol not in ('dueno', 'administrador') then now() else p_fecha end;
  if v_fecha > now() + interval '5 minutes' then raise exception 'La fecha no puede ser futura.'; end if;
  v_texto := q.nombre || ' · ' || v_cat || coalesce(': ' || _texto(p_detalle), '');

  if p_tipo = 'gasto' and p_caja is not null then
    insert into gastos (empresa_id, fecha, categoria_id, monto, caja_id, concepto, creado_por, maquina_id, maquina_categoria)
    values (q.empresa_id, v_fecha, _categoria_maquinaria(q.empresa_id), v_monto, p_caja, v_texto, auth.uid(), q.id, v_cat)
    returning id into v_id;
    perform _mov_caja(q.empresa_id, p_caja, v_fecha, 'egreso', 'gasto', v_id, v_monto, v_texto);
  elsif p_tipo = 'gasto' then
    insert into gastos_sin_caja (empresa_id, fecha, categoria_id, monto, concepto, creado_por, maquina_id, maquina_categoria)
    values (q.empresa_id, v_fecha, _categoria_maquinaria(q.empresa_id), v_monto, v_texto, auth.uid(), q.id, v_cat)
    returning id into v_id;
  else
    insert into movimientos_manuales (empresa_id, fecha, tipo, clase, caja_id, monto, motivo, creado_por, maquina_id, maquina_categoria)
    values (q.empresa_id, v_fecha, 'ingreso', 'ajuste', p_caja, v_monto, v_texto, auth.uid(), q.id, v_cat)
    returning id into v_id;
    v_mov := _mov_caja(q.empresa_id, p_caja, v_fecha, 'ingreso', 'ajuste', v_id, v_monto, 'Ingreso de dinero: ' || v_texto);
    update movimientos_manuales set mov_id = v_mov where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'tipo', p_tipo, 'origen', case when p_caja is null then 'fuera' else 'caja' end);
end $$;

-- Crea (p_id null) o edita una máquina. En la edición se guardan los valores anteriores en el historial.
-- Al crearla se puede registrar lo que costó: p_pago 'caja' (sale de p_caja), 'fuera' (solo registro) o null.
create or replace function guardar_maquina(
  p_empresa uuid, p_id uuid, p_nombre text, p_tipo text, p_marca text, p_modelo text, p_serie text,
  p_cantidad integer, p_fecha_adquisicion date, p_valor_compra numeric, p_estado text, p_ubicacion text,
  p_responsable text, p_notas text, p_razon text default null, p_pago text default null, p_caja uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  q       maquinas;
  v_rol   rol_miembro;
  v_id    uuid;
  v_valor numeric(14,2) := round(p_valor_compra, 2);
  v_est   text := coalesce(_texto(p_estado), 'operativo');
begin
  v_rol := exigir_rol(p_empresa, '{dueno,administrador}');
  if _texto(p_nombre) is null then raise exception 'Indique el nombre de la máquina.'; end if;
  if coalesce(p_cantidad, 1) < 1 then raise exception 'La cantidad debe ser al menos 1.'; end if;
  if v_valor < 0 then raise exception 'El valor de compra no puede ser negativo.'; end if;
  if v_est not in ('operativo', 'en_reparacion', 'de_baja') then raise exception 'Estado no válido.'; end if;
  if p_fecha_adquisicion > (now() at time zone 'America/Lima')::date then raise exception 'La fecha de compra no puede ser futura.'; end if;

  if p_id is null then
    insert into maquinas (empresa_id, nombre, tipo, marca, modelo, serie, cantidad, fecha_adquisicion, valor_compra, estado,
                          ubicacion, responsable, notas, creado_por)
    values (p_empresa, _texto(p_nombre), coalesce(_texto(p_tipo), 'Equipo'), _texto(p_marca), _texto(p_modelo), _texto(p_serie),
            coalesce(p_cantidad, 1), p_fecha_adquisicion, v_valor, v_est, _texto(p_ubicacion), _texto(p_responsable),
            _texto(p_notas), auth.uid())
    returning id into v_id;
    if p_pago in ('caja', 'fuera') then
      if coalesce(v_valor, 0) <= 0 then raise exception 'Para registrar el pago indique el valor de compra.'; end if;
      if p_pago = 'caja' and p_caja is null then raise exception 'Elija la caja de la que salió el pago.'; end if;
      perform registrar_movimiento_maquina(v_id, 'gasto', 'Compra', v_valor, case when p_pago = 'caja' then p_caja end,
        'Compra de la máquina',
        case when p_fecha_adquisicion is not null and p_fecha_adquisicion < (now() at time zone 'America/Lima')::date
             then (p_fecha_adquisicion::text || 'T12:00:00-05:00')::timestamptz end);
    end if;
    return v_id;
  end if;

  select * into q from maquinas where id = p_id and empresa_id = p_empresa for update;
  if not found then raise exception 'Máquina no encontrada.'; end if;
  if v_est = 'de_baja' and q.estado <> 'de_baja' and _texto(p_razon) is null then
    raise exception 'Indique por qué se da de baja (vendida, malograda sin arreglo, robada…).';
  end if;
  update maquinas
     set nombre = _texto(p_nombre), tipo = coalesce(_texto(p_tipo), 'Equipo'), marca = _texto(p_marca), modelo = _texto(p_modelo),
         serie = _texto(p_serie), cantidad = coalesce(p_cantidad, 1), fecha_adquisicion = p_fecha_adquisicion,
         valor_compra = v_valor, estado = v_est, ubicacion = _texto(p_ubicacion), responsable = _texto(p_responsable),
         notas = _texto(p_notas),
         historial = historial || jsonb_build_array(jsonb_build_object(
           'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'antes', jsonb_build_object('nombre', q.nombre, 'tipo', q.tipo, 'marca', q.marca, 'modelo', q.modelo, 'serie', q.serie,
                                       'cantidad', q.cantidad, 'fecha_adquisicion', q.fecha_adquisicion, 'valor_compra', q.valor_compra,
                                       'estado', q.estado, 'ubicacion', q.ubicacion, 'responsable', q.responsable, 'notas', q.notas)))
   where id = p_id;
  return p_id;
end $$;

revoke execute on function _categoria_maquinaria(uuid) from public, anon, authenticated;

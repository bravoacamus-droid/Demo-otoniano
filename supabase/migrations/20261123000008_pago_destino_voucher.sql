-- =============================================================================
-- Pagos al personal: a dónde le llega el dinero al trabajador y su comprobante (pedido del 23/11)
--  · Ficha del trabajador: cómo cobra (efectivo, Yape, Plin o transferencia), celular de Yape/Plin,
--    banco, N° de cuenta y CCI.
--  · Cada pago guarda el medio, a dónde se envió (celular o cuenta), el N° de operación y el voucher
--    (foto o PDF). Pagar por Yape, Plin o transferencia exige a dónde se envió.
--  · Se cambian las firmas de registrar_pago_personal y editar_pago_personal (se borran las anteriores
--    para no dejar dos versiones).
-- =============================================================================

alter table trabajadores
  add column pago_medio   text check (pago_medio in ('efectivo', 'yape', 'plin', 'transferencia')),
  add column pago_celular text check (pago_celular is null or pago_celular ~ '^9\d{8}$'),
  add column pago_banco   text,
  add column pago_cuenta  text,
  add column pago_cci     text check (pago_cci is null or pago_cci ~ '^\d{20}$');

alter table pagos_personal
  add column medio       text not null default 'efectivo' check (medio in ('efectivo', 'yape', 'plin', 'transferencia')),
  add column destino     text,          -- celular (Yape/Plin) o banco y cuenta (transferencia)
  add column operacion   text,          -- N° de operación del Yape o de la transferencia
  add column voucher_url text;

-- p.* toma las columnas nuevas (+ los datos de cobro del trabajador)
drop view v_pagos_personal;
create view v_pagos_personal with (security_invoker = on) as
select p.*, t.nombre as trabajador_nombre, t.cargo, c.nombre as caja_nombre, m.nombre as creado_por_nombre,
       t.dni as trabajador_dni
  from pagos_personal p
  join trabajadores t on t.id = p.trabajador_id
  left join cajas c on c.id = p.caja_id
  left join miembros m on m.empresa_id = p.empresa_id and m.user_id = p.creado_por;

create or replace function _validar_destino_pago(p_medio text, p_destino text)
returns void
language plpgsql immutable
as $$
begin
  if p_medio is null or p_medio not in ('efectivo', 'yape', 'plin', 'transferencia') then
    raise exception 'Medio de pago no válido.';
  end if;
  if p_medio in ('yape', 'plin') and coalesce(trim(p_destino), '') !~ '^9\d{8}$' then
    raise exception 'Indique el celular al que se envió el % (9 dígitos, empieza con 9).', initcap(p_medio);
  end if;
  if p_medio = 'transferencia' and coalesce(trim(p_destino), '') = '' then
    raise exception 'Indique el banco y la cuenta a la que se transfirió.';
  end if;
end $$;

drop function registrar_pago_personal(uuid, uuid, text, text, numeric, uuid, text);
create function registrar_pago_personal(
  p_empresa uuid, p_trabajador uuid, p_periodo text, p_tipo text, p_monto numeric,
  p_caja uuid default null, p_nota text default null,
  p_medio text default 'efectivo', p_destino text default null, p_operacion text default null, p_voucher_url text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  t trabajadores;
  p pagos_personal;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  select * into t from trabajadores where id = p_trabajador and empresa_id = p_empresa;
  if not found then raise exception 'Trabajador no encontrado.'; end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido (use AAAA-MM).'; end if;
  if p_tipo is null or p_tipo not in ('pago', 'adelanto', 'bono') then raise exception 'Tipo de pago no válido.'; end if;
  if p_monto is null or round(p_monto, 2) <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  perform _validar_destino_pago(p_medio, p_destino);

  insert into pagos_personal (empresa_id, trabajador_id, periodo, tipo, monto, caja_id, nota,
                              medio, destino, operacion, voucher_url, creado_por)
  values (p_empresa, p_trabajador, p_periodo, p_tipo, round(p_monto, 2), p_caja, _texto(p_nota),
          p_medio, case when p_medio = 'efectivo' then null else _texto(p_destino) end, _texto(p_operacion),
          _texto(p_voucher_url), auth.uid())
  returning * into p;
  perform _gasto_de_pago(p, t.nombre);
  return p.id;
end $$;

drop function editar_pago_personal(uuid, text, text, numeric, uuid, text, text);
create function editar_pago_personal(
  p_id uuid, p_periodo text, p_tipo text, p_monto numeric, p_caja uuid, p_nota text, p_razon text,
  p_medio text default 'efectivo', p_destino text default null, p_operacion text default null, p_voucher_url text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  p pagos_personal;
  v_nombre text;
begin
  select * into p from pagos_personal where id = p_id for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  perform exigir_rol(p.empresa_id, '{dueno}');
  if p.estado = 'anulada' then raise exception 'El pago está anulado.'; end if;
  if _texto(p_razon) is null then raise exception 'Indique por qué se corrige.'; end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido (use AAAA-MM).'; end if;
  if p_tipo is null or p_tipo not in ('pago', 'adelanto', 'bono') then raise exception 'Tipo de pago no válido.'; end if;
  if p_monto is null or round(p_monto, 2) <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  perform _validar_destino_pago(p_medio, p_destino);
  select nombre into v_nombre from trabajadores where id = p.trabajador_id;

  perform _anular_gasto_de_pago(p, 'Corrección del pago: ' || _texto(p_razon));
  update pagos_personal
     set periodo = p_periodo, tipo = p_tipo, monto = round(p_monto, 2), caja_id = p_caja, nota = _texto(p_nota),
         medio = p_medio, destino = case when p_medio = 'efectivo' then null else _texto(p_destino) end,
         operacion = _texto(p_operacion),
         voucher_url = coalesce(_texto(p_voucher_url), voucher_url),   -- sin archivo nuevo se conserva el anterior
         historial = historial || jsonb_build_array(jsonb_build_object(
           'fecha', now(), 'por', auth.uid(), 'razon', _texto(p_razon),
           'periodo', p.periodo, 'tipo', p.tipo, 'monto', p.monto, 'caja_id', p.caja_id, 'nota', p.nota,
           'medio', p.medio, 'destino', p.destino, 'operacion', p.operacion))
   where id = p_id
  returning * into p;
  perform _gasto_de_pago(p, v_nombre);
end $$;

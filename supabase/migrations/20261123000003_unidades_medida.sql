-- =============================================================================
-- Unidades de medida editables (pedido del 23/11): cada empresa tiene su lista y puede agregar más
-- (p. ej. «saco»). Se parte de las 5 de la reunión: kg, t, und, caja, balde.
--  · codigo = abreviatura que se muestra junto a la cantidad («12 und», «3 caja»); no se cambia
--    después de creada (los productos la usan). nombre y plural sí se editan.
--  · metales.unidad pasa de una lista fija (check) a referenciar esta tabla.
--  · kg no se puede desactivar: los totales en kilos del sistema se basan en ella.
-- =============================================================================

create table unidades_medida (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  codigo      text not null check (codigo ~ '^[a-z0-9áéíóúñ]{1,8}$'),
  nombre      text not null check (length(trim(nombre)) > 0),
  plural      text,                                      -- «cajas»; vacío = igual que el código
  orden       integer not null default 0,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, codigo),
  unique (empresa_id, nombre)
);

alter table unidades_medida enable row level security;
create policy unidades_medida_select on unidades_medida for select to authenticated using (es_miembro(empresa_id));
create policy unidades_medida_insert on unidades_medida for insert to authenticated
  with check (tiene_rol(empresa_id, '{dueno}'));
create policy unidades_medida_update on unidades_medida for update to authenticated
  using (tiene_rol(empresa_id, '{dueno}')) with check (tiene_rol(empresa_id, '{dueno}'));
create trigger unidades_medida_no_borrar before delete on unidades_medida
  for each row execute function trg_no_borrar();

-- El código no cambia y kg siempre queda activa
create or replace function _trg_unidad_medida()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.codigo <> old.codigo then raise exception 'La abreviatura de una unidad no se cambia. Cree una nueva.'; end if;
  if new.codigo = 'kg' and not new.activo then raise exception 'Kilogramos no se puede desactivar.'; end if;
  return new;
end $$;
create trigger unidades_medida_cambio before update on unidades_medida
  for each row execute function _trg_unidad_medida();

create or replace function _sembrar_unidades(p_empresa uuid)
returns void
language sql security definer set search_path = public
as $$
  insert into unidades_medida (empresa_id, codigo, nombre, plural, orden)
  values (p_empresa, 'kg', 'Kilogramos', 'kg', 1), (p_empresa, 't', 'Toneladas', 't', 2),
         (p_empresa, 'und', 'Unidades', 'und', 3), (p_empresa, 'caja', 'Cajas', 'cajas', 4),
         (p_empresa, 'balde', 'Baldes', 'baldes', 5)
  on conflict do nothing
$$;
revoke execute on function _sembrar_unidades(uuid) from public, anon, authenticated;

create or replace function _trg_empresa_unidades()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform _sembrar_unidades(new.id);
  return new;
end $$;
create trigger empresas_unidades after insert on empresas
  for each row execute function _trg_empresa_unidades();

select _sembrar_unidades(id) from empresas;

alter table metales drop constraint metales_unidad_ck;
alter table metales add constraint metales_unidad_fk
  foreign key (empresa_id, unidad) references unidades_medida (empresa_id, codigo);

-- =============================================================================
-- Cargos y permisos (pedido del Sr. Otiniano, 12/11)
--  · Cada cargo (Gerente, Administración, Auxiliar, Balanza…) tiene un NIVEL de acceso (rol) y la lista de
--    pantallas que puede usar. Gerencia los crea y marca las pantallas en Configuración.
--  · El nivel es el techo que la BD hace cumplir (RLS y exigir_rol); las pantallas solo pueden recortar dentro
--    de ese nivel. secciones = null → todas las de su nivel (las pantallas nuevas aparecen solas).
--  · Al usuario se le asigna un cargo y toma su nivel. La ficha del trabajador elige el cargo de esta lista.
-- =============================================================================

create table cargos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null check (btrim(nombre) <> ''),
  rol         rol_miembro not null check (rol in ('dueno', 'administrador', 'cajero')),
  secciones   text[],
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create unique index cargos_nombre_uq on cargos (empresa_id, lower(btrim(nombre)));
create index on cargos (empresa_id);

alter table cargos enable row level security;
create policy cargos_select on cargos for select to authenticated using (es_miembro(empresa_id));
-- Sin políticas de escritura: guardar_cargo / asignar_cargo_miembro

alter table miembros add column cargo_id uuid references cargos(id);

-- Cargos con los que arranca cada empresa (los que hoy tiene la empresa)
create or replace function _cargos_iniciales(p_empresa uuid)
returns void
language sql security definer set search_path = public
as $$
  insert into cargos (empresa_id, nombre, rol)
  values (p_empresa, 'Gerente', 'dueno'), (p_empresa, 'Administración', 'administrador'),
         (p_empresa, 'Auxiliar', 'cajero'), (p_empresa, 'Balanza', 'cajero')
  on conflict do nothing
$$;
revoke execute on function _cargos_iniciales(uuid) from public, anon, authenticated;

create or replace function _trg_cargos_empresa()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform _cargos_iniciales(new.id);
  return new;
end $$;
create trigger empresas_cargos after insert on empresas for each row execute function _trg_cargos_empresa();

select _cargos_iniciales(id) from empresas;
-- Usuarios de hoy: Gerencia → Gerente, Administración → Administración (el almacén se asigna a mano)
update miembros m set cargo_id = c.id
  from cargos c
 where c.empresa_id = m.empresa_id and m.cargo_id is null
   and ((m.rol = 'dueno' and c.nombre = 'Gerente') or (m.rol = 'administrador' and c.nombre = 'Administración'));

/** Crear o editar un cargo. Cambiar el nivel cambia el rol de todos los usuarios con ese cargo. */
create or replace function guardar_cargo(p_empresa uuid, p_id uuid, p_nombre text, p_rol rol_miembro, p_secciones text[], p_activo boolean default true)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'Ingrese el nombre del cargo.'; end if;
  if p_rol not in ('dueno', 'administrador', 'cajero') then raise exception 'Nivel de acceso no válido.'; end if;
  -- Gerencia ve todo: así nadie se queda fuera de Configuración
  if p_rol = 'dueno' then p_secciones := null; end if;

  if p_id is null then
    insert into cargos (empresa_id, nombre, rol, secciones, activo)
    values (p_empresa, btrim(p_nombre), p_rol, p_secciones, coalesce(p_activo, true))
    returning id into v_id;
  else
    if exists (select 1 from miembros where cargo_id = p_id and user_id = auth.uid() and (p_rol <> 'dueno' or not p_activo)) then
      raise exception 'Ese es su propio cargo: no puede quitarle el nivel de Gerencia ni desactivarlo.';
    end if;
    if not p_activo and exists (select 1 from miembros where cargo_id = p_id and activo) then
      raise exception 'Hay usuarios activos con ese cargo: cámbieles el cargo antes de desactivarlo.';
    end if;
    update cargos set nombre = btrim(p_nombre), rol = p_rol, secciones = p_secciones, activo = coalesce(p_activo, true)
     where id = p_id and empresa_id = p_empresa
    returning id into v_id;
    if v_id is null then raise exception 'Cargo no encontrado.'; end if;
    update miembros set rol = p_rol where cargo_id = v_id and rol <> p_rol;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Ya existe un cargo con ese nombre.';
end $$;

/** Asignar un cargo a un usuario: toma el nivel de acceso del cargo */
create or replace function asignar_cargo_miembro(p_empresa uuid, p_user uuid, p_cargo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_rol rol_miembro;
begin
  perform exigir_rol(p_empresa, '{dueno}');
  if p_user = auth.uid() then raise exception 'No puede cambiar su propio cargo.'; end if;
  select rol into v_rol from cargos where id = p_cargo and empresa_id = p_empresa and activo;
  if v_rol is null then raise exception 'Cargo no encontrado.'; end if;
  update miembros set cargo_id = p_cargo, rol = v_rol where empresa_id = p_empresa and user_id = p_user;
  if not found then raise exception 'Usuario no encontrado.'; end if;
end $$;

-- Alta de usuario con su cargo (servidor con service_role)
create or replace function admin_agregar_miembro(p_empresa uuid, p_user uuid, p_rol rol_miembro, p_nombre text, p_email text, p_cargo uuid default null)
returns void
language sql security definer set search_path = public
as $$
  insert into miembros (empresa_id, user_id, rol, nombre, email, cargo_id)
  values (p_empresa, p_user, coalesce((select rol from cargos where id = p_cargo and empresa_id = p_empresa), p_rol), p_nombre, lower(p_email), p_cargo)
  on conflict (empresa_id, user_id) do update set rol = excluded.rol, activo = true, nombre = excluded.nombre, cargo_id = excluded.cargo_id
$$;
revoke execute on function admin_agregar_miembro(uuid, uuid, rol_miembro, text, text, uuid) from public, anon, authenticated;
drop function admin_agregar_miembro(uuid, uuid, rol_miembro, text, text);

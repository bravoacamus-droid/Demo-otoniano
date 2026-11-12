-- =============================================================================
-- Trabajador ↔ usuario del sistema (pedido del 12/11)
--  · Desde «Nuevo trabajador» se le puede dar acceso al sistema: su usuario queda unido a la ficha.
--  · El cargo de la ficha manda: al cambiarlo, su usuario toma ese cargo (y su nivel y pantallas).
--  · Al registrar su cese (hoy o antes), su acceso se desactiva; si se quita el cese, vuelve.
-- =============================================================================

alter table trabajadores add column user_id uuid references auth.users(id);
create unique index trabajadores_usuario_uq on trabajadores (empresa_id, user_id) where user_id is not null;

create or replace function _trg_trabajador_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare c cargos;
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'INSERT' or new.cargo is distinct from old.cargo or new.user_id is distinct from old.user_id then
    select * into c from cargos
     where empresa_id = new.empresa_id and activo and lower(btrim(nombre)) = lower(btrim(coalesce(new.cargo, '')));
    -- Quien edita su propia ficha no cambia su propio nivel (no se queda sin acceso a Configuración)
    if found and new.user_id is distinct from auth.uid() then
      update miembros set cargo_id = c.id, rol = c.rol where empresa_id = new.empresa_id and user_id = new.user_id;
    end if;
  end if;
  if tg_op = 'INSERT' or new.fecha_cese is distinct from old.fecha_cese then
    if new.user_id is distinct from auth.uid() then
      update miembros
         set activo = not (new.fecha_cese is not null and new.fecha_cese <= (now() at time zone 'America/Lima')::date)
       where empresa_id = new.empresa_id and user_id = new.user_id;
    end if;
  end if;
  return new;
end $$;

create trigger trabajadores_usuario after insert or update on trabajadores
  for each row execute function _trg_trabajador_usuario();

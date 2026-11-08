-- Ejecutar después de registro-por-invitacion.sql e invitation-status-audit.sql.
-- Los drivers invitados a una flotilla pendiente se registran cuando su titular termina el alta.
-- No cambia de proveedor a usuarios que ya tienen uno; estos requieren gestion administrativa.
-- Para cancelar la invitacion del flotillero, cancela primero las de sus drivers pendientes.
begin;

alter table public.invitaciones_red
  add column if not exists invitacion_flotillero_id bigint references public.invitaciones_red(id);
create index if not exists invitaciones_red_flotillero_pendiente_idx
  on public.invitaciones_red (invitacion_flotillero_id)
  where invitacion_flotillero_id is not null;

create or replace function public.listar_flotilleros_invitacion()
returns table (tipo text, id bigint, nombre text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar flotilleros';
  end if;
  return query
    select 'proveedor'::text, p.id, p.nombre::text
      from public.proveedores p
     where p.tipo = 'flotillero' and p.activo
    union all
    select 'invitacion'::text, i.id, coalesce(nullif(btrim(i.nombre), ''), 'Flotillero #' || i.id)::text
      from public.invitaciones_red i
     where i.tipo = 'flotillero' and i.estatus = 'enviada'
    order by 3, 1, 2;
end;
$$;
revoke all on function public.listar_flotilleros_invitacion() from public, anon;
grant execute on function public.listar_flotilleros_invitacion() to authenticated;

create or replace function public.invitar_driver_flotillero_pendiente(
  p_email text, p_nombre text, p_invitacion_flotillero_id bigint
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol text := public.operativo_rol_actual();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_padre public.invitaciones_red%rowtype;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para enviar invitaciones';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo invalido'; end if;
  select * into v_padre from public.invitaciones_red
    where id = p_invitacion_flotillero_id for update;
  if not found or v_padre.tipo <> 'flotillero' or v_padre.estatus <> 'enviada' then
    raise exception 'La invitacion del flotillero ya no esta disponible';
  end if;
  if lower(btrim(v_padre.email)) = v_email then
    raise exception 'El correo del driver debe ser diferente al del flotillero';
  end if;
  if exists (
    select 1 from auth.users u join public.drivers d on d.id = u.id
     where lower(btrim(u.email::text)) = v_email
       and d.rol::text in ('driver', 'flotillero') and d.proveedor_id is not null
  ) then
    raise exception 'Este usuario ya tiene proveedor. Contacta al administrador; esta invitacion no cambia de flotilla';
  end if;
  begin
    insert into public.invitaciones_red
      (email, nombre, tipo, esquema, proveedor_id, cedis_id, estatus,
       invitado_por, invitado_por_rol, invitacion_flotillero_id)
    values
      (v_email, nullif(btrim(coalesce(p_nombre, '')), ''), 'driver', null, null, null, 'enviada',
       auth.uid(), v_rol, v_padre.id);
  exception when unique_violation then
    raise exception 'Ya existe una invitacion activa para ese correo';
  end;
  return 'Invitacion registrada. El driver debe esperar a que el flotillero se registre';
end;
$$;
revoke all on function public.invitar_driver_flotillero_pendiente(text, text, bigint) from public, anon;
grant execute on function public.invitar_driver_flotillero_pendiente(text, text, bigint) to authenticated;

create or replace function private.comprobar_flotillero_invitado()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if old.tipo = 'flotillero' and old.estatus = 'enviada'
     and (new.tipo <> 'flotillero' or new.estatus not in ('enviada', 'aceptada'))
     and exists (select 1 from public.invitaciones_red i
                  where i.invitacion_flotillero_id = old.id
                    and i.estatus in ('enviada', 'pendiente_aprobacion')) then
    raise exception 'Cancela primero las invitaciones de drivers vinculadas a este flotillero';
  end if;
  return new;
end;
$$;
revoke all on function private.comprobar_flotillero_invitado() from public, anon, authenticated;
drop trigger if exists invitacion_flotillero_proteger on public.invitaciones_red;
create trigger invitacion_flotillero_proteger
  before update of estatus, tipo on public.invitaciones_red
  for each row execute function private.comprobar_flotillero_invitado();

create or replace function private.vincular_flotillero_invitado()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_proveedor bigint;
  v_email text;
begin
  if new.tipo = 'flotillero' and old.estatus = 'enviada' and new.estatus = 'aceptada'
     and exists (select 1 from public.invitaciones_red i
                  where i.invitacion_flotillero_id = new.id
                    and i.estatus in ('enviada', 'pendiente_aprobacion')) then
    select p.id into v_proveedor from public.proveedores p
      join public.drivers d on d.id = p.titular_id and d.proveedor_id = p.id
     where p.titular_id = new.aceptada_por and p.tipo = 'flotillero' and p.activo
       and d.rol::text = 'flotillero' and lower(d.estatus::text) = 'activo'
     order by p.id limit 1;
    if v_proveedor is null then raise exception 'No se encontro la flotilla activa del titular'; end if;
    perform d.id
      from public.invitaciones_red i
      join auth.users u on lower(btrim(u.email::text)) = lower(btrim(i.email))
      join public.drivers d on d.id = u.id
     where i.invitacion_flotillero_id = new.id
       and i.estatus in ('enviada', 'pendiente_aprobacion')
     order by d.id
     for update of d;
    update public.invitaciones_red
       set proveedor_id = v_proveedor
     where invitacion_flotillero_id = new.id and tipo = 'driver'
       and estatus in ('enviada', 'pendiente_aprobacion') and proveedor_id is null
       and not exists (
         select 1 from auth.users u join public.drivers d on d.id = u.id
          where lower(btrim(u.email::text)) = lower(btrim(invitaciones_red.email))
            and d.rol::text in ('driver', 'flotillero') and d.proveedor_id is not null
       );
    for v_email in select i.email from public.invitaciones_red i
                    where i.invitacion_flotillero_id = new.id and i.estatus = 'enviada'
                      and i.proveedor_id = v_proveedor
    loop
      perform public.aplicar_invitacion_red_por_correo(v_email);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.vincular_flotillero_invitado() from public, anon, authenticated;
drop trigger if exists invitacion_flotillero_vincular on public.invitaciones_red;
create trigger invitacion_flotillero_vincular
  after update of estatus on public.invitaciones_red
  for each row execute function private.vincular_flotillero_invitado();

notify pgrst, 'reload schema';
commit;

-- Ejecutar después de driver-documents-workflow.sql e invitaciones-flotillero-pendiente.sql.
-- Esta etapa no modifica roles, proveedor, estatus ni correos de inicio de sesión.
begin;

create table if not exists private.ediciones_contacto_flota (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  driver_id uuid not null references public.drivers(id),
  proveedor_id bigint not null references public.proveedores(id),
  creado_en timestamptz not null default now()
);
revoke all on private.ediciones_contacto_flota from public, anon, authenticated;

create or replace function public.listar_afiliados_supervisor()
returns table (
  id uuid, nombre text, codigo text, rol text, estatus text, proveedor_id bigint,
  proveedor_nombre text, proveedor_tipo text, titular_id uuid, proveedor_activo boolean,
  telefono text, correo_contacto text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar afiliados';
  end if;
  return query
    select d.id, d.nombre::text, d.codigo::text, d.rol::text, d.estatus::text,
           p.id, p.nombre::text, p.tipo::text, p.titular_id, p.activo,
           d.telefono::text, d.correo_contacto::text
      from public.drivers d
      left join public.proveedores p on p.id = d.proveedor_id
     where d.rol::text in ('driver', 'flotillero')
     order by d.nombre, d.id;
end;
$$;
revoke all on function public.listar_afiliados_supervisor() from public, anon, authenticated;
grant execute on function public.listar_afiliados_supervisor() to authenticated;

create or replace function public.editar_contacto_driver_flota(
  p_driver_id uuid, p_proveedor_id bigint, p_nombre text, p_telefono text, p_correo_contacto text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_nombre text;
  v_telefono text;
  v_correo text;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para editar este driver';
  end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is null or length(btrim(p_nombre)) > 200 then
    raise exception 'Escribe un nombre de hasta 200 caracteres';
  end if;
  if length(coalesce(p_telefono, '')) > 50 then raise exception 'Telefono demasiado largo'; end if;
  if length(coalesce(p_correo_contacto, '')) > 254 or
     (nullif(btrim(coalesce(p_correo_contacto, '')), '') is not null
      and btrim(p_correo_contacto) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Correo de contacto invalido';
  end if;
  update public.drivers d
     set nombre = btrim(p_nombre), telefono = nullif(btrim(coalesce(p_telefono, '')), ''),
         correo_contacto = nullif(lower(btrim(coalesce(p_correo_contacto, ''))), '')
   where d.id = p_driver_id and d.rol::text = 'driver' and d.proveedor_id = p_proveedor_id
     and exists (
       select 1 from public.proveedores p join public.drivers titular on titular.id = p.titular_id
        where p.id = p_proveedor_id and p.tipo = 'flotillero'
          and titular.rol::text = 'flotillero' and titular.proveedor_id = p.id
     )
  returning d.nombre::text, d.telefono::text, d.correo_contacto::text
       into v_nombre, v_telefono, v_correo;
  if not found then raise exception 'El driver ya no pertenece a la flotilla seleccionada'; end if;
  if v_nombre is distinct from btrim(p_nombre)
     or v_telefono is distinct from nullif(btrim(coalesce(p_telefono, '')), '')
     or v_correo is distinct from nullif(lower(btrim(coalesce(p_correo_contacto, ''))), '') then
    raise exception 'No se pudieron guardar los datos de contacto';
  end if;
  insert into private.ediciones_contacto_flota(actor_id, driver_id, proveedor_id)
  values (auth.uid(), p_driver_id, p_proveedor_id);
end;
$$;
revoke all on function public.editar_contacto_driver_flota(uuid, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.editar_contacto_driver_flota(uuid, bigint, text, text, text) to authenticated;

create or replace function public.invitar_driver_flotilla_sin_traslado(
  p_email text, p_nombre text, p_proveedor_id bigint
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_driver public.drivers%rowtype;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para enviar invitaciones';
  end if;
  select d.* into v_driver from auth.users u join public.drivers d on d.id = u.id
   where lower(btrim(u.email::text)) = lower(btrim(coalesce(p_email, '')))
   for update of d;
  if found and (v_driver.rol::text = 'flotillero'
                or (v_driver.proveedor_id is not null and v_driver.proveedor_id <> p_proveedor_id)) then
    raise exception 'Este usuario ya pertenece a otra flotilla o es flotillero; se requiere el proceso de cambio';
  end if;
  return public.invitar_driver_flotillero(p_email, p_nombre, p_proveedor_id);
end;
$$;
revoke all on function public.invitar_driver_flotilla_sin_traslado(text, text, bigint) from public, anon, authenticated;
grant execute on function public.invitar_driver_flotilla_sin_traslado(text, text, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

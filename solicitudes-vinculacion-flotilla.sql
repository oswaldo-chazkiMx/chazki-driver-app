-- Ejecutar después de gestion-flotillas-supervisor.sql.
-- Esta etapa registra solicitudes; NO cambia proveedor ni aprueba traslados.
begin;

create table if not exists private.solicitudes_vinculacion_flota (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.drivers(id),
  proveedor_origen_id bigint not null references public.proveedores(id),
  proveedor_destino_id bigint not null references public.proveedores(id),
  solicitada_por uuid not null,
  solicitada_en timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'cancelada')),
  cancelada_por uuid,
  cancelada_en timestamptz
);
create unique index if not exists solicitud_vinculacion_unica_pendiente
  on private.solicitudes_vinculacion_flota(driver_id) where estado = 'pendiente';
revoke all on private.solicitudes_vinculacion_flota from public, anon, authenticated;

create or replace function public.listar_independientes_vinculacion()
returns table (id uuid, nombre text, codigo text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar drivers independientes';
  end if;
  return query
    select d.id, d.nombre::text, d.codigo::text
      from public.drivers d
      join public.proveedores p on p.id = d.proveedor_id
      join auth.users u on u.id = d.id
     where d.rol::text = 'driver' and lower(d.estatus::text) = 'activo'
       and p.tipo = 'independiente' and p.activo and p.titular_id = d.id
       and (u.banned_until is null or u.banned_until <= now())
       and not exists (select 1 from private.solicitudes_vinculacion_flota s
                       where s.driver_id = d.id and s.estado = 'pendiente')
     order by d.nombre, d.id;
end;
$$;
revoke all on function public.listar_independientes_vinculacion() from public, anon, authenticated;
grant execute on function public.listar_independientes_vinculacion() to authenticated;

create or replace function public.solicitar_vinculacion_flota(p_driver_id uuid, p_proveedor_id bigint)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare v_origen bigint;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para solicitar una vinculacion';
  end if;
  select d.proveedor_id into v_origen
    from public.drivers d join public.proveedores p on p.id = d.proveedor_id
    join auth.users u on u.id = d.id
   where d.id = p_driver_id and d.rol::text = 'driver'
     and lower(d.estatus::text) = 'activo'
     and p.tipo = 'independiente' and p.activo and p.titular_id = d.id
     and (u.banned_until is null or u.banned_until <= now())
   for update of d;
  if not found then raise exception 'El driver ya no es independiente activo o esta bloqueado'; end if;
  if not exists (
    select 1 from public.proveedores p
    join public.drivers titular on titular.id = p.titular_id
    join auth.users u on u.id = titular.id
    where p.id = p_proveedor_id and p.tipo = 'flotillero' and p.activo
      and titular.rol::text = 'flotillero' and titular.proveedor_id = p.id
      and lower(titular.estatus::text) = 'activo'
      and (u.banned_until is null or u.banned_until <= now())
  ) then raise exception 'El flotillero ya no esta activo'; end if;
  begin
    insert into private.solicitudes_vinculacion_flota(driver_id, proveedor_origen_id, proveedor_destino_id, solicitada_por)
    values (p_driver_id, v_origen, p_proveedor_id, auth.uid());
  exception when unique_violation then
    raise exception 'El driver ya tiene una solicitud pendiente';
  end;
  return 'Solicitud registrada. La aprobacion y el traslado seguro aun no estan habilitados';
end;
$$;
revoke all on function public.solicitar_vinculacion_flota(uuid, bigint) from public, anon, authenticated;
grant execute on function public.solicitar_vinculacion_flota(uuid, bigint) to authenticated;

create or replace function public.listar_solicitudes_vinculacion_flota()
returns table (id bigint, driver_nombre text, flotillero_nombre text, solicitada_en timestamptz, solicitada_por uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar solicitudes';
  end if;
  return query
    select s.id, d.nombre::text, p.nombre::text, s.solicitada_en, s.solicitada_por
      from private.solicitudes_vinculacion_flota s
      join public.drivers d on d.id = s.driver_id
      join public.proveedores p on p.id = s.proveedor_destino_id
     where s.estado = 'pendiente'
       and (public.operativo_rol_actual() in ('master', 'ops') or s.solicitada_por = auth.uid())
     order by s.solicitada_en desc, s.id desc;
end;
$$;
revoke all on function public.listar_solicitudes_vinculacion_flota() from public, anon, authenticated;
grant execute on function public.listar_solicitudes_vinculacion_flota() to authenticated;

create or replace function public.cancelar_solicitud_vinculacion_flota(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para cancelar solicitudes';
  end if;
  update private.solicitudes_vinculacion_flota s
     set estado = 'cancelada', cancelada_por = auth.uid(), cancelada_en = now()
   where s.id = p_id and s.estado = 'pendiente'
     and (s.solicitada_por = auth.uid() or public.operativo_rol_actual() in ('master', 'ops'));
  if not found then raise exception 'La solicitud no esta disponible'; end if;
end;
$$;
revoke all on function public.cancelar_solicitud_vinculacion_flota(bigint) from public, anon, authenticated;
grant execute on function public.cancelar_solicitud_vinculacion_flota(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

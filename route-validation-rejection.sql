begin;

create table if not exists public.ruta_validacion_rechazos (
  id bigint generated always as identity primary key,
  ruta_id bigint not null references public.rutas(id) on delete cascade,
  motivo text not null check (length(btrim(motivo)) between 1 and 2000),
  rechazada_por uuid not null references auth.users(id),
  rechazada_por_email text,
  rechazada_en timestamptz not null default now(),
  restaurada_por uuid references auth.users(id),
  restaurada_por_email text,
  restaurada_en timestamptz
);

create unique index if not exists ruta_validacion_rechazos_activos_uidx
  on public.ruta_validacion_rechazos(ruta_id)
  where restaurada_en is null;

alter table public.ruta_validacion_rechazos enable row level security;
grant select on public.ruta_validacion_rechazos to authenticated;

drop policy if exists ruta_validacion_rechazos_admin_read on public.ruta_validacion_rechazos;
create policy ruta_validacion_rechazos_admin_read
  on public.ruta_validacion_rechazos
  for select
  to authenticated
  using (public.mi_acceso_administrativo());

create or replace function public.rechazar_validacion_ruta(p_ruta_id bigint, p_motivo text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo() then
    raise exception 'No tienes autorización para rechazar rutas';
  end if;

  select rol into v_rol
  from public.drivers
  where id = auth.uid();

  if coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'Tu rol no puede rechazar rutas';
  end if;

  if p_motivo is null or length(btrim(p_motivo)) not between 1 and 2000 then
    raise exception 'Escribe un motivo de rechazo de hasta 2000 caracteres';
  end if;

  perform 1
  from public.rutas
  where id = p_ruta_id and estado = 'cerrada'
  for update;
  if not found then
    raise exception 'La ruta no existe, no está cerrada o ya no puede revisarse';
  end if;

  if exists (select 1 from public.liquidaciones where ruta_id::text = p_ruta_id::text) then
    raise exception 'La ruta ya tiene una liquidación validada';
  end if;

  if exists (
    select 1 from public.validaciones_pendientes
    where ruta_id::text = p_ruta_id::text and estatus = 'pendiente'
  ) then
    raise exception 'La ruta está pendiente de aprobación y no puede rechazarse desde esta sección';
  end if;

  if exists (
    select 1 from public.ruta_validacion_rechazos
    where ruta_id = p_ruta_id and restaurada_en is null
  ) then
    raise exception 'La ruta ya fue rechazada';
  end if;

  insert into public.ruta_validacion_rechazos (
    ruta_id, motivo, rechazada_por, rechazada_por_email
  )
  values (p_ruta_id, btrim(p_motivo), auth.uid(), auth.jwt() ->> 'email');

  return true;
end;
$$;

create or replace function public.restaurar_validacion_ruta(p_ruta_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo() then
    raise exception 'No tienes autorización para restaurar rutas rechazadas';
  end if;

  select rol into v_rol
  from public.drivers
  where id = auth.uid();

  if coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'Tu rol no puede restaurar rutas rechazadas';
  end if;

  perform 1
  from public.rutas
  where id = p_ruta_id and estado = 'cerrada'
  for update;
  if not found then
    raise exception 'La ruta no existe o ya no puede revisarse';
  end if;

  if exists (select 1 from public.liquidaciones where ruta_id::text = p_ruta_id::text)
    or exists (
      select 1 from public.validaciones_pendientes
      where ruta_id::text = p_ruta_id::text and estatus = 'pendiente'
    ) then
    raise exception 'La ruta ya fue validada o está pendiente de aprobación';
  end if;

  update public.ruta_validacion_rechazos
  set restaurada_por = auth.uid(),
      restaurada_por_email = auth.jwt() ->> 'email',
      restaurada_en = now()
  where ruta_id = p_ruta_id and restaurada_en is null;
  if not found then
    raise exception 'La ruta no tiene un rechazo para restaurar';
  end if;

  return true;
end;
$$;

revoke all on function public.rechazar_validacion_ruta(bigint, text) from public, anon, authenticated;
revoke all on function public.restaurar_validacion_ruta(bigint) from public, anon, authenticated;
grant execute on function public.rechazar_validacion_ruta(bigint, text) to authenticated;
grant execute on function public.restaurar_validacion_ruta(bigint) to authenticated;

commit;

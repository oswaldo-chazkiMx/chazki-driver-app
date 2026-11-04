begin;

create table if not exists public.liquidacion_validaciones (
  ruta_id bigint primary key,
  validado_por uuid not null references auth.users(id),
  validado_por_email text,
  validado_en timestamptz not null default now()
);

alter table public.liquidacion_validaciones enable row level security;
grant select on public.liquidacion_validaciones to authenticated;

drop policy if exists liquidacion_validaciones_admin_read on public.liquidacion_validaciones;
create policy liquidacion_validaciones_admin_read
  on public.liquidacion_validaciones
  for select
  to authenticated
  using (public.mi_acceso_administrativo());

create or replace function public.registrar_validacion_liquidacion(p_ruta_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo() then
    raise exception 'No tienes autorización para registrar validaciones';
  end if;

  select rol into v_rol
  from public.drivers
  where id = auth.uid();

  if coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'Tu rol no puede validar rutas';
  end if;

  if not exists (
    select 1
    from public.liquidaciones
    where ruta_id = p_ruta_id
  ) then
    raise exception 'No existe una liquidación validada para esta ruta';
  end if;

  insert into public.liquidacion_validaciones (
    ruta_id,
    validado_por,
    validado_por_email,
    validado_en
  )
  values (
    p_ruta_id,
    auth.uid(),
    auth.jwt() ->> 'email',
    now()
  )
  on conflict (ruta_id) do update
  set validado_por = excluded.validado_por,
      validado_por_email = excluded.validado_por_email,
      validado_en = excluded.validado_en;

  return true;
end;
$$;

revoke all on function public.registrar_validacion_liquidacion(bigint) from public, anon, authenticated;
grant execute on function public.registrar_validacion_liquidacion(bigint) to authenticated;

commit;

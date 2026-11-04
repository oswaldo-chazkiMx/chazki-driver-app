begin;

create table if not exists public.liquidacion_anulaciones (
  id bigint generated always as identity primary key,
  ruta_id text not null,
  motivo text not null check (length(btrim(motivo)) between 1 and 2000),
  liquidacion_snapshot jsonb not null,
  anulada_por uuid not null references auth.users(id),
  anulada_por_email text,
  anulada_en timestamptz not null default now()
);

alter table public.liquidacion_anulaciones enable row level security;

grant select on public.liquidacion_anulaciones to authenticated;

drop policy if exists liquidacion_anulaciones_admin_read on public.liquidacion_anulaciones;
create policy liquidacion_anulaciones_admin_read
  on public.liquidacion_anulaciones
  for select
  to authenticated
  using (public.mi_acceso_administrativo());

create or replace function public.anular_liquidacion(p_ruta_id text, p_motivo text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_liquidacion jsonb;
  v_anulacion_id bigint;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo() then
    raise exception 'No tienes autorización para anular liquidaciones';
  end if;

  if not exists (
    select 1
    from public.drivers
    where id = auth.uid()
      and rol in ('master', 'ops', 'coordinador', 'finanzas')
  ) then
    raise exception 'Tu rol no puede anular liquidaciones';
  end if;

  if p_ruta_id is null or btrim(p_ruta_id) = '' then
    raise exception 'La ruta es obligatoria';
  end if;

  if p_motivo is null or length(btrim(p_motivo)) not between 1 and 2000 then
    raise exception 'Escribe un motivo de anulación de hasta 2000 caracteres';
  end if;

  select to_jsonb(l)
  into v_liquidacion
  from public.liquidaciones as l
  where l.ruta_id::text = p_ruta_id
  for update;

  if not found then
    raise exception 'No se encontró la liquidación de esta ruta';
  end if;

  if exists (
    select 1
    from public.pagos
    where ruta_id::text = p_ruta_id
      and concepto = 'servicio'
      and estatus = 'pagado'
  ) then
    raise exception 'Este pago ya está marcado como pagado; no se puede anular';
  end if;

  insert into public.liquidacion_anulaciones (
    ruta_id,
    motivo,
    liquidacion_snapshot,
    anulada_por,
    anulada_por_email
  )
  values (
    p_ruta_id,
    btrim(p_motivo),
    v_liquidacion,
    auth.uid(),
    auth.jwt() ->> 'email'
  )
  returning id into v_anulacion_id;

  delete from public.pagos
  where ruta_id::text = p_ruta_id
    and concepto = 'servicio'
    and estatus = 'pendiente';

  delete from public.liquidaciones
  where ruta_id::text = p_ruta_id;

  return v_anulacion_id;
end;
$$;

revoke all on function public.anular_liquidacion(text, text) from public, anon, authenticated;
grant execute on function public.anular_liquidacion(text, text) to authenticated;

commit;

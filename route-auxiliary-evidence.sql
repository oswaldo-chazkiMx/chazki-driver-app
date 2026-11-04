begin;

alter table public.rutas
  add column if not exists auxiliar_requerido boolean not null default false,
  add column if not exists viaja_con_auxiliar boolean not null default false,
  add column if not exists evidencia_auxiliar_checkin_path text,
  add column if not exists evidencia_auxiliar_checkout_path text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rutas_auxiliar_requiere_evidencia_checkin'
      and conrelid = 'public.rutas'::regclass
  ) then
    alter table public.rutas add constraint rutas_auxiliar_requiere_evidencia_checkin
      check (not viaja_con_auxiliar or (auxiliar_requerido and evidencia_auxiliar_checkin_path is not null));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'rutas_auxiliar_requiere_evidencia_checkout'
      and conrelid = 'public.rutas'::regclass
  ) then
    alter table public.rutas add constraint rutas_auxiliar_requiere_evidencia_checkout
      check (estado <> 'cerrada' or not viaja_con_auxiliar or evidencia_auxiliar_checkout_path is not null);
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ruta-auxiliares', 'ruta-auxiliares', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists ruta_auxiliares_read_own_or_admin on storage.objects;
create policy ruta_auxiliares_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ruta-auxiliares'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.mi_acceso_administrativo()
    )
  );

drop policy if exists ruta_auxiliares_insert_own on storage.objects;
create policy ruta_auxiliares_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ruta-auxiliares'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists ruta_auxiliares_update_own on storage.objects;
create policy ruta_auxiliares_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'ruta-auxiliares'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'ruta-auxiliares'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

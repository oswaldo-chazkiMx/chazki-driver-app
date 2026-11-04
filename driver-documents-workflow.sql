begin;

alter table public.drivers
  add column if not exists correo_contacto text;

create or replace function public.actualizar_contacto_driver(
  p_telefono text,
  p_correo_contacto text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if p_correo_contacto is not null
    and p_correo_contacto !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo de contacto no es válido';
  end if;

  update public.drivers
  set telefono = nullif(btrim(p_telefono), ''),
      correo_contacto = nullif(lower(btrim(p_correo_contacto)), '')
  where id = auth.uid()
    and rol::text in ('driver', 'flotillero');

  if not found then
    raise exception 'No se encontró un perfil de driver autorizado';
  end if;
  return true;
end;
$$;

revoke all on function public.actualizar_contacto_driver(text, text) from public, anon, authenticated;
grant execute on function public.actualizar_contacto_driver(text, text) to authenticated;

create or replace function public.puede_gestionar_documentos_driver()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.drivers
    where id = auth.uid()
      and rol::text in ('master', 'ops')
  );
$$;

revoke all on function public.puede_gestionar_documentos_driver() from public, anon;
grant execute on function public.puede_gestionar_documentos_driver() to authenticated, service_role;

create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id),
  tipo text not null check (tipo in ('seguro', 'licencia', 'tarjeta', 'ine')),
  storage_path text not null unique,
  vigencia date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'reemplazado')),
  origen text not null check (origen in ('driver', 'flota')),
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  resuelto_por uuid references auth.users(id),
  nota text
);

create unique index if not exists driver_documents_one_pending_per_type
  on public.driver_documents (driver_id, tipo)
  where estado = 'pendiente';

alter table public.driver_documents enable row level security;
grant select, insert on public.driver_documents to authenticated;

drop policy if exists driver_documents_read_own_or_ops on public.driver_documents;
create policy driver_documents_read_own_or_ops
  on public.driver_documents
  for select
  to authenticated
  using (driver_id = auth.uid() or public.puede_gestionar_documentos_driver());

drop policy if exists driver_documents_driver_submit on public.driver_documents;
create policy driver_documents_driver_submit
  on public.driver_documents
  for insert
  to authenticated
  with check (
    driver_id = auth.uid()
    and estado = 'pendiente'
    and origen = 'driver'
    and storage_path like auth.uid()::text || '/' || tipo || '/%'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-documents', 'driver-documents', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists driver_documents_storage_read on storage.objects;
create policy driver_documents_storage_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.puede_gestionar_documentos_driver()
    )
  );

drop policy if exists driver_documents_storage_insert on storage.objects;
create policy driver_documents_storage_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'driver-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.puede_gestionar_documentos_driver()
    )
  );

create table if not exists public.driver_document_alerts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id),
  driver_document_id uuid not null references public.driver_documents(id),
  alert_date date not null,
  message text not null,
  creada_en timestamptz not null default now(),
  email_enviado_en timestamptz,
  unique (driver_document_id, alert_date)
);

alter table public.driver_document_alerts
  add column if not exists email_enviado_en timestamptz;

alter table public.driver_document_alerts enable row level security;
grant select on public.driver_document_alerts to authenticated;

drop policy if exists driver_document_alerts_read_own_or_ops on public.driver_document_alerts;
create policy driver_document_alerts_read_own_or_ops
  on public.driver_document_alerts
  for select
  to authenticated
  using (driver_id = auth.uid() or public.puede_gestionar_documentos_driver());

create or replace function public.generar_alertas_vigencia_documentos()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.driver_document_alerts (driver_id, driver_document_id, alert_date, message)
  select d.driver_id,
         d.id,
         current_date,
         format('%s vence %s. Sube el reemplazo para mantener tu expediente vigente.',
           case d.tipo
             when 'seguro' then 'El seguro del vehículo'
             when 'licencia' then 'La licencia de conducir'
             when 'tarjeta' then 'La tarjeta de circulación'
             else 'El INE'
           end,
           to_char(d.vigencia, 'DD/MM/YYYY'))
  from public.driver_documents d
  where d.estado = 'aprobado'
    and d.vigencia <= current_date + 15
    and not exists (
      select 1
      from public.driver_documents pending
      where pending.driver_id = d.driver_id
        and pending.tipo = d.tipo
        and pending.estado = 'pendiente'
    )
  on conflict (driver_document_id, alert_date) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.generar_alertas_vigencia_documentos() from public, anon, authenticated;
grant execute on function public.generar_alertas_vigencia_documentos() to service_role;

create or replace function public.registrar_documento_flota(
  p_driver_id uuid,
  p_tipo text,
  p_storage_path text,
  p_vigencia date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.puede_gestionar_documentos_driver() then
    raise exception 'Solo Operaciones puede importar documentos de Flota';
  end if;
  if p_tipo not in ('seguro', 'licencia', 'tarjeta', 'ine') or p_vigencia is null then
    raise exception 'Tipo y vigencia del documento son obligatorios';
  end if;
  if p_storage_path not like p_driver_id::text || '/' || p_tipo || '/%' then
    raise exception 'La ruta del archivo no corresponde al driver y tipo seleccionados';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'driver-documents' and name = p_storage_path
  ) then
    raise exception 'No se encontró el archivo en el almacenamiento privado';
  end if;

  update public.driver_documents
  set estado = 'reemplazado', resuelto_en = now(), resuelto_por = auth.uid()
  where driver_id = p_driver_id and tipo = p_tipo and estado = 'aprobado';

  insert into public.driver_documents (
    driver_id, tipo, storage_path, vigencia, estado, origen, creado_en, resuelto_en, resuelto_por
  )
  values (
    p_driver_id, p_tipo, p_storage_path, p_vigencia, 'aprobado', 'flota', now(), now(), auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resolver_documento_driver(
  p_id uuid,
  p_aprobar boolean,
  p_nota text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc public.driver_documents%rowtype;
begin
  if auth.uid() is null or not public.puede_gestionar_documentos_driver() then
    raise exception 'Solo Operaciones puede resolver actualizaciones de documentos';
  end if;

  select * into v_doc
  from public.driver_documents
  where id = p_id and estado = 'pendiente'
  for update;
  if not found then
    raise exception 'La solicitud no existe o ya fue resuelta';
  end if;

  if p_aprobar then
    update public.driver_documents
    set estado = 'reemplazado', resuelto_en = now(), resuelto_por = auth.uid()
    where driver_id = v_doc.driver_id and tipo = v_doc.tipo and estado = 'aprobado';

    update public.driver_documents
    set estado = 'aprobado', resuelto_en = now(), resuelto_por = auth.uid(), nota = null
    where id = p_id;
    return 'aprobado';
  end if;

  update public.driver_documents
  set estado = 'rechazado',
      resuelto_en = now(),
      resuelto_por = auth.uid(),
      nota = nullif(btrim(p_nota), '')
  where id = p_id;
  return 'rechazado';
end;
$$;

revoke all on function public.registrar_documento_flota(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.registrar_documento_flota(uuid, text, text, date) to authenticated;

revoke all on function public.resolver_documento_driver(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.resolver_documento_driver(uuid, boolean, text) to authenticated;

commit;

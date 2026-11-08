-- Ejecutar después de driver-documents-workflow.sql y expedientes-afiliados.sql.
-- Conserva los documentos y el historial existentes.
begin;

create or replace function public.finanzas_puede_ver_documento(p_driver_id uuid, p_tipo text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_tipo in ('constancia_fiscal', 'estado_cuenta')
    and exists (select 1 from public.drivers where id = auth.uid() and rol::text = 'finanzas')
    and exists (select 1 from public.drivers where id = p_driver_id and rol::text = 'flotillero');
$$;
revoke all on function public.finanzas_puede_ver_documento(uuid, text) from public, anon, authenticated;
grant execute on function public.finanzas_puede_ver_documento(uuid, text) to authenticated;

drop policy if exists driver_documents_finanzas_read on public.driver_documents;
create policy driver_documents_finanzas_read on public.driver_documents
  for select to authenticated using (public.finanzas_puede_ver_documento(driver_id, tipo));

create or replace function public.finanzas_puede_ver_archivo_documento(p_path text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.driver_documents d
    where d.storage_path = p_path
      and public.finanzas_puede_ver_documento(d.driver_id, d.tipo)
  );
$$;
revoke all on function public.finanzas_puede_ver_archivo_documento(text) from public, anon, authenticated;
grant execute on function public.finanzas_puede_ver_archivo_documento(text) to authenticated;

drop policy if exists driver_documents_finanzas_storage_read on storage.objects;
create policy driver_documents_finanzas_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'driver-documents' and public.finanzas_puede_ver_archivo_documento(name));

create or replace function public.listar_documentos_finanzas()
returns table (id uuid, driver_id uuid, nombre text, codigo text, tipo text,
               vigencia date, estado text, creado_en timestamptz, storage_path text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select d.id, d.driver_id, p.nombre::text, p.codigo::text, d.tipo::text,
         d.vigencia, d.estado::text, d.creado_en, d.storage_path::text
  from public.driver_documents d
  join public.drivers p on p.id = d.driver_id
  where public.finanzas_puede_ver_documento(d.driver_id, d.tipo)
  order by d.creado_en desc, d.id;
$$;
revoke all on function public.listar_documentos_finanzas() from public, anon, authenticated;
grant execute on function public.listar_documentos_finanzas() to authenticated;

create or replace function public.enviar_documento_driver(
  p_tipo text, p_storage_path text, p_vigencia date
)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_driver uuid := auth.uid();
  v_rol text;
  v_estado text;
begin
  if v_driver is null then raise exception 'Debes iniciar sesión'; end if;
  select rol::text into v_rol from public.drivers where id = v_driver for update;
  if v_rol is null or v_rol not in ('driver', 'flotillero') then
    raise exception 'No tienes un perfil de driver o flotillero';
  end if;
  if p_tipo is null or p_tipo not in ('seguro', 'licencia', 'tarjeta', 'ine', 'domicilio', 'constancia_fiscal', 'estado_cuenta')
     or (p_tipo in ('constancia_fiscal', 'estado_cuenta') and v_rol <> 'flotillero')
     or (p_tipo in ('seguro', 'licencia', 'tarjeta', 'ine') and p_vigencia is null)
     or (p_tipo in ('domicilio', 'constancia_fiscal', 'estado_cuenta') and p_vigencia is not null) then
    raise exception 'Tipo o vigencia del documento invalido';
  end if;
  if p_storage_path is null or p_storage_path not like v_driver::text || '/' || p_tipo || '/%' then
    raise exception 'La ruta del archivo no corresponde a tu perfil y documento';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'driver-documents' and name = p_storage_path) then
    raise exception 'No se encontró el archivo en el almacenamiento privado';
  end if;
  if exists (select 1 from public.driver_documents where driver_id = v_driver and tipo = p_tipo and estado = 'pendiente') then
    raise exception 'Ya existe una actualización pendiente para este documento';
  end if;
  v_estado := case when exists (
    select 1 from public.driver_documents where driver_id = v_driver and tipo = p_tipo
  ) then 'pendiente' else 'aprobado' end;
  insert into public.driver_documents
    (driver_id, tipo, storage_path, vigencia, estado, origen, creado_en, resuelto_en, resuelto_por)
  values
    (v_driver, p_tipo, p_storage_path, p_vigencia, v_estado, 'driver', now(),
     case when v_estado = 'aprobado' then now() else null end, null);
  return v_estado;
end;
$$;
revoke all on function public.enviar_documento_driver(text, text, date) from public, anon, authenticated;
grant execute on function public.enviar_documento_driver(text, text, date) to authenticated;

create or replace function public.registrar_documento_flota(
  p_driver_id uuid, p_tipo text, p_storage_path text, p_vigencia date
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_rol text;
begin
  if auth.uid() is null or not public.puede_gestionar_documentos_driver() then
    raise exception 'Solo Operaciones puede importar documentos de Flota';
  end if;
  if p_tipo is null or p_tipo not in ('seguro', 'licencia', 'tarjeta', 'ine', 'domicilio', 'constancia_fiscal', 'estado_cuenta')
     or (p_tipo in ('seguro', 'licencia', 'tarjeta', 'ine') and p_vigencia is null)
     or (p_tipo in ('domicilio', 'constancia_fiscal', 'estado_cuenta') and p_vigencia is not null) then
    raise exception 'Tipo o vigencia del documento invalido';
  end if;
  select rol::text into v_rol from public.drivers where id = p_driver_id for update;
  if v_rol is null or v_rol not in ('driver', 'flotillero')
     or (p_tipo in ('constancia_fiscal', 'estado_cuenta') and v_rol <> 'flotillero') then
    raise exception 'El documento no corresponde a la categoria del afiliado';
  end if;
  if p_storage_path is null or p_storage_path not like p_driver_id::text || '/' || p_tipo || '/%' then
    raise exception 'La ruta del archivo no corresponde al driver y tipo seleccionados';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'driver-documents' and name = p_storage_path) then
    raise exception 'No se encontró el archivo en el almacenamiento privado';
  end if;
  update public.driver_documents
     set estado = 'reemplazado', resuelto_en = now(), resuelto_por = auth.uid()
   where driver_id = p_driver_id and tipo = p_tipo and estado = 'aprobado';
  insert into public.driver_documents
    (driver_id, tipo, storage_path, vigencia, estado, origen, creado_en, resuelto_en, resuelto_por)
  values (p_driver_id, p_tipo, p_storage_path, p_vigencia, 'aprobado', 'flota', now(), now(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resolver_documento_driver(p_id uuid, p_aprobar boolean, p_nota text default null)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_doc public.driver_documents%rowtype; v_driver_id uuid;
begin
  if auth.uid() is null or not public.puede_gestionar_documentos_driver() then
    raise exception 'Solo Operaciones puede resolver actualizaciones de documentos';
  end if;
  if p_aprobar is null then raise exception 'Indica si apruebas el documento'; end if;
  select driver_id into v_driver_id from public.driver_documents where id = p_id;
  if v_driver_id is null then raise exception 'La solicitud no existe o ya fue resuelta'; end if;
  perform 1 from public.drivers where id = v_driver_id for update;
  select * into v_doc from public.driver_documents where id = p_id and estado = 'pendiente' for update;
  if not found then raise exception 'La solicitud no existe o ya fue resuelta'; end if;
  if p_aprobar then
    update public.driver_documents set estado = 'reemplazado', resuelto_en = now(), resuelto_por = auth.uid()
      where driver_id = v_doc.driver_id and tipo = v_doc.tipo and estado = 'aprobado';
    update public.driver_documents set estado = 'aprobado', resuelto_en = now(), resuelto_por = auth.uid(), nota = null
      where id = p_id;
    return 'aprobado';
  end if;
  update public.driver_documents set estado = 'rechazado', resuelto_en = now(), resuelto_por = auth.uid(),
    nota = nullif(btrim(p_nota), '') where id = p_id;
  return 'rechazado';
end;
$$;
notify pgrst, 'reload schema';
commit;

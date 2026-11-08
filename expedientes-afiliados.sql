-- Ejecutar después de driver-documents-workflow.sql.
-- Conserva los documentos y sus estados anteriores.
-- Después de reinstalar, reaplica documentos-carga-y-finanzas.sql.
begin;

alter table public.driver_documents drop constraint if exists driver_documents_tipo_check;
alter table public.driver_documents add constraint driver_documents_tipo_check
  check (tipo in ('seguro', 'licencia', 'tarjeta', 'ine', 'domicilio', 'constancia_fiscal', 'estado_cuenta'));
alter table public.driver_documents alter column vigencia drop not null;
alter table public.driver_documents drop constraint if exists driver_documents_vigencia_tipo_check;
alter table public.driver_documents add constraint driver_documents_vigencia_tipo_check
  check ((tipo in ('domicilio', 'constancia_fiscal', 'estado_cuenta') and vigencia is null)
      or (tipo in ('seguro', 'licencia', 'tarjeta', 'ine') and vigencia is not null));

drop policy if exists driver_documents_driver_submit on public.driver_documents;
create policy driver_documents_driver_submit on public.driver_documents
  for insert to authenticated with check (
    driver_id = auth.uid() and estado = 'pendiente' and origen = 'driver'
    and storage_path like auth.uid()::text || '/' || tipo || '/%'
    and exists (select 1 from public.drivers d where d.id = auth.uid()
      and d.rol::text in ('driver', 'flotillero')
      and (tipo not in ('constancia_fiscal', 'estado_cuenta') or d.rol::text = 'flotillero'))
  );

create or replace function public.registrar_documento_flota(
  p_driver_id uuid, p_tipo text, p_storage_path text, p_vigencia date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.puede_gestionar_documentos_driver() then
    raise exception 'Solo Operaciones puede importar documentos de Flota';
  end if;
  if p_tipo is null or p_tipo not in ('seguro', 'licencia', 'tarjeta', 'ine', 'domicilio', 'constancia_fiscal', 'estado_cuenta')
     or (p_tipo in ('seguro', 'licencia', 'tarjeta', 'ine') and p_vigencia is null)
     or (p_tipo in ('domicilio', 'constancia_fiscal', 'estado_cuenta') and p_vigencia is not null) then
    raise exception 'Tipo o vigencia del documento invalido';
  end if;
  if not exists (select 1 from public.drivers d where d.id = p_driver_id
    and d.rol::text in ('driver', 'flotillero')
    and (p_tipo not in ('constancia_fiscal', 'estado_cuenta') or d.rol::text = 'flotillero')) then
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
revoke all on function public.registrar_documento_flota(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.registrar_documento_flota(uuid, text, text, date) to authenticated;

notify pgrst, 'reload schema';
commit;

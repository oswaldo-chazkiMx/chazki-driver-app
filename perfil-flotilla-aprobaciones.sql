-- BORRADOR INCOMPLETO: no ejecutar ni publicar todavía.
-- Requiere integrar y validar la aprobación de cambios de perfil y la interfaz.
-- Ejecutar después de documentos-carga-y-finanzas.sql y gestion-flotillas-supervisor.sql.
-- No elimina vehículos, documentos ni solicitudes.
begin;

create or replace function public.categoria_tarifaria_vehiculo(p_tipo text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select case p_tipo
    when 'Moto' then 'Moto'
    when 'Auto hatch' then 'Sedan'
    when 'Auto sedan' then 'Sedan'
    when 'Small van' then 'Small'
    when 'Large van' then 'Large'
    when '3.5T' then '3.5T'
    else null
  end;
$$;

alter table public.drivers
  add column if not exists emergencia_nombre text,
  add column if not exists emergencia_telefono text,
  add column if not exists emergencia_parentesco text;

create or replace function public.flotillero_administra_driver(p_driver_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.drivers titular
    join public.proveedores p on p.id = titular.proveedor_id and p.titular_id = titular.id
    join public.drivers d on d.proveedor_id = p.id
    where titular.id = auth.uid() and titular.rol = 'flotillero'
      and titular.estatus = 'activo' and p.tipo = 'flotillero' and p.activo
      and d.id = p_driver_id and d.rol = 'driver'
  );
$$;
revoke all on function public.flotillero_administra_driver(uuid) from public, anon, authenticated;
grant execute on function public.flotillero_administra_driver(uuid) to authenticated;

create or replace function public.perfil_driver_de_flotilla(p_driver_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare resultado jsonb;
begin
  if not public.flotillero_administra_driver(p_driver_id) then
    raise exception 'No tienes permiso para consultar este driver';
  end if;
  if (select count(*) from public.vehiculos where driver_id = p_driver_id and activo) > 1 then
    raise exception 'El driver tiene más de un vehículo activo; contacta a Operaciones';
  end if;
  select jsonb_build_object(
    'nombre', d.nombre, 'codigo', d.codigo, 'estatus', d.estatus,
    'telefono', d.telefono, 'correo_contacto', d.correo_contacto,
    'emergencia_nombre', d.emergencia_nombre, 'emergencia_telefono', d.emergencia_telefono,
    'emergencia_parentesco', d.emergencia_parentesco,
    'vehiculo', (select jsonb_build_object('placas', v.placas, 'tipo', v.tipo, 'marca_modelo', v.marca_modelo)
      from public.vehiculos v where v.driver_id = d.id and v.activo),
    'licencia', (select jsonb_build_object('numero', l.numero, 'tipo', l.tipo, 'vigencia', l.vigencia)
      from public.licencias l where l.driver_id = d.id)
  ) into resultado from public.drivers d where d.id = p_driver_id;
  return resultado;
end;
$$;
revoke all on function public.perfil_driver_de_flotilla(uuid) from public, anon, authenticated;
grant execute on function public.perfil_driver_de_flotilla(uuid) to authenticated;

drop policy if exists driver_documents_flotillero_read on public.driver_documents;
create policy driver_documents_flotillero_read on public.driver_documents for select to authenticated
  using (tipo in ('seguro','licencia','tarjeta','ine','domicilio')
    and public.flotillero_administra_driver(driver_id));

create or replace function public.flotillero_puede_ver_archivo(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.driver_documents d
    where d.storage_path = p_path and d.tipo in ('seguro','licencia','tarjeta','ine','domicilio')
      and public.flotillero_administra_driver(d.driver_id));
$$;
revoke all on function public.flotillero_puede_ver_archivo(text) from public, anon, authenticated;
grant execute on function public.flotillero_puede_ver_archivo(text) to authenticated;

drop policy if exists driver_documents_flotillero_storage_read on storage.objects;
create policy driver_documents_flotillero_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents' and public.flotillero_puede_ver_archivo(name));

-- El archivo permanece bajo la carpeta del driver para que conserve acceso a su expediente.
create or replace function public.flotillero_puede_subir_archivo(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select split_part(p_path, '/', 3) = 'flotilla'
    and split_part(p_path, '/', 4) = auth.uid()::text
    and split_part(p_path, '/', 2) in ('seguro','licencia','tarjeta','ine','domicilio')
    and exists (select 1 from public.drivers d
      where d.id::text = split_part(p_path, '/', 1)
        and public.flotillero_administra_driver(d.id));
$$;
revoke all on function public.flotillero_puede_subir_archivo(text) from public, anon, authenticated;
grant execute on function public.flotillero_puede_subir_archivo(text) to authenticated;

drop policy if exists driver_documents_flotillero_storage_insert on storage.objects;
create policy driver_documents_flotillero_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-documents' and public.flotillero_puede_subir_archivo(name));

create or replace function public.enviar_documento_flotillero(
  p_driver_id uuid, p_tipo text, p_storage_path text, p_vigencia date
) returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_estado text;
begin
  perform 1 from public.drivers where id = p_driver_id for update;
  if not public.flotillero_administra_driver(p_driver_id) then
    raise exception 'No tienes permiso para modificar documentos de este driver';
  end if;
  if p_tipo is null or p_tipo not in ('seguro','licencia','tarjeta','ine','domicilio')
     or (p_tipo = 'domicilio' and p_vigencia is not null)
     or (p_tipo <> 'domicilio' and p_vigencia is null) then
    raise exception 'Tipo o vigencia del documento invalido';
  end if;
  if p_storage_path is null or
     p_storage_path not like p_driver_id::text || '/' || p_tipo || '/flotilla/' || auth.uid()::text || '/%' then
    raise exception 'La ruta del archivo no corresponde a la flotilla y documento';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'driver-documents' and name = p_storage_path) then
    raise exception 'No se encontró el archivo en el almacenamiento privado';
  end if;
  if exists (select 1 from public.driver_documents where driver_id = p_driver_id and tipo = p_tipo and estado = 'pendiente') then
    raise exception 'Ya existe una actualización pendiente';
  end if;
  v_estado := case when exists (select 1 from public.driver_documents where driver_id = p_driver_id and tipo = p_tipo)
    then 'pendiente' else 'aprobado' end;
  insert into public.driver_documents(driver_id,tipo,storage_path,vigencia,estado,origen,resuelto_en)
  values(p_driver_id,p_tipo,p_storage_path,p_vigencia,v_estado,'driver',case when v_estado = 'aprobado' then now() end);
  return v_estado;
end;
$$;
revoke all on function public.enviar_documento_flotillero(uuid,text,text,date) from public, anon, authenticated;
grant execute on function public.enviar_documento_flotillero(uuid,text,text,date) to authenticated;

notify pgrst, 'reload schema';
commit;

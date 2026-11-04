begin;

create or replace function public.resolver_desactivacion_driver(
  p_id bigint,
  p_aprobar boolean,
  p_nota text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_solicitud public.bajas_solicitudes%rowtype;
  v_rol text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;

  select *
  into v_solicitud
  from public.bajas_solicitudes
  where id = p_id
  for update;

  if not found then
    raise exception 'No se encontró la solicitud';
  end if;
  if v_solicitud.estatus <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta';
  end if;

  select rol into v_rol
  from public.drivers
  where id = auth.uid();

  if p_aprobar then
    if v_rol = 'ih' then
      update public.bajas_solicitudes
      set aprob_supervisor = true
      where id = p_id;
    elsif v_rol in ('master', 'ops', 'coordinador') then
      update public.bajas_solicitudes
      set aprob_coord = true
      where id = p_id;
    else
      raise exception 'Tu rol no puede autorizar esta solicitud';
    end if;

    select * into v_solicitud
    from public.bajas_solicitudes
    where id = p_id;

    if v_solicitud.aprob_supervisor and v_solicitud.aprob_coord then
      update public.drivers
      set estatus = 'inactivo'
      where id = v_solicitud.driver_id;

      if not found then
        raise exception 'No se encontró el driver solicitado';
      end if;

      update public.bajas_solicitudes
      set estatus = 'aprobada', resuelto_en = now()
      where id = p_id;
      return 'desactivado';
    end if;

    return 'pendiente';
  end if;

  if coalesce(v_rol, '') not in ('ih', 'master', 'ops', 'coordinador') then
    raise exception 'Tu rol no puede rechazar esta solicitud';
  end if;
  update public.bajas_solicitudes
  set estatus = 'rechazada', resuelto_en = now()
  where id = p_id;
  return 'rechazada';
end;
$$;

create or replace function public.reactivar_driver(p_driver_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;

  update public.drivers
  set estatus = 'activo'
  where id = p_driver_id
    and lower(coalesce(estatus, '')) = 'inactivo'
    and proveedor_id in (
      select id
      from public.proveedores
      where titular_id = auth.uid()
    );

  if not found then
    raise exception 'No puedes reactivar este driver o no está inactivo';
  end if;
  return true;
end;
$$;

revoke all on function public.resolver_desactivacion_driver(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.resolver_desactivacion_driver(bigint, boolean, text) to authenticated;

revoke all on function public.reactivar_driver(uuid) from public, anon, authenticated;
grant execute on function public.reactivar_driver(uuid) to authenticated;

commit;

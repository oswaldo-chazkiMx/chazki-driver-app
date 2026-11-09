-- BORRADOR: no ejecutar ni publicar hasta integrar y probar todo el flujo.
begin;

create table if not exists private.coppel_peak_solicitudes_revision (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.drivers(id),
  lunes date not null,
  solicitado_por uuid not null references public.drivers(id),
  solicitado_en timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente','resuelta')),
  unique(driver_id,lunes)
);
revoke all on private.coppel_peak_solicitudes_revision from public, anon, authenticated;

create or replace function public.coppel_peak_solicitar_revision(
  p_driver_id uuid, p_lunes date
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_resultado jsonb;
  v_id bigint;
  v_destinatarios uuid[];
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' then
    raise exception 'Solo el supervisor autorizado puede solicitar la revisión';
  end if;
  v_resultado := public.coppel_peak_consultar_semana(p_driver_id,p_lunes);
  if v_resultado->>'estado' is distinct from 'requiere_revision' then
    raise exception 'La semana no requiere revisión por falta de alcance';
  end if;

  insert into private.coppel_peak_solicitudes_revision(driver_id,lunes,solicitado_por)
    values(p_driver_id,p_lunes,auth.uid())
    on conflict(driver_id,lunes) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from private.coppel_peak_solicitudes_revision
    where driver_id=p_driver_id and lunes=p_lunes and estado='pendiente';
    if v_id is null then
      raise exception 'Esta semana ya tiene una revisión resuelta; requiere seguimiento manual';
    end if;
    return v_id;
  end if;

  select array_agg(d.id order by d.id) into v_destinatarios
  from public.drivers d
  join auth.users u on u.id=d.id
  join public.staff_autorizados s on s.email=lower(u.email) and s.rol=d.rol::text
  where d.rol::text='coordinador' and lower(coalesce(d.estatus::text,''))='activo'
    and not exists (
      select 1 from private.coppel_peak_centros_semana(p_driver_id,p_lunes) c
      where not exists (
        select 1 from public.asignaciones_operativas a
        where a.cliente_id=c.cliente_id and a.cedis_id=c.cedis_id
          and a.coordinador_id=d.id
      )
    );
  if coalesce(cardinality(v_destinatarios),0)=0 then
    select array_agg(d.id order by d.id) into v_destinatarios
    from public.drivers d
    join auth.users u on u.id=d.id
    join public.staff_autorizados s on s.email=lower(u.email) and s.rol=d.rol::text
    where d.rol::text in ('ops','master') and lower(coalesce(d.estatus::text,''))='activo';
  end if;
  if coalesce(cardinality(v_destinatarios),0)=0 then
    raise exception 'No hay coordinación autorizada ni Operaciones disponibles para revisar el precierre';
  end if;
  insert into public.notificaciones(usuario,titulo,cuerpo,tipo,ref_tipo,ref_id)
    select u,'Revisión de precierre COPPEL',
      'Hay una solicitud de revisión semanal de COPPEL pendiente.',
      'coppel_peak_revision','coppel_peak_revision',v_id
    from unnest(v_destinatarios) as u;
  return v_id;
end;
$$;
revoke all on function public.coppel_peak_solicitar_revision(uuid,date) from public, anon;
grant execute on function public.coppel_peak_solicitar_revision(uuid,date) to authenticated;

create or replace function public.coppel_peak_listar_solicitudes()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_rol text;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Sin permiso para consultar solicitudes COPPEL';
  end if;
  v_rol := public.operativo_rol_actual();
  if v_rol is null or v_rol not in ('coordinador','ops','master') then
    raise exception 'Solo coordinación u Operaciones pueden consultar solicitudes COPPEL';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'driver_id',s.driver_id,'driver_nombre',d.nombre,
      'lunes',s.lunes,'solicitado_en',s.solicitado_en
    ) order by s.solicitado_en,s.id),'[]'::jsonb)
    from private.coppel_peak_solicitudes_revision s
    join public.drivers d on d.id=s.driver_id
    where s.estado='pendiente'
      and exists (select 1 from private.coppel_peak_centros_semana(s.driver_id,s.lunes))
      and (v_rol in ('ops','master') or not exists (
        select 1 from private.coppel_peak_centros_semana(s.driver_id,s.lunes) c
        where public.operativo_asignado_a(c.cliente_id,c.cedis_id,'coordinador') is not true
      ))
  );
end;
$$;
revoke all on function public.coppel_peak_listar_solicitudes() from public, anon;
grant execute on function public.coppel_peak_listar_solicitudes() to authenticated;

commit;

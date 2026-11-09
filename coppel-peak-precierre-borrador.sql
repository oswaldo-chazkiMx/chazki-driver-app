-- BORRADOR: no ejecutar ni publicar hasta integrar y probar todo el flujo.
-- Consulta de precierre; no aprueba bonos ni genera pagos.
begin;

create or replace function private.coppel_peak_centros_semana(
  p_driver_id uuid, p_lunes date
) returns table(cliente_id bigint,cedis_id bigint)
language sql stable set search_path = ''
as $$
  select ce.cliente_id,r.cedis_id
  from public.rutas r
  join public.cedis ce on ce.id=r.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  where r.driver_id=p_driver_id
    and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
    and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
  union
  select ce.cliente_id,c.cedis_id
  from public.cancelaciones c
  join public.cedis ce on ce.id=c.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  where c.driver_id=p_driver_id and c.estatus='aprobada'
    and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
    and (c.capturado_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
  union
  select ns.cliente_id,ns.cedis_id
  from public.no_show_casos ns
  where ns.driver_id=p_driver_id and ns.cuenta='COPPEL'
    and ns.fecha_servicio between p_lunes and p_lunes+6
    and ns.estado <> 'apelacion_aceptada'
$$;
revoke all on function private.coppel_peak_centros_semana(uuid,date) from public, anon, authenticated;

create or replace function public.coppel_peak_consultar_semana(
  p_driver_id uuid, p_lunes date
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rol text;
  v_actividad_accesible bigint;
  v_fuera_de_alcance boolean;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Sin permiso para consultar el precierre COPPEL';
  end if;
  v_rol := public.operativo_rol_actual();
  if v_rol is null or v_rol not in ('ih','coordinador','ops','master') then
    raise exception 'Sin permiso para consultar el precierre COPPEL';
  end if;
  if p_driver_id is null or p_lunes is null or extract(isodow from p_lunes) <> 1
    or p_lunes < date '2026-11-09' or p_lunes + 6 > date '2027-01-10' then
    raise exception 'Driver o semana COPPEL inválidos';
  end if;

  select count(*) filter (where x.accesible),
    coalesce(bool_or(not x.accesible),false)
  into v_actividad_accesible,v_fuera_de_alcance
  from (
    select v_rol in ('ops','master')
      or public.operativo_asignado_a(f.cliente_id,f.cedis_id,v_rol) is true as accesible
    from private.coppel_peak_centros_semana(p_driver_id,p_lunes) f
  ) x;
  if v_actividad_accesible=0 then
    raise exception 'Sin actividad COPPEL accesible para este driver y semana';
  end if;
  if v_fuera_de_alcance then
    return jsonb_build_object('estado','requiere_revision',
      'mensaje','Precierre incompleto: solicita revisión a coordinación con acceso completo o a Operaciones');
  end if;
  return jsonb_build_object('estado','completo',
    'resumen',private.coppel_peak_previsualizar_semana(p_driver_id,p_lunes));
end;
$$;
revoke all on function public.coppel_peak_consultar_semana(uuid,date) from public, anon;
grant execute on function public.coppel_peak_consultar_semana(uuid,date) to authenticated;

commit;

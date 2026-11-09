-- BORRADOR: solo calcula el plazo. No autoriza ni libera saldo retenido.
-- Reclamaciones, descuentos, permisos y concurrencia requieren validacion adicional.
begin;

create or replace function private.walmart_consultar_plazo(
  p_proveedor_id bigint,p_ahora timestamptz
) returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  v_ultima timestamptz;
  v_inciertas bigint;
begin
  if p_proveedor_id is null or p_ahora is null
    or not exists (select 1 from public.proveedores p where p.id=p_proveedor_id) then
    raise exception 'Se requieren proveedor y fecha validos para revisar la retencion';
  end if;
  if exists (
    select 1 from private.walmart_proveedores_confirmados w
    join public.liquidaciones l on l.ruta_id=w.ruta_id
    where l.cuenta='WALMART' and l.proveedor_id is distinct from w.proveedor_id
      and (w.proveedor_id=p_proveedor_id or l.proveedor_id=p_proveedor_id)
  ) then raise exception 'Hay rutas Walmart con proveedores historicos distintos; requiere revision'; end if;
  if exists (
    select 1 from public.rutas r
    where r.checkin_at is null and (
      exists (select 1 from private.walmart_proveedores_confirmados w where w.ruta_id=r.id and w.proveedor_id=p_proveedor_id)
      or exists (select 1 from public.liquidaciones l where l.ruta_id=r.id and l.cuenta='WALMART' and l.proveedor_id=p_proveedor_id)
    )
  ) then raise exception 'Hay rutas del proveedor sin fecha de inicio; requiere revision'; end if;
  if exists (
    select 1 from public.rutas r
    where r.checkout_at is not null and (r.checkout_at<r.checkin_at or r.checkout_at>p_ahora) and (
      exists (select 1 from private.walmart_proveedores_confirmados w where w.ruta_id=r.id and w.proveedor_id=p_proveedor_id)
      or exists (select 1 from public.liquidaciones l where l.ruta_id=r.id and l.cuenta='WALMART' and l.proveedor_id=p_proveedor_id)
    )
  ) then raise exception 'Hay rutas del proveedor con fecha de cierre invalida; requiere revision'; end if;
  select max(x.checkout_at) into v_ultima from (
    select r.checkout_at from private.walmart_proveedores_confirmados w
      join public.rutas r on r.id=w.ruta_id
      join public.cedis ce on ce.id=r.cedis_id
      join public.clientes cl on cl.id=ce.cliente_id
      where w.proveedor_id=p_proveedor_id and public.operativo_normalizar(cl.nombre)='walmart'
    union all
    select r.checkout_at from public.liquidaciones l
      join public.rutas r on r.id=l.ruta_id
      join public.cedis ce on ce.id=r.cedis_id
      join public.clientes cl on cl.id=ce.cliente_id
      where l.proveedor_id=p_proveedor_id and l.cuenta='WALMART'
        and public.operativo_normalizar(cl.nombre)='walmart'
  ) x;
  select count(*) into v_inciertas
  from public.rutas r
  join public.cedis ce on ce.id=r.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  where public.operativo_normalizar(cl.nombre)='walmart' and (
    (r.checkout_at is null and (
      exists (select 1 from private.walmart_proveedores_confirmados w where w.ruta_id=r.id and w.proveedor_id=p_proveedor_id)
      or exists (select 1 from public.liquidaciones l where l.ruta_id=r.id and l.cuenta='WALMART' and l.proveedor_id=p_proveedor_id)
    ))
    or ((r.checkin_at is null or r.checkout_at is null or v_ultima is null or r.checkout_at>v_ultima)
      and not exists (select 1 from private.walmart_proveedores_confirmados w where w.ruta_id=r.id)
      and not exists (select 1 from public.liquidaciones l where l.ruta_id=r.id
        and l.cuenta='WALMART' and l.proveedor_id is not null))
  );
  if v_ultima is null and v_inciertas=0 then
    return jsonb_build_object('estado','sin_ruta_confirmada','ultima_ruta',null,
      'disponible_desde',null,'plazo_cumplido',false,'liberacion_validada',false);
  end if;
  return jsonb_build_object(
    'estado',case when v_inciertas>0 then 'requiere_revision' else 'calculado' end,
    'ultima_ruta',v_ultima,'disponible_desde',v_ultima+interval '30 days',
    'plazo_cumplido',v_inciertas=0 and v_ultima is not null and p_ahora>=v_ultima+interval '30 days',
    'rutas_sin_proveedor',v_inciertas,'liberacion_validada',false
  );
end;
$$;
revoke all on function private.walmart_consultar_plazo(bigint,timestamptz) from public, anon, authenticated;

commit;

-- BORRADOR: no ejecutar ni publicar. No aplica descuentos ni genera pagos.
begin;

create or replace function private.postval_actividad_confirmada(
  p_proveedor_id bigint,p_lunes date
) returns table(driver_id uuid,cliente_id bigint,cedis_id bigint)
language plpgsql stable set search_path = ''
as $$
begin
  if p_proveedor_id is null or p_lunes is null or extract(isodow from p_lunes)<>1 then
    raise exception 'Se requiere proveedor y lunes validos';
  end if;
  return query
    select r.driver_id,ce.cliente_id,r.cedis_id
    from public.liquidaciones l
    join public.rutas r on r.id=l.ruta_id
    join public.cedis ce on ce.id=r.cedis_id
    where l.proveedor_id=p_proveedor_id
      and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
    union
    select ca.driver_id,ce.cliente_id,c.cedis_id
    from private.coppel_peak_cancelaciones ca
    join public.cancelaciones c on c.id=ca.cancelacion_id
    join public.cedis ce on ce.id=c.cedis_id
    where ca.proveedor_id=p_proveedor_id and ca.lunes=p_lunes;
  if to_regclass('private.walmart_proveedores_confirmados') is not null then
    return query execute $query$
      select r.driver_id,ce.cliente_id,r.cedis_id
      from private.walmart_proveedores_confirmados w
      join public.rutas r on r.id=w.ruta_id
      join public.cedis ce on ce.id=r.cedis_id
      where w.proveedor_id=$1
        and (r.checkin_at at time zone 'America/Mexico_City')::date between $2 and $2+6
    $query$ using p_proveedor_id,p_lunes;
  end if;
  if to_regclass('private.walmart_cancelaciones_pagadas') is not null then
    return query execute $query$
      select w.driver_id,ce.cliente_id,c.cedis_id
      from private.walmart_cancelaciones_pagadas w
      join public.cancelaciones c on c.id=w.cancelacion_id
      join public.cedis ce on ce.id=c.cedis_id
      where w.proveedor_id=$1
        and (c.capturado_at at time zone 'America/Mexico_City')::date between $2 and $2+6
    $query$ using p_proveedor_id,p_lunes;
  end if;
end;
$$;
revoke all on function private.postval_actividad_confirmada(bigint,date) from public, anon, authenticated;

create or replace function public.coppel_postval_resumen_pnr(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_concepto private.postvalorizaciones_coppel%rowtype;
  v_precierre jsonb;
  v_rol text;
  v_total numeric;
  v_cantidad bigint;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Sin permiso para consultar los PNR del proveedor';
  end if;
  v_rol:=public.operativo_rol_actual();
  if v_rol is null or v_rol not in ('ih','coordinador') then
    raise exception 'Solo el supervisor o coordinador asignado pueden consultar los PNR';
  end if;
  select * into v_concepto from private.postvalorizaciones_coppel where id=p_id;
  if not found then raise exception 'No se encontro la post valorizacion'; end if;
  v_precierre:=public.coppel_peak_consultar_precierre(v_concepto.driver_contexto,v_concepto.lunes);
  if v_precierre->>'estado' not in ('completo','cerrada') or v_precierre->>'estado' is null then
    raise exception 'Se requiere acceso completo a la semana COPPEL';
  end if;
  if not exists (
    select 1 from private.postval_actividad_confirmada(v_concepto.proveedor_id,v_concepto.lunes)
  ) or exists (
    select 1 from private.postval_actividad_confirmada(v_concepto.proveedor_id,v_concepto.lunes) a
    where public.operativo_asignado_a(a.cliente_id,a.cedis_id,v_rol) is not true
  ) then raise exception 'Se requiere acceso a todos los CEDIS de la actividad confirmada del proveedor'; end if;
  select count(*),coalesce(sum(d.saldo_pendiente),0)
    into v_cantidad,v_total from public.pnr_descuentos d
    where d.saldo_pendiente>0 and d.driver_id in (
      select distinct a.driver_id
      from private.postval_actividad_confirmada(v_concepto.proveedor_id,v_concepto.lunes) a
    );
  return jsonb_build_object(
    'proveedor_id',v_concepto.proveedor_id,'lunes',v_concepto.lunes,
    'reclamos_pendientes',v_cantidad,'saldo_pendiente',v_total,
    'alcance','actividad_confirmada','requiere_revision_fuentes',true
  );
end;
$$;
revoke all on function public.coppel_postval_resumen_pnr(uuid) from public, anon;
grant execute on function public.coppel_postval_resumen_pnr(uuid) to authenticated;

commit;

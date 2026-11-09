-- BORRADOR INCOMPLETO: no ejecutar ni publicar.
-- No aplica pagos ni detecta automáticamente eventos tardíos.
begin;

create table if not exists private.coppel_peak_ajustes (
  id uuid primary key,
  driver_id uuid not null references public.drivers(id),
  lunes_origen date not null,
  proveedor_id bigint not null references public.proveedores(id),
  tipo text not null check (tipo in ('descuento','abono')),
  monto_base numeric(12,2) not null check (monto_base>0),
  motivo text not null,
  origen_tipo text not null check (origen_tipo in ('manual','ruta','cancelacion','no_show')),
  origen_id text,
  origen_cliente_id bigint references public.clientes(id),
  origen_cedis_id bigint references public.cedis(id),
  creado_por uuid not null references public.drivers(id),
  creado_en timestamptz not null default now(),
  estado text not null default 'pendiente_revision' check (estado in ('pendiente_revision','autorizado')),
  autorizado_por uuid references public.drivers(id),
  autorizado_en timestamptz,
  permitir_otras_cuentas boolean,
  foreign key (driver_id,lunes_origen) references private.coppel_peak_cierres(driver_id,lunes),
  check ((origen_tipo='manual' and origen_id is null and origen_cliente_id is null and origen_cedis_id is null)
    or (origen_tipo<>'manual' and origen_id is not null and origen_cliente_id is not null and origen_cedis_id is not null)),
  check ((estado='pendiente_revision' and autorizado_por is null and autorizado_en is null and permitir_otras_cuentas is null)
    or (estado='autorizado' and autorizado_por is not null and autorizado_en is not null and permitir_otras_cuentas is not null))
);
revoke all on private.coppel_peak_ajustes from public, anon, authenticated;

create table if not exists private.coppel_peak_ajustes_destinos (
  ajuste_id uuid not null references private.coppel_peak_ajustes(id),
  cliente_id bigint not null references public.clientes(id),
  cedis_id bigint not null references public.cedis(id),
  autorizado_por uuid not null references public.drivers(id),
  rol_autorizador text not null check (rol_autorizador in ('coordinador','ops','master','finanzas')),
  autorizado_en timestamptz not null default now(),
  primary key (ajuste_id,cedis_id)
);
revoke all on private.coppel_peak_ajustes_destinos from public, anon, authenticated;

create or replace function public.coppel_peak_proponer_ajuste(
  p_id uuid,p_driver_id uuid,p_lunes date,p_proveedor_id bigint,
  p_tipo text,p_monto_base numeric,p_motivo text,p_origen_tipo text,p_origen_id text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_consulta jsonb;
  v_anterior private.coppel_peak_ajustes%rowtype;
  v_motivo text;
  v_origen_cliente bigint;
  v_origen_cedis bigint;
  v_origen_proveedor bigint;
  v_cantidad_proveedores bigint;
  v_rol text;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is null
    or public.operativo_rol_actual() not in ('ih','coordinador','ops','master') then
    raise exception 'Sin permiso para proponer ajustes COPPEL';
  end if;
  v_motivo:=btrim(p_motivo);
  if p_id is null or p_driver_id is null or p_lunes is null or p_proveedor_id is null
    or p_tipo is null or p_tipo not in ('descuento','abono')
    or p_monto_base is null or p_monto_base::text in ('NaN','Infinity','-Infinity')
    or p_monto_base<=0 or p_monto_base>9999999999.99 or p_monto_base<>round(p_monto_base,2)
    or p_origen_tipo is null or p_origen_tipo not in ('manual','ruta','cancelacion','no_show')
    or (p_origen_tipo='manual' and p_origen_id is not null)
    or (p_origen_tipo<>'manual' and p_origen_id is null)
    or v_motivo is null or length(v_motivo)<5 or length(v_motivo)>1000 then
    raise exception 'Datos inválidos para proponer el ajuste COPPEL';
  end if;
  perform private.coppel_peak_bloqueo_semana(p_driver_id,p_lunes);
  v_consulta:=public.coppel_peak_consultar_semana(p_driver_id,p_lunes);
  if v_consulta->>'estado' is distinct from 'cerrada' then
    raise exception 'Se requiere acceso completo a la semana COPPEL cerrada';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_consulta->'precierre'->'rutas') r
    where nullif(r->>'proveedor_id','')::bigint=p_proveedor_id
    union all
    select 1 from jsonb_array_elements(v_consulta->'precierre'->'cancelaciones') c
    where nullif(c->>'proveedor_id','')::bigint=p_proveedor_id
  ) then raise exception 'El proveedor no figura en la semana COPPEL cerrada; requiere revisión'; end if;
  v_rol:=public.operativo_rol_actual();
  if p_origen_tipo='ruta' and not exists (
    select 1 from public.rutas r join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id::text=p_origen_id and r.driver_id=p_driver_id
      and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
      and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
  ) then raise exception 'La ruta no pertenece a la semana COPPEL indicada'; end if;
  if p_origen_tipo='cancelacion' and not exists (
    select 1 from public.cancelaciones c join public.cedis ce on ce.id=c.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where c.id::text=p_origen_id and c.driver_id=p_driver_id and c.estatus='aprobada'
      and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
      and (c.capturado_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
  ) then raise exception 'La cancelación no pertenece a la semana COPPEL indicada'; end if;
  if p_origen_tipo='no_show' and not exists (
    select 1 from public.no_show_casos ns
    where ns.id::text=p_origen_id and ns.driver_id=p_driver_id and ns.cuenta='COPPEL'
      and ns.fecha_servicio between p_lunes and p_lunes+6
  ) then raise exception 'El NO SHOW no pertenece a la semana COPPEL indicada'; end if;
  if p_origen_tipo='ruta' then
    select ce.cliente_id,r.cedis_id into v_origen_cliente,v_origen_cedis
    from public.rutas r join public.cedis ce on ce.id=r.cedis_id where r.id::text=p_origen_id;
  elsif p_origen_tipo='cancelacion' then
    select ce.cliente_id,c.cedis_id into v_origen_cliente,v_origen_cedis
    from public.cancelaciones c join public.cedis ce on ce.id=c.cedis_id where c.id::text=p_origen_id;
  elsif p_origen_tipo='no_show' then
    select ns.cliente_id,ns.cedis_id,ns.proveedor_id into v_origen_cliente,v_origen_cedis,v_origen_proveedor
    from public.no_show_casos ns where ns.id::text=p_origen_id;
    if v_origen_proveedor is distinct from p_proveedor_id then
      raise exception 'El proveedor del NO SHOW no coincide con el ajuste';
    end if;
  end if;
  if p_origen_tipo<>'manual' and (v_origen_cliente is null or v_origen_cedis is null
    or (v_rol in ('ih','coordinador')
      and public.operativo_asignado_a(v_origen_cliente,v_origen_cedis,v_rol) is not true)) then
    raise exception 'Sin acceso al CEDIS del origen del ajuste';
  end if;
  if p_origen_tipo in ('ruta','cancelacion') then
    select nullif(x->>'proveedor_id','')::bigint into v_origen_proveedor
    from jsonb_array_elements(case when p_origen_tipo='ruta' then v_consulta->'precierre'->'rutas'
      else v_consulta->'precierre'->'cancelaciones' end) x
    where x->>case when p_origen_tipo='ruta' then 'ruta_id' else 'cancelacion_id' end=p_origen_id
    limit 1;
    if found then
      if v_origen_proveedor is distinct from p_proveedor_id then
        raise exception 'El proveedor del origen no coincide con la semana cerrada';
      end if;
    else
      select count(distinct x.proveedor_id) into v_cantidad_proveedores from (
        select nullif(r->>'proveedor_id','')::bigint as proveedor_id
        from jsonb_array_elements(v_consulta->'precierre'->'rutas') r
        union all
        select nullif(c->>'proveedor_id','')::bigint
        from jsonb_array_elements(v_consulta->'precierre'->'cancelaciones') c
      ) x where x.proveedor_id is not null;
      if v_cantidad_proveedores<>1 then
        raise exception 'La semana tiene proveedores ambiguos; revisa el origen antes de ajustar';
      end if;
    end if;
  end if;

  insert into private.coppel_peak_ajustes(id,driver_id,lunes_origen,proveedor_id,tipo,monto_base,motivo,origen_tipo,origen_id,origen_cliente_id,origen_cedis_id,creado_por)
  values(p_id,p_driver_id,p_lunes,p_proveedor_id,p_tipo,p_monto_base,v_motivo,p_origen_tipo,p_origen_id,v_origen_cliente,v_origen_cedis,auth.uid())
  on conflict (id) do nothing;
  select * into v_anterior from private.coppel_peak_ajustes where id=p_id;
  if v_anterior.driver_id is distinct from p_driver_id or v_anterior.lunes_origen is distinct from p_lunes
    or v_anterior.proveedor_id is distinct from p_proveedor_id or v_anterior.tipo is distinct from p_tipo
    or v_anterior.monto_base is distinct from p_monto_base or v_anterior.motivo is distinct from v_motivo
    or v_anterior.origen_tipo is distinct from p_origen_tipo or v_anterior.origen_id is distinct from p_origen_id
    or v_anterior.origen_cliente_id is distinct from v_origen_cliente or v_anterior.origen_cedis_id is distinct from v_origen_cedis
    or v_anterior.creado_por is distinct from auth.uid() then
    raise exception 'El identificador del ajuste ya corresponde a otra solicitud';
  end if;
  return to_jsonb(v_anterior);
end;
$$;
revoke all on function public.coppel_peak_proponer_ajuste(uuid,uuid,date,bigint,text,numeric,text,text,text) from public, anon;
grant execute on function public.coppel_peak_proponer_ajuste(uuid,uuid,date,bigint,text,numeric,text,text,text) to authenticated;

create or replace function public.coppel_peak_autorizar_ajuste(
  p_id uuid,p_permitir_otras_cuentas boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_ajuste private.coppel_peak_ajustes%rowtype;
  v_consulta jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'coordinador' then
    raise exception 'Solo coordinación puede autorizar ajustes COPPEL';
  end if;
  if p_id is null or p_permitir_otras_cuentas is null then
    raise exception 'Indica si el ajuste puede aplicarse a otras cuentas';
  end if;
  select * into v_ajuste from private.coppel_peak_ajustes where id=p_id;
  if not found then raise exception 'No se encontró el ajuste COPPEL'; end if;
  perform private.coppel_peak_bloqueo_semana(v_ajuste.driver_id,v_ajuste.lunes_origen);
  v_consulta:=public.coppel_peak_consultar_semana(v_ajuste.driver_id,v_ajuste.lunes_origen);
  if v_consulta->>'estado' is distinct from 'cerrada' then
    raise exception 'Se requiere acceso completo a la semana COPPEL cerrada';
  end if;
  if v_ajuste.origen_tipo<>'manual'
    and public.operativo_asignado_a(v_ajuste.origen_cliente_id,v_ajuste.origen_cedis_id,'coordinador') is not true then
    raise exception 'Sin acceso al CEDIS del origen del ajuste';
  end if;
  select * into v_ajuste from private.coppel_peak_ajustes where id=p_id for update;
  if v_ajuste.estado='autorizado' then
    if v_ajuste.permitir_otras_cuentas is distinct from p_permitir_otras_cuentas then
      raise exception 'El ajuste ya fue autorizado con otra condición';
    end if;
    return to_jsonb(v_ajuste);
  end if;
  update private.coppel_peak_ajustes
  set estado='autorizado',autorizado_por=auth.uid(),autorizado_en=now(),
      permitir_otras_cuentas=p_permitir_otras_cuentas
  where id=p_id returning * into v_ajuste;
  return to_jsonb(v_ajuste);
end;
$$;
revoke all on function public.coppel_peak_autorizar_ajuste(uuid,boolean) from public, anon;
grant execute on function public.coppel_peak_autorizar_ajuste(uuid,boolean) to authenticated;

create or replace function public.coppel_peak_autorizar_destino_ajuste(
  p_ajuste_id uuid,p_cedis_id bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_rol text;
  v_ajuste private.coppel_peak_ajustes%rowtype;
  v_destino private.coppel_peak_ajustes_destinos%rowtype;
  v_cliente_id bigint;
  v_consulta jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Sin permiso para autorizar el destino del ajuste COPPEL';
  end if;
  v_rol:=public.operativo_rol_actual();
  if v_rol is null or v_rol not in ('coordinador','ops','master','finanzas') then
    raise exception 'Sin permiso para autorizar el destino del ajuste COPPEL';
  end if;
  if p_ajuste_id is null or p_cedis_id is null then
    raise exception 'Indica el ajuste y el CEDIS de destino';
  end if;
  select * into v_ajuste from private.coppel_peak_ajustes where id=p_ajuste_id;
  if not found then raise exception 'No se encontró el ajuste COPPEL'; end if;
  perform private.coppel_peak_bloqueo_semana(v_ajuste.driver_id,v_ajuste.lunes_origen);
  select * into v_ajuste from private.coppel_peak_ajustes where id=p_ajuste_id for update;
  if v_ajuste.estado<>'autorizado' or v_ajuste.permitir_otras_cuentas is not true then
    raise exception 'El ajuste no está autorizado para otras cuentas';
  end if;
  select ce.cliente_id into v_cliente_id
  from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
  where ce.id=p_cedis_id and ce.activo and cl.activo
    and public.operativo_normalizar(cl.nombre) not in ('coppel','coppelbt');
  if v_cliente_id is null then raise exception 'El CEDIS de destino no pertenece a otra cuenta activa'; end if;
  if v_rol='coordinador' then
    v_consulta:=public.coppel_peak_consultar_semana(v_ajuste.driver_id,v_ajuste.lunes_origen);
    if v_consulta->>'estado' is distinct from 'cerrada'
      or public.operativo_asignado_a(v_cliente_id,p_cedis_id,'coordinador') is not true
      or (v_ajuste.origen_tipo<>'manual'
        and public.operativo_asignado_a(v_ajuste.origen_cliente_id,v_ajuste.origen_cedis_id,'coordinador') is not true) then
      raise exception 'Coordinación requiere acceso al origen y al destino del ajuste';
    end if;
  end if;
  insert into private.coppel_peak_ajustes_destinos(ajuste_id,cliente_id,cedis_id,autorizado_por,rol_autorizador)
  values(p_ajuste_id,v_cliente_id,p_cedis_id,auth.uid(),v_rol)
  on conflict (ajuste_id,cedis_id) do nothing;
  select * into v_destino from private.coppel_peak_ajustes_destinos
  where ajuste_id=p_ajuste_id and cedis_id=p_cedis_id;
  if v_destino.cliente_id is distinct from v_cliente_id then
    raise exception 'El cliente del CEDIS de destino cambió; requiere revisión';
  end if;
  return to_jsonb(v_destino);
end;
$$;
revoke all on function public.coppel_peak_autorizar_destino_ajuste(uuid,bigint) from public, anon;
grant execute on function public.coppel_peak_autorizar_destino_ajuste(uuid,bigint) to authenticated;

create or replace function public.coppel_peak_listar_ajustes()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_rol text;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Sin permiso para consultar ajustes COPPEL';
  end if;
  v_rol:=public.operativo_rol_actual();
  if v_rol is null or v_rol not in ('coordinador','ops','master','finanzas') then
    raise exception 'Solo coordinación, Operaciones o Finanzas pueden consultar ajustes COPPEL';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('destinos',(
      select coalesce(jsonb_agg(to_jsonb(d) order by d.cedis_id),'[]'::jsonb)
      from private.coppel_peak_ajustes_destinos d
      where d.ajuste_id=a.id and (v_rol in ('ops','master','finanzas')
        or public.operativo_asignado_a(d.cliente_id,d.cedis_id,'coordinador') is true)
    )) order by a.creado_en,a.id),'[]'::jsonb)
    from private.coppel_peak_ajustes a
    join private.coppel_peak_cierres c on c.driver_id=a.driver_id and c.lunes=a.lunes_origen
    where jsonb_array_length(c.centros)>0
      and (v_rol<>'finanzas' or (a.estado='autorizado' and a.permitir_otras_cuentas is true))
      and (v_rol in ('ops','master','finanzas') or not exists (
        select 1 from jsonb_to_recordset(c.centros) as ce(cliente_id bigint,cedis_id bigint)
        where public.operativo_asignado_a(ce.cliente_id,ce.cedis_id,'coordinador') is not true
      ))
      and (v_rol in ('ops','master','finanzas') or a.origen_tipo='manual'
        or public.operativo_asignado_a(a.origen_cliente_id,a.origen_cedis_id,'coordinador') is true)
  );
end;
$$;
revoke all on function public.coppel_peak_listar_ajustes() from public, anon;
grant execute on function public.coppel_peak_listar_ajustes() to authenticated;

commit;

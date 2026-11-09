-- BORRADOR: no activar sin pruebas reales de permisos y concurrencia.
-- Depende de walmart-no-show-borrador.sql y el mapeo de tarifas Walmart.
begin;

create or replace function private.walmart_semana_no_show(p_registrado timestamptz)
returns date language plpgsql immutable set search_path = ''
as $$
declare
  v_local timestamp;
  v_viernes date;
begin
  if p_registrado is null then raise exception 'Se requiere la fecha de registro del NO SHOW'; end if;
  v_local:=p_registrado at time zone 'America/Mexico_City';
  v_viernes:=v_local::date + ((5-extract(isodow from v_local)::integer+7)%7);
  if extract(isodow from v_local)=5 and v_local::time>=time '12:00' then
    v_viernes:=v_viernes+7;
  end if;
  return v_viernes-4;
end;
$$;
revoke all on function private.walmart_semana_no_show(timestamptz) from public, anon, authenticated;

create table if not exists private.walmart_no_show_reportes (
  caso_id uuid primary key references public.no_show_casos(id),
  solicitud_id uuid not null unique,
  proveedor_id bigint not null references public.proveedores(id),
  opcion smallint not null check (opcion in (1,2)),
  calculo jsonb not null,
  creado_por uuid not null references public.drivers(id),
  creado_en timestamptz not null default clock_timestamp()
);
alter table private.walmart_no_show_reportes
  alter column creado_en set default clock_timestamp(),
  add column if not exists semana_no_show date
    generated always as (private.walmart_semana_no_show(creado_en)) stored;
revoke all on private.walmart_no_show_reportes from public, anon, authenticated;

create or replace function private.walmart_no_show_impedir_reporte_legacy()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if public.operativo_normalizar(new.cuenta)='walmart' and new.metodo_calculo is distinct from 'walmart_60_saldo' then
    raise exception 'El NO SHOW Walmart requiere la captura del tarifario Walmart';
  end if;
  return new;
end;
$$;
revoke all on function private.walmart_no_show_impedir_reporte_legacy() from public, anon, authenticated;
drop trigger if exists walmart_no_show_impedir_reporte_legacy on public.no_show_casos;
create trigger walmart_no_show_impedir_reporte_legacy before insert on public.no_show_casos
for each row execute function private.walmart_no_show_impedir_reporte_legacy();

create or replace function private.walmart_no_show_impedir_reversion_legacy()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.metodo_calculo='walmart_60_saldo'
    and new.pago_reversion_id is distinct from old.pago_reversion_id then
    raise exception 'La apelacion Walmart requiere su resolucion sin ajuste duplicado';
  end if;
  return new;
end;
$$;
revoke all on function private.walmart_no_show_impedir_reversion_legacy() from public, anon, authenticated;
drop trigger if exists walmart_no_show_impedir_reversion_legacy on public.no_show_casos;
create trigger walmart_no_show_impedir_reversion_legacy before update on public.no_show_casos
for each row execute function private.walmart_no_show_impedir_reversion_legacy();

create or replace function private.walmart_no_show_bloquear(p_proveedor_id bigint,p_driver_id uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  if p_proveedor_id is null or p_driver_id is null then
    raise exception 'Se requieren proveedor y driver para NO SHOW Walmart';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('walmart-no-show-proveedor:'||p_proveedor_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('walmart-no-show-driver:'||p_driver_id::text,0)
  );
end;
$$;
revoke all on function private.walmart_no_show_bloquear(bigint,uuid) from public, anon, authenticated;

create or replace function public.walmart_previsualizar_no_show(
  p_cedis_id bigint,p_fecha date,p_unidad text,p_proveedor_id bigint,p_opcion smallint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_cliente_id bigint;
begin
  if auth.uid() is null or public.no_show_es_supervisor() is not true
    or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede revisar NO SHOW Walmart';
  end if;
  select ce.cliente_id into v_cliente_id from public.cedis ce
    join public.clientes cl on cl.id=ce.cliente_id
    where ce.id=p_cedis_id and public.operativo_normalizar(cl.nombre)='walmart';
  if v_cliente_id is null or public.operativo_asignado_a(v_cliente_id,p_cedis_id,'ih') is not true
    or not exists (select 1 from public.proveedores p where p.id=p_proveedor_id)
    or p_fecha is null or p_fecha>(now() at time zone 'America/Mexico_City')::date then
    raise exception 'Confirma CEDIS asignado, proveedor y fecha valida';
  end if;
  return private.calcular_walmart_no_show_configurado(p_cedis_id,p_fecha,p_unidad,p_opcion)
    ||jsonb_build_object('proveedor_id',p_proveedor_id,'fecha_servicio',p_fecha);
end;
$$;
revoke all on function public.walmart_previsualizar_no_show(bigint,date,text,bigint,smallint) from public, anon;
grant execute on function public.walmart_previsualizar_no_show(bigint,date,text,bigint,smallint) to authenticated;

create or replace function public.walmart_crear_no_show(
  p_solicitud_id uuid,p_driver_id uuid,p_cedis_id bigint,p_fecha date,p_unidad text,
  p_proveedor_id bigint,p_opcion smallint,p_observaciones text,p_calculo_esperado jsonb
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_calculo jsonb;
  v_existente record;
  v_driver record;
  v_cedis record;
  v_tarifa bigint;
  v_caso uuid;
begin
  if p_solicitud_id is null or p_driver_id is null or p_observaciones is null
    or length(btrim(p_observaciones)) not between 1 and 200
    or public.no_show_texto_inapropiado(p_observaciones)
    or jsonb_typeof(p_calculo_esperado) is distinct from 'object' then
    raise exception 'Completa driver, observaciones y calculo revisado';
  end if;
  v_calculo:=public.walmart_previsualizar_no_show(p_cedis_id,p_fecha,p_unidad,p_proveedor_id,p_opcion);
  if v_calculo is distinct from p_calculo_esperado then
    raise exception 'El calculo NO SHOW cambio; vuelve a revisarlo';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('walmart-no-show-solicitud:'||p_solicitud_id::text,0));
  perform private.walmart_no_show_bloquear(p_proveedor_id,p_driver_id);
  select c.id,c.driver_id,c.cedis_id,c.fecha_servicio,c.tipo_unidad,c.observaciones_supervisor,
    r.proveedor_id,r.opcion,r.calculo,r.creado_por into v_existente
  from private.walmart_no_show_reportes r join public.no_show_casos c on c.id=r.caso_id
  where r.solicitud_id=p_solicitud_id;
  if found then
    if v_existente.driver_id is distinct from p_driver_id or v_existente.cedis_id is distinct from p_cedis_id
      or v_existente.fecha_servicio is distinct from p_fecha
      or v_existente.tipo_unidad is distinct from v_calculo->>'tipo_unidad'
      or v_existente.observaciones_supervisor is distinct from btrim(p_observaciones)
      or v_existente.proveedor_id is distinct from p_proveedor_id or v_existente.opcion is distinct from p_opcion
      or v_existente.calculo is distinct from v_calculo or v_existente.creado_por is distinct from auth.uid() then
      raise exception 'La solicitud NO SHOW ya fue utilizada con otros datos';
    end if;
    return v_existente.id;
  end if;
  select d.id,d.nombre into v_driver from public.drivers d where d.id=p_driver_id and d.rol='driver';
  if not found then raise exception 'El driver seleccionado no existe'; end if;
  select ce.id,ce.nombre,ce.cliente_id,cl.nombre as cliente_nombre into v_cedis
    from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id where ce.id=p_cedis_id;
  select m.tarifa_id into v_tarifa from private.walmart_tarifas_mapeo m
    join public.tarifas t on t.id=m.tarifa_id
    where m.walmart_tarifa_id=(v_calculo->>'tarifa_id')::bigint and t.cuenta='WALMART' and t.activo;
  if not found then raise exception 'Falta la tarifa Walmart vinculada para el reporte'; end if;
  insert into public.no_show_casos(
    driver_id,proveedor_id,cliente_id,cedis_id,cliente_nombre,cedis_nombre,driver_nombre,
    cuenta,tipo_unidad,fecha_servicio,tarifa_servicio_id,valor_servicio_contratado,
    metodo_calculo,observaciones_supervisor,monto_penalizacion,creado_por
  ) values (
    p_driver_id,p_proveedor_id,v_cedis.cliente_id,p_cedis_id,v_cedis.cliente_nombre,v_cedis.nombre,
    v_driver.nombre,'WALMART',v_calculo->>'tipo_unidad',p_fecha,v_tarifa,
    (v_calculo->>'base_servicio')::numeric,'walmart_60_saldo',btrim(p_observaciones),
    (v_calculo->>'monto_penalizacion')::numeric,auth.uid()
  ) returning id into v_caso;
  insert into private.walmart_no_show_reportes(caso_id,solicitud_id,proveedor_id,opcion,calculo,creado_por)
    values(v_caso,p_solicitud_id,p_proveedor_id,p_opcion,v_calculo,auth.uid());
  insert into public.no_show_eventos(caso_id,tipo,mensaje,actor_id)
    values(v_caso,'reportado',btrim(p_observaciones),auth.uid());
  return v_caso;
end;
$$;
revoke all on function public.walmart_crear_no_show(uuid,uuid,bigint,date,text,bigint,smallint,text,jsonb) from public, anon;
grant execute on function public.walmart_crear_no_show(uuid,uuid,bigint,date,text,bigint,smallint,text,jsonb) to authenticated;

create or replace function private.walmart_preparar_no_show(p_proveedor_id bigint,p_driver_id uuid)
returns void language plpgsql set search_path = ''
as $$
declare v_caso record;
begin
  perform private.walmart_no_show_bloquear(p_proveedor_id,p_driver_id);
  for v_caso in
    select c.id,r.opcion,r.calculo from public.no_show_casos c
    join private.walmart_no_show_reportes r on r.caso_id=c.id
    where (c.proveedor_id=p_proveedor_id or c.driver_id=p_driver_id)
      and (c.estado='apelacion_rechazada' or (c.estado='reportado' and c.vence_apelacion_en<now()))
      and not exists (select 1 from private.walmart_no_show_saldos s where s.caso_id=c.id)
    order by c.id for update of c
  loop
    perform private.walmart_registrar_saldo_no_show(v_caso.id,v_caso.opcion,
      v_caso.calculo-'proveedor_id'-'fecha_servicio');
  end loop;
end;
$$;
revoke all on function private.walmart_preparar_no_show(bigint,uuid) from public, anon, authenticated;

create or replace function public.walmart_resolver_apelacion_no_show(
  p_caso_id uuid,p_accion text,p_mensaje text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_caso public.no_show_casos%rowtype;
  v_opcion smallint;
  v_calculo jsonb;
  v_proveedor bigint;
  v_driver uuid;
begin
  if auth.uid() is null or public.no_show_es_coordinador() is not true then
    raise exception 'Solo Coordinacion puede resolver apelaciones';
  end if;
  if p_accion is null or p_accion not in ('aceptar','rechazar')
    or length(coalesce(p_mensaje,''))>500 or public.no_show_texto_inapropiado(p_mensaje) then
    raise exception 'Resolucion o nota invalida';
  end if;
  select c.proveedor_id,c.driver_id into v_proveedor,v_driver from public.no_show_casos c
    join private.walmart_no_show_reportes r on r.caso_id=c.id
    where c.id=p_caso_id;
  if not found then raise exception 'No se encontro el NO SHOW Walmart'; end if;
  perform private.walmart_no_show_bloquear(v_proveedor,v_driver);
  select c.* into v_caso from public.no_show_casos c
    where c.id=p_caso_id and c.proveedor_id=v_proveedor and c.driver_id=v_driver for update of c;
  if not found or v_caso.estado is distinct from 'apelado'
    or v_caso.pago_penalizacion_id is not null or v_caso.pago_reversion_id is not null
    or exists (select 1 from private.walmart_no_show_saldos s where s.caso_id=p_caso_id) then
    raise exception 'El NO SHOW no admite esta resolucion o tiene ajustes; requiere revision';
  end if;
  update public.no_show_casos set
    estado=case p_accion when 'aceptar' then 'apelacion_aceptada' else 'apelacion_rechazada' end,
    resolucion=nullif(btrim(p_mensaje),''),resuelto_por=auth.uid(),resuelto_en=now()
    where id=p_caso_id;
  if p_accion='rechazar' then
    select r.opcion,r.calculo into v_opcion,v_calculo
      from private.walmart_no_show_reportes r where r.caso_id=p_caso_id;
    perform private.walmart_registrar_saldo_no_show(p_caso_id,v_opcion,v_calculo-'proveedor_id'-'fecha_servicio');
  end if;
  insert into public.no_show_eventos(caso_id,tipo,mensaje,actor_id)
    values(p_caso_id,case p_accion when 'aceptar' then 'apelacion_aceptada' else 'apelacion_rechazada' end,
      coalesce(nullif(btrim(p_mensaje),''),case p_accion when 'aceptar' then 'Apelacion aceptada sin descuento.' else 'Apelacion rechazada; saldo NO SHOW vigente.' end),
      auth.uid());
end;
$$;
revoke all on function public.walmart_resolver_apelacion_no_show(uuid,text,text) from public, anon;
grant execute on function public.walmart_resolver_apelacion_no_show(uuid,text,text) to authenticated;

commit;

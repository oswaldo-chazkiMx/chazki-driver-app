-- SOLO EN SUPABASE DE PRUEBAS. Crea un esquema aislado temporal.
-- Contiene datos ficticios aislados; no modifica tablas de la aplicacion.
-- Si ya existe el esquema, se detiene sin cambiarlo.
do $instalacion_ensayo$
begin
  if pg_catalog.to_regnamespace('ensayo_walmart_concurrencia') is not null then
    raise exception 'Ya existe ensayo_walmart_concurrencia; revisa antes de continuar';
  end if;
  create schema ensayo_walmart_concurrencia;
  create table ensayo_walmart_concurrencia.marca(id text primary key);
  insert into ensayo_walmart_concurrencia.marca values ('walmart-no-show-concurrencia-v1');
  create table ensayo_walmart_concurrencia.casos(
    id uuid primary key,estado text,vence_apelacion_en timestamptz,
    pago_penalizacion_id bigint,pago_reversion_id bigint,monto_penalizacion numeric,
    valor_servicio_contratado numeric,proveedor_id bigint,driver_id uuid,
    cedis_id bigint,fecha_servicio date,tipo_unidad text,cuenta text
  );
  create table ensayo_walmart_concurrencia.saldos(
    caso_id uuid primary key,proveedor_id bigint,driver_id uuid,calculo jsonb,
    monto numeric,saldo_pendiente numeric,monto_aplicado numeric,creado_en timestamptz
  );
  create table ensayo_walmart_concurrencia.lotes(
    tipo text,origen_id bigint,proveedor_id bigint,driver_id uuid,disponible numeric,
    aplicado numeric default 0,primary key(tipo,origen_id)
  );
  create table ensayo_walmart_concurrencia.aplicaciones(
    tipo text,origen_id bigint,caso_id uuid,monto numeric,primary key(tipo,origen_id,caso_id)
  );
  execute $funcion_ensayo$
    create function ensayo_walmart_concurrencia.calcular(bigint,date,text,smallint)
    returns jsonb language sql immutable as
    'select ''{"base_servicio":4500,"opcion":1}''::jsonb'
  $funcion_ensayo$;
  execute $funcion_ensayo$
create or replace function ensayo_walmart_concurrencia.aplicar(
  p_tipo text,p_origen_id bigint,p_proveedor_id bigint,p_driver_id uuid,p_disponible numeric
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_lote ensayo_walmart_concurrencia.lotes%rowtype;
  v_saldo record;
  v_restante numeric(12,2);
  v_aplicar numeric(12,2);
  v_total numeric(12,2):=0;
begin
  if p_tipo is null or p_tipo not in ('ruta','cancelacion') or p_origen_id is null
    or p_proveedor_id is null or p_driver_id is null or p_disponible is null
    or p_disponible::text in ('NaN','Infinity','-Infinity') or p_disponible<0
    or p_disponible>9999999999.99 or p_disponible<>round(p_disponible,2) then
    raise exception 'Se requiere un origen y monto disponible valido para NO SHOW';
  end if;
  -- Serializa reintentos aun cuando el lote todavia no existe.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('walmart-no-show:'||p_tipo||':'||p_origen_id::text,0)
  );
  select * into v_lote from ensayo_walmart_concurrencia.lotes
    where tipo=p_tipo and origen_id=p_origen_id;
  if found then
    if v_lote.proveedor_id is distinct from p_proveedor_id
      or v_lote.driver_id is distinct from p_driver_id
      or v_lote.disponible is distinct from p_disponible then
      raise exception 'El origen ya tiene otra aplicacion NO SHOW';
    end if;
    return jsonb_build_object('aplicado',v_lote.aplicado,'restante',v_lote.disponible-v_lote.aplicado);
  end if;
  insert into ensayo_walmart_concurrencia.lotes(tipo,origen_id,proveedor_id,driver_id,disponible)
    values(p_tipo,p_origen_id,p_proveedor_id,p_driver_id,p_disponible);
  v_restante:=p_disponible;
  for v_saldo in
    select s.caso_id,s.saldo_pendiente,s.monto,s.calculo,c.estado,c.vence_apelacion_en,
      c.pago_penalizacion_id,c.pago_reversion_id,c.monto_penalizacion,
      c.valor_servicio_contratado,c.proveedor_id,c.driver_id,c.cedis_id,c.fecha_servicio,c.tipo_unidad,c.cuenta
    from ensayo_walmart_concurrencia.saldos s
    join ensayo_walmart_concurrencia.casos c on c.id=s.caso_id
    where s.proveedor_id=p_proveedor_id and s.driver_id=p_driver_id and s.saldo_pendiente>0
    order by s.creado_en,s.caso_id for update of c,s
  loop
    if v_saldo.pago_penalizacion_id is not null or v_saldo.pago_reversion_id is not null
      or v_saldo.cuenta is distinct from 'WALMART'
      or v_saldo.proveedor_id is distinct from p_proveedor_id
      or v_saldo.driver_id is distinct from p_driver_id
      or v_saldo.monto_penalizacion is distinct from v_saldo.monto
      or v_saldo.valor_servicio_contratado is distinct from (v_saldo.calculo->>'base_servicio')::numeric
      or v_saldo.calculo is distinct from ensayo_walmart_concurrencia.calcular(
        v_saldo.cedis_id,v_saldo.fecha_servicio,v_saldo.tipo_unidad,(v_saldo.calculo->>'opcion')::smallint
      )
      or not (v_saldo.estado='apelacion_rechazada'
        or (v_saldo.estado='reportado' and v_saldo.vence_apelacion_en<now())) then
      raise exception 'El NO SHOW cambio o tiene un ajuste existente; requiere revision';
    end if;
    exit when v_restante<=0;
    v_aplicar:=least(v_saldo.saldo_pendiente,v_restante);
    update ensayo_walmart_concurrencia.saldos
      set saldo_pendiente=saldo_pendiente-v_aplicar,monto_aplicado=monto_aplicado+v_aplicar
      where caso_id=v_saldo.caso_id;
    insert into ensayo_walmart_concurrencia.aplicaciones(tipo,origen_id,caso_id,monto)
      values(p_tipo,p_origen_id,v_saldo.caso_id,v_aplicar);
    v_restante:=v_restante-v_aplicar;
    v_total:=v_total+v_aplicar;
  end loop;
  update ensayo_walmart_concurrencia.lotes set aplicado=v_total where tipo=p_tipo and origen_id=p_origen_id;
  return jsonb_build_object('aplicado',v_total,'restante',v_restante);
end;
$$;
  $funcion_ensayo$;
  insert into ensayo_walmart_concurrencia.casos values (
    '00000000-0000-0000-0000-000000000001','apelacion_rechazada',now()-interval '1 day',
    null,null,2700,4500,-9223372036854775808,'00000000-0000-0000-0000-000000000002',
    1,date '2026-11-09','3.5T','WALMART'
  );
  insert into ensayo_walmart_concurrencia.saldos values (
    '00000000-0000-0000-0000-000000000001',-9223372036854775808,
    '00000000-0000-0000-0000-000000000002','{"base_servicio":4500,"opcion":1}',
    2700,2700,0,now()
  );
end;
$instalacion_ensayo$;

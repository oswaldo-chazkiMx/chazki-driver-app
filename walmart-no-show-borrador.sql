-- BORRADOR: no instalar ni activar. La captura y apelaciones nuevas dependen de
-- walmart-no-show-flujo-borrador.sql; faltan casos heredados y pruebas reales.
begin;

create or replace function private.calcular_walmart_no_show_configurado(
  p_cedis_id bigint,p_fecha date,p_unidad text,p_opcion smallint
) returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  v_config jsonb;
  v_base numeric;
begin
  v_config:=private.calcular_walmart_tarifa_configurada(
    p_cedis_id,p_fecha,p_unidad,p_opcion,1,1,false,false,'FACTURA',0,0,0
  );
  v_base:=(v_config->>'pago_base')::numeric;
  return jsonb_build_object(
    'tarifa_id',v_config->'tarifa_id',
    'cedis_id',v_config->'cedis_id',
    'tipo_unidad',v_config->'tipo_unidad',
    'opcion',v_config->'opcion',
    'vigencia_desde',v_config->'vigencia_desde',
    'vigencia_hasta',v_config->'vigencia_hasta',
    'base_servicio',v_base,
    'porcentaje_no_show',0.60,
    'monto_penalizacion',round(v_base*0.60,2)
  );
end;
$$;
revoke all on function private.calcular_walmart_no_show_configurado(bigint,date,text,smallint)
  from public, anon, authenticated;

create table if not exists private.walmart_no_show_saldos (
  caso_id uuid primary key references public.no_show_casos(id),
  proveedor_id bigint not null references public.proveedores(id),
  driver_id uuid not null references public.drivers(id),
  calculo jsonb not null,
  monto numeric(12,2) not null check (monto>0),
  saldo_pendiente numeric(12,2) not null check (saldo_pendiente>=0),
  monto_aplicado numeric(12,2) not null default 0 check (monto_aplicado>=0),
  creado_en timestamptz not null default now(),
  check (saldo_pendiente+monto_aplicado=monto)
);

create table if not exists private.walmart_no_show_lotes (
  tipo text not null check (tipo in ('ruta','cancelacion')),
  origen_id bigint not null,
  proveedor_id bigint not null references public.proveedores(id),
  driver_id uuid not null references public.drivers(id),
  disponible numeric(12,2) not null check (disponible>=0),
  aplicado numeric(12,2) not null default 0 check (aplicado>=0 and aplicado<=disponible),
  creado_en timestamptz not null default now(),
  primary key (tipo,origen_id)
);

create table if not exists private.walmart_no_show_aplicaciones (
  tipo text not null,
  origen_id bigint not null,
  caso_id uuid not null references private.walmart_no_show_saldos(caso_id),
  monto numeric(12,2) not null check (monto>0),
  aplicado_en timestamptz not null default now(),
  primary key (tipo,origen_id,caso_id),
  foreign key (tipo,origen_id) references private.walmart_no_show_lotes(tipo,origen_id)
);
create table if not exists private.walmart_no_show_rutas (
  ruta_id bigint primary key references public.rutas(id),
  proveedor_id bigint not null references public.proveedores(id),
  driver_id uuid not null references public.drivers(id)
);
revoke all on private.walmart_no_show_saldos,private.walmart_no_show_lotes,
  private.walmart_no_show_aplicaciones,private.walmart_no_show_rutas from public, anon, authenticated;

create or replace function private.walmart_proteger_caso_no_show()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.walmart_no_show_saldos where caso_id=old.id) then
    raise exception 'El NO SHOW tiene un saldo registrado; requiere correccion auditada';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_caso_no_show() from public, anon, authenticated;
drop trigger if exists walmart_proteger_caso_no_show on public.no_show_casos;
create trigger walmart_proteger_caso_no_show before update or delete on public.no_show_casos
for each row execute function private.walmart_proteger_caso_no_show();

create or replace function private.walmart_registrar_saldo_no_show(
  p_caso_id uuid,p_opcion smallint,p_calculo_esperado jsonb
) returns void language plpgsql set search_path = ''
as $$
declare
  v_caso public.no_show_casos%rowtype;
  v_calculo jsonb;
  v_existente private.walmart_no_show_saldos%rowtype;
begin
  if p_caso_id is null or jsonb_typeof(p_calculo_esperado) is distinct from 'object' then
    raise exception 'Se requiere un caso y calculo NO SHOW revisado';
  end if;
  select * into v_caso from public.no_show_casos where id=p_caso_id for update;
  if not found or v_caso.cuenta is distinct from 'WALMART' or v_caso.proveedor_id is null
    or v_caso.pago_penalizacion_id is not null or v_caso.pago_reversion_id is not null
    or not (v_caso.estado='apelacion_rechazada'
      or (v_caso.estado='reportado' and v_caso.vence_apelacion_en<now())) then
    raise exception 'El NO SHOW no esta firme o tiene ajustes existentes; requiere revision';
  end if;
  v_calculo:=private.calcular_walmart_no_show_configurado(
    v_caso.cedis_id,v_caso.fecha_servicio,v_caso.tipo_unidad,p_opcion
  );
  if v_calculo is distinct from p_calculo_esperado
    or v_caso.monto_penalizacion is distinct from (v_calculo->>'monto_penalizacion')::numeric
    or v_caso.valor_servicio_contratado is distinct from (v_calculo->>'base_servicio')::numeric
    or v_caso.monto_penalizacion<=0 then
    raise exception 'El importe NO SHOW no coincide con la tarifa revisada';
  end if;
  select * into v_existente from private.walmart_no_show_saldos where caso_id=p_caso_id;
  if found then
    if v_existente.calculo is distinct from v_calculo
      or v_existente.proveedor_id is distinct from v_caso.proveedor_id
      or v_existente.driver_id is distinct from v_caso.driver_id then
      raise exception 'El NO SHOW ya tiene un saldo diferente';
    end if;
    return;
  end if;
  insert into private.walmart_no_show_saldos(caso_id,proveedor_id,driver_id,calculo,monto,saldo_pendiente)
    values(p_caso_id,v_caso.proveedor_id,v_caso.driver_id,v_calculo,
      v_caso.monto_penalizacion,v_caso.monto_penalizacion);
end;
$$;
revoke all on function private.walmart_registrar_saldo_no_show(uuid,smallint,jsonb)
  from public, anon, authenticated;

create or replace function private.walmart_aplicar_saldos_no_show(
  p_tipo text,p_origen_id bigint,p_proveedor_id bigint,p_driver_id uuid,p_disponible numeric
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_lote private.walmart_no_show_lotes%rowtype;
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
  select * into v_lote from private.walmart_no_show_lotes
    where tipo=p_tipo and origen_id=p_origen_id;
  if found then
    if v_lote.proveedor_id is distinct from p_proveedor_id
      or v_lote.driver_id is distinct from p_driver_id
      or v_lote.disponible is distinct from p_disponible then
      raise exception 'El origen ya tiene otra aplicacion NO SHOW';
    end if;
    return jsonb_build_object('aplicado',v_lote.aplicado,'restante',v_lote.disponible-v_lote.aplicado);
  end if;
  insert into private.walmart_no_show_lotes(tipo,origen_id,proveedor_id,driver_id,disponible)
    values(p_tipo,p_origen_id,p_proveedor_id,p_driver_id,p_disponible);
  v_restante:=p_disponible;
  for v_saldo in
    select s.caso_id,s.saldo_pendiente,s.monto,s.calculo,c.estado,c.vence_apelacion_en,
      c.pago_penalizacion_id,c.pago_reversion_id,c.monto_penalizacion,
      c.valor_servicio_contratado,c.proveedor_id,c.driver_id,c.cedis_id,c.fecha_servicio,c.tipo_unidad,c.cuenta
    from private.walmart_no_show_saldos s
    join public.no_show_casos c on c.id=s.caso_id
    where s.proveedor_id=p_proveedor_id and s.driver_id=p_driver_id and s.saldo_pendiente>0
    order by s.creado_en,s.caso_id for update of c,s
  loop
    if v_saldo.pago_penalizacion_id is not null or v_saldo.pago_reversion_id is not null
      or v_saldo.cuenta is distinct from 'WALMART'
      or v_saldo.proveedor_id is distinct from p_proveedor_id
      or v_saldo.driver_id is distinct from p_driver_id
      or v_saldo.monto_penalizacion is distinct from v_saldo.monto
      or v_saldo.valor_servicio_contratado is distinct from (v_saldo.calculo->>'base_servicio')::numeric
      or v_saldo.calculo is distinct from private.calcular_walmart_no_show_configurado(
        v_saldo.cedis_id,v_saldo.fecha_servicio,v_saldo.tipo_unidad,(v_saldo.calculo->>'opcion')::smallint
      )
      or not (v_saldo.estado='apelacion_rechazada'
        or (v_saldo.estado='reportado' and v_saldo.vence_apelacion_en<now())) then
      raise exception 'El NO SHOW cambio o tiene un ajuste existente; requiere revision';
    end if;
    exit when v_restante<=0;
    v_aplicar:=least(v_saldo.saldo_pendiente,v_restante);
    update private.walmart_no_show_saldos
      set saldo_pendiente=saldo_pendiente-v_aplicar,monto_aplicado=monto_aplicado+v_aplicar
      where caso_id=v_saldo.caso_id;
    insert into private.walmart_no_show_aplicaciones(tipo,origen_id,caso_id,monto)
      values(p_tipo,p_origen_id,v_saldo.caso_id,v_aplicar);
    v_restante:=v_restante-v_aplicar;
    v_total:=v_total+v_aplicar;
  end loop;
  update private.walmart_no_show_lotes set aplicado=v_total where tipo=p_tipo and origen_id=p_origen_id;
  return jsonb_build_object('aplicado',v_total,'restante',v_restante);
end;
$$;
revoke all on function private.walmart_aplicar_saldos_no_show(text,bigint,bigint,uuid,numeric)
  from public, anon, authenticated;

create or replace function private.walmart_verificar_casos_no_show(p_proveedor_id bigint,p_driver_id uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  if exists (
    select 1 from public.no_show_casos c
    where public.operativo_normalizar(c.cuenta)='walmart'
      and (c.proveedor_id=p_proveedor_id or c.driver_id=p_driver_id)
      and (c.estado is distinct from 'apelacion_aceptada' or not exists (
        select 1 from private.walmart_no_show_reportes r where r.caso_id=c.id
      ))
      and not exists (
        select 1 from private.walmart_no_show_saldos s
        where s.caso_id=c.id and
          ((s.proveedor_id=p_proveedor_id and s.driver_id=p_driver_id) or s.saldo_pendiente=0)
      )
  ) then raise exception 'Hay NO SHOW Walmart que requieren revision antes del pago'; end if;
end;
$$;
revoke all on function private.walmart_verificar_casos_no_show(bigint,uuid)
  from public, anon, authenticated;

create or replace function private.walmart_no_show_en_pago_ruta()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if new.ruta_id is null or not exists (
    select 1 from private.walmart_no_show_rutas r
    where r.ruta_id=new.ruta_id and r.proveedor_id=new.proveedor_id and r.driver_id=new.driver_id
  ) then return new; end if;
  if new.concepto is distinct from 'servicio' or new.estatus is distinct from 'pendiente' then
    raise exception 'El pago NO SHOW requiere un servicio pendiente';
  end if;
  perform private.walmart_verificar_casos_no_show(new.proveedor_id,new.driver_id);
  v_resultado:=private.walmart_aplicar_saldos_no_show(
    'ruta',new.ruta_id,new.proveedor_id,new.driver_id,new.monto
  );
  new.monto:=(v_resultado->>'restante')::numeric;
  update public.liquidaciones
    set dcto_pago=coalesce(dcto_pago,0)+(v_resultado->>'aplicado')::numeric,
      pago_driver=greatest(0,coalesce(pago_driver,0)-(v_resultado->>'aplicado')::numeric)
    where ruta_id=new.ruta_id;
  return new;
end;
$$;
revoke all on function private.walmart_no_show_en_pago_ruta() from public, anon, authenticated;
drop trigger if exists zz_walmart_no_show_en_pago_ruta on public.pagos;

commit;

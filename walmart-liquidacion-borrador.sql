-- BORRADOR: no instalar ni publicar. Faltan casos NO SHOW heredados, anulacion,
-- liberacion del retenido y ensayo completo en Supabase.
begin;

create table if not exists private.walmart_tarifas_mapeo (
  walmart_tarifa_id bigint primary key references public.walmart_tarifas(id),
  tarifa_id bigint not null unique references public.tarifas(id)
);
revoke all on private.walmart_tarifas_mapeo from public, anon, authenticated;

create table if not exists private.walmart_liquidaciones (
  ruta_id bigint primary key references public.rutas(id),
  liquidacion_id bigint not null unique references public.liquidaciones(id),
  pago_id bigint not null unique references public.pagos(id),
  proveedor_id bigint not null references public.proveedores(id),
  calculo jsonb not null,
  saldo_retenido numeric(12,2) not null check (saldo_retenido>=0),
  validado_por uuid not null references public.drivers(id),
  validado_en timestamptz not null default now()
);
revoke all on private.walmart_liquidaciones from public, anon, authenticated;

create or replace function private.walmart_proteger_ruta_liquidada()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_clave text;
begin
  if exists (select 1 from private.walmart_liquidaciones w where w.ruta_id=old.id) then
    if tg_op='DELETE' then raise exception 'La ruta Walmart liquidada requiere anulacion auditada'; end if;
    foreach v_clave in array array['driver_id','cedis_id','checkin_at','checkout_at','estado',
      'tipo_unidad','entregados','paquetes_asignados','fallidos','walmart_visitas_asignadas',
      'walmart_visitas_realizadas','walmart_folios_avaya','walmart_requiere_revision'] loop
      if to_jsonb(new)->v_clave is distinct from to_jsonb(old)->v_clave then
        raise exception 'La ruta Walmart liquidada requiere ajuste o anulacion auditada';
      end if;
    end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_ruta_liquidada() from public, anon, authenticated;
drop trigger if exists walmart_proteger_ruta_liquidada on public.rutas;
create trigger walmart_proteger_ruta_liquidada before update or delete on public.rutas
for each row execute function private.walmart_proteger_ruta_liquidada();

create or replace function private.walmart_proteger_liquidacion()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.walmart_liquidaciones w where w.liquidacion_id=old.id) then
    raise exception 'La liquidacion Walmart requiere ajuste o anulacion auditada';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_liquidacion() from public, anon, authenticated;
drop trigger if exists walmart_proteger_liquidacion on public.liquidaciones;
create trigger walmart_proteger_liquidacion before update or delete on public.liquidaciones
for each row execute function private.walmart_proteger_liquidacion();

create or replace function private.walmart_proteger_pago()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.walmart_liquidaciones w where w.pago_id=old.id) then
    if tg_op='DELETE' then raise exception 'El pago Walmart requiere anulacion auditada'; end if;
    if new.ruta_id is distinct from old.ruta_id or new.driver_id is distinct from old.driver_id
      or new.proveedor_id is distinct from old.proveedor_id or new.concepto is distinct from old.concepto
      or new.monto is distinct from old.monto or new.fecha is distinct from old.fecha
      or (old.estatus='pagado' and new.estatus is distinct from old.estatus) then
      raise exception 'El pago Walmart requiere ajuste o anulacion auditada';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_pago() from public, anon, authenticated;
drop trigger if exists walmart_proteger_pago on public.pagos;
create trigger walmart_proteger_pago before update or delete on public.pagos
for each row execute function private.walmart_proteger_pago();

-- Solo para un flujo autorizador futuro. No se concede acceso directo a la API.
create or replace function private.walmart_registrar_liquidacion(
  p_ruta_id bigint,p_aplicar_visitas boolean,p_aplicar_fallida boolean,p_calculo_esperado jsonb
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_ruta record;
  v_guardado private.walmart_liquidaciones%rowtype;
  v_proveedor bigint;
  v_registro text;
  v_retencion numeric;
  v_iva numeric;
  v_comision numeric;
  v_calculo jsonb;
  v_tarifa bigint;
  v_liquidacion bigint;
  v_pago bigint;
  v_pago_real numeric;
  v_pago_estatus text;
  v_subtotal numeric;
  v_impuesto numeric;
  v_cobro numeric;
  v_costo numeric;
  v_no_show numeric;
begin
  if auth.uid() is null or p_ruta_id is null or p_aplicar_visitas is null
    or p_aplicar_fallida is null or jsonb_typeof(p_calculo_esperado) is distinct from 'object' then
    raise exception 'Se requiere una ruta y un calculo revisado';
  end if;
  select r.driver_id,r.cedis_id,r.checkin_at,r.entregados,r.paquetes_asignados
    into v_ruta from public.rutas r where r.id=p_ruta_id for update;
  if not found or v_ruta.driver_id is null or v_ruta.checkin_at is null then
    raise exception 'No se encontro una ruta con driver y fecha validos';
  end if;
  select * into v_guardado from private.walmart_liquidaciones where ruta_id=p_ruta_id;
  if found then
    if v_guardado.calculo is distinct from p_calculo_esperado
      or (v_guardado.calculo->>'aplicar_visitas')::boolean is distinct from p_aplicar_visitas
      or (v_guardado.calculo->>'aplicar_fallida')::boolean is distinct from p_aplicar_fallida then
      raise exception 'La ruta ya tiene una liquidacion Walmart diferente';
    end if;
    select p.monto,p.estatus into v_pago_real,v_pago_estatus from public.pagos p
      where p.id=v_guardado.pago_id and p.ruta_id=p_ruta_id
        and p.driver_id=v_ruta.driver_id and p.proveedor_id=v_guardado.proveedor_id
        and p.concepto='servicio';
    if not found then raise exception 'El pago Walmart registrado cambio o ya no existe; requiere revision'; end if;
    select l.aplicado into v_no_show from private.walmart_no_show_lotes l
      where l.tipo='ruta' and l.origen_id=p_ruta_id;
    if not found then v_no_show:=0; end if;
    return jsonb_build_object('liquidacion_id',v_guardado.liquidacion_id,
      'pago_id',v_guardado.pago_id,'pago_semanal',v_pago_real,'pago_estatus',v_pago_estatus,
      'no_show_aplicado',v_no_show,'saldo_retenido',v_guardado.saldo_retenido);
  end if;
  if exists (select 1 from public.liquidaciones where ruta_id=p_ruta_id)
    or exists (select 1 from public.pagos where ruta_id=p_ruta_id)
    or exists (select 1 from public.validaciones_pendientes where ruta_id=p_ruta_id and estatus='pendiente') then
    raise exception 'La ruta ya tiene liquidacion, pago o validacion pendiente';
  end if;
  if to_regclass('private.walmart_cancelaciones_pagadas') is null then
    raise exception 'Falta integrar la proteccion de pagos por cancelacion Walmart';
  end if;
  if exists (
    select 1 from private.walmart_cancelaciones_pagadas w
    join public.cancelaciones c on c.id=w.cancelacion_id
    where c.ruta_id::text=p_ruta_id::text
  ) then raise exception 'La ruta ya tiene una cancelacion pagada'; end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.pagos'::regclass
      and t.tgfoid='public.aplicar_descuentos_pnr_a_pago()'::regprocedure
      and not t.tgisinternal and t.tgenabled in ('O','A') and (t.tgtype & 7)=7
  ) then raise exception 'El descuento automatico PNR no esta activo para pagos'; end if;
  select w.proveedor_id into v_proveedor from private.walmart_proveedores_confirmados w where w.ruta_id=p_ruta_id;
  if not found then raise exception 'Falta confirmar el proveedor Walmart'; end if;
  select p.tipo_registro into v_registro from public.proveedores p where p.id=v_proveedor for share;
  if v_registro is null or v_registro not in ('FACTURA','SIN FACTURA') then
    raise exception 'El proveedor no tiene un registro fiscal valido';
  end if;
  perform 1 from public.parametros_pago
    where clave in ('retencion_sin_factura','iva','comision_sin_factura') order by clave for share;
  select max(valor) filter (where clave='retencion_sin_factura'),
    max(valor) filter (where clave='iva'),max(valor) filter (where clave='comision_sin_factura')
    into v_retencion,v_iva,v_comision from public.parametros_pago
    where clave in ('retencion_sin_factura','iva','comision_sin_factura');
  v_calculo:=private.walmart_calcular_decision_guardada(p_ruta_id,p_aplicar_visitas,p_aplicar_fallida,
    v_registro,v_retencion,v_iva,v_comision)
    || jsonb_build_object('aplicar_visitas',p_aplicar_visitas,'aplicar_fallida',p_aplicar_fallida);
  if v_calculo is distinct from p_calculo_esperado then
    raise exception 'El calculo Walmart cambio; vuelve a revisarlo antes de validar';
  end if;
  select m.tarifa_id into v_tarifa
    from private.walmart_tarifas_mapeo m join public.tarifas t on t.id=m.tarifa_id
    join public.walmart_tarifas w on w.id=m.walmart_tarifa_id
    where w.id=(v_calculo->>'tarifa_id')::bigint and w.cedis_id=v_ruta.cedis_id
      and t.cuenta='WALMART' and t.esquema='RUTA' and t.activo
      and t.vigencia_desde<= (v_ruta.checkin_at at time zone 'America/Mexico_City')::date
      and (t.vigencia_hasta is null or t.vigencia_hasta>= (v_ruta.checkin_at at time zone 'America/Mexico_City')::date)
    for share of m,t,w;
  if not found then raise exception 'Falta una tarifa Walmart vinculada y vigente para la liquidacion'; end if;
  v_calculo:=private.walmart_calcular_decision_guardada(p_ruta_id,p_aplicar_visitas,p_aplicar_fallida,
    v_registro,v_retencion,v_iva,v_comision)
    || jsonb_build_object('aplicar_visitas',p_aplicar_visitas,'aplicar_fallida',p_aplicar_fallida);
  if v_calculo is distinct from p_calculo_esperado then
    raise exception 'El calculo Walmart cambio; vuelve a revisarlo antes de validar';
  end if;
  v_subtotal:=(v_calculo->>'subtotal')::numeric;
  v_impuesto:=(v_calculo->>'impuesto')::numeric;
  v_cobro:=(v_calculo->>'tarifa_cliente')::numeric;
  v_costo:=(v_calculo->>'costo_total_imp')::numeric;
  insert into public.liquidaciones(
    ruta_id,driver_id,proveedor_id,tarifa_id,cuenta,conc,esquema,tipo_unidad,
    entregados,asignados,efectividad,pago_base,regla_pago,dcto_pago,bono_pago,ajuste_pago,
    costo_total,registro_fiscal,retencion,neto,comision,costo_pl,iva,total_costo_imp,pago_driver,
    cobro_base,dcto_cobro,ajuste_cobro,venta_total,utilidad,margen,excepcion_supervisor,validada_por
  ) values (
    p_ruta_id,v_ruta.driver_id,v_proveedor,v_tarifa,'WALMART','WALMART RUTA','RUTA',v_calculo->>'tipo_unidad',
    coalesce(v_ruta.entregados,0),coalesce(v_ruta.paquetes_asignados,0),
    case when v_ruta.paquetes_asignados>0 then round(coalesce(v_ruta.entregados,0)::numeric/v_ruta.paquetes_asignados,4) else 0 end,
    (v_calculo->>'pago_base')::numeric,'Penalizaciones Walmart',
    -((v_calculo->>'descuento_visitas')::numeric+(v_calculo->>'descuento_fallida')::numeric),0,0,
    v_subtotal,v_registro,greatest(-v_impuesto,0),v_subtotal-greatest(-v_impuesto,0),
    (v_calculo->>'comision')::numeric,v_subtotal-greatest(-v_impuesto,0)+(v_calculo->>'comision')::numeric,
    greatest(v_impuesto,0),v_costo,(v_calculo->>'pago_semanal')::numeric,
    v_cobro,0,0,v_cobro,v_cobro-v_costo,case when v_cobro=0 then 0 else (v_cobro-v_costo)/v_cobro end,
    false,auth.uid()
  ) returning id into v_liquidacion;
  insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
    values(v_ruta.driver_id,v_proveedor,p_ruta_id,'servicio',(v_calculo->>'pago_semanal')::numeric,
      (v_ruta.checkin_at at time zone 'America/Mexico_City')::date,'pendiente')
    returning id,monto into v_pago,v_pago_real;
  insert into private.walmart_liquidaciones(ruta_id,liquidacion_id,pago_id,proveedor_id,calculo,saldo_retenido,validado_por)
    values(p_ruta_id,v_liquidacion,v_pago,v_proveedor,v_calculo,(v_calculo->>'saldo_retenido')::numeric,auth.uid());
  v_no_show:=0;
  return jsonb_build_object('liquidacion_id',v_liquidacion,'pago_id',v_pago,
    'pago_semanal',v_pago_real,'pago_estatus','pendiente',
    'no_show_aplicado',v_no_show,'saldo_retenido',(v_calculo->>'saldo_retenido')::numeric);
end;
$$;
revoke all on function private.walmart_registrar_liquidacion(bigint,boolean,boolean,jsonb) from public, anon, authenticated;

commit;

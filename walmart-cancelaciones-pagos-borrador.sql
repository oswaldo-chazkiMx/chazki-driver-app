-- BORRADOR: no instalar ni activar. Faltan casos NO SHOW heredados, liberacion
-- del retenido, reversión contable y ensayo con permisos y concurrencia reales.
begin;

create table if not exists private.walmart_cancelaciones_pagadas (
  cancelacion_id bigint primary key references public.cancelaciones(id),
  driver_id uuid not null references public.drivers(id),
  proveedor_id bigint not null references public.proveedores(id),
  pago_id bigint unique references public.pagos(id),
  calculo jsonb not null,
  saldo_retenido numeric(12,2) not null check (saldo_retenido>=0),
  pnr_aplicado numeric(12,2) not null default 0 check (pnr_aplicado>=0),
  registrado_por uuid not null references public.drivers(id),
  registrado_en timestamptz not null default now()
);
revoke all on private.walmart_cancelaciones_pagadas from public, anon, authenticated;

create table if not exists private.walmart_cancelaciones_pnr (
  cancelacion_id bigint not null references private.walmart_cancelaciones_pagadas(cancelacion_id),
  reclamo_id uuid not null references public.pnr_descuentos(reclamo_id),
  driver_id uuid not null references public.drivers(id),
  monto numeric(12,2) not null check (monto>0),
  aplicado_en timestamptz not null default now(),
  primary key (cancelacion_id,reclamo_id)
);
revoke all on private.walmart_cancelaciones_pnr from public, anon, authenticated;

create or replace function private.walmart_calcular_cancelacion_revisada(
  p_cancelacion_id bigint,p_proveedor_id bigint,p_unidad text,p_aplicar_retencion boolean
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_cancelacion record;
  v_opcion smallint;
  v_registro text;
  v_retencion numeric;
  v_iva numeric;
  v_comision numeric;
  v_resultado jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede revisar la cancelacion Walmart';
  end if;
  if p_cancelacion_id is null or p_proveedor_id is null or p_unidad is null
    or p_aplicar_retencion is null then raise exception 'Confirma proveedor, unidad y retencion'; end if;
  select c.id,c.driver_id,c.cedis_id,c.estatus,c.capturado_at,c.ruta_id,
    c.foto_path,c.foto_bitacora_path,ce.cliente_id,cl.nombre as cliente
    into v_cancelacion
    from public.cancelaciones c join public.cedis ce on ce.id=c.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where c.id=p_cancelacion_id for update of c;
  if not found or v_cancelacion.estatus is distinct from 'aprobada'
    or v_cancelacion.capturado_at is null
    or public.operativo_normalizar(v_cancelacion.cliente)<>'walmart'
    or public.operativo_asignado_a(v_cancelacion.cliente_id,v_cancelacion.cedis_id,'ih') is not true then
    raise exception 'Se requiere una cancelacion Walmart aprobada y asignada al supervisor';
  end if;
  if v_cancelacion.foto_path is null or v_cancelacion.foto_bitacora_path is null
    or v_cancelacion.foto_path=v_cancelacion.foto_bitacora_path
    or left(v_cancelacion.foto_path,length(v_cancelacion.driver_id::text)+1)<>v_cancelacion.driver_id::text||'/'
    or left(v_cancelacion.foto_bitacora_path,length(v_cancelacion.driver_id::text)+1)<>v_cancelacion.driver_id::text||'/'
    or not exists (select 1 from storage.objects o where o.bucket_id='cancelaciones' and o.name=v_cancelacion.foto_path)
    or not exists (select 1 from storage.objects o where o.bucket_id='cancelaciones' and o.name=v_cancelacion.foto_bitacora_path) then
    raise exception 'Se requieren las fotos de salida y bitacora de esta cancelacion';
  end if;
  perform 1 from storage.objects o where o.bucket_id='cancelaciones' and o.name=v_cancelacion.foto_path for share;
  if not found then raise exception 'No se encontro la foto de salida'; end if;
  perform 1 from storage.objects o where o.bucket_id='cancelaciones' and o.name=v_cancelacion.foto_bitacora_path for share;
  if not found then raise exception 'No se encontro la foto de bitacora'; end if;
  if v_cancelacion.ruta_id is not null then
    perform 1 from public.rutas r where r.id::text=v_cancelacion.ruta_id::text for update;
    if not exists (
      select 1 from public.rutas r where r.id::text=v_cancelacion.ruta_id::text
        and r.driver_id=v_cancelacion.driver_id and r.cedis_id=v_cancelacion.cedis_id
        and (case public.operativo_normalizar(r.tipo_unidad)
          when '35t' then '35t' when '35tn' then '35t'
          when 'large' then 'large' when 'largevan' then 'large' when '15tn' then 'large'
          else null end)
        =(case public.operativo_normalizar(p_unidad)
          when '35t' then '35t' when '35tn' then '35t'
          when 'large' then 'large' when 'largevan' then 'large' when '15tn' then 'large'
          else null end)
    ) then raise exception 'La ruta vinculada no coincide con el driver, CEDIS o unidad confirmada'; end if;
    if exists (select 1 from public.liquidaciones l where l.ruta_id::text=v_cancelacion.ruta_id::text)
      or exists (select 1 from public.pagos p where p.ruta_id::text=v_cancelacion.ruta_id::text) then
      raise exception 'La ruta vinculada ya tiene liquidacion o pago; requiere revision';
    end if;
    if to_regclass('private.walmart_proveedores_confirmados') is not null then
      if exists (select 1 from private.walmart_proveedores_confirmados w
        where w.ruta_id::text=v_cancelacion.ruta_id::text and w.proveedor_id is distinct from p_proveedor_id
      ) then raise exception 'El proveedor no coincide con la ruta vinculada'; end if;
    end if;
    if exists (
      select 1 from private.walmart_cancelaciones_pagadas w
      join public.cancelaciones c on c.id=w.cancelacion_id
      where c.ruta_id::text=v_cancelacion.ruta_id::text and c.id<>p_cancelacion_id
    ) then raise exception 'La ruta ya tiene una cancelacion pagada'; end if;
  end if;
  select p.tipo_registro into v_registro from public.proveedores p where p.id=p_proveedor_id for share;
  if v_registro is null or v_registro not in ('FACTURA','SIN FACTURA') then
    raise exception 'El proveedor no tiene un registro fiscal valido';
  end if;
  insert into private.walmart_acuerdos(proveedor_id,cedis_id)
    values(p_proveedor_id,v_cancelacion.cedis_id) on conflict do nothing;
  perform 1 from private.walmart_acuerdos a
    where a.proveedor_id=p_proveedor_id and a.cedis_id=v_cancelacion.cedis_id for update;
  v_opcion:=private.walmart_opcion_al_iniciar(p_proveedor_id,v_cancelacion.cedis_id,v_cancelacion.capturado_at);
  perform 1 from public.parametros_pago
    where clave in ('retencion_sin_factura','iva','comision_sin_factura') order by clave for share;
  select max(valor) filter (where clave='retencion_sin_factura'),
    max(valor) filter (where clave='iva'),max(valor) filter (where clave='comision_sin_factura')
    into v_retencion,v_iva,v_comision from public.parametros_pago
    where clave in ('retencion_sin_factura','iva','comision_sin_factura');
  perform 1 from public.walmart_tarifas w
    where w.cedis_id=v_cancelacion.cedis_id
      and (v_cancelacion.capturado_at at time zone 'America/Mexico_City')::date between w.vigencia_desde and w.vigencia_hasta
    order by w.id for share;
  v_resultado:=private.calcular_walmart_cancelacion_configurada(
    v_cancelacion.cedis_id,(v_cancelacion.capturado_at at time zone 'America/Mexico_City')::date,
    p_unidad,v_opcion,v_registro,v_retencion,v_iva,v_comision
  );
  if not p_aplicar_retencion then
    v_resultado:=v_resultado||jsonb_build_object('pago_semanal',(v_resultado->>'total')::numeric,'saldo_retenido',0);
  end if;
  return v_resultado||jsonb_build_object(
    'cancelacion_id',p_cancelacion_id,'driver_id',v_cancelacion.driver_id,
    'proveedor_id',p_proveedor_id,'registro_fiscal',v_registro,'aplicar_retencion',p_aplicar_retencion,
    'unidad_confirmada',p_unidad
  );
end;
$$;
revoke all on function private.walmart_calcular_cancelacion_revisada(bigint,bigint,text,boolean)
  from public, anon, authenticated;

create or replace function public.walmart_previsualizar_cancelacion(
  p_cancelacion_id bigint,p_proveedor_id bigint,p_unidad text,p_aplicar_retencion boolean
) returns jsonb language sql security definer set search_path = ''
as $$
  select private.walmart_calcular_cancelacion_revisada($1,$2,$3,$4)
$$;
revoke all on function public.walmart_previsualizar_cancelacion(bigint,bigint,text,boolean) from public, anon;
grant execute on function public.walmart_previsualizar_cancelacion(bigint,bigint,text,boolean) to authenticated;

create or replace function public.walmart_previsualizar_cancelacion_porcentaje(
  p_cancelacion_id bigint,p_proveedor_id bigint,p_unidad text,p_porcentaje_retencion smallint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if p_porcentaje_retencion is null or p_porcentaje_retencion not in (0,10,15,25) then
    raise exception 'Selecciona una retencion Walmart de 0, 10, 15 o 25 por ciento';
  end if;
  return private.walmart_aplicar_porcentaje_retencion(
    public.walmart_previsualizar_cancelacion(p_cancelacion_id,p_proveedor_id,p_unidad,p_porcentaje_retencion>0),
    p_porcentaje_retencion
  );
end;
$$;
revoke all on function public.walmart_previsualizar_cancelacion_porcentaje(bigint,bigint,text,smallint) from public, anon;
grant execute on function public.walmart_previsualizar_cancelacion_porcentaje(bigint,bigint,text,smallint) to authenticated;

create or replace function public.walmart_validar_cancelacion(
  p_cancelacion_id bigint,p_proveedor_id bigint,p_unidad text,p_aplicar_retencion boolean,p_calculo_esperado jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_calculo jsonb;
  v_existente private.walmart_cancelaciones_pagadas%rowtype;
  v_descuento record;
  v_disponible numeric(12,2);
  v_aplicar numeric(12,2);
  v_pnr numeric(12,2):=0;
  v_pago_id bigint;
  v_pago_monto numeric;
  v_pago_estatus text;
  v_no_show_aplicado numeric;
  v_porcentaje smallint;
begin
  if jsonb_typeof(p_calculo_esperado) is distinct from 'object' then raise exception 'Revisa el calculo antes de validar'; end if;
  if p_calculo_esperado ? 'porcentaje_retencion' then
    v_porcentaje:=(p_calculo_esperado->>'porcentaje_retencion')::smallint;
    if v_porcentaje is null or v_porcentaje not in (0,10,15,25)
      or p_aplicar_retencion is distinct from (v_porcentaje>0) then
      raise exception 'La retencion seleccionada no coincide con el calculo';
    end if;
  end if;
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede validar la cancelacion Walmart';
  end if;
  perform 1 from public.cancelaciones c join public.cedis ce on ce.id=c.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where c.id=p_cancelacion_id and public.operativo_normalizar(cl.nombre)='walmart'
      and public.operativo_asignado_a(ce.cliente_id,ce.id,'ih') is true for update of c;
  if not found then raise exception 'Cancelacion Walmart asignada requerida'; end if;
  select * into v_existente from private.walmart_cancelaciones_pagadas where cancelacion_id=p_cancelacion_id;
  if found then
    if v_existente.proveedor_id is distinct from p_proveedor_id
      or v_existente.calculo is distinct from p_calculo_esperado
      or (v_existente.calculo->>'aplicar_retencion')::boolean is distinct from p_aplicar_retencion
      or v_existente.calculo->>'unidad_confirmada' is distinct from p_unidad then
      raise exception 'La cancelacion ya tiene otro pago registrado';
    end if;
    select p.monto,p.estatus into v_pago_monto,v_pago_estatus from public.pagos p
      where p.id=v_existente.pago_id and p.driver_id=v_existente.driver_id
        and p.proveedor_id=v_existente.proveedor_id and p.ruta_id is null and p.concepto='servicio';
    if not found then raise exception 'El pago de cancelacion cambio o no existe; requiere revision'; end if;
    select l.aplicado into v_no_show_aplicado from private.walmart_no_show_lotes l
      where l.tipo='cancelacion' and l.origen_id=p_cancelacion_id;
    if not found then v_no_show_aplicado:=0; end if;
    return jsonb_build_object('pago_id',v_existente.pago_id,'pago_semanal',v_pago_monto,
      'pago_estatus',v_pago_estatus,'pnr_aplicado',v_existente.pnr_aplicado,
      'no_show_aplicado',v_no_show_aplicado,'saldo_retenido',v_existente.saldo_retenido);
  end if;
  v_calculo:=private.walmart_calcular_cancelacion_revisada(
    p_cancelacion_id,p_proveedor_id,p_unidad,p_aplicar_retencion
  );
  if v_porcentaje is not null then
    v_calculo:=private.walmart_aplicar_porcentaje_retencion(v_calculo,v_porcentaje);
  end if;
  if v_calculo is distinct from p_calculo_esperado then
    raise exception 'El calculo de cancelacion cambio; vuelve a revisarlo';
  end if;
  insert into private.walmart_cancelaciones_pagadas(
    cancelacion_id,driver_id,proveedor_id,calculo,saldo_retenido,registrado_por
  ) values (p_cancelacion_id,(v_calculo->>'driver_id')::uuid,p_proveedor_id,v_calculo,
    (v_calculo->>'saldo_retenido')::numeric,auth.uid());
  v_disponible:=(v_calculo->>'pago_semanal')::numeric;
  for v_descuento in
    select d.reclamo_id,d.driver_id,d.saldo_pendiente from public.pnr_descuentos d
    where d.driver_id=(v_calculo->>'driver_id')::uuid and d.saldo_pendiente>0
    order by d.creado_en,d.reclamo_id for update of d
  loop
    exit when v_disponible<=0;
    v_aplicar:=least(v_disponible,v_descuento.saldo_pendiente);
    update public.pnr_descuentos set saldo_pendiente=saldo_pendiente-v_aplicar,
      monto_aplicado=monto_aplicado+v_aplicar,
      aplicado_en=case when saldo_pendiente-v_aplicar=0 then now() else aplicado_en end
      where reclamo_id=v_descuento.reclamo_id;
    insert into private.walmart_cancelaciones_pnr(cancelacion_id,reclamo_id,driver_id,monto)
      values(p_cancelacion_id,v_descuento.reclamo_id,v_descuento.driver_id,v_aplicar);
    insert into public.pnr_reclamo_eventos(reclamo_id,tipo,mensaje)
      values(v_descuento.reclamo_id,'descuento_aplicado',
        'Se aplicaron '||to_char(v_aplicar,'FM$999,999,999,990.00')||' al pago de la cancelacion Walmart '||p_cancelacion_id::text||'.');
    v_disponible:=v_disponible-v_aplicar;
    v_pnr:=v_pnr+v_aplicar;
  end loop;
  insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
    select (v_calculo->>'driver_id')::uuid,p_proveedor_id,null,'servicio',v_disponible,
      (c.capturado_at at time zone 'America/Mexico_City')::date,'pendiente'
    from public.cancelaciones c where c.id=p_cancelacion_id
    returning id into v_pago_id;
  update private.walmart_cancelaciones_pagadas set pago_id=v_pago_id,pnr_aplicado=v_pnr
    where cancelacion_id=p_cancelacion_id;
  return jsonb_build_object('pago_id',v_pago_id,'pago_semanal',v_disponible,'pago_estatus','pendiente',
    'pnr_aplicado',v_pnr,'no_show_aplicado',0,
    'saldo_retenido',(v_calculo->>'saldo_retenido')::numeric);
end;
$$;
revoke all on function public.walmart_validar_cancelacion(bigint,bigint,text,boolean,jsonb) from public, anon;
grant execute on function public.walmart_validar_cancelacion(bigint,bigint,text,boolean,jsonb) to authenticated;

create or replace function private.walmart_proteger_cancelacion_pagada()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_clave text;
begin
  if exists (select 1 from private.walmart_cancelaciones_pagadas w where w.cancelacion_id=old.id) then
    if tg_op='DELETE' then raise exception 'La cancelacion pagada requiere anulacion auditada'; end if;
    foreach v_clave in array array['driver_id','cedis_id','capturado_at','estatus','ruta_id','foto_path','foto_bitacora_path'] loop
      if to_jsonb(new)->v_clave is distinct from to_jsonb(old)->v_clave then
        raise exception 'La cancelacion pagada requiere ajuste o anulacion auditada';
      end if;
    end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_cancelacion_pagada() from public, anon, authenticated;
drop trigger if exists walmart_proteger_cancelacion_pagada on public.cancelaciones;
create trigger walmart_proteger_cancelacion_pagada before update or delete on public.cancelaciones
for each row execute function private.walmart_proteger_cancelacion_pagada();

create or replace function private.walmart_proteger_pago_cancelacion()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.walmart_cancelaciones_pagadas w where w.pago_id=old.id) then
    if tg_op='DELETE' then raise exception 'El pago de cancelacion requiere anulacion auditada'; end if;
    if new.ruta_id is distinct from old.ruta_id or new.driver_id is distinct from old.driver_id
      or new.proveedor_id is distinct from old.proveedor_id or new.concepto is distinct from old.concepto
      or new.monto is distinct from old.monto or new.fecha is distinct from old.fecha
      or (old.estatus='pagado' and new.estatus is distinct from old.estatus) then
      raise exception 'El pago de cancelacion requiere ajuste o anulacion auditada';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_pago_cancelacion() from public, anon, authenticated;
drop trigger if exists walmart_proteger_pago_cancelacion on public.pagos;
create trigger walmart_proteger_pago_cancelacion before update or delete on public.pagos
for each row execute function private.walmart_proteger_pago_cancelacion();

commit;

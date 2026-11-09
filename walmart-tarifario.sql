-- BORRADOR: no ejecutar ni publicar hasta integrar y probar el flujo completo de Walmart.
-- Los importes son los del CSV confirmado; las rutas y pagos previos no se modifican.
begin;

create table if not exists public.walmart_tarifas (
  id bigint generated always as identity primary key,
  cedis_id bigint not null references public.cedis(id),
  tipo_unidad text not null,
  esquema text not null,
  zona text not null,
  variable text not null,
  vigencia_desde date not null,
  vigencia_hasta date not null,
  tarifa_cliente numeric(12,2) not null check (tarifa_cliente >= 0),
  pago_opcion_1 numeric(12,2) not null check (pago_opcion_1 >= 0),
  pago_opcion_2 numeric(12,2) not null check (pago_opcion_2 >= 0),
  semanal_opcion_1 numeric(5,4) not null check (semanal_opcion_1 between 0 and 1),
  semanal_opcion_2 numeric(5,4) not null check (semanal_opcion_2 between 0 and 1),
  unique (cedis_id, tipo_unidad, esquema, zona, variable, vigencia_desde),
  check (vigencia_hasta >= vigencia_desde)
);

alter table public.walmart_tarifas enable row level security;
revoke all on public.walmart_tarifas from public, anon, authenticated;

create table if not exists private.walmart_acuerdos (
  proveedor_id bigint not null references public.proveedores(id),
  cedis_id bigint not null references public.cedis(id),
  opcion smallint not null default 1 check (opcion in (1,2)),
  primary key (proveedor_id,cedis_id)
);

create table if not exists private.walmart_cambios_acuerdo (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references public.proveedores(id),
  cedis_id bigint not null references public.cedis(id),
  opcion_anterior smallint not null check (opcion_anterior in (1,2)),
  opcion_nueva smallint not null check (opcion_nueva in (1,2)),
  actor_id uuid not null references public.drivers(id),
  cambiado_en timestamptz not null default clock_timestamp()
);

revoke all on private.walmart_acuerdos, private.walmart_cambios_acuerdo
  from public, anon, authenticated;

-- La integración debe serializar el inicio con los cambios de acuerdo y guardar
-- una instantánea; esta consulta histórica por sí sola no resuelve concurrencia.
create or replace function private.walmart_opcion_al_iniciar(
  p_proveedor_id bigint, p_cedis_id bigint, p_inicio timestamptz
) returns smallint
language plpgsql stable set search_path = ''
as $$
declare
  v_opcion smallint;
begin
  if p_proveedor_id is null or p_cedis_id is null or p_inicio is null then
    raise exception 'Se requiere proveedor, CEDIS y fecha de inicio para determinar el acuerdo Walmart';
  end if;
  if not exists (select 1 from public.proveedores p where p.id=p_proveedor_id)
    or not exists (
      select 1 from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
      where ce.id=p_cedis_id and public.operativo_normalizar(cl.nombre)='walmart'
    ) then
    raise exception 'Proveedor o CEDIS Walmart no válido';
  end if;
  select c.opcion_anterior into v_opcion
  from private.walmart_cambios_acuerdo c
  where c.proveedor_id=p_proveedor_id and c.cedis_id=p_cedis_id
    and c.cambiado_en>p_inicio
  order by c.cambiado_en,c.id limit 1;
  if found then return v_opcion; end if;
  select a.opcion into v_opcion
  from private.walmart_acuerdos a
  where a.proveedor_id=p_proveedor_id and a.cedis_id=p_cedis_id;
  return coalesce(v_opcion,1)::smallint;
end;
$$;
revoke all on function private.walmart_opcion_al_iniciar(bigint,bigint,timestamptz)
  from public, anon, authenticated;

create or replace function public.walmart_cambiar_modelo(
  p_proveedor_id bigint, p_cedis_id bigint, p_opcion smallint
) returns smallint
language plpgsql security definer set search_path = ''
as $$
declare
  v_cliente_id bigint;
  v_rol text;
  v_anterior smallint;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Acceso administrativo requerido';
  end if;
  if p_opcion is null or p_opcion not in (1,2) then
    raise exception 'Selecciona la opción 1 o 2';
  end if;
  select ce.cliente_id into v_cliente_id
  from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
  where ce.id=p_cedis_id and ce.activo and cl.activo
    and public.operativo_normalizar(cl.nombre)='walmart';
  if v_cliente_id is null or not exists (
    select 1 from public.proveedores p where p.id=p_proveedor_id and p.activo
  ) then raise exception 'Proveedor o CEDIS Walmart no válido o inactivo'; end if;
  v_rol := public.operativo_rol_actual();
  if (
    v_rol in ('master','ops') or
    (v_rol='ih' and public.operativo_asignado_a(v_cliente_id,p_cedis_id,'ih'))
  ) is not true then raise exception 'No tienes permiso para cambiar el modelo en este CEDIS'; end if;

  insert into private.walmart_acuerdos(proveedor_id,cedis_id)
    values(p_proveedor_id,p_cedis_id) on conflict do nothing;
  select opcion into v_anterior from private.walmart_acuerdos
    where proveedor_id=p_proveedor_id and cedis_id=p_cedis_id for update;
  if v_anterior <> p_opcion then
    update private.walmart_acuerdos set opcion=p_opcion
      where proveedor_id=p_proveedor_id and cedis_id=p_cedis_id;
    insert into private.walmart_cambios_acuerdo
      (proveedor_id,cedis_id,opcion_anterior,opcion_nueva,actor_id)
      values(p_proveedor_id,p_cedis_id,v_anterior,p_opcion,auth.uid());
  end if;
  return p_opcion;
end;
$$;
revoke all on function public.walmart_cambiar_modelo(bigint,bigint,smallint) from public, anon;
grant execute on function public.walmart_cambiar_modelo(bigint,bigint,smallint) to authenticated;

create or replace function public.walmart_consultar_modelo(
  p_proveedor_id bigint, p_cedis_id bigint
) returns smallint
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cliente_id bigint;
  v_rol text;
  v_opcion smallint;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Acceso administrativo requerido';
  end if;
  select ce.cliente_id into v_cliente_id
  from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
  where ce.id=p_cedis_id and ce.activo and cl.activo
    and public.operativo_normalizar(cl.nombre)='walmart';
  if v_cliente_id is null or not exists (
    select 1 from public.proveedores p where p.id=p_proveedor_id and p.activo
  ) then raise exception 'Proveedor o CEDIS Walmart no válido o inactivo'; end if;
  v_rol := public.operativo_rol_actual();
  if (
    v_rol in ('master','ops') or
    (v_rol='ih' and public.operativo_asignado_a(v_cliente_id,p_cedis_id,'ih'))
  ) is not true then raise exception 'No tienes permiso para consultar el modelo en este CEDIS'; end if;
  select opcion into v_opcion from private.walmart_acuerdos
    where proveedor_id=p_proveedor_id and cedis_id=p_cedis_id;
  return coalesce(v_opcion,1)::smallint;
end;
$$;
revoke all on function public.walmart_consultar_modelo(bigint,bigint) from public, anon;
grant execute on function public.walmart_consultar_modelo(bigint,bigint) to authenticated;

create or replace function private.calcular_walmart_importes(
  p_base numeric, p_porcentaje_semanal numeric,
  p_visitas_asignadas integer, p_visitas_realizadas integer,
  p_aplicar_visitas boolean, p_aplicar_fallida boolean,
  p_registro_fiscal text, p_retencion_fiscal numeric, p_iva numeric, p_comision numeric
) returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_descuento_visitas numeric;
  v_descuento_fallida numeric;
  v_subtotal numeric;
  v_impuesto numeric;
  v_total numeric;
  v_semanal numeric;
  v_comision numeric;
begin
  if p_base is null or p_base::text in ('NaN','Infinity','-Infinity') or p_base < 0
     or p_porcentaje_semanal is null or p_porcentaje_semanal::text in ('NaN','Infinity','-Infinity')
     or p_porcentaje_semanal not between 0 and 1
     or ((p_aplicar_visitas is true or p_visitas_asignadas is not null or p_visitas_realizadas is not null)
       and (p_visitas_asignadas is null or p_visitas_asignadas <= 0
         or p_visitas_realizadas is null or p_visitas_realizadas < 0
         or p_visitas_realizadas > p_visitas_asignadas))
     or p_aplicar_visitas is null or p_aplicar_fallida is null
     or p_registro_fiscal is null or p_registro_fiscal not in ('FACTURA','SIN FACTURA')
     or p_retencion_fiscal is null or p_retencion_fiscal::text in ('NaN','Infinity','-Infinity') or p_retencion_fiscal not between 0 and 1
     or p_iva is null or p_iva::text in ('NaN','Infinity','-Infinity') or p_iva not between 0 and 1
     or p_comision is null or p_comision::text in ('NaN','Infinity','-Infinity') or p_comision not between 0 and 1 then
    raise exception 'Datos inválidos para calcular el pago Walmart';
  end if;
  v_descuento_visitas := case when p_aplicar_visitas
    then round(p_base * (p_visitas_asignadas-p_visitas_realizadas) / p_visitas_asignadas,2) else 0 end;
  v_descuento_fallida := case when p_aplicar_fallida then round(p_base * 0.05,2) else 0 end;
  v_subtotal := round(p_base-v_descuento_visitas-v_descuento_fallida,2);
  if v_subtotal < 0 then raise exception 'Las penalizaciones exceden el pago base'; end if;
  v_impuesto := case when p_registro_fiscal='FACTURA'
    then round(v_subtotal*p_iva,2) else -round(v_subtotal*p_retencion_fiscal,2) end;
  v_total := v_subtotal+v_impuesto;
  v_semanal := round(v_total*p_porcentaje_semanal,2);
  v_comision := case when p_registro_fiscal='SIN FACTURA'
    then round(v_total*p_comision,2) else 0 end;
  return jsonb_build_object(
    'pago_base',p_base,'descuento_visitas',v_descuento_visitas,
    'descuento_fallida',v_descuento_fallida,'subtotal',v_subtotal,
    'impuesto',v_impuesto,'total',v_total,'comision',v_comision,
    'costo_total_imp',v_total+v_comision,
    'pago_semanal',v_semanal,'saldo_retenido',v_total-v_semanal
  );
end;
$$;
revoke all on function private.calcular_walmart_importes(numeric,numeric,integer,integer,boolean,boolean,text,numeric,numeric,numeric)
  from public, anon, authenticated;

-- El modelo debe provenir de la instantánea de inicio o de una revisión
-- autorizada; no consultar el acuerdo actual al liquidar rutas anteriores.
create or replace function private.calcular_walmart_tarifa_configurada(
  p_cedis_id bigint, p_fecha date, p_unidad text, p_opcion smallint,
  p_visitas_asignadas integer, p_visitas_realizadas integer,
  p_aplicar_visitas boolean, p_aplicar_fallida boolean,
  p_registro_fiscal text, p_retencion_fiscal numeric, p_iva numeric, p_comision numeric
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_unidad text;
  v_tarifa public.walmart_tarifas%rowtype;
  v_count integer;
  v_base numeric;
  v_semanal numeric;
begin
  if p_cedis_id is null or p_fecha is null or p_opcion is null or p_opcion not in (1,2) then
    raise exception 'Se requiere CEDIS, fecha y modelo Walmart confirmado';
  end if;
  v_unidad := case public.operativo_normalizar(p_unidad)
    when '35t' then '3.5T'
    when '35tn' then '3.5T'
    when 'large' then 'Large'
    when 'largevan' then 'Large'
    when '15tn' then 'Large'
    else null end;
  if v_unidad is null then raise exception 'Unidad sin tarifa Walmart confirmada'; end if;
  select count(*) into v_count from public.walmart_tarifas t
  where t.cedis_id=p_cedis_id and t.tipo_unidad=v_unidad
    and t.esquema='RUTA' and t.zona='LOCAL' and t.variable='REGULAR'
    and p_fecha between t.vigencia_desde and t.vigencia_hasta;
  if v_count <> 1 then
    raise exception 'Se requiere una sola tarifa Walmart vigente para el CEDIS y unidad; encontradas %',v_count;
  end if;
  select * into strict v_tarifa from public.walmart_tarifas t
  where t.cedis_id=p_cedis_id and t.tipo_unidad=v_unidad
    and t.esquema='RUTA' and t.zona='LOCAL' and t.variable='REGULAR'
    and p_fecha between t.vigencia_desde and t.vigencia_hasta;
  v_base := case p_opcion when 1 then v_tarifa.pago_opcion_1 else v_tarifa.pago_opcion_2 end;
  v_semanal := case p_opcion when 1 then v_tarifa.semanal_opcion_1 else v_tarifa.semanal_opcion_2 end;
  return private.calcular_walmart_importes(v_base,v_semanal,
    p_visitas_asignadas,p_visitas_realizadas,p_aplicar_visitas,p_aplicar_fallida,
    p_registro_fiscal,p_retencion_fiscal,p_iva,p_comision)
    || jsonb_build_object('tarifa_id',v_tarifa.id,'cedis_id',v_tarifa.cedis_id,
      'tipo_unidad',v_unidad,'opcion',p_opcion,'porcentaje_semanal',v_semanal,
      'tarifa_cliente',v_tarifa.tarifa_cliente,'vigencia_desde',v_tarifa.vigencia_desde,
      'vigencia_hasta',v_tarifa.vigencia_hasta);
end;
$$;
revoke all on function private.calcular_walmart_tarifa_configurada(bigint,date,text,smallint,integer,integer,boolean,boolean,text,numeric,numeric,numeric)
  from public, anon, authenticated;

-- Solo calcula; el pago requiere revisión de evidencia, aprobación y conciliación.
create or replace function private.calcular_walmart_cancelacion_configurada(
  p_cedis_id bigint, p_fecha date, p_unidad text, p_opcion smallint,
  p_registro_fiscal text, p_retencion_fiscal numeric, p_iva numeric, p_comision numeric
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_config jsonb;
  v_base numeric;
  v_semanal numeric;
begin
  v_config := private.calcular_walmart_tarifa_configurada(
    p_cedis_id,p_fecha,p_unidad,p_opcion,1,1,false,false,
    p_registro_fiscal,p_retencion_fiscal,p_iva,p_comision
  );
  v_base := (v_config->>'pago_base')::numeric;
  v_semanal := (v_config->>'porcentaje_semanal')::numeric;
  return private.calcular_walmart_importes(
    round(v_base*0.40,2),v_semanal,1,1,false,false,
    p_registro_fiscal,p_retencion_fiscal,p_iva,p_comision
  ) || jsonb_build_object(
    'tarifa_id',v_config->'tarifa_id','cedis_id',v_config->'cedis_id',
    'tipo_unidad',v_config->'tipo_unidad','opcion',v_config->'opcion',
    'porcentaje_semanal',v_semanal,'base_servicio',v_base,
    'porcentaje_cancelacion',0.40,
    'vigencia_desde',v_config->'vigencia_desde','vigencia_hasta',v_config->'vigencia_hasta'
  );
end;
$$;
revoke all on function private.calcular_walmart_cancelacion_configurada(bigint,date,text,smallint,text,numeric,numeric,numeric)
  from public, anon, authenticated;

alter table public.rutas
  add column if not exists walmart_visitas_asignadas integer,
  add column if not exists walmart_visitas_realizadas integer,
  add column if not exists walmart_folios_avaya text[],
  add column if not exists walmart_requiere_revision boolean;

alter table public.cancelaciones add column if not exists foto_bitacora_path text;

create or replace function private.validar_bitacora_cancelacion_walmart()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='UPDATE' and new.foto_bitacora_path is distinct from old.foto_bitacora_path then
    raise exception 'La evidencia de bitácora registrada no puede modificarse';
  end if;
  if new.foto_bitacora_path is null then return new; end if;
  if not exists (
    select 1 from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
    where ce.id=new.cedis_id and public.operativo_normalizar(cl.nombre)='walmart'
  ) then raise exception 'La foto de bitácora solo corresponde a cancelaciones Walmart'; end if;
  if new.foto_bitacora_path=new.foto_path
    or left(new.foto_bitacora_path,length(new.driver_id::text)+1)<>new.driver_id::text||'/'
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id='cancelaciones' and o.name=new.foto_bitacora_path
    ) then raise exception 'La foto de bitácora Walmart no es válida o no se ha subido'; end if;
  return new;
end;
$$;
revoke all on function private.validar_bitacora_cancelacion_walmart() from public, anon, authenticated;
drop trigger if exists validar_bitacora_cancelacion_walmart on public.cancelaciones;
create trigger validar_bitacora_cancelacion_walmart
before insert or update of foto_bitacora_path, foto_path, driver_id, cedis_id on public.cancelaciones
for each row execute function private.validar_bitacora_cancelacion_walmart();

-- La liquidación pendiente debe bloquear las rutas marcadas para revisión.
create or replace function private.validar_visitas_walmart()
returns trigger language plpgsql set search_path = ''
as $$
declare v_walmart boolean;
begin
  select public.operativo_normalizar(cl.nombre)='walmart' into v_walmart
  from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
  where ce.id=new.cedis_id;
  if v_walmart is not true then return new; end if;
  if old.estado='cerrada' and
    (new.walmart_visitas_asignadas is distinct from old.walmart_visitas_asignadas
     or new.walmart_visitas_realizadas is distinct from old.walmart_visitas_realizadas
     or new.walmart_folios_avaya is distinct from old.walmart_folios_avaya
     or new.walmart_requiere_revision is distinct from old.walmart_requiere_revision) then
    raise exception 'Los datos de visitas de una ruta cerrada no pueden modificarse';
  end if;
  if old.estado <> 'cerrada' and new.estado='cerrada' then
    if new.walmart_visitas_asignadas is null and new.walmart_visitas_realizadas is null
      and new.walmart_folios_avaya is null then
      new.walmart_requiere_revision := true;
      return new;
    end if;
    if new.walmart_visitas_asignadas is null or new.walmart_visitas_asignadas < 1
      or new.walmart_visitas_realizadas is null or new.walmart_visitas_realizadas < 0
      or new.walmart_visitas_realizadas > new.walmart_visitas_asignadas then
      raise exception 'Registra las visitas asignadas y realizadas de Walmart';
    end if;
    if coalesce(cardinality(new.walmart_folios_avaya),0)>100 or exists (
      select 1 from unnest(new.walmart_folios_avaya) f
      where f is null or length(btrim(f)) not between 1 and 120
    ) then raise exception 'Los folios Avaya son inválidos'; end if;
    if coalesce(new.fallidos,0)>0 and coalesce(cardinality(new.walmart_folios_avaya),0)=0 then
      raise exception 'Captura al menos un folio Avaya cuando haya entregas fallidas';
    end if;
    new.walmart_requiere_revision := false;
  end if;
  return new;
end;
$$;
drop trigger if exists validar_visitas_walmart on public.rutas;
create trigger validar_visitas_walmart before update on public.rutas
for each row execute function private.validar_visitas_walmart();

do $$
declare
  t record;
  v_cedis_id bigint;
  v_count integer;
begin
  for t in
    select * from (values
      ('DS Querétaro', '3.5T', 5565.50::numeric, 4500::numeric, 4200::numeric, 0.75::numeric, 0.85::numeric),
      ('DS Veracruz', '3.5T', 5565.50::numeric, 4500::numeric, 4200::numeric, 0.85::numeric, 0.90::numeric),
      ('FC Guadalajara', 'Large', 3969::numeric, 3200::numeric, 3000::numeric, 0.75::numeric, 0.85::numeric),
      ('FC Mérida', 'Large', 4500::numeric, 3600::numeric, 3400::numeric, 0.85::numeric, 0.90::numeric)
    ) as datos(centro, unidad, cobro, opcion_1, opcion_2, semanal_1, semanal_2)
  loop
    select count(*), min(ce.id) into v_count, v_cedis_id
    from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
    where public.operativo_normalizar(cl.nombre)='walmart'
      and public.operativo_normalizar(ce.nombre)=public.operativo_normalizar(t.centro)
      and ce.activo and cl.activo;
    if v_count <> 1 then
      raise exception 'Se requiere exactamente un CEDIS Walmart activo para %; encontrados %',t.centro,v_count;
    end if;

    if exists (
      select 1 from public.walmart_tarifas w
      where w.cedis_id=v_cedis_id and w.tipo_unidad=t.unidad and w.esquema='RUTA'
        and w.zona='LOCAL' and w.variable='REGULAR'
        and w.vigencia_desde <> date '2026-11-09'
        and w.vigencia_desde <= date '2026-12-31'
        and w.vigencia_hasta >= date '2026-11-09'
    ) then
      raise exception 'La tarifa existente de % se superpone con la vigencia Walmart; revisa antes de continuar',t.centro;
    end if;

    insert into public.walmart_tarifas
      (cedis_id,tipo_unidad,esquema,zona,variable,vigencia_desde,vigencia_hasta,
       tarifa_cliente,pago_opcion_1,pago_opcion_2,semanal_opcion_1,semanal_opcion_2)
    values
      (v_cedis_id,t.unidad,'RUTA','LOCAL','REGULAR','2026-11-09','2026-12-31',
       t.cobro,t.opcion_1,t.opcion_2,t.semanal_1,t.semanal_2)
    on conflict (cedis_id,tipo_unidad,esquema,zona,variable,vigencia_desde) do nothing;

    if not exists (
      select 1 from public.walmart_tarifas w
      where w.cedis_id=v_cedis_id and w.tipo_unidad=t.unidad and w.esquema='RUTA'
        and w.zona='LOCAL' and w.variable='REGULAR' and w.vigencia_desde='2026-11-09'
        and w.vigencia_hasta='2026-12-31' and w.tarifa_cliente=t.cobro
        and w.pago_opcion_1=t.opcion_1 and w.pago_opcion_2=t.opcion_2
        and w.semanal_opcion_1=t.semanal_1 and w.semanal_opcion_2=t.semanal_2
    ) then
      raise exception 'La tarifa existente de % difiere del archivo; revisa antes de continuar',t.centro;
    end if;
  end loop;
end;
$$;

commit;

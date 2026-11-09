-- ENSAYO REVERSIBLE: ejecutar solo en el proyecto de Supabase de pruebas.
-- Copia TODO el archivo. Es una sola sentencia: el error ENSAYO OK es intencional.
-- Al terminar, PostgreSQL revierte toda esta sentencia; no crea pagos persistentes.
do $walmart_ensayo$
begin
  -- walmart-tarifario.sql
  execute $walmart_fuente_0$
-- BORRADOR: no ejecutar ni publicar hasta integrar y probar el flujo completo de Walmart.
-- Los importes son los del CSV confirmado; las rutas y pagos previos no se modifican.


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



$walmart_fuente_0$;
  -- walmart-retencion-borrador.sql
  execute $walmart_fuente_1$
-- BORRADOR: no ejecutar ni publicar hasta integrar la validacion y los pagos.
-- La decision de retencion es independiente del tratamiento fiscal.


create or replace function private.walmart_aplicar_porcentaje_retencion(
  p_calculo jsonb,p_porcentaje smallint
) returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_total numeric;
  v_retenido numeric;
begin
  if p_porcentaje is null or p_porcentaje not in (0,10,15,25)
    or jsonb_typeof(p_calculo) is distinct from 'object' then
    raise exception 'Selecciona una retencion Walmart de 0, 10, 15 o 25 por ciento';
  end if;
  v_total:=(p_calculo->>'total')::numeric;
  if v_total is null or v_total::text in ('NaN','Infinity','-Infinity') or v_total<0 then
    raise exception 'El total Walmart no es valido';
  end if;
  v_retenido:=round(v_total*p_porcentaje/100,2);
  return p_calculo||jsonb_build_object('porcentaje_retencion',p_porcentaje,
    'porcentaje_semanal',(100-p_porcentaje)::numeric/100,
    'aplicar_retencion',p_porcentaje>0,'pago_semanal',v_total-v_retenido,'saldo_retenido',v_retenido);
end;
$$;
revoke all on function private.walmart_aplicar_porcentaje_retencion(jsonb,smallint) from public, anon, authenticated;

create or replace function private.calcular_walmart_ruta_con_retencion(
  p_cedis_id bigint, p_fecha date, p_unidad text, p_opcion smallint,
  p_visitas_asignadas integer, p_visitas_realizadas integer,
  p_aplicar_visitas boolean, p_aplicar_fallida boolean,
  p_registro_fiscal text, p_retencion_fiscal numeric, p_iva numeric, p_comision numeric,
  p_aplicar_retencion boolean
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_calculo jsonb;
begin
  if p_aplicar_retencion is null then
    raise exception 'Se requiere una decision de retencion Walmart';
  end if;

  v_calculo := private.calcular_walmart_tarifa_configurada(
    p_cedis_id, p_fecha, p_unidad, p_opcion,
    p_visitas_asignadas, p_visitas_realizadas, p_aplicar_visitas, p_aplicar_fallida,
    p_registro_fiscal, p_retencion_fiscal, p_iva, p_comision
  );
  if not p_aplicar_retencion then
    v_calculo := v_calculo || jsonb_build_object(
      'pago_semanal', (v_calculo->>'total')::numeric,
      'saldo_retenido', 0
    );
  end if;
  return v_calculo || jsonb_build_object('aplicar_retencion', p_aplicar_retencion);
end;
$$;

revoke all on function private.calcular_walmart_ruta_con_retencion(
  bigint,date,text,smallint,integer,integer,boolean,boolean,text,numeric,numeric,numeric,boolean
) from public, anon, authenticated;



$walmart_fuente_1$;
  -- walmart-decision-retencion-borrador.sql
  execute $walmart_fuente_2$
-- BORRADOR: no ejecutar ni publicar hasta integrar y probar el flujo completo.


create table if not exists private.walmart_decisiones_retencion (
  ruta_id bigint primary key references public.rutas(id),
  aplicar_retencion boolean not null,
  porcentaje_retencion smallint check (porcentaje_retencion in (0,10,15,25)),
  seleccionado_por uuid not null references public.drivers(id),
  seleccionado_en timestamptz not null default clock_timestamp()
);
revoke all on private.walmart_decisiones_retencion from public, anon, authenticated;

create table if not exists private.walmart_proveedores_confirmados (
  ruta_id bigint primary key references public.rutas(id),
  proveedor_id bigint not null references public.proveedores(id),
  opcion smallint not null check (opcion in (1,2)),
  confirmado_por uuid not null references public.drivers(id),
  confirmado_en timestamptz not null default clock_timestamp()
);
revoke all on private.walmart_proveedores_confirmados from public, anon, authenticated;

create or replace function public.walmart_consultar_retencion(p_ruta_id bigint)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_aplicar boolean;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or private.es_valida() is not true
    or not exists (
      select 1 from public.rutas r
      join public.cedis ce on ce.id=r.cedis_id
      join public.clientes cl on cl.id=ce.cliente_id
      where r.id=p_ruta_id and r.estado='cerrada'
        and public.operativo_normalizar(cl.nombre)='walmart'
        and public.operativo_asignado_a(ce.cliente_id,ce.id,'ih') is true
    ) then
    raise exception 'Solo el supervisor asignado puede consultar la retencion de una ruta Walmart cerrada';
  end if;
  select d.aplicar_retencion into v_aplicar
    from private.walmart_decisiones_retencion d where d.ruta_id=p_ruta_id;
  return coalesce(v_aplicar,true);
end;
$$;
revoke all on function public.walmart_consultar_retencion(bigint) from public, anon;
grant execute on function public.walmart_consultar_retencion(bigint) to authenticated;

create or replace function public.walmart_elegir_retencion(p_ruta_id bigint, p_aplicar boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_ruta record;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or private.es_valida() is not true then
    raise exception 'Solo el supervisor autorizado puede elegir la retencion Walmart';
  end if;
  if p_aplicar is null then raise exception 'Selecciona si aplica la retencion Walmart'; end if;
  select r.id,r.estado,r.cedis_id,ce.cliente_id,cl.nombre as cliente
    into v_ruta
    from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=p_ruta_id for update of r;
  if not found or v_ruta.estado is distinct from 'cerrada'
    or public.operativo_normalizar(v_ruta.cliente)<>'walmart'
    or public.operativo_asignado_a(v_ruta.cliente_id,v_ruta.cedis_id,'ih') is not true then
    raise exception 'Ruta Walmart cerrada y asignada requerida';
  end if;
  if exists (select 1 from public.liquidaciones l where l.ruta_id=p_ruta_id)
    or exists (select 1 from public.pagos p where p.ruta_id=p_ruta_id)
    or exists (select 1 from public.validaciones_pendientes v
      where v.ruta_id=p_ruta_id and v.estatus='pendiente') then
    raise exception 'No se puede cambiar la retencion de una ruta validada, con pagos o pendiente de aprobacion';
  end if;
  insert into private.walmart_decisiones_retencion(ruta_id,aplicar_retencion,seleccionado_por)
    values(p_ruta_id,p_aplicar,auth.uid())
  on conflict (ruta_id) do update set aplicar_retencion=excluded.aplicar_retencion,
    porcentaje_retencion=null,
    seleccionado_por=excluded.seleccionado_por,seleccionado_en=clock_timestamp();
  return p_aplicar;
end;
$$;
revoke all on function public.walmart_elegir_retencion(bigint,boolean) from public, anon;
grant execute on function public.walmart_elegir_retencion(bigint,boolean) to authenticated;

create or replace function public.walmart_confirmar_proveedor_ruta(
  p_ruta_id bigint, p_proveedor_id bigint
) returns smallint language plpgsql security definer set search_path = ''
as $$
declare
  v_ruta record;
  v_opcion smallint;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or private.es_valida() is not true then
    raise exception 'Solo el supervisor autorizado puede confirmar el proveedor Walmart';
  end if;
  select r.id,r.estado,r.cedis_id,r.checkin_at,ce.cliente_id,cl.nombre as cliente
    into v_ruta
    from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=p_ruta_id for update of r;
  if not found or v_ruta.estado is distinct from 'cerrada'
    or public.operativo_normalizar(v_ruta.cliente)<>'walmart'
    or public.operativo_asignado_a(v_ruta.cliente_id,v_ruta.cedis_id,'ih') is not true then
    raise exception 'Ruta Walmart cerrada y asignada requerida';
  end if;
  if p_proveedor_id is null or not exists (
    select 1 from public.proveedores p where p.id=p_proveedor_id
  ) then raise exception 'Confirma un proveedor existente para la ruta Walmart'; end if;
  if exists (select 1 from public.liquidaciones l where l.ruta_id=p_ruta_id)
    or exists (select 1 from public.pagos p where p.ruta_id=p_ruta_id)
    or exists (select 1 from public.validaciones_pendientes v
      where v.ruta_id=p_ruta_id and v.estatus='pendiente') then
    raise exception 'No se puede cambiar el proveedor de una ruta validada, con pagos o pendiente de aprobacion';
  end if;
  insert into private.walmart_acuerdos(proveedor_id,cedis_id)
    values(p_proveedor_id,v_ruta.cedis_id) on conflict do nothing;
  perform 1 from private.walmart_acuerdos a
    where a.proveedor_id=p_proveedor_id and a.cedis_id=v_ruta.cedis_id for update;
  v_opcion := private.walmart_opcion_al_iniciar(p_proveedor_id,v_ruta.cedis_id,v_ruta.checkin_at);
  insert into private.walmart_proveedores_confirmados(
    ruta_id,proveedor_id,opcion,confirmado_por
  ) values (p_ruta_id,p_proveedor_id,v_opcion,auth.uid())
  on conflict (ruta_id) do update set
    proveedor_id=excluded.proveedor_id,opcion=excluded.opcion,
    confirmado_por=excluded.confirmado_por,confirmado_en=clock_timestamp();
  return v_opcion;
end;
$$;
revoke all on function public.walmart_confirmar_proveedor_ruta(bigint,bigint) from public, anon;
grant execute on function public.walmart_confirmar_proveedor_ruta(bigint,bigint) to authenticated;

create or replace function private.walmart_calcular_decision_guardada(
  p_ruta_id bigint,
  p_aplicar_visitas boolean, p_aplicar_fallida boolean,
  p_registro_fiscal text, p_retencion_fiscal numeric, p_iva numeric, p_comision numeric
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_ruta record;
  v_decision record;
  v_proveedor record;
  v_calculo jsonb;
begin
  select r.id,r.cedis_id,r.tipo_unidad,r.checkin_at,r.estado,
         r.walmart_visitas_asignadas,r.walmart_visitas_realizadas,
         r.walmart_requiere_revision,cl.nombre as cliente
    into v_ruta
    from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=p_ruta_id for update of r;
  if not found or v_ruta.estado is distinct from 'cerrada'
    or public.operativo_normalizar(v_ruta.cliente)<>'walmart' then
    raise exception 'Se requiere una ruta Walmart cerrada';
  end if;
  if p_aplicar_visitas is true and v_ruta.walmart_requiere_revision is distinct from false then
    raise exception 'Las visitas Walmart requieren revision antes de calcular el pago';
  end if;
  select d.aplicar_retencion,d.porcentaje_retencion,d.seleccionado_por,d.seleccionado_en
    into v_decision from private.walmart_decisiones_retencion d
    where d.ruta_id=p_ruta_id;
  if not found then
    raise exception 'El supervisor debe confirmar la retencion Walmart antes de calcular el pago';
  end if;
  select p.proveedor_id,p.opcion,p.confirmado_por,p.confirmado_en
    into v_proveedor from private.walmart_proveedores_confirmados p
    where p.ruta_id=p_ruta_id;
  if not found then
    raise exception 'El supervisor debe confirmar el proveedor Walmart antes de calcular el pago';
  end if;
  v_calculo := private.calcular_walmart_ruta_con_retencion(
    v_ruta.cedis_id,(v_ruta.checkin_at at time zone 'America/Mexico_City')::date,
    v_ruta.tipo_unidad,v_proveedor.opcion,v_ruta.walmart_visitas_asignadas,
    v_ruta.walmart_visitas_realizadas,p_aplicar_visitas,p_aplicar_fallida,
    p_registro_fiscal,p_retencion_fiscal,p_iva,p_comision,v_decision.aplicar_retencion
  );
  if v_decision.porcentaje_retencion is not null then
    v_calculo:=private.walmart_aplicar_porcentaje_retencion(v_calculo,v_decision.porcentaje_retencion);
  end if;
  return v_calculo || jsonb_build_object(
    'ruta_id',v_ruta.id,'retencion_seleccionada_por',v_decision.seleccionado_por,
    'retencion_seleccionada_en',v_decision.seleccionado_en,
    'proveedor_id',v_proveedor.proveedor_id,'proveedor_confirmado_por',v_proveedor.confirmado_por,
    'proveedor_confirmado_en',v_proveedor.confirmado_en
  );
end;
$$;
revoke all on function private.walmart_calcular_decision_guardada(
  bigint,boolean,boolean,text,numeric,numeric,numeric
) from public, anon, authenticated;

create or replace function public.walmart_previsualizar_ruta(
  p_ruta_id bigint, p_proveedor_id bigint, p_aplicar_retencion boolean,
  p_aplicar_visitas boolean, p_aplicar_fallida boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_registro text;
  v_retencion numeric;
  v_iva numeric;
  v_comision numeric;
begin
  perform public.walmart_confirmar_proveedor_ruta(p_ruta_id,p_proveedor_id);
  perform public.walmart_elegir_retencion(p_ruta_id,p_aplicar_retencion);
  select p.tipo_registro into v_registro from public.proveedores p where p.id=p_proveedor_id;
  if v_registro is null or v_registro not in ('FACTURA','SIN FACTURA') then
    raise exception 'El proveedor no tiene un registro fiscal valido';
  end if;
  select max(valor) filter (where clave='retencion_sin_factura'),
         max(valor) filter (where clave='iva'),
         max(valor) filter (where clave='comision_sin_factura')
    into v_retencion,v_iva,v_comision from public.parametros_pago
    where clave in ('retencion_sin_factura','iva','comision_sin_factura');
  return private.walmart_calcular_decision_guardada(
    p_ruta_id,p_aplicar_visitas,p_aplicar_fallida,
    v_registro,v_retencion,v_iva,v_comision
  ) || jsonb_build_object('aplicar_visitas',p_aplicar_visitas,'aplicar_fallida',p_aplicar_fallida);
end;
$$;
revoke all on function public.walmart_previsualizar_ruta(bigint,bigint,boolean,boolean,boolean)
  from public, anon;
grant execute on function public.walmart_previsualizar_ruta(bigint,bigint,boolean,boolean,boolean)
  to authenticated;

create or replace function public.walmart_previsualizar_ruta_porcentaje(
  p_ruta_id bigint,p_proveedor_id bigint,p_porcentaje_retencion smallint,
  p_aplicar_visitas boolean,p_aplicar_fallida boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_calculo jsonb;
  v_decision private.walmart_decisiones_retencion%rowtype;
begin
  if p_porcentaje_retencion is null or p_porcentaje_retencion not in (0,10,15,25) then
    raise exception 'Selecciona una retencion Walmart de 0, 10, 15 o 25 por ciento';
  end if;
  v_calculo:=public.walmart_previsualizar_ruta(
    p_ruta_id,p_proveedor_id,p_porcentaje_retencion>0,p_aplicar_visitas,p_aplicar_fallida
  );
  update private.walmart_decisiones_retencion set porcentaje_retencion=p_porcentaje_retencion
    where ruta_id=p_ruta_id returning * into strict v_decision;
  return private.walmart_aplicar_porcentaje_retencion(v_calculo,p_porcentaje_retencion)
    ||jsonb_build_object('retencion_seleccionada_por',v_decision.seleccionado_por,
      'retencion_seleccionada_en',v_decision.seleccionado_en);
end;
$$;
revoke all on function public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean) from public, anon;
grant execute on function public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean) to authenticated;



$walmart_fuente_2$;
  -- walmart-no-show-borrador.sql
  execute $walmart_fuente_3$
-- BORRADOR: no instalar ni activar. La captura y apelaciones nuevas dependen de
-- walmart-no-show-flujo-borrador.sql; faltan casos heredados y pruebas reales.


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



$walmart_fuente_3$;
  -- walmart-no-show-flujo-borrador.sql
  execute $walmart_fuente_4$
-- BORRADOR: no activar sin pruebas reales de permisos y concurrencia.
-- Depende de walmart-no-show-borrador.sql y el mapeo de tarifas Walmart.


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



$walmart_fuente_4$;
  -- walmart-precierre-no-show-borrador.sql
  execute $walmart_fuente_5$
-- BORRADOR: no instalar ni activar antes de validar permisos y concurrencia.
-- Requiere los borradores Walmart de NO SHOW, liquidaciones y cancelaciones.


create table if not exists private.walmart_no_show_decisiones (
  caso_id uuid primary key references public.no_show_casos(id),
  solicitud_id uuid not null unique,
  driver_id uuid not null references public.drivers(id),
  proveedor_id bigint not null references public.proveedores(id),
  lunes date not null check (extract(isodow from lunes)=1),
  monto numeric(12,2) not null check (monto>0),
  pago_id bigint not null unique references public.pagos(id),
  registrado_por uuid not null references public.drivers(id),
  registrado_en timestamptz not null default clock_timestamp()
);
revoke all on private.walmart_no_show_decisiones from public, anon, authenticated;

create or replace function public.walmart_consultar_no_show_precierre(p_driver_id uuid,p_lunes date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actual date:=(pg_catalog.now() at time zone 'America/Mexico_City')::date;
  v_casos jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede consultar el precierre Walmart';
  end if;
  if p_driver_id is null or p_lunes is null or extract(isodow from p_lunes)<>1 then
    raise exception 'Selecciona un driver y el lunes de la semana';
  end if;
  v_actual:=v_actual-(extract(isodow from v_actual)::integer-1);
  if exists (
    select 1 from public.no_show_casos c
    left join private.walmart_no_show_reportes r on r.caso_id=c.id
    where c.driver_id=p_driver_id and public.operativo_normalizar(c.cuenta)='walmart'
      and coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en))<=p_lunes
      and public.operativo_asignado_a(c.cliente_id,c.cedis_id,'ih') is not true
  ) then raise exception 'Se requiere acceso a todos los CEDIS de los NO SHOW'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'caso_id',c.id,'fecha_servicio',c.fecha_servicio,'cedis_id',c.cedis_id,
    'cedis',c.cedis_nombre,'proveedor_id',c.proveedor_id,'estado',c.estado,
    'semana_registro',coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en)),'monto',c.monto_penalizacion,
    'semana_aplicada',d.lunes,'aplicado',d.caso_id is not null,
    'seleccionable',coalesce(
      r.caso_id is not null and d.caso_id is null and p_lunes>=v_actual
      and c.pago_penalizacion_id is null and c.pago_reversion_id is null
      and c.proveedor_id=r.proveedor_id
      and c.monto_penalizacion>0
      and c.monto_penalizacion=round(c.valor_servicio_contratado*0.60,2)
      and (s.caso_id is null or (s.proveedor_id=c.proveedor_id and s.driver_id=c.driver_id
        and s.monto=c.monto_penalizacion and s.saldo_pendiente=s.monto and s.monto_aplicado=0))
      and ((c.estado='reportado' and c.vence_apelacion_en<=pg_catalog.now()
          and c.vence_apelacion_en<=((p_lunes+4)::timestamp+interval '18 hours') at time zone 'America/Mexico_City')
        or (c.estado='apelacion_rechazada' and c.resuelto_en is not null
          and c.resuelto_en<=pg_catalog.now()
          and c.resuelto_en<=((p_lunes+4)::timestamp+interval '18 hours') at time zone 'America/Mexico_City')),false)
  ) order by coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en)),c.fecha_servicio,c.id),'[]'::jsonb) into v_casos
  from public.no_show_casos c
  left join private.walmart_no_show_reportes r on r.caso_id=c.id
  left join private.walmart_no_show_saldos s on s.caso_id=c.id
  left join private.walmart_no_show_decisiones d on d.caso_id=c.id
  where c.driver_id=p_driver_id and public.operativo_normalizar(c.cuenta)='walmart'
    and coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en))<=p_lunes
    and (d.caso_id is null or d.lunes=p_lunes);
  return jsonb_build_object('driver_id',p_driver_id,'lunes',p_lunes,
    'cantidad',jsonb_array_length(v_casos),'casos',v_casos);
end;
$$;
revoke all on function public.walmart_consultar_no_show_precierre(uuid,date) from public, anon;
grant execute on function public.walmart_consultar_no_show_precierre(uuid,date) to authenticated;

create or replace function public.walmart_aplicar_no_show_precierre(
  p_solicitud_id uuid,p_caso_id uuid,p_lunes date,p_monto_esperado numeric
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_caso public.no_show_casos%rowtype;
  v_reporte private.walmart_no_show_reportes%rowtype;
  v_existente private.walmart_no_show_decisiones%rowtype;
  v_semana jsonb;
  v_caso_revisado jsonb;
  v_pago bigint;
  v_cerrada boolean;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede aplicar el NO SHOW';
  end if;
  if p_solicitud_id is null or p_caso_id is null or p_lunes is null
    or p_monto_esperado is null or p_monto_esperado::text in ('NaN','Infinity','-Infinity')
    or p_monto_esperado<=0 or p_monto_esperado<>round(p_monto_esperado,2) then
    raise exception 'Selecciona un caso y revisa el importe';
  end if;
  select * into v_caso from public.no_show_casos where id=p_caso_id;
  if not found or v_caso.proveedor_id is null
    or public.operativo_asignado_a(v_caso.cliente_id,v_caso.cedis_id,'ih') is not true then
    raise exception 'NO SHOW no encontrado o no asignado';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('walmart-no-show-decision:'||p_solicitud_id::text,0));
  perform private.walmart_no_show_bloquear(v_caso.proveedor_id,v_caso.driver_id);
  select * into v_caso from public.no_show_casos where id=p_caso_id for update;
  select * into v_reporte from private.walmart_no_show_reportes where caso_id=p_caso_id;
  if not found then raise exception 'El NO SHOW anterior requiere revision manual'; end if;
  select * into v_existente from private.walmart_no_show_decisiones
    where caso_id=p_caso_id or solicitud_id=p_solicitud_id;
  if found then
    if v_existente.caso_id is distinct from p_caso_id or v_existente.solicitud_id is distinct from p_solicitud_id
      or v_existente.lunes is distinct from p_lunes or v_existente.monto is distinct from p_monto_esperado
      or v_existente.registrado_por is distinct from auth.uid() then
      raise exception 'El NO SHOW o la solicitud ya tiene una decision diferente';
    end if;
    if not exists (select 1 from public.pagos p where p.id=v_existente.pago_id
      and p.driver_id=v_existente.driver_id and p.proveedor_id=v_existente.proveedor_id
      and p.ruta_id is null and p.concepto='ajuste' and p.monto=-v_existente.monto
      and p.fecha=v_existente.lunes and p.estatus in ('pendiente','pagado')) then
      raise exception 'El pago NO SHOW requiere revision';
    end if;
    return to_jsonb(v_existente);
  end if;
  if to_regprocedure('private.coppel_peak_bloqueo_semana(uuid,date)') is not null then
    execute 'select private.coppel_peak_bloqueo_semana($1,$2)' using v_caso.driver_id,p_lunes;
  end if;
  if to_regclass('private.coppel_peak_cierres') is not null then
    execute 'select exists(select 1 from private.coppel_peak_cierres where driver_id=$1 and lunes=$2)'
      into v_cerrada using v_caso.driver_id,p_lunes;
    if v_cerrada then raise exception 'La semana de destino ya esta cerrada'; end if;
  end if;
  v_semana:=public.walmart_consultar_no_show_precierre(v_caso.driver_id,p_lunes);
  select x into v_caso_revisado from jsonb_array_elements(v_semana->'casos') x where x->>'caso_id'=p_caso_id::text;
  if v_caso_revisado is null or (v_caso_revisado->>'seleccionable')::boolean is not true
    or (v_caso_revisado->>'monto')::numeric is distinct from p_monto_esperado then
    raise exception 'El NO SHOW no esta disponible o cambio; vuelve a revisar el precierre';
  end if;
  perform private.walmart_registrar_saldo_no_show(p_caso_id,v_reporte.opcion,
    v_reporte.calculo-'proveedor_id'-'fecha_servicio');
  update private.walmart_no_show_saldos set saldo_pendiente=0,monto_aplicado=monto
    where caso_id=p_caso_id and saldo_pendiente=monto and monto_aplicado=0;
  if not found then raise exception 'El saldo NO SHOW cambio; vuelve a revisar'; end if;
  insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
    values(v_caso.driver_id,v_caso.proveedor_id,null,'ajuste',-p_monto_esperado,p_lunes,'pendiente')
    returning id into v_pago;
  insert into private.walmart_no_show_decisiones(caso_id,solicitud_id,driver_id,proveedor_id,lunes,monto,pago_id,registrado_por)
    values(p_caso_id,p_solicitud_id,v_caso.driver_id,v_caso.proveedor_id,p_lunes,p_monto_esperado,v_pago,auth.uid())
    returning * into v_existente;
  insert into public.no_show_eventos(caso_id,tipo,mensaje,actor_id)
    values(p_caso_id,'descuento_aplicado','Descuento seleccionado en el precierre Walmart de la semana '||p_lunes::text||'.',auth.uid());
  return to_jsonb(v_existente);
end;
$$;
revoke all on function public.walmart_aplicar_no_show_precierre(uuid,uuid,date,numeric) from public, anon, authenticated;

create or replace function public.walmart_aplicar_no_shows_precierre(
  p_driver_id uuid,p_lunes date,p_seleccion jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_fila record;
  v_resultados jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede aplicar los NO SHOW';
  end if;
  if p_driver_id is null or p_lunes is null or jsonb_typeof(p_seleccion) is distinct from 'array'
    or jsonb_array_length(p_seleccion) not between 1 and 100 then
    raise exception 'Selecciona entre uno y cien NO SHOW';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_seleccion) x
    where jsonb_typeof(x) is distinct from 'object' or x->>'caso_id' is null
      or x->>'solicitud_id' is null or x->>'monto' is null
  ) or (select count(distinct x->>'caso_id') from jsonb_array_elements(p_seleccion) x)<>jsonb_array_length(p_seleccion)
    or (select count(distinct x->>'solicitud_id') from jsonb_array_elements(p_seleccion) x)<>jsonb_array_length(p_seleccion) then
    raise exception 'La seleccion contiene casos o solicitudes invalidos o duplicados';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_seleccion) x
    left join public.no_show_casos c on c.id=(x->>'caso_id')::uuid
    where c.id is null or c.driver_id is distinct from p_driver_id or c.proveedor_id is null
      or public.operativo_asignado_a(c.cliente_id,c.cedis_id,'ih') is not true
  ) then raise exception 'La seleccion contiene casos no asignados al driver o supervisor'; end if;
  for v_fila in
    select distinct c.proveedor_id from jsonb_array_elements(p_seleccion) x
    join public.no_show_casos c on c.id=(x->>'caso_id')::uuid order by c.proveedor_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'walmart-no-show-proveedor:'||v_fila.proveedor_id::text,0));
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('walmart-no-show-driver:'||p_driver_id::text,0));
  for v_fila in select x from jsonb_array_elements(p_seleccion) x order by x->>'caso_id'
  loop
    v_resultados:=v_resultados||jsonb_build_array(public.walmart_aplicar_no_show_precierre(
      (v_fila.x->>'solicitud_id')::uuid,(v_fila.x->>'caso_id')::uuid,p_lunes,(v_fila.x->>'monto')::numeric
    ));
  end loop;
  return v_resultados;
end;
$$;
revoke all on function public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb) from public, anon;
grant execute on function public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb) to authenticated;

create or replace function private.walmart_proteger_no_show_decision()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='walmart_no_show_decisiones' then
    raise exception 'La decision NO SHOW requiere correccion auditada';
  end if;
  if exists (select 1 from private.walmart_no_show_decisiones d where d.pago_id=old.id) then
    if tg_op='DELETE' then raise exception 'El descuento NO SHOW requiere correccion auditada'; end if;
    if new.driver_id is distinct from old.driver_id or new.proveedor_id is distinct from old.proveedor_id
      or new.ruta_id is distinct from old.ruta_id or new.concepto is distinct from old.concepto
      or new.monto is distinct from old.monto or new.fecha is distinct from old.fecha
      or (new.estatus is distinct from old.estatus
        and (old.estatus is distinct from 'pendiente' or new.estatus is distinct from 'pagado')) then
      raise exception 'El descuento NO SHOW requiere correccion auditada';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_no_show_decision() from public, anon, authenticated;
drop trigger if exists walmart_proteger_no_show_decision on private.walmart_no_show_decisiones;
create trigger walmart_proteger_no_show_decision before update or delete on private.walmart_no_show_decisiones
for each row execute function private.walmart_proteger_no_show_decision();
drop trigger if exists walmart_proteger_pago_no_show_decision on public.pagos;
create trigger walmart_proteger_pago_no_show_decision before update or delete on public.pagos
for each row execute function private.walmart_proteger_no_show_decision();



$walmart_fuente_5$;
  -- walmart-liquidacion-borrador.sql
  execute $walmart_fuente_6$
-- BORRADOR: no instalar ni publicar. Faltan casos NO SHOW heredados, anulacion,
-- liberacion del retenido y ensayo completo en Supabase.


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



$walmart_fuente_6$;
  -- walmart-cancelaciones-pagos-borrador.sql
  execute $walmart_fuente_7$
-- BORRADOR: no instalar ni activar. Faltan casos NO SHOW heredados, liberacion
-- del retenido, reversión contable y ensayo con permisos y concurrencia reales.


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



$walmart_fuente_7$;
  -- walmart-plazo-retencion-borrador.sql
  execute $walmart_fuente_8$
-- BORRADOR: solo calcula el plazo. No autoriza ni libera saldo retenido.
-- Reclamaciones, descuentos, permisos y concurrencia requieren validacion adicional.


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



$walmart_fuente_8$;
  -- walmart-retencion-proveedor-borrador.sql
  execute $walmart_fuente_9$
-- BORRADOR PRIVADO: no instalar ni activar. No transfiere dinero.
-- El registro privado permanece bloqueado por cobertura incompleta.
-- Faltan fuentes de descuentos, concurrencia integral, Finanzas y pantallas.


create table if not exists private.walmart_liberaciones_proveedor (
  id uuid primary key,
  proveedor_id bigint not null references public.proveedores(id),
  monto numeric(12,2) not null check (monto>0 and monto::text not in ('NaN','Infinity','-Infinity')),
  estatus text not null default 'pendiente' check (estatus in ('pendiente','pagado')),
  creado_por uuid not null references public.drivers(id),
  creado_en timestamptz not null default now(),
  ultima_ruta_en timestamptz not null,
  confirmacion_sincronizacion text not null
    check (length(btrim(confirmacion_sincronizacion)) between 5 and 1000),
  revision jsonb not null check (jsonb_typeof(revision)='object'),
  pagado_por uuid references public.drivers(id),
  pagado_en timestamptz,
  check (creado_en>=ultima_ruta_en+interval '30 days'),
  check ((estatus='pendiente' and pagado_por is null and pagado_en is null)
    or (estatus='pagado' and pagado_por is not null and pagado_en is not null))
);

create table if not exists private.walmart_liberaciones_rutas (
  ruta_id bigint primary key references private.walmart_liquidaciones(ruta_id),
  liberacion_id uuid not null references private.walmart_liberaciones_proveedor(id),
  monto numeric(12,2) not null check (monto>0 and monto::text not in ('NaN','Infinity','-Infinity'))
);

create table if not exists private.walmart_liberaciones_cancelaciones (
  cancelacion_id bigint primary key references private.walmart_cancelaciones_pagadas(cancelacion_id),
  liberacion_id uuid not null references private.walmart_liberaciones_proveedor(id),
  monto numeric(12,2) not null check (monto>0 and monto::text not in ('NaN','Infinity','-Infinity'))
);

revoke all on private.walmart_liberaciones_proveedor,private.walmart_liberaciones_rutas,
  private.walmart_liberaciones_cancelaciones from public, anon, authenticated;

create or replace function private.walmart_verificar_liberacion_contable()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_id uuid;
  v_pago private.walmart_liberaciones_proveedor%rowtype;
  v_total numeric;
begin
  v_id:=(to_jsonb(new)->>tg_argv[0])::uuid;
  select * into strict v_pago from private.walmart_liberaciones_proveedor where id=v_id;
  if exists (
    select 1 from private.walmart_liberaciones_rutas x
    join private.walmart_liquidaciones w on w.ruta_id=x.ruta_id
    where x.liberacion_id=v_id
      and (w.proveedor_id is distinct from v_pago.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) or exists (
    select 1 from private.walmart_liberaciones_cancelaciones x
    join private.walmart_cancelaciones_pagadas w on w.cancelacion_id=x.cancelacion_id
    where x.liberacion_id=v_id
      and (w.proveedor_id is distinct from v_pago.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) then raise exception 'La liberacion no coincide con los saldos originales del proveedor'; end if;

  select coalesce(sum(monto),0) into v_total from (
    select monto from private.walmart_liberaciones_rutas where liberacion_id=v_id
    union all
    select monto from private.walmart_liberaciones_cancelaciones where liberacion_id=v_id
  ) origenes;
  if v_total is distinct from v_pago.monto then
    raise exception 'El movimiento del proveedor no coincide con sus saldos originales';
  end if;
  return null;
end;
$$;
revoke all on function private.walmart_verificar_liberacion_contable() from public, anon, authenticated;

drop trigger if exists walmart_verificar_liberacion on private.walmart_liberaciones_proveedor;
create constraint trigger walmart_verificar_liberacion after insert on private.walmart_liberaciones_proveedor
deferrable initially deferred for each row execute function private.walmart_verificar_liberacion_contable('id');
drop trigger if exists walmart_verificar_ruta_liberada on private.walmart_liberaciones_rutas;
create constraint trigger walmart_verificar_ruta_liberada after insert on private.walmart_liberaciones_rutas
deferrable initially deferred for each row execute function private.walmart_verificar_liberacion_contable('liberacion_id');
drop trigger if exists walmart_verificar_cancelacion_liberada on private.walmart_liberaciones_cancelaciones;
create constraint trigger walmart_verificar_cancelacion_liberada after insert on private.walmart_liberaciones_cancelaciones
deferrable initially deferred for each row execute function private.walmart_verificar_liberacion_contable('liberacion_id');

create or replace function private.walmart_proteger_liberacion_contable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_table_name is distinct from 'walmart_liberaciones_proveedor' or tg_op='DELETE' then
    raise exception 'La liberacion requiere una correccion contable auditada';
  end if;
  if old.estatus is distinct from 'pendiente' or new.estatus is distinct from 'pagado'
    or new.id is distinct from old.id or new.proveedor_id is distinct from old.proveedor_id
    or new.monto is distinct from old.monto or new.creado_por is distinct from old.creado_por
    or new.creado_en is distinct from old.creado_en
    or new.ultima_ruta_en is distinct from old.ultima_ruta_en
    or new.confirmacion_sincronizacion is distinct from old.confirmacion_sincronizacion
    or new.revision is distinct from old.revision
    or new.pagado_por is null or new.pagado_en is null then
    raise exception 'La liberacion requiere una correccion contable auditada';
  end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_liberacion_contable() from public, anon, authenticated;

drop trigger if exists walmart_proteger_liberacion on private.walmart_liberaciones_proveedor;
create trigger walmart_proteger_liberacion before update or delete on private.walmart_liberaciones_proveedor
for each row execute function private.walmart_proteger_liberacion_contable();
drop trigger if exists walmart_proteger_ruta_liberada on private.walmart_liberaciones_rutas;
create trigger walmart_proteger_ruta_liberada before update or delete on private.walmart_liberaciones_rutas
for each row execute function private.walmart_proteger_liberacion_contable();
drop trigger if exists walmart_proteger_cancelacion_liberada on private.walmart_liberaciones_cancelaciones;
create trigger walmart_proteger_cancelacion_liberada before update or delete on private.walmart_liberaciones_cancelaciones
for each row execute function private.walmart_proteger_liberacion_contable();

-- Esta consulta no comprueba plazo, reclamaciones ni autorizacion.
create or replace function private.walmart_saldo_retenido_sin_liberar(p_proveedor_id bigint)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  v_rutas numeric;
  v_cancelaciones numeric;
  v_num_rutas bigint;
  v_num_cancelaciones bigint;
begin
  if p_proveedor_id is null or not exists (
    select 1 from public.proveedores p where p.id=p_proveedor_id
  ) then raise exception 'Se requiere un proveedor valido'; end if;
  if exists (
    select 1 from private.walmart_liquidaciones w
    where w.proveedor_id=p_proveedor_id
      and (w.saldo_retenido is null or w.saldo_retenido::text in ('NaN','Infinity','-Infinity') or w.saldo_retenido<0)
  ) or exists (
    select 1 from private.walmart_cancelaciones_pagadas w
    where w.proveedor_id=p_proveedor_id
      and (w.saldo_retenido is null or w.saldo_retenido::text in ('NaN','Infinity','-Infinity') or w.saldo_retenido<0)
  ) then raise exception 'Hay saldos retenidos invalidos; requiere revision'; end if;
  if exists (
    select 1 from private.walmart_liberaciones_rutas x
    join private.walmart_liquidaciones w on w.ruta_id=x.ruta_id
    join private.walmart_liberaciones_proveedor p on p.id=x.liberacion_id
    where (w.proveedor_id=p_proveedor_id or p.proveedor_id=p_proveedor_id)
      and (w.proveedor_id is distinct from p.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) or exists (
    select 1 from private.walmart_liberaciones_cancelaciones x
    join private.walmart_cancelaciones_pagadas w on w.cancelacion_id=x.cancelacion_id
    join private.walmart_liberaciones_proveedor p on p.id=x.liberacion_id
    where (w.proveedor_id=p_proveedor_id or p.proveedor_id=p_proveedor_id)
      and (w.proveedor_id is distinct from p.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) then raise exception 'Los saldos liberados cambiaron; requiere revision contable'; end if;

  select coalesce(sum(w.saldo_retenido),0),count(*)
    into v_rutas,v_num_rutas
  from private.walmart_liquidaciones w
  where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
    and not exists (select 1 from private.walmart_liberaciones_rutas x where x.ruta_id=w.ruta_id);

  select coalesce(sum(w.saldo_retenido),0),count(*)
    into v_cancelaciones,v_num_cancelaciones
  from private.walmart_cancelaciones_pagadas w
  where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
    and not exists (
      select 1 from private.walmart_liberaciones_cancelaciones x where x.cancelacion_id=w.cancelacion_id
    );

  return jsonb_build_object(
    'proveedor_id',p_proveedor_id,'saldo_rutas',v_rutas,'rutas',v_num_rutas,
    'saldo_cancelaciones',v_cancelaciones,'cancelaciones',v_num_cancelaciones,
    'saldo_total',v_rutas+v_cancelaciones,'liberacion_validada',false
  );
end;
$$;
revoke all on function private.walmart_saldo_retenido_sin_liberar(bigint) from public, anon, authenticated;

create or replace function private.walmart_drivers_historicos(p_proveedor_id bigint)
returns table(driver_id uuid) language sql stable set search_path = ''
as $$
  select r.driver_id from private.walmart_proveedores_confirmados w
    join public.rutas r on r.id=w.ruta_id
    where w.proveedor_id=p_proveedor_id and r.driver_id is not null
  union
  select r.driver_id from private.walmart_liquidaciones w
    join public.rutas r on r.id=w.ruta_id
    where w.proveedor_id=p_proveedor_id and r.driver_id is not null
  union
  select w.driver_id from private.walmart_cancelaciones_pagadas w
    where w.proveedor_id=p_proveedor_id and w.driver_id is not null
  union
  select c.driver_id from public.no_show_casos c
    where c.proveedor_id=p_proveedor_id and public.operativo_normalizar(c.cuenta)='walmart'
      and c.driver_id is not null
$$;
revoke all on function private.walmart_drivers_historicos(bigint) from public, anon, authenticated;

-- Solo detecta bloqueos conocidos; no certifica fuentes pendientes de integrar.
create or replace function private.walmart_bloqueos_retencion(p_proveedor_id bigint)
returns jsonb language sql stable set search_path = ''
as $$
  with conductores as (
    select driver_id from private.walmart_drivers_historicos(p_proveedor_id)
  ), reclamos as (
    select r.* from public.pnr_reclamos r
    where r.driver_id in (select driver_id from conductores)
  ), casos as (
    select c.* from public.no_show_casos c
    where public.operativo_normalizar(c.cuenta)='walmart'
      and (c.proveedor_id=p_proveedor_id
        or (c.proveedor_id is null and c.driver_id in (select driver_id from conductores)))
  )
  select jsonb_build_object(
    'pnr_abiertos',exists (
      select 1 from reclamos r where r.estado is null or r.estado not in ('cerrada_sin_cargo','cerrada_con_cargo')
    ),
    'pnr_saldo_pendiente',exists (
      select 1 from public.pnr_descuentos d join reclamos r on r.id=d.reclamo_id
      where d.saldo_pendiente<>0 or d.saldo_pendiente is null
        or d.saldo_pendiente::text in ('NaN','Infinity','-Infinity')
    ),
    'no_show_requiere_revision',exists (
      select 1 from casos c
      where c.metodo_calculo is distinct from 'walmart_60_saldo'
        or c.proveedor_id is distinct from p_proveedor_id
        or c.pago_penalizacion_id is not null or c.pago_reversion_id is not null
        or (
          (c.estado='apelacion_aceptada' and exists (
            select 1 from private.walmart_no_show_reportes r where r.caso_id=c.id and r.proveedor_id=p_proveedor_id
          ) and not exists (
            select 1 from private.walmart_no_show_saldos s where s.caso_id=c.id
          ))
          or ((c.estado='apelacion_rechazada'
            or (c.estado='reportado' and c.vence_apelacion_en<pg_catalog.now()))
            and exists (
              select 1 from private.walmart_no_show_saldos s
              where s.caso_id=c.id and s.proveedor_id=p_proveedor_id
                and s.driver_id=c.driver_id and s.saldo_pendiente=0
            ))
        ) is not true
    ),
    'ajustes_negativos_pendientes',exists (
      select 1 from public.pagos p
      where p.estatus='pendiente' and p.concepto='ajuste'
        and (p.proveedor_id=p_proveedor_id
          or (p.proveedor_id is null and p.driver_id in (select driver_id from conductores)))
        and (p.monto<0 or p.monto is null or p.monto::text in ('NaN','Infinity','-Infinity'))
    ),
    'cobertura_completa',false
  )
$$;
revoke all on function private.walmart_bloqueos_retencion(bigint) from public, anon, authenticated;

create or replace function public.walmart_consultar_retencion_proveedor(p_proveedor_id bigint)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fuente record;
  v_encontrada boolean:=false;
  v_rol text;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or coalesce(public.operativo_rol_actual(),'') not in ('ih','coordinador') or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede consultar la retencion del proveedor';
  end if;
  v_rol:=public.operativo_rol_actual();
  for v_fuente in
    select ce.id as cedis_id,ce.cliente_id
    from private.walmart_proveedores_confirmados w
    left join public.rutas r on r.id=w.ruta_id
    left join public.cedis ce on ce.id=r.cedis_id
    where w.proveedor_id=p_proveedor_id
    union
    select ce.id,ce.cliente_id
    from private.walmart_liquidaciones w
    left join public.rutas r on r.id=w.ruta_id
    left join public.cedis ce on ce.id=r.cedis_id
    where w.proveedor_id=p_proveedor_id
    union
    select ce.id,ce.cliente_id
    from private.walmart_cancelaciones_pagadas w
    left join public.cancelaciones c on c.id=w.cancelacion_id
    left join public.cedis ce on ce.id=c.cedis_id
    where w.proveedor_id=p_proveedor_id
    union
    select ce.id,ce.cliente_id
    from public.no_show_casos c
    left join public.cedis ce on ce.id=c.cedis_id
    where public.operativo_normalizar(c.cuenta)='walmart'
      and (c.proveedor_id=p_proveedor_id
        or (c.proveedor_id is null and c.driver_id in (
          select h.driver_id from private.walmart_drivers_historicos(p_proveedor_id) h
        )))
  loop
    v_encontrada:=true;
    if v_fuente.cedis_id is null or v_fuente.cliente_id is null
      or public.operativo_asignado_a(v_fuente.cliente_id,v_fuente.cedis_id,v_rol) is not true then
      raise exception 'Se requiere acceso a todos los CEDIS del proveedor';
    end if;
  end loop;
  if not v_encontrada then raise exception 'No hay actividad Walmart confirmada para consultar'; end if;
  return jsonb_build_object(
    'plazo',private.walmart_consultar_plazo(p_proveedor_id,pg_catalog.clock_timestamp())-'rutas_sin_proveedor',
    'saldo',private.walmart_saldo_retenido_sin_liberar(p_proveedor_id),
    'bloqueos',private.walmart_bloqueos_retencion(p_proveedor_id),
    'reclamaciones_verificadas',false,'liberacion_validada',false
  );
end;
$$;
revoke all on function public.walmart_consultar_retencion_proveedor(bigint) from public, anon;
grant execute on function public.walmart_consultar_retencion_proveedor(bigint) to authenticated;

-- No se expone a la API. La cobertura incompleta bloquea incluso a este registrador.
-- Los bloqueos de tablas son provisionales y requieren pruebas de concurrencia y carga.
create or replace function private.walmart_registrar_liberacion(
  p_id uuid,p_proveedor_id bigint,p_revision jsonb,p_confirmacion text
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_actual jsonb;
  v_existente private.walmart_liberaciones_proveedor%rowtype;
  v_monto numeric;
  v_ultima timestamptz;
  v_confirmacion text:=btrim(p_confirmacion);
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede registrar la liberacion';
  end if;
  if p_id is null or p_proveedor_id is null or jsonb_typeof(p_revision) is distinct from 'object'
    or v_confirmacion is null or length(v_confirmacion) not between 5 and 1000 then
    raise exception 'Revisa el saldo y documenta la conciliacion de rutas sincronizadas';
  end if;
  if (private.walmart_bloqueos_retencion(p_proveedor_id)->>'cobertura_completa')::boolean is not true then
    raise exception 'La revision de descuentos todavia no cubre todas las fuentes';
  end if;
  lock table public.drivers,public.proveedores,public.clientes,public.cedis,public.asignaciones_operativas,
    public.rutas,public.cancelaciones,public.pnr_reclamos,public.pnr_descuentos,public.no_show_casos,public.pagos,
    private.walmart_proveedores_confirmados,private.walmart_liquidaciones,private.walmart_cancelaciones_pagadas,
    private.walmart_no_show_saldos,private.walmart_no_show_reportes,private.walmart_liberaciones_proveedor,
    private.walmart_liberaciones_rutas,private.walmart_liberaciones_cancelaciones in share row exclusive mode;
  v_actual:=public.walmart_consultar_retencion_proveedor(p_proveedor_id);
  select * into v_existente from private.walmart_liberaciones_proveedor where id=p_id;
  if found then
    if v_existente.proveedor_id is distinct from p_proveedor_id
      or v_existente.creado_por is distinct from auth.uid()
      or v_existente.revision is distinct from p_revision
      or v_existente.confirmacion_sincronizacion is distinct from v_confirmacion then
      raise exception 'El identificador corresponde a otra liberacion';
    end if;
    return jsonb_build_object('id',v_existente.id,'monto',v_existente.monto,'estatus',v_existente.estatus);
  end if;
  if v_actual is distinct from p_revision then
    raise exception 'La revision de retencion cambio; consulta el proveedor nuevamente';
  end if;
  if (v_actual->>'reclamaciones_verificadas')::boolean is not true
    or (v_actual->'bloqueos'->>'cobertura_completa')::boolean is not true
    or (v_actual->'bloqueos'->>'pnr_abiertos')::boolean is not false
    or (v_actual->'bloqueos'->>'pnr_saldo_pendiente')::boolean is not false
    or (v_actual->'bloqueos'->>'no_show_requiere_revision')::boolean is not false
    or (v_actual->'bloqueos'->>'ajustes_negativos_pendientes')::boolean is not false then
    raise exception 'La retencion tiene reclamaciones o descuentos pendientes de revision';
  end if;
  if v_actual->'plazo'->>'estado' is distinct from 'calculado'
    or (v_actual->'plazo'->>'plazo_cumplido')::boolean is not true then
    raise exception 'El plazo de retencion no esta cumplido o requiere revision';
  end if;
  v_monto:=(v_actual->'saldo'->>'saldo_total')::numeric;
  v_ultima:=(v_actual->'plazo'->>'ultima_ruta')::timestamptz;
  if v_monto is null or v_monto::text in ('NaN','Infinity','-Infinity')
    or v_monto<=0 or v_monto>9999999999.99 or v_monto<>round(v_monto,2)
    or v_ultima is null then raise exception 'No hay saldo o ultima ruta validos para liberar'; end if;
  insert into private.walmart_liberaciones_proveedor(
    id,proveedor_id,monto,creado_por,ultima_ruta_en,confirmacion_sincronizacion,revision
  ) values (p_id,p_proveedor_id,v_monto,auth.uid(),v_ultima,v_confirmacion,p_revision);
  insert into private.walmart_liberaciones_rutas(ruta_id,liberacion_id,monto)
    select w.ruta_id,p_id,w.saldo_retenido from private.walmart_liquidaciones w
    where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
      and not exists (select 1 from private.walmart_liberaciones_rutas x where x.ruta_id=w.ruta_id);
  insert into private.walmart_liberaciones_cancelaciones(cancelacion_id,liberacion_id,monto)
    select w.cancelacion_id,p_id,w.saldo_retenido from private.walmart_cancelaciones_pagadas w
    where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
      and not exists (
        select 1 from private.walmart_liberaciones_cancelaciones x where x.cancelacion_id=w.cancelacion_id
      );
  return jsonb_build_object('id',p_id,'monto',v_monto,'estatus','pendiente');
end;
$$;
revoke all on function private.walmart_registrar_liberacion(uuid,bigint,jsonb,text) from public, anon, authenticated;

-- Solo lectura de movimientos ya registrados; no permite crear ni liberar pagos.
create or replace function public.walmart_mis_liberaciones(p_desde date)
returns table(id uuid,concepto text,monto numeric,fecha date,estatus text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_desde is null then
    raise exception 'Se requiere una sesion y fecha validas para consultar pagos';
  end if;
  if not exists (
    select 1 from public.drivers d
    join public.proveedores p on p.id=d.proveedor_id and p.titular_id=d.id
    where d.id=auth.uid() and d.rol::text in ('driver','flotillero')
      and lower(coalesce(d.estatus::text,''))='activo'
  ) then raise exception 'Sin permiso para consultar movimientos del proveedor'; end if;
  return query
    select l.id,'liberacion_retencion_walmart'::text,l.monto,
      (l.creado_en at time zone 'America/Mexico_City')::date,l.estatus
    from private.walmart_liberaciones_proveedor l
    join public.proveedores p on p.id=l.proveedor_id and p.titular_id=auth.uid()
    join public.drivers d on d.id=auth.uid() and d.proveedor_id=p.id
      and d.rol::text in ('driver','flotillero')
      and lower(coalesce(d.estatus::text,''))='activo'
    where (l.creado_en at time zone 'America/Mexico_City')::date>=p_desde
    order by l.creado_en desc,l.id desc;
end;
$$;
revoke all on function public.walmart_mis_liberaciones(date) from public, anon;
grant execute on function public.walmart_mis_liberaciones(date) to authenticated;



$walmart_fuente_9$;
  -- walmart-bolsa-borrador.sql
  execute $walmart_fuente_10$
-- BORRADOR: no instalar ni activar antes de probar permisos, concurrencia y avisos.
-- Los movimientos son pendientes; no acreditan una transferencia bancaria.


create table if not exists private.walmart_bolsa_decisiones (
  liberacion_id uuid primary key references private.walmart_liberaciones_proveedor(id),
  descuento numeric(12,2) not null check (descuento>=0 and descuento::text not in ('NaN','Infinity','-Infinity')),
  motivo text,
  lunes_pago date not null check (extract(isodow from lunes_pago)=1),
  check ((descuento=0 and motivo is null) or (descuento>0 and length(btrim(motivo)) between 5 and 1000))
);
revoke all on private.walmart_bolsa_decisiones from public, anon, authenticated;

create or replace function public.walmart_decidir_bolsa(
  p_id uuid,p_proveedor_id bigint,p_revision jsonb,p_descuento numeric,p_motivo text,p_confirmado boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actual jsonb;
  v_existente private.walmart_liberaciones_proveedor%rowtype;
  v_decision private.walmart_bolsa_decisiones%rowtype;
  v_monto numeric;
  v_ultima timestamptz;
  v_motivo text:=nullif(btrim(p_motivo),'');
  v_lunes date:=(pg_catalog.clock_timestamp() at time zone 'America/Mexico_City')::date;
  v_confirmacion constant text:='Coordinacion confirma que las rutas estan sincronizadas';
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'coordinador' or private.es_valida() is not true then
    raise exception 'Solo el coordinador asignado puede decidir sobre la bolsa Walmart';
  end if;
  if p_id is null or p_proveedor_id is null or jsonb_typeof(p_revision) is distinct from 'object'
    or p_confirmado is not true or p_descuento is null
    or p_descuento::text in ('NaN','Infinity','-Infinity') or p_descuento<0
    or p_descuento>9999999999.99 or p_descuento<>round(p_descuento,2)
    or (p_descuento=0 and v_motivo is not null)
    or (p_descuento>0 and (v_motivo is null or length(v_motivo) not between 5 and 1000)) then
    raise exception 'Revisa la bolsa, confirma las rutas y documenta cualquier descuento';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('walmart-bolsa-solicitud:'||p_id::text,0));
  lock table public.drivers,public.proveedores,public.clientes,public.cedis,public.asignaciones_operativas,
    public.rutas,public.cancelaciones,public.pnr_reclamos,public.pnr_descuentos,public.no_show_casos,public.pagos,
    private.walmart_proveedores_confirmados,private.walmart_liquidaciones,private.walmart_cancelaciones_pagadas,
    private.walmart_no_show_saldos,private.walmart_no_show_reportes,private.walmart_liberaciones_proveedor,
    private.walmart_liberaciones_rutas,private.walmart_liberaciones_cancelaciones,private.walmart_bolsa_decisiones
    in share row exclusive mode;
  select * into v_existente from private.walmart_liberaciones_proveedor where id=p_id;
  if found then
    select * into v_decision from private.walmart_bolsa_decisiones where liberacion_id=p_id;
    if not found or v_existente.proveedor_id is distinct from p_proveedor_id
      or v_existente.creado_por is distinct from auth.uid() or v_existente.revision is distinct from p_revision
      or v_decision.descuento is distinct from p_descuento or v_decision.motivo is distinct from v_motivo then
      raise exception 'El identificador corresponde a otra decision';
    end if;
    perform public.walmart_consultar_retencion_proveedor(p_proveedor_id);
    return jsonb_build_object('id',p_id,'acumulado',v_existente.monto,'descuento',v_decision.descuento,
      'neto',v_existente.monto-v_decision.descuento,'lunes_pago',v_decision.lunes_pago,'estatus',v_existente.estatus);
  end if;
  v_actual:=public.walmart_consultar_retencion_proveedor(p_proveedor_id);
  if v_actual is distinct from p_revision then
    raise exception 'La bolsa cambio; vuelve a consultar antes de confirmar';
  end if;
  if v_actual->>'reclamaciones_verificadas' is distinct from 'true'
    or v_actual->'bloqueos'->>'cobertura_completa' is distinct from 'true'
    or v_actual->'bloqueos'->>'pnr_abiertos' is distinct from 'false'
    or v_actual->'bloqueos'->>'pnr_saldo_pendiente' is distinct from 'false'
    or v_actual->'bloqueos'->>'no_show_requiere_revision' is distinct from 'false'
    or v_actual->'bloqueos'->>'ajustes_negativos_pendientes' is distinct from 'false' then
    raise exception 'La bolsa tiene descuentos sin cobertura verificada; no se puede aprobar';
  end if;
  if v_actual->'plazo'->>'estado' is distinct from 'calculado'
    or (v_actual->'plazo'->>'plazo_cumplido')::boolean is not true then
    raise exception 'No han transcurrido 30 dias desde el cierre de la ultima ruta o se requiere revision';
  end if;
  v_monto:=(v_actual->'saldo'->>'saldo_total')::numeric;
  v_ultima:=(v_actual->'plazo'->>'ultima_ruta')::timestamptz;
  if v_monto is null or v_monto::text in ('NaN','Infinity','-Infinity') or v_monto<=0
    or v_monto>9999999999.99 or v_monto<>round(v_monto,2) or v_ultima is null
    or p_descuento>v_monto then
    raise exception 'El descuento no puede exceder la bolsa acumulada';
  end if;
  v_lunes:=v_lunes-(extract(isodow from v_lunes)::integer-1)+7;
  insert into private.walmart_liberaciones_proveedor(
    id,proveedor_id,monto,creado_por,ultima_ruta_en,confirmacion_sincronizacion,revision
  ) values (p_id,p_proveedor_id,v_monto,auth.uid(),v_ultima,v_confirmacion,p_revision);
  insert into private.walmart_liberaciones_rutas(ruta_id,liberacion_id,monto)
    select w.ruta_id,p_id,w.saldo_retenido from private.walmart_liquidaciones w
    where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
      and not exists (select 1 from private.walmart_liberaciones_rutas x where x.ruta_id=w.ruta_id);
  insert into private.walmart_liberaciones_cancelaciones(cancelacion_id,liberacion_id,monto)
    select w.cancelacion_id,p_id,w.saldo_retenido from private.walmart_cancelaciones_pagadas w
    where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
      and not exists (select 1 from private.walmart_liberaciones_cancelaciones x where x.cancelacion_id=w.cancelacion_id);
  insert into private.walmart_bolsa_decisiones(liberacion_id,descuento,motivo,lunes_pago)
    values(p_id,p_descuento,v_motivo,v_lunes);
  return jsonb_build_object('id',p_id,'acumulado',v_monto,'descuento',p_descuento,
    'neto',v_monto-p_descuento,'lunes_pago',v_lunes,'estatus','pendiente');
end;
$$;
revoke all on function public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean) from public, anon;
grant execute on function public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean) to authenticated;

create or replace function private.walmart_proteger_bolsa_decision()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'La decision de bolsa requiere correccion auditada';
end;
$$;
revoke all on function private.walmart_proteger_bolsa_decision() from public, anon, authenticated;
drop trigger if exists walmart_proteger_bolsa_decision on private.walmart_bolsa_decisiones;
create trigger walmart_proteger_bolsa_decision before update or delete on private.walmart_bolsa_decisiones
for each row execute function private.walmart_proteger_bolsa_decision();

create or replace function public.walmart_mi_bolsa()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_proveedor_id bigint;
  v_plazo jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesion'; end if;
  select p.id into v_proveedor_id
  from public.drivers d
  join public.proveedores p on p.id=d.proveedor_id and p.titular_id=d.id
  where d.id=auth.uid() and d.rol::text='flotillero'
    and lower(coalesce(d.estatus::text,''))='activo'
    and p.tipo='flotillero' and p.activo;
  if not found then raise exception 'Solo el flotillero titular activo puede consultar su bolsa'; end if;
  v_plazo:=private.walmart_consultar_plazo(v_proveedor_id,pg_catalog.clock_timestamp());
  return jsonb_build_object(
    'proveedor_id',v_proveedor_id,
    'saldo',private.walmart_saldo_retenido_sin_liberar(v_proveedor_id),
    'plazo',v_plazo-'rutas_sin_proveedor',
    'liberacion_validada',false
  );
end;
$$;
revoke all on function public.walmart_mi_bolsa() from public, anon;
grant execute on function public.walmart_mi_bolsa() to authenticated;

create or replace function public.walmart_mis_movimientos_bolsa(p_desde date)
returns table(id uuid,concepto text,monto numeric,fecha date,estatus text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_desde is null or not exists (
    select 1 from public.drivers d
    join public.proveedores p on p.id=d.proveedor_id and p.titular_id=d.id
    where d.id=auth.uid() and d.rol::text='flotillero'
      and lower(coalesce(d.estatus::text,''))='activo'
      and p.tipo='flotillero' and p.activo
  ) then raise exception 'Se requiere una sesion activa y fecha validas'; end if;
  return query
    select l.id,'liberacion_retencion_walmart'::text,l.monto-b.descuento,b.lunes_pago,l.estatus
    from private.walmart_liberaciones_proveedor l
    join private.walmart_bolsa_decisiones b on b.liberacion_id=l.id
    join public.proveedores p on p.id=l.proveedor_id and p.titular_id=auth.uid()
      and p.tipo='flotillero' and p.activo
    join public.drivers d on d.id=auth.uid() and d.proveedor_id=p.id and d.rol::text='flotillero'
      and lower(coalesce(d.estatus::text,''))='activo'
    where b.lunes_pago>=p_desde and l.monto>b.descuento
    order by b.lunes_pago desc,l.id desc;
end;
$$;
revoke all on function public.walmart_mis_movimientos_bolsa(date) from public, anon;
grant execute on function public.walmart_mis_movimientos_bolsa(date) to authenticated;



$walmart_fuente_10$;
  -- walmart-mapeo-tarifas-borrador.sql
  execute $walmart_fuente_11$
-- BORRADOR: no instalar ni publicar sin ensayar restricciones y flujo financiero.
-- Los importes de las dos opciones permanecen en public.walmart_tarifas.


do $$
declare
  v_expr text;
  v_permite boolean;
  v_atributo smallint;
begin
  select a.attnum into v_atributo from pg_catalog.pg_attribute a
    where a.attrelid='public.tarifas'::regclass and a.attname='cuenta' and not a.attisdropped;
  select pg_catalog.pg_get_expr(c.conbin,c.conrelid) into v_expr
    from pg_catalog.pg_constraint c
    where c.conrelid='public.tarifas'::regclass and c.conname='tarifas_cuenta_check'
      and c.contype='c' and c.convalidated and c.conkey=array[v_atributo]::smallint[];
  if v_expr is null then raise exception 'La restriccion de cuenta de tarifas requiere revision'; end if;
  execute format('select (%s) is true from (select %L::text as cuenta) x',v_expr,'WALMART') into v_permite;
  if not v_permite then
    alter table public.tarifas drop constraint tarifas_cuenta_check;
    execute format('alter table public.tarifas add constraint tarifas_cuenta_check check ((%s) or cuenta=''WALMART'')',v_expr);
  end if;
end;
$$;

do $$
declare
  v_tarifa record;
  v_actual record;
  v_conc text;
  v_id bigint;
begin
  for v_tarifa in
    select w.*,ce.nombre as centro from public.walmart_tarifas w
      join public.cedis ce on ce.id=w.cedis_id order by w.id
  loop
    v_conc:='WALMART-CEDIS-'||v_tarifa.cedis_id::text||'-'||v_tarifa.tipo_unidad;
    insert into public.tarifas(cuenta,cliente,ciudad,ubicacion,tipo_unidad,esquema,zona,variable,
      conc,tarifa_cliente,pago_base,vigencia_desde,vigencia_hasta,activo,fuente)
    values ('WALMART','WALMART',v_tarifa.centro,v_tarifa.centro,v_tarifa.tipo_unidad,
      v_tarifa.esquema,v_tarifa.zona,v_tarifa.variable,v_conc,v_tarifa.tarifa_cliente,null,
      v_tarifa.vigencia_desde,v_tarifa.vigencia_hasta,true,'Walmart vinculado')
    on conflict (cuenta,conc,vigencia_desde) do nothing;
    select * into v_actual from public.tarifas
      where cuenta='WALMART' and conc=v_conc and vigencia_desde=v_tarifa.vigencia_desde;
    if not found or v_actual.cliente is distinct from 'WALMART'
      or v_actual.ubicacion is distinct from v_tarifa.centro
      or v_actual.tipo_unidad is distinct from v_tarifa.tipo_unidad
      or v_actual.esquema is distinct from v_tarifa.esquema
      or v_actual.zona is distinct from v_tarifa.zona
      or v_actual.variable is distinct from v_tarifa.variable
      or v_actual.tarifa_cliente is distinct from v_tarifa.tarifa_cliente
      or v_actual.pago_base is not null or v_actual.vigencia_hasta is distinct from v_tarifa.vigencia_hasta
      or v_actual.activo is distinct from true then
      raise exception 'La tarifa vinculada de % difiere; requiere revision',v_tarifa.centro;
    end if;
    insert into private.walmart_tarifas_mapeo(walmart_tarifa_id,tarifa_id)
      values(v_tarifa.id,v_actual.id) on conflict (walmart_tarifa_id) do nothing;
    select tarifa_id into v_id from private.walmart_tarifas_mapeo where walmart_tarifa_id=v_tarifa.id;
    if v_id is distinct from v_actual.id then raise exception 'El mapeo Walmart ya apunta a otra tarifa'; end if;
  end loop;
end;
$$;



$walmart_fuente_11$;
  -- walmart-validacion-borrador.sql
  execute $walmart_fuente_12$
-- BORRADOR: no instalar ni activar antes de completar anulación, casos NO SHOW
-- heredados, liberación de retención y pruebas reales en Supabase.


create or replace function public.walmart_validar_ruta(
  p_ruta_id bigint,p_aplicar_visitas boolean,p_aplicar_fallida boolean,p_calculo_esperado jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_ruta record;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede validar Walmart';
  end if;
  select r.cedis_id,ce.cliente_id,cl.nombre as cliente into v_ruta
    from public.rutas r join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=p_ruta_id for update of r;
  if not found or public.operativo_normalizar(v_ruta.cliente)<>'walmart'
    or public.operativo_asignado_a(v_ruta.cliente_id,v_ruta.cedis_id,'ih') is not true then
    raise exception 'Se requiere una ruta Walmart asignada al supervisor';
  end if;
  return private.walmart_registrar_liquidacion(
    p_ruta_id,p_aplicar_visitas,p_aplicar_fallida,p_calculo_esperado
  );
end;
$$;
revoke all on function public.walmart_validar_ruta(bigint,boolean,boolean,jsonb) from public, anon;
grant execute on function public.walmart_validar_ruta(bigint,boolean,boolean,jsonb) to authenticated;



$walmart_fuente_12$;

  if has_table_privilege('anon','private.walmart_no_show_saldos','select')
    or has_table_privilege('authenticated','private.walmart_no_show_saldos','select')
    or has_table_privilege('authenticated','private.walmart_no_show_reportes','select')
    or has_table_privilege('authenticated','private.walmart_no_show_decisiones','select')
    or has_table_privilege('authenticated','private.walmart_liquidaciones','select')
    or has_table_privilege('authenticated','private.walmart_cancelaciones_pagadas','select')
    or has_table_privilege('anon','private.walmart_liberaciones_proveedor','select')
    or has_table_privilege('authenticated','private.walmart_liberaciones_proveedor','select')
    or has_table_privilege('authenticated','private.walmart_liberaciones_rutas','select')
    or has_table_privilege('authenticated','private.walmart_liberaciones_cancelaciones','select') then
    raise exception 'ENSAYO FALLIDO: un ledger privado tiene acceso directo';
  end if;
  if has_table_privilege('anon','private.walmart_bolsa_decisiones','select')
    or has_table_privilege('authenticated','private.walmart_bolsa_decisiones','select') then
    raise exception 'ENSAYO FALLIDO: las decisiones de bolsa permiten acceso directo';
  end if;
  if has_function_privilege('anon','public.walmart_previsualizar_no_show(bigint,date,text,bigint,smallint)','execute')
    or has_function_privilege('anon','public.walmart_crear_no_show(uuid,uuid,bigint,date,text,bigint,smallint,text,jsonb)','execute')
    or has_function_privilege('anon','public.walmart_resolver_apelacion_no_show(uuid,text,text)','execute')
    or has_function_privilege('anon','public.walmart_consultar_no_show_precierre(uuid,date)','execute')
    or has_function_privilege('anon','public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb)','execute')
    or has_function_privilege('authenticated','public.walmart_aplicar_no_show_precierre(uuid,uuid,date,numeric)','execute')
    or has_function_privilege('anon','public.walmart_validar_ruta(bigint,boolean,boolean,jsonb)','execute')
    or has_function_privilege('anon','public.walmart_validar_cancelacion(bigint,bigint,text,boolean,jsonb)','execute')
    or has_function_privilege('anon','public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean)','execute')
    or has_function_privilege('anon','public.walmart_previsualizar_cancelacion_porcentaje(bigint,bigint,text,smallint)','execute')
    or has_function_privilege('anon','public.walmart_consultar_retencion_proveedor(bigint)','execute')
    or has_function_privilege('anon','public.walmart_mis_liberaciones(date)','execute')
    or has_function_privilege('anon','public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean)','execute')
    or has_function_privilege('anon','public.walmart_mi_bolsa()','execute')
    or has_function_privilege('anon','public.walmart_mis_movimientos_bolsa(date)','execute')
    or has_function_privilege('authenticated','private.walmart_bloqueos_retencion(bigint)','execute')
    or has_function_privilege('anon','private.walmart_registrar_liberacion(uuid,bigint,jsonb,text)','execute')
    or has_function_privilege('authenticated','private.walmart_registrar_liberacion(uuid,bigint,jsonb,text)','execute')
    or has_function_privilege('authenticated','private.walmart_drivers_historicos(bigint)','execute')
    or has_function_privilege('authenticated','private.walmart_saldo_retenido_sin_liberar(bigint)','execute')
    or not has_function_privilege('authenticated','public.walmart_previsualizar_no_show(bigint,date,text,bigint,smallint)','execute')
    or not has_function_privilege('authenticated','public.walmart_crear_no_show(uuid,uuid,bigint,date,text,bigint,smallint,text,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_resolver_apelacion_no_show(uuid,text,text)','execute')
    or not has_function_privilege('authenticated','public.walmart_consultar_no_show_precierre(uuid,date)','execute')
    or not has_function_privilege('authenticated','public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_validar_ruta(bigint,boolean,boolean,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_validar_cancelacion(bigint,bigint,text,boolean,jsonb)','execute')
    or not has_function_privilege('authenticated','public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean)','execute')
    or not has_function_privilege('authenticated','public.walmart_previsualizar_cancelacion_porcentaje(bigint,bigint,text,smallint)','execute')
    or not has_function_privilege('authenticated','public.walmart_consultar_retencion_proveedor(bigint)','execute')
    or not has_function_privilege('authenticated','public.walmart_mis_liberaciones(date)','execute')
    or not has_function_privilege('authenticated','public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean)','execute')
    or not has_function_privilege('authenticated','public.walmart_mi_bolsa()','execute')
    or not has_function_privilege('authenticated','public.walmart_mis_movimientos_bolsa(date)','execute') then
    raise exception 'ENSAYO FALLIDO: permisos RPC inesperados';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  begin
    perform public.walmart_previsualizar_no_show(1::bigint,current_date,'3.5T',1::bigint,1::smallint);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario obtuvo acceso';
  exception when raise_exception then
    if sqlerrm<>'Solo el supervisor asignado puede revisar NO SHOW Walmart' then raise; end if;
  end;
  begin
    perform public.walmart_consultar_retencion_proveedor(1::bigint);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto la retencion';
  exception when raise_exception then
    if sqlerrm<>'Solo el supervisor asignado puede consultar la retencion del proveedor' then raise; end if;
  end;
  begin
    perform public.walmart_mis_liberaciones(current_date);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto pagos del proveedor';
  exception when raise_exception then
    if sqlerrm<>'Se requiere una sesion y fecha validas para consultar pagos' then raise; end if;
  end;
  begin
    perform public.walmart_decidir_bolsa(
      '00000000-0000-0000-0000-000000000001'::uuid,1::bigint,'{}'::jsonb,0::numeric,null,false
    );
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario decidio sobre la bolsa';
  exception when raise_exception then
    if sqlerrm<>'Solo el coordinador asignado puede decidir sobre la bolsa Walmart' then raise; end if;
  end;
  begin
    perform public.walmart_mi_bolsa();
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto la bolsa';
  exception when raise_exception then
    if sqlerrm<>'Debes iniciar sesion' then raise; end if;
  end;
  begin
    perform public.walmart_mis_movimientos_bolsa(current_date);
    raise exception 'ENSAYO FALLIDO: una sesion sin usuario consulto movimientos de bolsa';
  exception when raise_exception then
    if sqlerrm<>'Se requiere una sesion activa y fecha validas' then raise; end if;
  end;
  execute 'reset role';

  -- Aborta esta sentencia y revierte sus cambios, incluso si el editor no abre
  -- una transaccion explicita. Otros resultados o errores no indican exito.
  raise exception 'ENSAYO OK: permisos declarados y rechazo sin usuario verificados; cambios revertidos';
end;
$walmart_ensayo$;

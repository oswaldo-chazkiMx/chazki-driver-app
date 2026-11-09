-- BORRADOR: no ejecutar ni publicar hasta integrar y probar todo el flujo.
-- Conserva las tarifas históricas y valida el diagnóstico antes de relacionarlas.
begin;

create table if not exists private.coppel_peak_tarifas (
  cedis_id bigint primary key references private.coppel_peak_plazas(cedis_id),
  tarifa_id bigint not null unique references public.tarifas(id),
  ubicacion text not null,
  ciudad text not null
);
revoke all on private.coppel_peak_tarifas from public, anon, authenticated;

create table if not exists private.coppel_peak_decisiones (
  ruta_id bigint primary key references public.rutas(id),
  aplicar_descuento boolean not null,
  seleccionado_por uuid not null references public.drivers(id),
  seleccionado_en timestamptz not null default now()
);
revoke all on private.coppel_peak_decisiones from public, anon, authenticated;

do $$
declare
  r record;
  v_count integer;
  v_tarifa_id bigint;
begin
  for r in
    select * from (values
      (24,437,'CEDIS','AGUASCALIENTES'),
      (23,447,'ENSENADA','BAJA CALIFORNIA NORTE'),
      (22,428,'AZCAPOTZALCO','CDMX'),
      (21,451,'IZTAPALAPA','CDMX'),
      (20,446,'DURANGO','DURANGO'),
      (19,448,'GOMEZ PALACIOS','DURANGO'),
      (17,468,'TOLUCA','EDOMEX'),
      (15,449,'GUADALAJARA','JALISCO'),
      (14,461,'MONTERREY','NUEVO LEON'),
      (13,464,'PUEBLA','PUEBLA'),
      (12,467,'SAN LUIS','SAN LUIS'),
      (11,458,'MAZATLAN','SINALOA'),
      (10,450,'HERMOSILLO','SONORA'),
      (9,436,'CD. OBREGON','SONORA'),
      (8,472,'XALAPA','VERACRUZ'),
      (7,473,'ZACATECAS','ZACATECAS'),
      (6,429,'IZCALLI','EDOMEX')
    ) as x(cedis_id,tarifa_id,ubicacion,ciudad)
  loop
    if not exists (
      select 1 from public.tarifas t
      where t.id=r.tarifa_id and t.cuenta='COPPEL' and t.activo
        and public.operativo_normalizar(t.ubicacion)=public.operativo_normalizar(r.ubicacion)
        and public.operativo_normalizar(t.ciudad)=public.operativo_normalizar(r.ciudad)
        and public.operativo_normalizar(t.tipo_unidad)='sedan'
        and public.operativo_normalizar(t.esquema)='paquete'
        and public.operativo_normalizar(t.zona)='local'
        and public.operativo_normalizar(t.variable)='regular'
        and t.tarifa_cliente=50
        and t.vigencia_desde<=date '2026-11-09'
        and (t.vigencia_hasta is null or t.vigencia_hasta>=date '2027-01-10')
    ) then raise exception 'La tarifa COPPEL % de CEDIS % cambió; revisa el diagnóstico',r.tarifa_id,r.cedis_id; end if;
    insert into private.coppel_peak_tarifas(cedis_id,tarifa_id,ubicacion,ciudad)
      values (r.cedis_id,r.tarifa_id,r.ubicacion,r.ciudad) on conflict (cedis_id) do nothing;
    if not exists (select 1 from private.coppel_peak_tarifas
      where cedis_id=r.cedis_id and tarifa_id=r.tarifa_id
        and ubicacion=r.ubicacion and ciudad=r.ciudad) then
      raise exception 'El CEDIS % ya tiene otra tarifa Peak asignada',r.cedis_id;
    end if;
  end loop;

  select count(*),min(t.id) into v_count,v_tarifa_id
  from public.tarifas t
  where t.cuenta='COPPEL' and t.activo
    and public.operativo_normalizar(t.ubicacion)='tecamac'
    and public.operativo_normalizar(t.tipo_unidad)='sedan'
    and public.operativo_normalizar(t.esquema)='paquete'
    and public.operativo_normalizar(t.zona)='local'
    and t.vigencia_desde<=date '2027-01-10'
    and (t.vigencia_hasta is null or t.vigencia_hasta>=date '2026-11-09');
  if v_count>1 then raise exception 'Hay múltiples tarifas Tecámac durante Peak; revisa antes de continuar'; end if;
  if v_count=0 then
    insert into public.tarifas
      (cuenta,cliente,ciudad,ubicacion,tipo_unidad,esquema,zona,variable,conc,
       tarifa_cliente,pago_base,vigencia_desde,vigencia_hasta,activo,fuente)
    values
      ('COPPEL','COPPEL','EDOMEX','TECAMAC','SEDAN','PAQUETE','LOCAL','REGULAR',
       'COPPEL-EDOMEXTECAMACSEDANPAQUETELOCAL-PEAK2026',50,30,
       date '2026-11-09',date '2027-01-10',true,'Peak COPPEL 2026')
    returning id into v_tarifa_id;
  end if;
  if not exists (
    select 1 from public.tarifas t where t.id=v_tarifa_id
      and public.operativo_normalizar(t.ciudad)='edomex'
      and public.operativo_normalizar(t.variable)='regular'
      and t.tarifa_cliente=50 and t.pago_base=30
      and t.vigencia_desde<=date '2026-11-09'
      and (t.vigencia_hasta is null or t.vigencia_hasta>=date '2027-01-10')
  ) then raise exception 'La tarifa existente de Tecámac no coincide con lo confirmado'; end if;
  insert into private.coppel_peak_tarifas(cedis_id,tarifa_id,ubicacion,ciudad)
    values (18,v_tarifa_id,'TECAMAC','EDOMEX') on conflict (cedis_id) do nothing;
  if not exists (select 1 from private.coppel_peak_tarifas
    where cedis_id=18 and tarifa_id=v_tarifa_id and ubicacion='TECAMAC' and ciudad='EDOMEX') then
    raise exception 'Tecámac ya tiene otra tarifa Peak asignada';
  end if;
end;
$$;

create or replace function private.coppel_peak_aplicar_a_calculo(
  p_ruta_id bigint, p_tarifa_id bigint, p_excepcion boolean, p_calculo jsonb
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_ruta record;
  v_peak jsonb;
  v_base numeric;
  v_descuento numeric;
  v_bono numeric;
  v_costo numeric;
  v_venta numeric;
  v_retencion numeric;
  v_neto numeric;
  v_comision numeric;
  v_iva numeric;
  v_pago numeric;
  v_k_ret numeric;
  v_k_com numeric;
  v_k_iva numeric;
  v_registro text;
  v_aplicar_descuento boolean;
begin
  if jsonb_typeof(p_calculo) is distinct from 'object' then
    raise exception 'El cálculo original de la ruta no es válido';
  end if;
  select ru.cedis_id,ru.tipo_unidad,ru.entregados,ru.paquetes_asignados,
         (ru.checkin_at at time zone 'America/Mexico_City')::date as fecha,
         cl.nombre as cliente,t.cuenta,t.tipo_unidad as tarifa_unidad,t.esquema,t.zona,
         p.inicio,p.fin
  into v_ruta
  from public.rutas ru
  join public.cedis ce on ce.id=ru.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  join public.tarifas t on t.id=p_tarifa_id
  left join private.coppel_peak_plazas p on p.cedis_id=ru.cedis_id
  where ru.id=p_ruta_id;
  if not found then raise exception 'No se encontró la ruta o tarifa COPPEL'; end if;
  if public.operativo_normalizar(v_ruta.cliente)<>'coppel'
    or v_ruta.cuenta<>'COPPEL'
    or v_ruta.inicio is null or v_ruta.fecha not between v_ruta.inicio and v_ruta.fin
    or public.operativo_normalizar(v_ruta.tipo_unidad)<>'sedan' then
    return p_calculo;
  end if;
  if exists (select 1 from private.coppel_peak_tarifas m
      where m.cedis_id=v_ruta.cedis_id and m.tarifa_id=p_tarifa_id)
    and (public.operativo_normalizar(v_ruta.esquema)<>'paquete'
      or public.operativo_normalizar(v_ruta.zona)<>'local') then
    raise exception 'La tarifa COPPEL Peak asignada al CEDIS cambió de esquema o zona';
  end if;
  if public.operativo_normalizar(v_ruta.esquema)<>'paquete'
    or public.operativo_normalizar(v_ruta.zona)<>'local' then return p_calculo; end if;
  if public.operativo_normalizar(v_ruta.tarifa_unidad)<>'sedan'
    or not exists (
      select 1 from private.coppel_peak_tarifas m
      join public.tarifas t on t.id=m.tarifa_id
      where m.cedis_id=v_ruta.cedis_id and m.tarifa_id=p_tarifa_id
        and t.activo and t.tarifa_cliente=50
        and public.operativo_normalizar(t.ubicacion)=public.operativo_normalizar(m.ubicacion)
        and public.operativo_normalizar(t.ciudad)=public.operativo_normalizar(m.ciudad)
        and public.operativo_normalizar(t.variable)='regular'
        and v_ruta.fecha>=t.vigencia_desde
        and (t.vigencia_hasta is null or v_ruta.fecha<=t.vigencia_hasta)
    ) then raise exception 'La tarifa no corresponde al CEDIS COPPEL Peak de esta ruta'; end if;
  select d.aplicar_descuento into v_aplicar_descuento
  from private.coppel_peak_decisiones d where d.ruta_id=p_ruta_id;
  v_peak := private.coppel_peak_calcular_ruta_configurada(
    v_ruta.cedis_id,v_ruta.fecha,v_ruta.tipo_unidad,v_ruta.esquema,v_ruta.zona,
    v_ruta.paquetes_asignados,v_ruta.entregados,coalesce(v_aplicar_descuento,false)
  );
  v_registro := p_calculo->>'registro_fiscal';
  if v_registro not in ('FACTURA','SIN FACTURA') or v_registro is null
    or p_calculo->>'ajuste_pago' is null or p_calculo->>'venta_total' is null then
    raise exception 'Faltan datos fiscales o importes del cálculo original';
  end if;
  select max(valor) filter (where clave='retencion_sin_factura'),
         max(valor) filter (where clave='comision_sin_factura'),
         max(valor) filter (where clave='iva')
    into v_k_ret,v_k_com,v_k_iva
  from public.parametros_pago
  where clave in ('retencion_sin_factura','comision_sin_factura','iva');
  if v_k_ret is null or v_k_com is null or v_k_iva is null
    or v_k_ret::text in ('NaN','Infinity','-Infinity')
    or v_k_com::text in ('NaN','Infinity','-Infinity')
    or v_k_iva::text in ('NaN','Infinity','-Infinity')
    or v_k_ret not between 0 and 1 or v_k_com not between 0 and 1 or v_k_iva not between 0 and 1 then
    raise exception 'Parámetros fiscales inválidos para COPPEL Peak';
  end if;
  v_base := (v_peak->>'pago_base')::numeric;
  v_descuento := -(v_peak->>'descuento_efectividad')::numeric;
  v_bono := (v_peak->>'bono_efectividad')::numeric;
  v_costo := v_base+v_descuento+v_bono+(p_calculo->>'ajuste_pago')::numeric;
  v_venta := (p_calculo->>'venta_total')::numeric;
  v_retencion := case when v_registro='SIN FACTURA' then round(v_costo*v_k_ret,2) else 0 end;
  v_neto := v_costo-v_retencion;
  v_comision := case when v_registro='SIN FACTURA' then round(v_neto*v_k_com,2) else 0 end;
  v_iva := case when v_registro='FACTURA' then round(v_neto*v_k_iva,2) else 0 end;
  v_pago := v_neto+v_iva;
  return p_calculo || jsonb_build_object(
    'pago_base',v_base,'dcto_pago',v_descuento,
    'regla_pago',case when v_descuento<0 then 'COPPEL Peak: descuento 5% seleccionado por IH' end,
    'bono_pago',v_bono,
    'regla_bono',case when v_bono>0 then 'COPPEL Peak: efectividad desde 95%' end,
    'costo_total',v_costo,'retencion',v_retencion,'neto',v_neto,
    'comision',v_comision,'costo_pl',v_neto+v_comision,'iva',v_iva,
    'total_costo_imp',v_neto+v_comision+v_iva,'pago_driver',v_pago,
    'utilidad',v_venta-v_costo,
    'margen',case when v_venta<>0 then round((v_venta-v_costo)/v_venta,4) end
  );
end;
$$;
revoke all on function private.coppel_peak_aplicar_a_calculo(bigint,bigint,boolean,jsonb)
  from public, anon, authenticated;

create or replace function public.coppel_peak_tarifa_para_ruta(p_ruta_id bigint)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ruta record;
  v_tarifa bigint;
begin
  if private.es_valida() is not true then raise exception 'Sin permiso para consultar tarifas de validación'; end if;
  select ru.cedis_id,ru.tipo_unidad,(ru.checkin_at at time zone 'America/Mexico_City')::date as fecha,
         cl.nombre as cliente,p.inicio,p.fin
    into v_ruta
  from public.rutas ru
  join public.cedis ce on ce.id=ru.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  left join private.coppel_peak_plazas p on p.cedis_id=ru.cedis_id
  where ru.id=p_ruta_id;
  if not found then raise exception 'Ruta no encontrada'; end if;
  if public.operativo_normalizar(v_ruta.cliente)<>'coppel'
    or public.operativo_normalizar(v_ruta.tipo_unidad)<>'sedan'
    or v_ruta.inicio is null or v_ruta.fecha not between v_ruta.inicio and v_ruta.fin then
    return null;
  end if;
  select m.tarifa_id into v_tarifa
  from private.coppel_peak_tarifas m
  where m.cedis_id=v_ruta.cedis_id;
  if not found then raise exception 'Falta la tarifa Peak para el CEDIS de esta ruta'; end if;
  return v_tarifa;
end;
$$;
revoke all on function public.coppel_peak_tarifa_para_ruta(bigint) from public, anon;
grant execute on function public.coppel_peak_tarifa_para_ruta(bigint) to authenticated;

create or replace function public.coppel_peak_elegir_descuento(
  p_ruta_id bigint, p_aplicar boolean
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_ruta record;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or private.es_valida() is not true then
    raise exception 'Solo el supervisor autorizado puede elegir el descuento COPPEL';
  end if;
  if p_aplicar is null then raise exception 'Selecciona si aplica el descuento COPPEL'; end if;
  select r.id,r.estado,r.cedis_id,ce.cliente_id
    into v_ruta from public.rutas r join public.cedis ce on ce.id=r.cedis_id
    where r.id=p_ruta_id for update of r;
  if not found or v_ruta.estado is distinct from 'cerrada'
    or public.operativo_asignado_a(v_ruta.cliente_id,v_ruta.cedis_id,'ih') is not true
    or public.coppel_peak_tarifa_para_ruta(p_ruta_id) is null then
    raise exception 'Ruta COPPEL Peak cerrada y asignada requerida';
  end if;
  if exists (select 1 from public.liquidaciones l where l.ruta_id=p_ruta_id)
    or exists (select 1 from public.validaciones_pendientes v
      where v.ruta_id=p_ruta_id and v.estatus='pendiente') then
    raise exception 'No se puede cambiar el descuento de una ruta validada o pendiente de aprobación';
  end if;
  insert into private.coppel_peak_decisiones(ruta_id,aplicar_descuento,seleccionado_por)
    values(p_ruta_id,p_aplicar,auth.uid())
  on conflict (ruta_id) do update set aplicar_descuento=excluded.aplicar_descuento,
    seleccionado_por=excluded.seleccionado_por,seleccionado_en=now();
  return p_aplicar;
end;
$$;
revoke all on function public.coppel_peak_elegir_descuento(bigint,boolean) from public, anon;
grant execute on function public.coppel_peak_elegir_descuento(bigint,boolean) to authenticated;

create or replace function public.coppel_peak_consultar_descuento(p_ruta_id bigint)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_aplicar boolean;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or not exists (
      select 1 from public.rutas r join public.cedis ce on ce.id=r.cedis_id
      where r.id=p_ruta_id and public.operativo_asignado_a(ce.cliente_id,r.cedis_id,'ih')
    ) then raise exception 'Solo el supervisor asignado puede consultar el descuento COPPEL'; end if;
  select d.aplicar_descuento into v_aplicar from private.coppel_peak_decisiones d where d.ruta_id=p_ruta_id;
  return coalesce(v_aplicar,false);
end;
$$;
revoke all on function public.coppel_peak_consultar_descuento(bigint) from public, anon;
grant execute on function public.coppel_peak_consultar_descuento(bigint) to authenticated;

create or replace function private.coppel_peak_proteger_decision()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_aplicar boolean;
begin
  if not exists (
    select 1 from private.coppel_peak_tarifas m
    join public.rutas r on r.id=new.ruta_id and r.cedis_id=m.cedis_id
    join private.coppel_peak_plazas p on p.cedis_id=r.cedis_id
    where m.tarifa_id=new.tarifa_id and new.cuenta='COPPEL'
      and public.operativo_normalizar(r.tipo_unidad)='sedan'
      and public.operativo_normalizar(new.esquema)='paquete'
      and (r.checkin_at at time zone 'America/Mexico_City')::date between p.inicio and p.fin
  ) then return new; end if;
  perform 1 from public.rutas where id=new.ruta_id for update;
  select d.aplicar_descuento into v_aplicar from private.coppel_peak_decisiones d where d.ruta_id=new.ruta_id;
  if new.dcto_pago is distinct from (case when coalesce(v_aplicar,false)
    then -round(new.pago_base*0.05,2) else 0::numeric end) then
    raise exception 'La decisión de descuento COPPEL cambió; vuelve a calcular la ruta';
  end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_decision() from public, anon, authenticated;
drop trigger if exists coppel_peak_proteger_decision on public.liquidaciones;
create trigger coppel_peak_proteger_decision before insert on public.liquidaciones
for each row execute function private.coppel_peak_proteger_decision();

create or replace function public.coppel_peak_validar_ruta(
  p_ruta_id bigint,p_tarifa_id bigint,p_registro text,p_aplicar boolean,
  p_excepcion boolean default false,p_ajuste_pago numeric default 0,
  p_ajuste_cobro numeric default 0,p_nota text default null,
  p_proveedor_id bigint default null,p_actualizar_driver boolean default false
) returns bigint language plpgsql security definer set search_path = ''
as $$
begin
  perform public.coppel_peak_elegir_descuento(p_ruta_id,p_aplicar);
  return public.validar_ruta(p_ruta_id,p_tarifa_id,p_registro,p_excepcion,
    p_ajuste_pago,p_ajuste_cobro,p_nota,p_proveedor_id,p_actualizar_driver);
end;
$$;
revoke all on function public.coppel_peak_validar_ruta(bigint,bigint,text,boolean,boolean,numeric,numeric,text,bigint,boolean) from public, anon;
grant execute on function public.coppel_peak_validar_ruta(bigint,bigint,text,boolean,boolean,numeric,numeric,text,bigint,boolean) to authenticated;

-- Se reemplaza solo la definición diagnosticada; ante cualquier cambio, aborta.
do $$
declare
  v_def text;
  v_hash text;
  v_open text := '  return jsonb_build_object(';
  v_close text := E'    ''excepcion_supervisor'', coalesce(p_excepcion,false), ''avisos'', to_jsonb(avisos)\n  );';
begin
  select replace(pg_catalog.pg_get_functiondef(
    'private.calc_liquidacion(bigint,bigint,text,boolean,numeric,numeric)'::regprocedure
  ),E'\r\n',E'\n') into v_def;
  v_hash := md5(v_def);
  if v_hash='0d0ebbfae16bdb4e7b05711c554362fd' then return; end if;
  if v_hash<>'e6ab00641244473922cc1724a6ae55df'
    or length(v_def)-length(replace(v_def,v_open,''))<>length(v_open)
    or length(v_def)-length(replace(v_def,v_close,''))<>length(v_close) then
    raise exception 'El calculador productivo cambió; no se puede integrar COPPEL Peak automáticamente';
  end if;
  v_def := replace(v_def,v_open,
    '  return private.coppel_peak_aplicar_a_calculo(p_ruta_id, p_tarifa_id, p_excepcion, jsonb_build_object(');
  v_def := replace(v_def,v_close,replace(v_close,E'\n  );',E'\n  ));'));
  execute v_def;
end;
$$;

commit;

-- BORRADOR: no ejecutar en Supabase ni publicar hasta integrar y probar todo el flujo.
-- Este archivo no modifica las tarifas, liquidaciones ni pagos existentes.
begin;

create table if not exists private.coppel_peak_plazas (
  cedis_id bigint primary key references public.cedis(id),
  inicio date not null,
  fin date not null,
  pago_paquete numeric(12,2) not null check (pago_paquete > 0),
  bono_efectividad_paquete numeric(12,2) not null check (bono_efectividad_paquete >= 0),
  bono_asistencia_paquete numeric(12,2) not null check (bono_asistencia_paquete >= 0),
  cancelacion_garantizada boolean not null,
  check (fin >= inicio)
);

revoke all on private.coppel_peak_plazas from public, anon, authenticated;

do $$
declare
  r record;
  coincidencias integer;
begin
  for r in
    select * from (values
      (24,'Express Aguascalientes',35,0,0,false),
      (23,'Express Ensenada',38,0,0,false),
      (22,'DS Coppel AZC',30,5,2,true),
      (21,'DS Coppel Iztapalapa',30,5,2,true),
      (20,'Express Durango',35,0,0,false),
      (19,'Express Gómez Palacio',35,0,0,false),
      (18,'DS Coppel Tecámac',30,5,2,true),
      (17,'Express Toluca',30,5,0,true),
      (15,'Express Guadalajara',40,0,0,false),
      (14,'DS Coppel Monterrey',35,0,3,true),
      (13,'Express Puebla',30,3,2,true),
      (12,'Express San Luis Potosí',33,0,0,false),
      (11,'Express Mazatlán',40,0,0,false),
      (10,'Hermosillo',35,0,3,false),
      (9,'Express Ciudad Obregón',35,0,0,false),
      (8,'Express Xalapa',30,0,2,false),
      (7,'Express Zacatecas',33,0,0,false),
      (6,'DS Express Izcalli',40,0,0,false)
    ) as x(id,nombre,base,efectividad,asistencia,cancelacion)
  loop
    select count(*) into coincidencias
    from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
    where ce.id=r.id and ce.activo and cl.activo
      and public.operativo_normalizar(ce.nombre)=public.operativo_normalizar(r.nombre)
      and public.operativo_normalizar(cl.nombre)='coppel';
    if coincidencias <> 1 then
      raise exception 'Revisa el CEDIS COPPEL % (%): no coincide con el diagnóstico',r.nombre,r.id;
    end if;
    insert into private.coppel_peak_plazas
      (cedis_id,inicio,fin,pago_paquete,bono_efectividad_paquete,bono_asistencia_paquete,cancelacion_garantizada)
    values (r.id,'2026-11-09','2027-01-10',r.base,r.efectividad,r.asistencia,r.cancelacion)
    on conflict (cedis_id) do nothing;
    if not exists (
      select 1 from private.coppel_peak_plazas p
      where p.cedis_id=r.id and p.inicio='2026-11-09' and p.fin='2027-01-10'
        and p.pago_paquete=r.base and p.bono_efectividad_paquete=r.efectividad
        and p.bono_asistencia_paquete=r.asistencia and p.cancelacion_garantizada=r.cancelacion
    ) then raise exception 'La configuración Peak del CEDIS % difiere del borrador',r.nombre; end if;
  end loop;
end;
$$;

create or replace function private.calcular_coppel_peak_ruta(
  p_base numeric, p_bono_efectividad numeric, p_asignados integer, p_entregados integer
) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_base numeric;
  v_descuento numeric;
  v_bono numeric;
begin
  if p_base is null or p_base::text in ('NaN','Infinity','-Infinity') or p_base <= 0
    or p_bono_efectividad is null or p_bono_efectividad::text in ('NaN','Infinity','-Infinity') or p_bono_efectividad < 0
    or p_asignados is null or p_asignados <= 0
    or p_entregados is null or p_entregados < 0 or p_entregados > p_asignados then
    raise exception 'Datos inválidos para calcular la ruta COPPEL';
  end if;
  v_base := round(p_base*p_entregados,2);
  v_descuento := case when p_entregados::numeric*100 < p_asignados::numeric*90
    then round(v_base*0.05,2) else 0 end;
  v_bono := case when p_entregados::numeric*100 >= p_asignados::numeric*95
    then round(p_bono_efectividad*p_entregados,2) else 0 end;
  return jsonb_build_object('pago_base',v_base,'descuento_efectividad',v_descuento,
    'bono_efectividad',v_bono,'subtotal',v_base-v_descuento+v_bono);
end;
$$;
revoke all on function private.calcular_coppel_peak_ruta(numeric,numeric,integer,integer)
  from public, anon, authenticated;

create or replace function private.coppel_peak_calcular_ruta_configurada(
  p_cedis_id bigint, p_fecha date, p_unidad text, p_esquema text, p_zona text,
  p_asignados integer, p_entregados integer
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare v_plaza private.coppel_peak_plazas%rowtype;
begin
  if p_cedis_id is null or p_fecha is null or
    upper(btrim(coalesce(p_unidad,''))) <> 'SEDAN' or
    upper(btrim(coalesce(p_esquema,''))) <> 'PAQUETE' or
    upper(btrim(coalesce(p_zona,''))) <> 'LOCAL' then
    raise exception 'La ruta no corresponde al esquema COPPEL Peak SEDAN local';
  end if;
  select * into v_plaza from private.coppel_peak_plazas p
  where p.cedis_id=p_cedis_id and p_fecha between p.inicio and p.fin;
  if not found then
    raise exception 'No hay tarifa COPPEL Peak para el CEDIS y fecha indicados';
  end if;
  return private.calcular_coppel_peak_ruta(
    v_plaza.pago_paquete,v_plaza.bono_efectividad_paquete,p_asignados,p_entregados
  );
end;
$$;
revoke all on function private.coppel_peak_calcular_ruta_configurada(bigint,date,text,text,text,integer,integer)
  from public, anon, authenticated;

create or replace function private.coppel_peak_asistencia_completa(
  p_lunes date, p_dias date[], p_hubo_no_show boolean
) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare v_dia date;
begin
  if p_lunes is null or extract(isodow from p_lunes) <> 1
    or p_lunes < date '2026-11-09' or p_lunes + 6 > date '2027-01-10'
    or p_dias is null or p_hubo_no_show is null then
    raise exception 'Semana o asistencia COPPEL inválida';
  end if;
  foreach v_dia in array p_dias loop
    if v_dia is null or v_dia < p_lunes or v_dia > p_lunes + 6 then
      raise exception 'La asistencia debe pertenecer a la semana indicada';
    end if;
  end loop;
  return not p_hubo_no_show and not exists (
    select 1 from generate_series(0,5) as dia
    where not (p_lunes + dia = any(p_dias))
  );
end;
$$;
revoke all on function private.coppel_peak_asistencia_completa(date,date[],boolean)
  from public, anon, authenticated;

-- La integración pendiente debe proporcionar solo rutas validadas de SEDAN local;
-- 3.5T y Huixquilucan se gestionan manualmente.
create or replace function private.calcular_coppel_peak_asistencia(
  p_lunes date, p_dias date[], p_hubo_no_show boolean, p_rutas jsonb
) returns numeric
language plpgsql stable set search_path = ''
as $$
declare
  v_completa boolean;
  v_ruta record;
  v_ids bigint[] := '{}';
  v_tarifa numeric;
  v_total numeric := 0;
begin
  v_completa := private.coppel_peak_asistencia_completa(p_lunes,p_dias,p_hubo_no_show);
  if p_rutas is null or jsonb_typeof(p_rutas) <> 'array' then
    raise exception 'Se requiere una lista de rutas validadas';
  end if;
  for v_ruta in
    select * from jsonb_to_recordset(p_rutas)
      as x(ruta_id bigint,cedis_id bigint,fecha date,entregados integer)
  loop
    if v_ruta.ruta_id is null or v_ruta.ruta_id <= 0
      or v_ruta.cedis_id is null or v_ruta.fecha is null
      or v_ruta.fecha < p_lunes or v_ruta.fecha > p_lunes + 6
      or v_ruta.entregados is null or v_ruta.entregados < 0
      or v_ruta.ruta_id = any(v_ids) then
      raise exception 'Ruta validada duplicada o inválida para el bono de asistencia';
    end if;
    v_ids := array_append(v_ids,v_ruta.ruta_id);
    select p.bono_asistencia_paquete into v_tarifa
    from private.coppel_peak_plazas p
    where p.cedis_id=v_ruta.cedis_id and v_ruta.fecha between p.inicio and p.fin;
    if not found then raise exception 'Ruta sin configuración Peak para el CEDIS %',v_ruta.cedis_id; end if;
    v_total := v_total + v_tarifa*v_ruta.entregados;
  end loop;
  return case when v_completa then round(v_total,2) else 0 end;
end;
$$;
revoke all on function private.calcular_coppel_peak_asistencia(date,date[],boolean,jsonb)
  from public, anon, authenticated;

create or replace function private.coppel_peak_previsualizar_semana(
  p_driver_id uuid, p_lunes date
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_dias date[];
  v_hubo_no_show boolean;
  v_rutas jsonb;
  v_asistencia numeric;
  v_rutas_domingo integer;
  v_proveedores bigint[];
  v_faltan_proveedores boolean;
  v_registros_fiscales integer;
  v_domingo_sin_destino integer;
  v_domingo_proveedores bigint[];
  v_domingo_registros_fiscales integer;
begin
  if p_driver_id is null or p_lunes is null or extract(isodow from p_lunes) <> 1
    or p_lunes < date '2026-11-09' or p_lunes + 6 > date '2027-01-10' then
    raise exception 'Driver o semana COPPEL inválidos';
  end if;

  select coalesce(array_agg(distinct x.dia order by x.dia),'{}'::date[]) into v_dias
  from (
    select (r.checkin_at at time zone 'America/Mexico_City')::date as dia
    from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.driver_id=p_driver_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
      and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
    union
    select (c.capturado_at at time zone 'America/Mexico_City')::date
    from public.cancelaciones c
    join public.cedis ce on ce.id=c.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where c.driver_id=p_driver_id and c.estatus='aprobada'
      and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
      and (c.capturado_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
  ) x;
  select exists (
    select 1 from public.no_show_casos ns
    where ns.driver_id=p_driver_id and ns.cuenta='COPPEL'
      and ns.fecha_servicio between p_lunes and p_lunes+6
      and ns.estado <> 'apelacion_aceptada'
  ) into v_hubo_no_show;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ruta_id',r.id,'cedis_id',r.cedis_id,
    'fecha',(r.checkin_at at time zone 'America/Mexico_City')::date,
    'entregados',l.entregados,'proveedor_id',l.proveedor_id,
    'registro_fiscal',l.registro_fiscal
  ) order by r.id),'[]'::jsonb) into v_rutas
  from public.liquidaciones l
  join public.rutas r on r.id=l.ruta_id
  join public.tarifas t on t.id=l.tarifa_id
  join private.coppel_peak_plazas p on p.cedis_id=r.cedis_id
  where r.driver_id=p_driver_id and l.cuenta='COPPEL'
    and upper(btrim(l.tipo_unidad))='SEDAN'
    and upper(btrim(l.esquema))='PAQUETE'
    and upper(btrim(t.zona))='LOCAL'
    and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
    and (r.checkin_at at time zone 'America/Mexico_City')::date between p.inicio and p.fin;
  v_asistencia := private.calcular_coppel_peak_asistencia(p_lunes,v_dias,v_hubo_no_show,v_rutas);
  select coalesce(array_agg(distinct x.proveedor_id) filter (where x.proveedor_id is not null),'{}'::bigint[]),
         coalesce(bool_or(x.proveedor_id is null or x.registro_fiscal is null
           or x.registro_fiscal not in ('FACTURA','SIN FACTURA')),false),
         count(distinct x.registro_fiscal)
    into v_proveedores,v_faltan_proveedores,v_registros_fiscales
  from jsonb_to_recordset(v_rutas) as x(proveedor_id bigint,registro_fiscal text);

  select count(*),
    count(*) filter (where l.id is null or l.cuenta is distinct from 'COPPEL'
      or l.proveedor_id is null or l.registro_fiscal is null
      or l.registro_fiscal not in ('FACTURA','SIN FACTURA')),
    coalesce(array_agg(distinct l.proveedor_id) filter (where l.proveedor_id is not null),'{}'::bigint[]),
    count(distinct l.registro_fiscal)
  into v_rutas_domingo,v_domingo_sin_destino,v_domingo_proveedores,v_domingo_registros_fiscales
  from public.rutas r
  join public.cedis ce on ce.id=r.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  left join public.liquidaciones l on l.ruta_id=r.id
  where r.driver_id=p_driver_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
    and (r.checkin_at at time zone 'America/Mexico_City')::date=p_lunes+6;
  return jsonb_build_object(
    'lunes',p_lunes,'dias_asistencia',to_jsonb(v_dias),'hubo_no_show',v_hubo_no_show,
    'rutas_validadas',v_rutas,'bono_asistencia_base',v_asistencia,
    'proveedores',to_jsonb(v_proveedores),
    'asistencia_requiere_revision',v_faltan_proveedores or cardinality(v_proveedores)>1 or v_registros_fiscales>1,
    'rutas_domingo',v_rutas_domingo,
    'domingo_requiere_revision',v_domingo_sin_destino>0 or cardinality(v_domingo_proveedores)>1 or v_domingo_registros_fiscales>1,
    'bono_domingo_base',case when v_rutas_domingo>0 then 300 else 0 end
  );
end;
$$;
revoke all on function private.coppel_peak_previsualizar_semana(uuid,date)
  from public, anon, authenticated;

create or replace function private.coppel_peak_bono_domingo(
  p_fecha date, p_rutas_registradas integer
) returns numeric
language plpgsql immutable set search_path = ''
as $$
begin
  if p_fecha is null or p_fecha < date '2026-11-09' or p_fecha > date '2027-01-10'
    or p_rutas_registradas is null or p_rutas_registradas < 0 then
    raise exception 'Fecha o número de rutas inválidos para el bono dominical COPPEL';
  end if;
  return case when extract(isodow from p_fecha)=7 and p_rutas_registradas>0 then 300 else 0 end;
end;
$$;
revoke all on function private.coppel_peak_bono_domingo(date,integer)
  from public, anon, authenticated;

create or replace function private.coppel_peak_fiscal_bono(
  p_bono numeric, p_registro text, p_retencion numeric, p_comision numeric, p_iva numeric
) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_retencion numeric := 0;
  v_neto numeric;
  v_comision numeric := 0;
  v_iva numeric := 0;
begin
  if p_bono is null or p_bono::text in ('NaN','Infinity','-Infinity')
    or p_bono < 0 or p_bono <> round(p_bono,2)
    or p_registro is null or p_registro not in ('FACTURA','SIN FACTURA')
    or p_retencion is null or p_retencion::text in ('NaN','Infinity','-Infinity') or p_retencion not between 0 and 1
    or p_comision is null or p_comision::text in ('NaN','Infinity','-Infinity') or p_comision not between 0 and 1
    or p_iva is null or p_iva::text in ('NaN','Infinity','-Infinity') or p_iva not between 0 and 1 then
    raise exception 'Datos fiscales inválidos para el bono COPPEL';
  end if;
  if p_registro='SIN FACTURA' then v_retencion := round(p_bono*p_retencion,2); end if;
  v_neto := p_bono-v_retencion;
  if p_registro='SIN FACTURA' then v_comision := round(v_neto*p_comision,2); end if;
  if p_registro='FACTURA' then v_iva := round(v_neto*p_iva,2); end if;
  return jsonb_build_object(
    'bono_base',p_bono,'retencion',v_retencion,'neto',v_neto,
    'comision',v_comision,'iva',v_iva,'pago_proveedor',v_neto+v_iva,
    'costo_total_imp',v_neto+v_comision+v_iva
  );
end;
$$;
revoke all on function private.coppel_peak_fiscal_bono(numeric,text,numeric,numeric,numeric)
  from public, anon, authenticated;

-- Solo calcula la diferencia; la integración debe serializar y registrar cada
-- pago y su fuente antes de volver a ejecutar la conciliación.
create or replace function private.coppel_peak_conciliar_bono(
  p_calculado numeric, p_registrado numeric
) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare v_diferencia numeric;
begin
  if p_calculado is null or p_calculado::text in ('NaN','Infinity','-Infinity')
    or p_calculado < 0 or p_calculado <> round(p_calculado,2)
    or p_registrado is null or p_registrado::text in ('NaN','Infinity','-Infinity')
    or p_registrado < 0 or p_registrado <> round(p_registrado,2) then
    raise exception 'Importes inválidos para conciliar el bono COPPEL';
  end if;
  v_diferencia := p_calculado-p_registrado;
  return jsonb_build_object(
    'calculado',p_calculado,'registrado',p_registrado,
    'estado',case when v_diferencia < 0 then 'revision'
                  when v_diferencia > 0 then 'pendiente' else 'conciliado' end,
    'diferencia',v_diferencia
  );
end;
$$;
revoke all on function private.coppel_peak_conciliar_bono(numeric,numeric)
  from public, anon, authenticated;

commit;

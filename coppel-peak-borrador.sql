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

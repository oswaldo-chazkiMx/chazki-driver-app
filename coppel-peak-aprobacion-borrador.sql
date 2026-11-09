-- BORRADOR INCOMPLETO: no ejecutar ni publicar.
-- Falta integrar cierre manual, semanas inmutables y ajustes retroactivos autorizados.
begin;

create table if not exists private.coppel_peak_aprobaciones_asistencia (
  driver_id uuid not null references public.drivers(id),
  lunes date not null,
  aplica boolean not null,
  aprobado_por uuid not null references public.drivers(id),
  aprobado_en timestamptz not null default now(),
  resumen jsonb not null,
  proveedor_id bigint references public.proveedores(id),
  registro_fiscal text,
  fiscal jsonb,
  pago_id bigint unique references public.pagos(id),
  primary key (driver_id,lunes)
);
revoke all on private.coppel_peak_aprobaciones_asistencia from public, anon, authenticated;

create or replace function private.coppel_peak_fecha_actual()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'America/Mexico_City')::date $$;
revoke all on function private.coppel_peak_fecha_actual() from public, anon, authenticated;

create or replace function private.coppel_peak_calcular_ajuste_retroactivo(
  p_tipo text, p_pendiente numeric, p_base_actual numeric, p_subtotal_actual numeric,
  p_pago_disponible numeric, p_registro text,
  p_retencion numeric, p_comision numeric, p_iva numeric
) returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_aplicado numeric;
  v_base_nueva numeric;
  v_subtotal_nuevo numeric;
  v_antes jsonb;
  v_despues jsonb;
  v_bajo numeric;
  v_alto numeric;
  v_medio numeric;
begin
  if p_tipo is null or p_tipo not in ('descuento','abono')
    or p_pendiente is null or p_pendiente::text in ('NaN','Infinity','-Infinity')
    or p_pendiente < 0 or p_pendiente <> round(p_pendiente,2)
    or p_base_actual is null or p_base_actual::text in ('NaN','Infinity','-Infinity')
    or p_base_actual < 0 or p_base_actual <> round(p_base_actual,2)
    or p_subtotal_actual is null or p_subtotal_actual::text in ('NaN','Infinity','-Infinity')
    or p_subtotal_actual < p_base_actual or p_subtotal_actual <> round(p_subtotal_actual,2)
    or p_pago_disponible is null or p_pago_disponible::text in ('NaN','Infinity','-Infinity')
    or p_pago_disponible < 0 or p_pago_disponible <> round(p_pago_disponible,2) then
    raise exception 'Datos inválidos para el ajuste retroactivo COPPEL';
  end if;
  v_antes := private.coppel_peak_fiscal_bono(p_subtotal_actual,p_registro,p_retencion,p_comision,p_iva);
  v_aplicado := case when p_tipo='descuento' then least(p_pendiente,p_base_actual)
    else p_pendiente end;
  if p_tipo='descuento' then
    v_bajo:=0;
    v_alto:=case when p_pago_disponible=0 then 0 else v_aplicado*100 end;
    while v_bajo<v_alto loop
      v_medio:=floor((v_bajo+v_alto+1)/2);
      v_despues:=private.coppel_peak_fiscal_bono(
        p_subtotal_actual-v_medio/100,p_registro,p_retencion,p_comision,p_iva);
      if (v_antes->>'pago_proveedor')::numeric-(v_despues->>'pago_proveedor')::numeric<=p_pago_disponible then
        v_bajo:=v_medio;
      else
        v_alto:=v_medio-1;
      end if;
    end loop;
    v_aplicado:=v_bajo/100;
  end if;
  v_base_nueva := case when p_tipo='descuento' then p_base_actual-v_aplicado
    else p_base_actual+v_aplicado end;
  v_subtotal_nuevo := p_subtotal_actual+(v_base_nueva-p_base_actual);
  v_despues := private.coppel_peak_fiscal_bono(v_subtotal_nuevo,p_registro,p_retencion,p_comision,p_iva);
  return jsonb_build_object(
    'tipo',p_tipo,
    'ajuste_base',case when p_tipo='descuento' then -v_aplicado else v_aplicado end,
    'pendiente_base',p_pendiente-v_aplicado,'base_resultante',v_base_nueva,'subtotal_resultante',v_subtotal_nuevo,
    'ajuste_pago',(v_despues->>'pago_proveedor')::numeric-(v_antes->>'pago_proveedor')::numeric,
    'fiscal_antes',v_antes,'fiscal_despues',v_despues
  );
end;
$$;
revoke all on function private.coppel_peak_calcular_ajuste_retroactivo(text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric)
  from public, anon, authenticated;

create or replace function public.coppel_peak_aprobar_asistencia(
  p_driver_id uuid, p_lunes date, p_aplicar boolean, p_resumen_esperado jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_consulta jsonb;
  v_resumen jsonb;
  v_anterior private.coppel_peak_aprobaciones_asistencia%rowtype;
  v_base numeric;
  v_proveedor bigint;
  v_registro text;
  v_retencion numeric;
  v_comision numeric;
  v_iva numeric;
  v_fiscal jsonb;
  v_pago_id bigint;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() not in ('ih','coordinador','ops','master')
    or public.operativo_rol_actual() is null then
    raise exception 'Sin permiso para aprobar la asistencia COPPEL';
  end if;
  if p_driver_id is null or p_lunes is null or p_aplicar is null
    or p_resumen_esperado is null or jsonb_typeof(p_resumen_esperado) <> 'object' then
    raise exception 'Se requiere una decisión y un resumen COPPEL válido';
  end if;
  if private.coppel_peak_fecha_actual() <= p_lunes+6 then
    raise exception 'El bono de asistencia se decide después de terminar la semana';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('coppel-peak:'||p_driver_id::text||':'||p_lunes::text,0)
  );
  v_consulta := public.coppel_peak_consultar_semana(p_driver_id,p_lunes);
  if v_consulta->>'estado' is distinct from 'completo' then
    raise exception 'La semana requiere revisión por un responsable con acceso completo';
  end if;
  v_resumen := v_consulta->'resumen';
  if v_resumen is distinct from p_resumen_esperado then
    raise exception 'El resumen cambió; vuelve a revisarlo antes de decidir';
  end if;
  select * into v_anterior from private.coppel_peak_aprobaciones_asistencia
    where driver_id=p_driver_id and lunes=p_lunes;
  if found then
    if v_anterior.aplica is distinct from p_aplicar or v_anterior.resumen is distinct from v_resumen then
      raise exception 'La asistencia de esta semana ya fue decidida; requiere revisión';
    end if;
    return jsonb_build_object('aplica',v_anterior.aplica,'pago_id',v_anterior.pago_id,'fiscal',v_anterior.fiscal);
  end if;

  if p_aplicar then
    if exists (
      select 1 from public.rutas r
      join public.cedis ce on ce.id=r.cedis_id
      join public.clientes cl on cl.id=ce.cliente_id
      where r.driver_id=p_driver_id
        and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
        and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
        and not exists (select 1 from public.liquidaciones l where l.ruta_id=r.id)
    ) then raise exception 'Hay rutas COPPEL sin validar; revisa la semana antes de aplicar el bono'; end if;
    v_base := (v_resumen->>'bono_asistencia_potencial')::numeric;
    if v_base is null or v_base < 0 then raise exception 'El bono de asistencia no es válido'; end if;
    if v_base > 0 then
      if (v_resumen->>'asistencia_requiere_revision')::boolean is not false
        or jsonb_array_length(v_resumen->'proveedores') <> 1 then
        raise exception 'Revisa el proveedor y el registro fiscal antes de aplicar el bono';
      end if;
      v_proveedor := (v_resumen->'proveedores'->>0)::bigint;
      select min(x.registro_fiscal) into v_registro
      from jsonb_to_recordset(v_resumen->'rutas_validadas') as x(registro_fiscal text);
      select max(valor) filter (where clave='retencion_sin_factura'),
             max(valor) filter (where clave='comision_sin_factura'),
             max(valor) filter (where clave='iva')
        into v_retencion,v_comision,v_iva
      from public.parametros_pago
      where clave in ('retencion_sin_factura','comision_sin_factura','iva');
      v_fiscal := private.coppel_peak_fiscal_bono(v_base,v_registro,v_retencion,v_comision,v_iva);
      insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
      values(p_driver_id,v_proveedor,null,'bono',(v_fiscal->>'pago_proveedor')::numeric,p_lunes+6,'pendiente')
      returning id into v_pago_id;
    end if;
  end if;

  insert into private.coppel_peak_aprobaciones_asistencia
    (driver_id,lunes,aplica,aprobado_por,resumen,proveedor_id,registro_fiscal,fiscal,pago_id)
  values(p_driver_id,p_lunes,p_aplicar,auth.uid(),v_resumen,v_proveedor,v_registro,v_fiscal,v_pago_id);
  update private.coppel_peak_solicitudes_revision set estado='resuelta'
    where driver_id=p_driver_id and lunes=p_lunes and estado='pendiente';
  return jsonb_build_object('aplica',p_aplicar,'pago_id',v_pago_id,'fiscal',v_fiscal);
end;
$$;
revoke all on function public.coppel_peak_aprobar_asistencia(uuid,date,boolean,jsonb) from public, anon;
grant execute on function public.coppel_peak_aprobar_asistencia(uuid,date,boolean,jsonb) to authenticated;

commit;

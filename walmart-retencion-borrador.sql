-- BORRADOR: no ejecutar ni publicar hasta integrar la validacion y los pagos.
-- La decision de retencion es independiente del tratamiento fiscal.
begin;

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

commit;

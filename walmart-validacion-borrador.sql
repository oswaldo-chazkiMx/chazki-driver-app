-- BORRADOR: no instalar ni activar antes de completar anulación, casos NO SHOW
-- heredados, liberación de retención y pruebas reales en Supabase.
begin;

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

commit;

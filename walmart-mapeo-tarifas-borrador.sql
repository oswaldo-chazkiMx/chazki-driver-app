-- BORRADOR: no instalar ni publicar sin ensayar restricciones y flujo financiero.
-- Los importes de las dos opciones permanecen en public.walmart_tarifas.
begin;

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

commit;

-- Upsert tarifas y reglas compatibles con el calculador actual.
-- Cubbo: el porcentaje por efectividad aplica al pago base de $1,400.
-- Despues de 40 entregas, sumar $30 por cada entrega al pago y $40 al cobro.
-- AMPM: efectividad aplica a base mas extras; se agregan tarifas por excedente segun vehiculo.
begin;

do $$
declare
  c record;
  definicion text;
begin
  for c in
    select * from (values
      ('tarifas'::text, 'tarifas_cuenta_check'::text),
      ('reglas_penalizacion'::text, 'reglas_penalizacion_cuenta_check'::text)
    ) as x(tabla, restriccion)
  loop
    select pg_get_expr(con.conbin, con.conrelid)
      into definicion
      from pg_constraint con
     where con.conrelid = format('public.%I', c.tabla)::regclass
       and con.conname = c.restriccion
       and con.contype = 'c';

    if definicion is not null then
      execute format('alter table public.%I drop constraint %I', c.tabla, c.restriccion);
      execute format(
        'alter table public.%I add constraint %I check ((%s) or cuenta in (''MELI'', ''COPPEL'', ''LIVERPOOL'', ''CUBBO'', ''NESPRESSO'', ''ESTAFETA'', ''AMPM''))',
        c.tabla, c.restriccion, definicion
      );
    end if;
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('NESPRESSO', 'NESPRESSO', 'CDMX', 'GEODIS', 'LOCAL', 'SEDAN (1 A 20)', 'RUTA', 'REGULAR', 750.00::numeric, 49.90::numeric, date '2026-01-01', null::date),
      ('NESPRESSO', 'NESPRESSO', 'CDMX', 'GEODIS', 'LOCAL', 'SEDAN', 'RECOLECCION (LUNES A JUEVES)', 'REGULAR', 500.00::numeric, 0.00::numeric, date '2026-01-01', null::date),
      ('NESPRESSO', 'NESPRESSO', 'CDMX', 'GEODIS', 'LOCAL', 'SEDAN', 'RECOLECCION (VIERNES & SABADO)', 'REGULAR', 350.00::numeric, 0.00::numeric, date '2026-01-01', null::date),
      ('NESPRESSO', 'NESPRESSO', 'CDMX', 'GEODIS', 'LOCAL', 'SEDAN (21 A 30)', 'RUTA', 'REGULAR', 1000.00::numeric, 49.90::numeric, date '2026-01-01', null::date),
      ('NESPRESSO', 'NESPRESSO', 'CDMX', 'GEODIS', 'LOCAL', 'SEDAN (31 A 45)', 'RUTA', 'REGULAR', 1300.00::numeric, 49.90::numeric, date '2026-01-01', null::date),
      ('NESPRESSO', 'NESPRESSO', 'CDMX', 'GEODIS', 'LOCAL', 'SEDAN (46 A 60)', 'RUTA', 'REGULAR', 1500.00::numeric, 49.90::numeric, date '2026-01-01', null::date),
      ('NESPRESSO', 'NESPRESSO', 'CDMX', 'GEODIS', 'LOCAL', 'SEDAN (61 EN ADELANTE)', 'RUTA', 'REGULAR', 1500.00::numeric, 49.90::numeric, date '2026-01-01', null::date),
      ('NESPRESSO', 'NESPRESSO', 'CANCUN', 'CANCUN', 'LOCAL', 'SEDAN', 'RUTA', 'REGULAR', 2000.00::numeric, 2400.00::numeric, date '2026-01-01', null::date),
      ('CUBBO', 'CUBBO', 'CDMX', 'IZTAPALAPA', 'LOCAL', 'SEDAN', 'PAQUETE', 'REGULAR', 1400.00::numeric, 1600.00::numeric, date '2026-01-01', null::date),
      ('CUBBO', 'CUBBO', 'CDMX', 'IZTAPALAPA', 'LOCAL', 'SEDAN', 'PAQUETE', 'PICK', 1400.00::numeric, 1600.00::numeric, date '2026-01-01', null::date),
      ('CUBBO', 'CUBBO', 'CDMX', 'TOREO', 'LOCAL', 'SEDAN', 'PAQUETE', 'REGULAR', 1400.00::numeric, 1600.00::numeric, date '2026-01-01', null::date),
      ('CUBBO', 'CUBBO', 'CDMX', 'TOREO', 'LOCAL', 'SEDAN', 'PAQUETE', 'PICK', 1400.00::numeric, 1600.00::numeric, date '2026-01-01', null::date),
      ('ESTAFETA', 'ESTAFETA', 'TLALNEPANTLA', 'TLALNEPANTLA', 'LOCAL', 'SEDAN', 'PAQUETE', 'TEMPORADA REGULAR', 25.00::numeric, 32.00::numeric, date '2026-01-01', date '2026-11-08'),
      ('ESTAFETA', 'ESTAFETA', 'TLALNEPANTLA', 'TLALNEPANTLA', 'LOCAL', 'SEDAN', 'PAQUETE', 'TEMPORADA ALTA', 27.00::numeric, 32.00::numeric, date '2026-11-09', date '2027-01-10'),
      ('ESTAFETA', 'ESTAFETA', 'TLALNEPANTLA', 'TLALNEPANTLA', 'LOCAL', 'SEDAN', 'PAQUETE', 'TEMPORADA REGULAR', 25.00::numeric, 32.00::numeric, date '2027-01-11', null::date)
      ,('AMPM', 'AMPM', 'TLALNEPANTLA', 'TLALNEPANTLA', 'LOCAL', 'SEDAN', 'PAQUETE', 'REGULAR', 1450.00::numeric, 1800.00::numeric, date '2026-11-04', null::date)
      ,('AMPM', 'AMPM', 'TLALNEPANTLA', 'TLALNEPANTLA', 'LOCAL', 'SMALL VAN', 'PAQUETE', 'REGULAR', 1850.00::numeric, 2250.00::numeric, date '2026-11-04', null::date)
      ,('AMPM', 'AMPM', 'TLALNEPANTLA', 'TLALNEPANTLA', 'LOCAL', 'LARGE VAN', 'PAQUETE', 'REGULAR', 2200.00::numeric, 2700.00::numeric, date '2026-11-04', null::date)
    ) as v(cuenta, cliente, ciudad, ubicacion, zona, tipo_unidad, esquema, variable, pago_base, tarifa_cliente, vigencia_desde, vigencia_hasta)
  loop
    update public.tarifas as t
    set cliente = r.cliente,
        ciudad = r.ciudad,
        zona = r.zona,
        pago_base = r.pago_base,
        tarifa_cliente = r.tarifa_cliente,
        vigencia_hasta = r.vigencia_hasta,
        activo = true,
        conc = concat(r.ubicacion, r.tipo_unidad, r.esquema, r.zona, r.variable),
        fuente = 'Panel'
    where t.cuenta = r.cuenta
      and t.ubicacion is not distinct from r.ubicacion
      and t.ciudad is not distinct from r.ciudad
      and t.zona is not distinct from r.zona
      and t.tipo_unidad is not distinct from r.tipo_unidad
      and t.esquema is not distinct from r.esquema
      and t.variable is not distinct from r.variable
      and t.vigencia_desde = r.vigencia_desde;

    if not found then
      insert into public.tarifas (
        cuenta, cliente, ciudad, ubicacion, zona, tipo_unidad, esquema, variable,
        pago_base, tarifa_cliente, vigencia_desde, vigencia_hasta, activo, conc, fuente
      ) values (
        r.cuenta, r.cliente, r.ciudad, r.ubicacion, r.zona, r.tipo_unidad, r.esquema, r.variable,
        r.pago_base, r.tarifa_cliente, r.vigencia_desde, r.vigencia_hasta, true,
        concat(r.ubicacion, r.tipo_unidad, r.esquema, r.zona, r.variable), 'Panel'
      );
    end if;
  end loop;

  for r in
    select * from (values
      ('NESPRESSO', 'porcentaje_descuento', 'pago', 0.05::numeric, null::numeric, 0.90::numeric, 5, null::text, 'RUTA', date '2026-01-01',
       'Descuento del 5% al pago cuando la efectividad sea menor a 90%. Aplicable a rutas.'),
      ('CUBBO', 'porcentaje_descuento', 'pago', 1.00::numeric, null::numeric, 0.51::numeric, 1, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Efectividad menor a 51%: se paga 0% del pago base.'),
      ('CUBBO', 'porcentaje_descuento', 'pago', 0.25::numeric, 0.51::numeric, 0.86::numeric, 2, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Efectividad desde 51% y menor a 86%: se paga 75% del pago base.'),
      ('CUBBO', 'porcentaje_descuento', 'pago', 0.20::numeric, 0.86::numeric, 0.90::numeric, 3, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Efectividad desde 86% y menor a 90%: se paga 80% del pago base.'),
      ('CUBBO', 'porcentaje_descuento', 'pago', 0.12::numeric, 0.90::numeric, 0.93::numeric, 4, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Efectividad desde 90% y menor a 93%: se paga 88% del pago base.'),
      ('CUBBO', 'porcentaje_descuento', 'pago', 0.06::numeric, 0.93::numeric, 0.95::numeric, 5, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Efectividad desde 93% y menor a 95%: se paga 94% del pago base.'),
      ('ESTAFETA', 'porcentaje_descuento', 'pago', 1.00::numeric, null::numeric, 0.50::numeric, 1, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Pago aplicado: 0% cuando la efectividad sea menor a 50%.'),
      ('ESTAFETA', 'porcentaje_descuento', 'pago', 0.50::numeric, null::numeric, 0.81::numeric, 2, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Pago aplicado: 50% cuando la efectividad sea de 50% a menos de 81%.'),
      ('ESTAFETA', 'porcentaje_descuento', 'pago', 0.30::numeric, null::numeric, 0.91::numeric, 3, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Pago aplicado: 70% cuando la efectividad sea de 81% a menos de 91%.'),
      ('ESTAFETA', 'porcentaje_descuento', 'pago', 0.10::numeric, null::numeric, 0.96::numeric, 4, 'SEDAN', 'PAQUETE', date '2026-01-01',
       'Pago aplicado: 90% cuando la efectividad sea de 91% a menos de 96%.'),
      ('AMPM', 'porcentaje_descuento', 'pago', 1.00::numeric, null::numeric, 0.50::numeric, 1, null::text, 'PAQUETE', date '2026-11-04',
       'Pago aplicado: 0% cuando la efectividad sea menor a 50%.'),
      ('AMPM', 'porcentaje_descuento', 'pago', 0.50::numeric, 0.50::numeric, 0.81::numeric, 2, null::text, 'PAQUETE', date '2026-11-04',
       'Pago aplicado: 50% cuando la efectividad sea de 50% a menos de 81%.'),
      ('AMPM', 'porcentaje_descuento', 'pago', 0.30::numeric, 0.81::numeric, 0.91::numeric, 3, null::text, 'PAQUETE', date '2026-11-04',
       'Pago aplicado: 70% cuando la efectividad sea de 81% a menos de 91%.'),
      ('AMPM', 'porcentaje_descuento', 'pago', 0.10::numeric, 0.91::numeric, 0.96::numeric, 4, null::text, 'PAQUETE', date '2026-11-04',
       'Pago aplicado: 90% cuando la efectividad sea de 91% a menos de 96%.')
    ) as v(cuenta, tipo_regla, aplica_a, valor, efectividad_minima, efectividad_menor_que, prioridad, tipo_unidad, esquema, vigencia_desde, descripcion)
  loop
    update public.reglas_penalizacion as g
    set aplica_a = r.aplica_a,
        valor = r.valor,
        efectividad_menor_que = r.efectividad_menor_que,
    efectividad_minima = r.efectividad_minima,
        entregados_minimos = null,
        prioridad = r.prioridad,
        excepcion_validacion_supervisor = false,
        descripcion = r.descripcion,
        por_confirmar = false,
        activo = true
    where g.cuenta = r.cuenta
      and g.tipo_regla = r.tipo_regla
      and g.aplica_a = r.aplica_a
      and g.efectividad_menor_que is not distinct from r.efectividad_menor_que
      and g.efectividad_minima is not distinct from r.efectividad_minima
      and g.tipo_unidad is not distinct from r.tipo_unidad
      and g.esquema is not distinct from r.esquema
      and g.vigencia_desde = r.vigencia_desde;

    if not found then
      insert into public.reglas_penalizacion (
        cuenta, tipo_regla, aplica_a, valor, efectividad_menor_que,
        efectividad_minima, entregados_minimos, prioridad, excepcion_validacion_supervisor,
        tipo_unidad, esquema, vigencia_desde, descripcion, por_confirmar, activo
      ) values (
        r.cuenta, r.tipo_regla, r.aplica_a, r.valor, r.efectividad_menor_que,
        r.efectividad_minima, null, r.prioridad, false, r.tipo_unidad, r.esquema,
        r.vigencia_desde, r.descripcion, false, true
      );
    end if;
  end loop;
end $$;

create or replace function private.calc_liquidacion(
  p_ruta_id bigint,
  p_tarifa_id bigint,
  p_registro text,
  p_excepcion boolean,
  p_ajuste_pago numeric,
  p_ajuste_cobro numeric
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  r record; t record; reg text; ent int; asg int; eff numeric; exento boolean;
  por_paq_pago boolean; por_paq_cobro boolean;
  pago_b numeric; cobro_b numeric; rp record; rc record;
  d_pago numeric := 0; d_cobro numeric := 0; costo numeric; venta numeric;
  ret numeric := 0; neto numeric; com numeric := 0; pl numeric; iva numeric := 0; tot numeric; pago_drv numeric;
  bono numeric := 0; rb text; k_ret numeric; k_com numeric; k_iva numeric; avisos text[] := '{}';
  entregas_extra int := 0; entregas_incluidas int := 0;
  tarifa_extra_pago numeric := 0; tarifa_extra_cobro numeric := 0;
  pago_entrega_extra numeric := 0; cobro_entrega_extra numeric := 0; pago_penalizable numeric := 0;
begin
  select ru.id, ru.estado, ru.entregados, ru.paquetes_asignados, cl.nombre as cliente into r
  from public.rutas ru
  join public.cedis ce on ce.id = ru.cedis_id
  join public.clientes cl on cl.id = ce.cliente_id
  where ru.id = p_ruta_id;
  if not found then raise exception 'Ruta no encontrada'; end if;
  if r.estado <> 'cerrada' then raise exception 'La ruta aún no está cerrada'; end if;

  select * into t from public.tarifas where id = p_tarifa_id;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if t.esquema is null then raise exception 'La tarifa no tiene esquema definido; corrige el tarifario'; end if;
  if not (
    (t.cuenta='MELI' and r.cliente='MERCADO LIBRE')
    or (t.cuenta='COPPEL' and r.cliente in ('COPPEL','COPPEL BT'))
    or (t.cuenta='LIVERPOOL' and r.cliente='LIVERPOOL')
    or (t.cuenta in ('CUBBO','NESPRESSO','ESTAFETA','AMPM') and r.cliente=t.cuenta)
  ) then raise exception 'La tarifa elegida no corresponde al cliente de la ruta'; end if;

  reg := upper(coalesce(p_registro,''));
  if reg not in ('FACTURA','SIN FACTURA') then raise exception 'Indica si el proveedor factura o no'; end if;

  select valor into k_ret from public.parametros_pago where clave='retencion_sin_factura';
  select valor into k_com from public.parametros_pago where clave='comision_sin_factura';
  select valor into k_iva from public.parametros_pago where clave='iva';

  ent := coalesce(r.entregados,0);
  asg := r.paquetes_asignados;
  eff := case when asg > 0 then ent::numeric / asg else 0 end;
  exento := t.esquema in ('CANCELACION','CANCELACION SIN PAGO','NO SHOW','CAPITAN','AMBULANCIA MELI','AMBULANCIA INTERNA','AMBULANCIA MELI PAQUETE','RETROACTIVO');

  por_paq_pago := (t.cuenta='COPPEL' and t.esquema <> 'RUTA') or (t.cuenta='LIVERPOOL' and t.esquema = 'PAQUETE')
               or (t.cuenta='MELI' and t.esquema in ('AMBULANCIA MELI PAQUETE','AMBULANCIA INTERNA'))
               or (t.cuenta='ESTAFETA' and t.esquema='PAQUETE');
  por_paq_cobro := (t.cuenta='COPPEL') or (t.cuenta='LIVERPOOL' and t.esquema in ('PAQUETE','RETROACTIVO'))
               or (t.cuenta='MELI' and t.esquema in ('AMBULANCIA MELI PAQUETE','AMBULANCIA INTERNA'))
               or (t.cuenta='ESTAFETA' and t.esquema='PAQUETE');

  if t.pago_base is null then avisos := avisos || 'La tarifa no tiene pago al driver'; end if;
  if t.tarifa_cliente is null then avisos := avisos || 'La tarifa no tiene cobro al cliente'; end if;
  pago_b := round(coalesce(t.pago_base,0) * case when por_paq_pago then ent else 1 end, 2);
  cobro_b := round(coalesce(t.tarifa_cliente,0) * case when por_paq_cobro then ent else 1 end, 2);

  if t.cuenta='CUBBO' and t.esquema='PAQUETE' then
    entregas_incluidas := 40;
    tarifa_extra_pago := 30;
    tarifa_extra_cobro := 40;
  elsif t.cuenta='AMPM' and t.esquema='PAQUETE' then
    case upper(t.tipo_unidad)
      when 'SEDAN' then entregas_incluidas := 60; tarifa_extra_pago := 25; tarifa_extra_cobro := 30;
      when 'SMALL VAN' then entregas_incluidas := 70; tarifa_extra_pago := 28; tarifa_extra_cobro := 35;
      when 'LARGE VAN' then entregas_incluidas := 90; tarifa_extra_pago := 32; tarifa_extra_cobro := 40;
      else raise exception 'Vehiculo AMPM sin umbral de entregas: %', t.tipo_unidad;
    end case;
  end if;
  if entregas_incluidas > 0 then
    entregas_extra := greatest(ent - entregas_incluidas, 0);
    pago_entrega_extra := round(entregas_extra * tarifa_extra_pago, 2);
    cobro_entrega_extra := round(entregas_extra * tarifa_extra_cobro, 2);
  end if;
  pago_penalizable := pago_b + case when t.cuenta='AMPM' then pago_entrega_extra else 0 end;

  select * into rp from public.reglas_penalizacion g
   where g.activo and g.cuenta = t.cuenta and g.aplica_a = 'pago' and g.tipo_regla in ('porcentaje_descuento','pago_fijo')
     and (g.tipo_unidad is null or g.tipo_unidad = t.tipo_unidad) and (g.esquema is null or g.esquema = t.esquema)
     and (g.efectividad_menor_que is null or (not exento and eff < g.efectividad_menor_que))
     and (g.efectividad_minima is null or (not exento and eff >= g.efectividad_minima))
     and not coalesce(p_excepcion,false)
     and g.vigencia_desde <= current_date
   order by g.prioridad limit 1;
  if found then
    d_pago := case when rp.tipo_regla = 'porcentaje_descuento' then -round(pago_penalizable * rp.valor, 2) else rp.valor - pago_penalizable end;
  end if;

  select * into rc from public.reglas_penalizacion g
   where g.activo and g.cuenta = t.cuenta and g.aplica_a = 'cobro' and g.tipo_regla in ('porcentaje_descuento','pago_fijo')
     and (g.tipo_unidad is null or g.tipo_unidad = t.tipo_unidad) and (g.esquema is null or g.esquema = t.esquema)
     and (g.efectividad_menor_que is null or (not exento and eff < g.efectividad_menor_que))
     and (g.efectividad_minima is null or (not exento and eff >= g.efectividad_minima))
     and g.vigencia_desde <= current_date
   order by g.prioridad limit 1;
  if found then
    d_cobro := case when rc.tipo_regla = 'porcentaje_descuento' then -round(cobro_b * rc.valor, 2) else rc.valor - cobro_b end;
  end if;

  select coalesce(sum(case when g.tipo_regla = 'bono_fijo' then g.valor else round(pago_b * g.valor, 2) end), 0),
         string_agg(g.descripcion, ' + ')
    into bono, rb
    from public.reglas_penalizacion g
   where g.activo and not exento and g.cuenta = t.cuenta and g.aplica_a = 'pago' and g.tipo_regla in ('bono_fijo','bono_porcentaje')
     and (g.tipo_unidad is null or g.tipo_unidad = t.tipo_unidad) and (g.esquema is null or g.esquema = t.esquema)
     and (g.efectividad_minima is null or eff >= g.efectividad_minima)
     and (g.entregados_minimos is null or ent >= g.entregados_minimos)
     and g.vigencia_desde <= current_date;
  if pago_b + d_pago <= 0 then bono := 0; rb := null; end if;

  costo := pago_b + d_pago + pago_entrega_extra + bono + coalesce(p_ajuste_pago,0);
  venta := cobro_b + cobro_entrega_extra + d_cobro + coalesce(p_ajuste_cobro,0);
  if reg = 'SIN FACTURA' then ret := round(costo * k_ret, 2); end if;
  neto := costo - ret;
  if reg = 'SIN FACTURA' then com := round(neto * k_com, 2); end if;
  pl := neto + com;
  if reg = 'FACTURA' then iva := round(pl * k_iva, 2); end if;
  tot := pl + iva;
  pago_drv := case when reg = 'SIN FACTURA' then neto else tot end;

  return jsonb_build_object(
    'cuenta', t.cuenta, 'conc', t.conc, 'esquema', t.esquema, 'tipo_unidad', t.tipo_unidad,
    'entregados', ent, 'asignados', asg, 'efectividad', round(eff,4),
    'pago_base', pago_b, 'entregas_extra', entregas_extra, 'pago_entrega_extra', pago_entrega_extra,
    'regla_pago', rp.descripcion, 'dcto_pago', d_pago, 'bono_pago', bono, 'regla_bono', rb,
    'ajuste_pago', coalesce(p_ajuste_pago,0), 'costo_total', costo,
    'registro_fiscal', reg, 'retencion', ret, 'neto', neto, 'comision', com, 'costo_pl', pl,
    'iva', iva, 'total_costo_imp', tot, 'pago_driver', pago_drv,
    'cobro_base', cobro_b, 'cobro_entrega_extra', cobro_entrega_extra,
    'regla_cobro', rc.descripcion, 'dcto_cobro', d_cobro, 'ajuste_cobro', coalesce(p_ajuste_cobro,0),
    'venta_total', venta, 'utilidad', venta - costo,
    'margen', case when venta <> 0 then round((venta - costo) / venta, 4) end,
    'excepcion_supervisor', coalesce(p_excepcion,false), 'avisos', to_jsonb(avisos)
  );
end
$function$;

notify pgrst, 'reload schema';
commit;

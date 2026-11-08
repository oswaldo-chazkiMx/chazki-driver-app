-- Solo lectura. No incluye drivers, pagos, liquidaciones ni datos personales.
-- Ayuda a identificar las tarifas existentes antes de conectar COPPEL Peak.
select jsonb_build_object(
  'cedis', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ce.id, 'nombre', ce.nombre, 'ciudad', ce.ciudad
    ) order by ce.id)
    from public.cedis ce
    join public.clientes cl on cl.id=ce.cliente_id
    where public.operativo_normalizar(cl.nombre)='coppel'
      and cl.activo and ce.activo
  ),'[]'::jsonb),
  'tarifas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'cuenta', t.cuenta, 'cliente', t.cliente,
      'ciudad', t.ciudad, 'ubicacion', t.ubicacion,
      'tipo_unidad', t.tipo_unidad, 'esquema', t.esquema,
      'zona', t.zona, 'variable', t.variable,
      'pago_base', t.pago_base, 'tarifa_cliente', t.tarifa_cliente,
      'vigencia_desde', t.vigencia_desde, 'vigencia_hasta', t.vigencia_hasta,
      'activo', t.activo
    ) order by t.ubicacion,t.vigencia_desde,t.id)
    from public.tarifas t
    where t.cuenta='COPPEL'
      and public.operativo_normalizar(t.tipo_unidad)='sedan'
      and public.operativo_normalizar(t.esquema)='paquete'
      and public.operativo_normalizar(t.zona)='local'
      and t.vigencia_desde<=date '2027-01-10'
      and (t.vigencia_hasta is null or t.vigencia_hasta>=date '2026-11-09')
  ),'[]'::jsonb)
) as diagnostico_tarifas_coppel;

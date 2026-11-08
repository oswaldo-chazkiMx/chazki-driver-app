-- Consulta de estructura solamente: no modifica datos ni devuelve filas de negocio.
-- Revisa el resultado y elimina cualquier secreto antes de compartirlo.
with tablas as (
  select c.oid, n.nspname, c.relname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname in (
      'clientes', 'cedis', 'drivers', 'proveedores', 'rutas', 'cancelaciones',
      'tarifas', 'reglas_penalizacion', 'parametros_pago', 'liquidaciones',
      'pagos', 'liquidacion_validaciones', 'liquidacion_anulaciones',
      'no_show_casos', 'pnr_reclamos', 'pnr_descuentos',
      'pnr_descuentos_aplicaciones', 'solicitudes_validacion'
    )
),
funciones as (
  select p.oid, n.nspname, p.proname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (
      p.proname in (
        'calc_liquidacion', 'calcular_liquidacion', 'validar_core', 'validar_ruta',
        'resolver_validacion', 'anular_liquidacion', 'crear_reporte_no_show',
        'apelar_no_show', 'resolver_apelacion_no_show', 'resolver_cancelacion',
        'resolver_cancelacion_asignada', 'aplicar_descuentos_pnr_a_pago',
        'operativo_asignado_a', 'operativo_rol_actual'
      )
      or p.oid in (
        select t.tgfoid from pg_catalog.pg_trigger t
        join tablas tb on tb.oid = t.tgrelid
        where not t.tgisinternal
      )
    )
    and p.prokind = 'f'
)
select jsonb_build_object(
  'columnas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tabla', tb.relname, 'nombre', a.attname,
      'tipo', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'obligatoria', a.attnotnull,
      'defecto', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    ) order by tb.relname, a.attnum)
    from tablas tb
    join pg_catalog.pg_attribute a on a.attrelid = tb.oid
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'restricciones', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tabla', tb.relname, 'nombre', c.conname,
      'definicion', pg_catalog.pg_get_constraintdef(c.oid)
    ) order by tb.relname, c.conname)
    from tablas tb
    join pg_catalog.pg_constraint c on c.conrelid = tb.oid
  ), '[]'::jsonb),
  'indices', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tabla', tb.relname, 'definicion', pg_catalog.pg_get_indexdef(i.indexrelid)
    ) order by tb.relname, i.indexrelid::regclass::text)
    from tablas tb
    join pg_catalog.pg_index i on i.indrelid = tb.oid
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tabla', tb.relname, 'nombre', t.tgname,
      'definicion', pg_catalog.pg_get_triggerdef(t.oid), 'habilitado', t.tgenabled
    ) order by tb.relname, t.tgname)
    from tablas tb
    join pg_catalog.pg_trigger t on t.tgrelid = tb.oid
    where not t.tgisinternal
  ), '[]'::jsonb),
  'funciones', coalesce((
    select jsonb_agg(jsonb_build_object(
      'esquema', f.nspname, 'nombre', f.proname,
      'firma', pg_catalog.pg_get_function_identity_arguments(f.oid),
      'definicion', pg_catalog.pg_get_functiondef(f.oid)
    ) order by f.nspname, f.proname, f.oid::regprocedure::text)
    from funciones f
  ), '[]'::jsonb)
) as diagnostico;

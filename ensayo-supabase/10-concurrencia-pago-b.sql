-- SOLO EN PRUEBAS. Ejecutar mientras sigue corriendo el archivo 9.
-- Espera a la primera transaccion, reintenta su origen y aplica el remanente.
do $ensayo$
declare v_reintento jsonb; v_otro jsonb; v_inicio timestamptz;
begin
  v_inicio:=pg_catalog.clock_timestamp();
  v_reintento:=ensayo_walmart_concurrencia.aplicar(
    'ruta',-9223372036854775807,-9223372036854775808,'00000000-0000-0000-0000-000000000002',2000
  );
  if pg_catalog.clock_timestamp()-v_inicio<interval '2 seconds' then
    raise exception 'Las sesiones no coincidieron al menos 2 segundos; repite el ensayo';
  end if;
  v_otro:=ensayo_walmart_concurrencia.aplicar(
    'ruta',-9223372036854775806,-9223372036854775808,'00000000-0000-0000-0000-000000000002',2000
  );
  if (v_reintento->>'aplicado')::numeric<>2000 or (v_otro->>'aplicado')::numeric<>700 then
    raise exception 'Sesion B: descuento o reintento incorrecto';
  end if;
end;
$ensayo$;

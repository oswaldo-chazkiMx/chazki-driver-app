-- SOLO EN PRUEBAS. Ejecutar despues del archivo 8.
-- Mientras esta consulta espera, ejecutar el archivo 10 en otra sesion.
do $ensayo$
declare v_resultado jsonb;
begin
  v_resultado:=ensayo_walmart_concurrencia.aplicar(
    'ruta',-9223372036854775807,-9223372036854775808,'00000000-0000-0000-0000-000000000002',2000
  );
  if (v_resultado->>'aplicado')::numeric<>2000 then raise exception 'Sesion A: descuento incorrecto'; end if;
  perform pg_catalog.pg_sleep(45);
end;
$ensayo$;

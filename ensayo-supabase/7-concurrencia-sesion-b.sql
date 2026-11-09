-- SOLO EN PRUEBAS. Ejecutar mientras sigue corriendo el archivo 6.
-- El ERROR "RESULTADO BLOQUEO" es intencional y no modifica datos.
-- "bloqueado" confirma que la segunda sesion observo el bloqueo;
-- "libre" significa que no coincidieron y hay que repetir.
do $ensayo$
declare v_libre boolean;
begin
  v_libre:=pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('walmart-no-show-proveedor:-9223372036854775808',0)
  );
  raise exception 'RESULTADO BLOQUEO: %',case when v_libre then 'libre' else 'bloqueado' end;
end;
$ensayo$;

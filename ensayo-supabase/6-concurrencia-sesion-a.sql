-- SOLO EN PRUEBAS. No crea ni modifica datos.
-- Ejecuta este archivo completo y, mientras espera, ejecuta el archivo 7
-- desde otra pestaña de SQL Editor. Usa un proveedor ficticio negativo.
do $ensayo$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('walmart-no-show-proveedor:-9223372036854775808',0)
  );
  perform pg_catalog.pg_sleep(45);
end;
$ensayo$;

-- SOLO EN PRUEBAS. Ejecutar despues del archivo 13.
-- Mientras espera, ejecutar el archivo 15 desde la segunda sesion.
do $ensayo$
begin
  perform ensayo_walmart_pago.bloquear(-9223372036854775808,'00000000-0000-0000-0000-000000000002');
  insert into ensayo_walmart_pago.pagos values (
    1,'00000000-0000-0000-0000-000000000002',-9223372036854775808,
    -9223372036854775807,'servicio',2000,'pendiente'
  );
  perform pg_catalog.pg_sleep(45);
end;
$ensayo$;

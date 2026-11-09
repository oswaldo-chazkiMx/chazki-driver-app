-- SOLO EN PRUEBAS. Ejecutar mientras sigue corriendo el archivo 14.
do $ensayo$
declare v_inicio timestamptz;
begin
  v_inicio:=pg_catalog.clock_timestamp();
  perform ensayo_walmart_pago.bloquear(-9223372036854775808,'00000000-0000-0000-0000-000000000002');
  if pg_catalog.clock_timestamp()-v_inicio<interval '2 seconds' then
    raise exception 'Las sesiones no coincidieron al menos 2 segundos; repite el ensayo';
  end if;
  insert into ensayo_walmart_pago.pagos values (
    2,'00000000-0000-0000-0000-000000000002',-9223372036854775808,
    -9223372036854775806,'servicio',2000,'pendiente'
  );
end;
$ensayo$;

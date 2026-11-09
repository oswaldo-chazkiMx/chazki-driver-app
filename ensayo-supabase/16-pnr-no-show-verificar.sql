-- SOLO EN PRUEBAS. Ejecutar al terminar los archivos 14 y 15.
-- Si no hay error, valida saldos y elimina el esquema aislado.
do $ensayo$
begin
  if not exists (select 1 from ensayo_walmart_pago.marca where id='walmart-pnr-no-show-concurrencia-v1') then
    raise exception 'Marca del esquema distinta';
  end if;
  if not exists (select 1 from ensayo_walmart_pago.pnr_descuentos where saldo_pendiente=0 and monto_aplicado=1000)
    or not exists (select 1 from ensayo_walmart_pago.saldos where saldo_pendiente=0 and monto_aplicado=2700)
    or (select count(*) from ensayo_walmart_pago.pnr_aplicaciones)<>1
    or (select count(*) from ensayo_walmart_pago.aplicaciones)<>2
    or not exists (select 1 from ensayo_walmart_pago.pagos where id=1 and monto=0)
    or not exists (select 1 from ensayo_walmart_pago.pagos where id=2 and monto=300)
    or not exists (select 1 from ensayo_walmart_pago.liquidaciones where ruta_id=-9223372036854775807 and dcto_pago=2000 and pago_driver=0)
    or not exists (select 1 from ensayo_walmart_pago.liquidaciones where ruta_id=-9223372036854775806 and dcto_pago=1700 and pago_driver=300) then
    raise exception 'ENSAYO FALLIDO: prioridad o saldo incorrecto';
  end if;
  drop schema ensayo_walmart_pago cascade;
end;
$ensayo$;

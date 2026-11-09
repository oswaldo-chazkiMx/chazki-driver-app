-- SOLO EN PRUEBAS. Ejecutar cuando hayan terminado los archivos 9 y 10.
-- Si no hay error, la verificacion paso y el esquema ficticio se elimino.
-- Si hay error, no se elimina: ejecuta el archivo 12 para limpiarlo.
do $ensayo$
declare v_saldo numeric; v_aplicado numeric; v_casos bigint; v_lotes bigint;
begin
  if not exists (select 1 from ensayo_walmart_concurrencia.marca where id='walmart-no-show-concurrencia-v1') then
    raise exception 'No coincide la marca del esquema de ensayo';
  end if;
  select saldo_pendiente,monto_aplicado into strict v_saldo,v_aplicado
    from ensayo_walmart_concurrencia.saldos;
  select count(*) into v_casos from ensayo_walmart_concurrencia.aplicaciones;
  select count(*) into v_lotes from ensayo_walmart_concurrencia.lotes;
  if v_saldo<>0 or v_aplicado<>2700 or v_casos<>2 or v_lotes<>2
    or not exists (select 1 from ensayo_walmart_concurrencia.lotes where tipo='ruta' and origen_id=-9223372036854775807 and aplicado=2000)
    or not exists (select 1 from ensayo_walmart_concurrencia.lotes where tipo='ruta' and origen_id=-9223372036854775806 and aplicado=700) then
    raise exception 'ENSAYO FALLIDO: saldos o reintentos inconsistentes';
  end if;
  drop schema ensayo_walmart_concurrencia cascade;
end;
$ensayo$;

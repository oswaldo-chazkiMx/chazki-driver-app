-- SOLO EN PRUEBAS. Usar si el ensayo fallo o fue interrumpido.
-- No borra el esquema si su marca no coincide.
do $ensayo$
begin
  if pg_catalog.to_regnamespace('ensayo_walmart_concurrencia') is null then return; end if;
  if pg_catalog.to_regclass('ensayo_walmart_concurrencia.marca') is null then
    raise exception 'Esquema sin marca; no se eliminara';
  end if;
  if not exists (select 1 from ensayo_walmart_concurrencia.marca where id='walmart-no-show-concurrencia-v1') then
    raise exception 'Marca distinta; no se eliminara';
  end if;
  drop schema ensayo_walmart_concurrencia cascade;
end;
$ensayo$;

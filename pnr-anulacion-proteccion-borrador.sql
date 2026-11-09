-- BORRADOR: no ejecutar ni publicar sin ensayar la anulacion y la reversión completa.
-- Bloquea la anulacion cuando existen aplicaciones PNR; no revierte saldos.
begin;

create or replace function private.pnr_proteger_pago_con_aplicaciones()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.concepto='servicio' and old.ruta_id is not null and exists (
    select 1 from public.pnr_descuentos_aplicaciones a where a.ruta_id=old.ruta_id::text
  ) then
    raise exception 'La ruta tiene descuentos PNR registrados; requiere revisión y reversión auditada antes de anular';
  end if;
  return old;
end;
$$;
revoke all on function private.pnr_proteger_pago_con_aplicaciones() from public, anon, authenticated;

drop trigger if exists pnr_proteger_pago_con_aplicaciones on public.pagos;
create trigger pnr_proteger_pago_con_aplicaciones before delete on public.pagos
for each row execute function private.pnr_proteger_pago_con_aplicaciones();

create or replace function private.pnr_proteger_liquidacion_con_aplicaciones()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.ruta_id is not null and exists (
    select 1 from public.pnr_descuentos_aplicaciones a where a.ruta_id=old.ruta_id::text
  ) then
    raise exception 'La ruta tiene descuentos PNR registrados; requiere revisión y reversión auditada antes de anular';
  end if;
  return old;
end;
$$;
revoke all on function private.pnr_proteger_liquidacion_con_aplicaciones() from public, anon, authenticated;

drop trigger if exists pnr_proteger_liquidacion_con_aplicaciones on public.liquidaciones;
create trigger pnr_proteger_liquidacion_con_aplicaciones before delete on public.liquidaciones
for each row execute function private.pnr_proteger_liquidacion_con_aplicaciones();

commit;

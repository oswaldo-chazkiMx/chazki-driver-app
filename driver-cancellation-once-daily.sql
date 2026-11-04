begin;

create index if not exists cancelaciones_driver_capturado_at_idx
  on public.cancelaciones (driver_id, capturado_at);

create or replace function public.limitar_cancelacion_driver_diaria()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_dia date;
  v_inicio timestamptz;
  v_fin timestamptz;
begin
  if new.driver_id = 'f640638a-d9a6-4136-a7dd-481e86715c7e'::uuid then
    return new;
  end if;

  v_dia := (new.capturado_at at time zone 'America/Mexico_City')::date;
  v_inicio := v_dia::timestamp at time zone 'America/Mexico_City';
  v_fin := (v_dia + 1)::timestamp at time zone 'America/Mexico_City';

  perform pg_advisory_xact_lock(hashtextextended(new.driver_id::text || ':' || v_dia::text, 0));

  if exists (
    select 1
    from public.cancelaciones c
    where c.driver_id = new.driver_id
      and c.capturado_at >= v_inicio
      and c.capturado_at < v_fin
  ) then
    raise exception 'Solo se permite registrar una cancelación por día';
  end if;

  return new;
end;
$$;

drop trigger if exists limitar_cancelacion_driver_diaria on public.cancelaciones;
create trigger limitar_cancelacion_driver_diaria
before insert on public.cancelaciones
for each row execute function public.limitar_cancelacion_driver_diaria();

commit;

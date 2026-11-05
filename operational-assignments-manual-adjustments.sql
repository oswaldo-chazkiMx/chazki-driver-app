-- Manual adjustments for operational assignments (client + CEDIS -> supervisor + coordinator).
-- Run after operational-responsibility-approvals.sql. Master account only.
begin;

create or replace function public.guardar_asignacion_operativa(
  p_cliente_id bigint,
  p_cedis_id bigint,
  p_supervisor_id uuid,
  p_coordinador_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or public.operativo_rol_actual() <> 'master' then
    raise exception 'Solo la cuenta maestra puede ajustar responsables operativos';
  end if;
  if not exists (select 1 from public.cedis where id = p_cedis_id and cliente_id = p_cliente_id) then
    raise exception 'El CEDIS no pertenece al cliente seleccionado';
  end if;
  if not exists (select 1 from public.drivers where id = p_supervisor_id and rol::text = 'ih') then
    raise exception 'El supervisor seleccionado no tiene rol de supervisor';
  end if;
  if not exists (select 1 from public.drivers where id = p_coordinador_id and rol::text = 'coordinador') then
    raise exception 'El coordinador seleccionado no tiene rol de coordinador';
  end if;

  insert into public.asignaciones_operativas (
    cliente_id, cedis_id, supervisor_id, coordinador_id, actualizado_en
  ) values (
    p_cliente_id, p_cedis_id, p_supervisor_id, p_coordinador_id, now()
  )
  on conflict (cliente_id, cedis_id) do update
    set supervisor_id = excluded.supervisor_id,
        coordinador_id = excluded.coordinador_id,
        actualizado_en = excluded.actualizado_en;
end;
$$;

create or replace function public.eliminar_asignacion_operativa(
  p_cliente_id bigint,
  p_cedis_id bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or public.operativo_rol_actual() <> 'master' then
    raise exception 'Solo la cuenta maestra puede ajustar responsables operativos';
  end if;
  delete from public.asignaciones_operativas
   where cliente_id = p_cliente_id and cedis_id = p_cedis_id;
end;
$$;

revoke all on function public.guardar_asignacion_operativa(bigint, bigint, uuid, uuid) from public, anon;
revoke all on function public.eliminar_asignacion_operativa(bigint, bigint) from public, anon;
grant execute on function public.guardar_asignacion_operativa(bigint, bigint, uuid, uuid) to authenticated;
grant execute on function public.eliminar_asignacion_operativa(bigint, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Ejecutar despues de editar-invitaciones-red.sql y las demas migraciones de invitaciones.
-- Conserva las canceladas eliminadas y su auditoria; no borra cuentas ni dependencias.
-- confirmation_sent_at es el ultimo envio registrado por Auth, no una confirmacion de entrega.
-- No crea una cola ni cambia el limite de correos de Supabase.
begin;

alter table public.invitaciones_red
  add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por uuid;

drop policy if exists invitaciones_red_select on public.invitaciones_red;
create policy invitaciones_red_select on public.invitaciones_red
  for select to authenticated
  using (eliminado_en is null and public.invitacion_red_visible(invitaciones_red));

create or replace function public.listar_invitaciones_red(p_solo_propias boolean default false)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;
  return query
    select to_jsonb(i) || jsonb_build_object(
      'correo_enviado_en', u.confirmation_sent_at,
      'correo_validado_en', u.email_confirmed_at,
      'cuenta_creada', u.id is not null
    )
    from public.invitaciones_red i
    left join auth.users u on lower(btrim(u.email::text)) = lower(btrim(i.email))
    where i.eliminado_en is null
      and public.invitacion_red_visible(i)
      and (not coalesce(p_solo_propias, false) or i.invitado_por = auth.uid())
    order by (i.estatus = 'cancelada'), i.creado_en desc, i.id desc;
end;
$$;
revoke all on function public.listar_invitaciones_red(boolean) from public, anon;
grant execute on function public.listar_invitaciones_red(boolean) to authenticated;

create or replace function public.eliminar_invitacion_red(p_id bigint)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_inv public.invitaciones_red%rowtype;
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;
  select * into v_inv from public.invitaciones_red where id = p_id for update;
  if not found or not public.invitacion_red_visible(v_inv) then
    raise exception 'La invitacion no esta disponible o no tienes permiso';
  end if;
  if v_inv.estatus <> 'cancelada' or v_inv.eliminado_en is not null then
    raise exception 'Solo puedes eliminar invitaciones canceladas que sigan en la lista';
  end if;
  update public.invitaciones_red
     set eliminado_en = now(), eliminado_por = auth.uid()
   where id = p_id;
  return 'Invitacion eliminada de la lista; se conserva su historial';
end;
$$;
revoke all on function public.eliminar_invitacion_red(bigint) from public, anon;
grant execute on function public.eliminar_invitacion_red(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

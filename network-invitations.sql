-- Temporary invitation flow for fleet owners (flotilleros), independent drivers and fleet drivers.
--   * Supervisors / coordinators / ops invite flotilleros and independents and choose the category.
--   * A flotillero invites their own drivers; the request waits for the supervisor of the chosen
--     CEDIS (or a coordinator / ops / master) to approve it before it becomes an invitation.
--   * When the invited email has (or creates) an account, the invitation is applied automatically.
-- Depends on: drivers, proveedores, cedis, asignaciones_operativas, mi_acceso_administrativo(),
--             operativo_rol_actual(), padron_fleet, notificaciones.
-- Run in the Supabase SQL editor as the database owner. The grants below fix table-level
-- access; RLS still limits invitations to the sender and assigned operational staff.
-- Installation order: network-invitations.sql, invitation-status-audit.sql, then
-- registro-por-invitacion.sql. Re-running this file replaces functions customized by
-- registro-por-invitacion.sql, so reapply that migration before using invitations.
-- For pending fleet-owner invitations, apply invitaciones-flotillero-pendiente.sql last.
begin;

create table if not exists public.invitaciones_red (
  id bigserial primary key,
  email text not null,
  nombre text,
  tipo text not null check (tipo in ('flotillero', 'independiente', 'driver')),
  esquema text check (esquema in ('FACTURA', 'SIN FACTURA')),
  proveedor_id bigint references public.proveedores(id),
  cedis_id bigint references public.cedis(id),
  estatus text not null default 'pendiente_aprobacion'
    check (estatus in ('pendiente_aprobacion', 'enviada', 'aceptada', 'rechazada', 'cancelada')),
  invitado_por uuid not null,
  invitado_por_rol text,
  resuelto_por uuid,
  motivo text,
  aceptada_por uuid,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz
);
create unique index if not exists invitaciones_red_email_activa
  on public.invitaciones_red (lower(email))
  where estatus in ('pendiente_aprobacion', 'enviada');

alter table public.invitaciones_red enable row level security;
alter table public.invitaciones_red add column if not exists ultimo_aviso_en timestamptz;
revoke all on public.invitaciones_red from anon, authenticated;
grant select on public.invitaciones_red to authenticated;

create or replace function public.invitacion_red_visible(p_inv public.invitaciones_red)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null and (
    p_inv.invitado_por = auth.uid()
    or (
      public.mi_acceso_administrativo()
      and (
        public.operativo_rol_actual() in ('master', 'ops')
        or (public.operativo_rol_actual() in ('ih', 'coordinador') and exists (
          select 1 from public.asignaciones_operativas a
          where a.cedis_id = p_inv.cedis_id
            and ((public.operativo_rol_actual() = 'ih' and a.supervisor_id = auth.uid())
              or (public.operativo_rol_actual() = 'coordinador' and a.coordinador_id = auth.uid()))
        ))
      )
    )
  );
$$;
revoke all on function public.invitacion_red_visible(public.invitaciones_red) from public, anon;
grant execute on function public.invitacion_red_visible(public.invitaciones_red) to authenticated;

drop policy if exists invitaciones_red_select on public.invitaciones_red;
create policy invitaciones_red_select on public.invitaciones_red
  for select to authenticated
  using (public.invitacion_red_visible(invitaciones_red));

-- Applies an invitation to an existing account.
create or replace function public.aplicar_invitacion_red(p_inv_id bigint, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_inv public.invitaciones_red%rowtype;
  v_nombre text;
  v_prov bigint;
begin
  select * into v_inv from public.invitaciones_red where id = p_inv_id and estatus = 'enviada' for update;
  if not found then return; end if;
  select nombre into v_nombre from public.drivers where id = p_driver_id;

  if v_inv.tipo in ('flotillero', 'independiente') then
    select id into v_prov from public.proveedores
     where titular_id = p_driver_id limit 1;
    if v_prov is null then
      insert into public.proveedores (nombre, tipo, tipo_registro, titular_id)
      values (coalesce(nullif(v_inv.nombre, ''), v_nombre, v_inv.email), v_inv.tipo, v_inv.esquema, p_driver_id)
      returning id into v_prov;
    else
      update public.proveedores
         set tipo = v_inv.tipo, tipo_registro = coalesce(v_inv.esquema, tipo_registro)
       where id = v_prov;
    end if;
    update public.drivers
       set proveedor_id = v_prov,
           rol = case when v_inv.tipo = 'flotillero' then 'flotillero' else rol end
     where id = p_driver_id;
  else
    update public.drivers set proveedor_id = v_inv.proveedor_id where id = p_driver_id;
  end if;

  update public.invitaciones_red
     set estatus = 'aceptada', aceptada_por = p_driver_id, resuelto_en = now()
   where id = v_inv.id;
end;
$$;
revoke all on function public.aplicar_invitacion_red(bigint, uuid) from public, anon, authenticated;

create or replace function public.aplicar_invitacion_red_por_correo(p_email text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_inv_id bigint; v_uid uuid;
begin
  select id into v_inv_id from public.invitaciones_red
   where lower(email) = lower(p_email) and estatus = 'enviada' limit 1;
  if v_inv_id is null then return; end if;
  select u.id into v_uid from auth.users u
   join public.drivers d on d.id = u.id
   where lower(u.email::text) = lower(p_email) limit 1;
  if v_uid is not null then perform public.aplicar_invitacion_red(v_inv_id, v_uid); end if;
end;
$$;
revoke all on function public.aplicar_invitacion_red_por_correo(text) from public, anon, authenticated;

create or replace function public.invitar_a_red(
  p_email text,
  p_nombre text,
  p_tipo text,
  p_esquema text default null,
  p_cedis_id bigint default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol text := public.operativo_rol_actual();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_admin boolean := auth.uid() is not null and public.mi_acceso_administrativo()
                     and v_rol in ('master', 'ops', 'coordinador', 'ih');
  v_prov bigint;
  v_estatus text;
  v_tipo text := p_tipo;
  v_esquema text := nullif(upper(btrim(coalesce(p_esquema, ''))), '');
  v_id bigint;
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo invalido'; end if;
  if v_esquema is not null and v_esquema not in ('FACTURA', 'SIN FACTURA') then
    raise exception 'Esquema invalido';
  end if;

  if v_admin then
    if v_tipo not in ('flotillero', 'independiente') then
      raise exception 'Categoria invalida: usa flotillero o independiente';
    end if;
    if v_rol in ('ih', 'coordinador') and not exists (
      select 1 from public.asignaciones_operativas a
       where a.cedis_id = p_cedis_id
         and ((v_rol = 'ih' and a.supervisor_id = auth.uid())
           or (v_rol = 'coordinador' and a.coordinador_id = auth.uid()))
    ) then
      raise exception 'Selecciona un CEDIS asignado a tu cuenta';
    end if;
    v_estatus := 'enviada';
  elsif v_rol = 'flotillero' then
    select proveedor_id into v_prov from public.drivers where id = auth.uid();
    if v_prov is null then
      raise exception 'Tu cuenta aun no esta vinculada a un proveedor. Contacta a tu supervisor';
    end if;
    if p_cedis_id is null then raise exception 'Selecciona el CEDIS donde operara el driver'; end if;
    v_tipo := 'driver'; v_esquema := null; v_estatus := 'pendiente_aprobacion';
  else
    raise exception 'No tienes permiso para enviar invitaciones';
  end if;

  if exists (select 1 from auth.users u join public.drivers d on d.id = u.id
              where lower(u.email::text) = v_email and (v_tipo = 'driver' and d.proveedor_id = v_prov)) then
    raise exception 'Ese driver ya pertenece a tu flotilla';
  end if;

  insert into public.invitaciones_red
    (email, nombre, tipo, esquema, proveedor_id, cedis_id, estatus, invitado_por, invitado_por_rol)
  values
    (v_email, nullif(btrim(coalesce(p_nombre, '')), ''), v_tipo, v_esquema, v_prov, p_cedis_id,
     v_estatus, auth.uid(), v_rol)
  returning id into v_id;

  if v_estatus = 'enviada' then
    perform public.aplicar_invitacion_red_por_correo(v_email);
    return 'Invitacion registrada. Comparte el aviso por correo o WhatsApp';
  end if;
  return 'Solicitud enviada: el supervisor debe aprobarla';
exception when unique_violation then
  raise exception 'Ya existe una invitacion activa para ese correo';
end;
$$;
revoke all on function public.invitar_a_red(text, text, text, text, bigint) from public, anon;
grant execute on function public.invitar_a_red(text, text, text, text, bigint) to authenticated;

create or replace function public.resolver_invitacion_red(
  p_id bigint,
  p_aprobar boolean,
  p_motivo text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_inv public.invitaciones_red%rowtype;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo() then
    raise exception 'No tienes permiso para resolver invitaciones';
  end if;
  select * into v_inv from public.invitaciones_red where id = p_id for update;
  if not found then raise exception 'Invitacion no encontrada'; end if;
  if v_inv.estatus <> 'pendiente_aprobacion' then raise exception 'La invitacion ya fue resuelta'; end if;
  if v_inv.invitado_por = auth.uid() or not public.invitacion_red_visible(v_inv) then
    raise exception 'Esta invitacion no corresponde a tus CEDIS';
  end if;

  if p_aprobar then
    update public.invitaciones_red
       set estatus = 'enviada', resuelto_por = auth.uid(), resuelto_en = now(), motivo = p_motivo
     where id = p_id;
    perform public.aplicar_invitacion_red_por_correo(v_inv.email);
    return 'Invitacion aprobada';
  end if;
  update public.invitaciones_red
     set estatus = 'rechazada', resuelto_por = auth.uid(), resuelto_en = now(), motivo = p_motivo
   where id = p_id;
  return 'Invitacion rechazada';
end;
$$;
revoke all on function public.resolver_invitacion_red(bigint, boolean, text) from public, anon;
grant execute on function public.resolver_invitacion_red(bigint, boolean, text) to authenticated;

create or replace function public.cancelar_invitacion_red(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_inv public.invitaciones_red%rowtype;
begin
  select * into v_inv from public.invitaciones_red where id = p_id for update;
  if not found or v_inv.estatus not in ('pendiente_aprobacion', 'enviada') then
    raise exception 'La invitacion ya no se puede cancelar';
  end if;
  if not public.invitacion_red_visible(v_inv) then raise exception 'Sin permiso'; end if;
  update public.invitaciones_red
     set estatus = 'cancelada', resuelto_por = auth.uid(), resuelto_en = now()
   where id = p_id;
end;
$$;
revoke all on function public.cancelar_invitacion_red(bigint) from public, anon;
grant execute on function public.cancelar_invitacion_red(bigint) to authenticated;

-- A pending fleet request notifies the assigned supervisor and coordinator.
create or replace function public.notificar_solicitud_invitacion_red(p_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_inv public.invitaciones_red%rowtype;
begin
  select * into v_inv from public.invitaciones_red where id = p_id for update;
  if not found or v_inv.estatus <> 'pendiente_aprobacion' or v_inv.invitado_por_rol <> 'flotillero' then
    raise exception 'La solicitud ya no esta pendiente';
  end if;
  if v_inv.ultimo_aviso_en > now() - interval '1 minute' then
    raise exception 'Espera un minuto antes de reenviar la solicitud';
  end if;
  insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
  select destinatario, 'Solicitud de acceso de driver',
         'Un flotillero solicita la aprobacion de un driver en tu CEDIS.',
         'invitacion_red', 'invitacion_red', v_inv.id
    from (
      select a.supervisor_id as destinatario from public.asignaciones_operativas a where a.cedis_id = v_inv.cedis_id
      union
      select a.coordinador_id from public.asignaciones_operativas a where a.cedis_id = v_inv.cedis_id
    ) responsables;
  if not found then
    insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
    select d.id, 'Solicitud de acceso sin responsables',
           'Una solicitud de driver no tiene responsables asignados al CEDIS.',
           'configuracion_operativa', 'invitacion_red', v_inv.id
      from public.drivers d where d.rol::text = 'master';
    if not found then raise exception 'No hay responsables disponibles para esta solicitud'; end if;
  end if;
  update public.invitaciones_red set ultimo_aviso_en = now() where id = p_id;
end;
$$;
revoke all on function public.notificar_solicitud_invitacion_red(bigint) from public, anon, authenticated;

create or replace function public.invitacion_red_notificar_nueva()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.estatus = 'pendiente_aprobacion' and new.invitado_por_rol = 'flotillero' then
    perform public.notificar_solicitud_invitacion_red(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.invitacion_red_notificar_nueva() from public, anon, authenticated;
drop trigger if exists invitacion_red_notificar_nueva_trg on public.invitaciones_red;
create trigger invitacion_red_notificar_nueva_trg after insert on public.invitaciones_red
for each row execute function public.invitacion_red_notificar_nueva();

create or replace function public.reenviar_solicitud_invitacion_red(p_id bigint)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_inv public.invitaciones_red%rowtype;
begin
  select * into v_inv from public.invitaciones_red where id = p_id for update;
  if not found or auth.uid() is null or v_inv.invitado_por <> auth.uid()
     or v_inv.invitado_por_rol <> 'flotillero' or v_inv.estatus <> 'pendiente_aprobacion' then
    raise exception 'Solo el flotillero que envio una solicitud pendiente puede reenviarla';
  end if;
  perform public.notificar_solicitud_invitacion_red(p_id);
  return 'Solicitud reenviada a los responsables';
end;
$$;
revoke all on function public.reenviar_solicitud_invitacion_red(bigint) from public, anon;
grant execute on function public.reenviar_solicitud_invitacion_red(bigint) to authenticated;

-- This roster has no reliable CEDIS mapping. Authorized operational staff can see the
-- entire roster, including account status; no direct access to auth.users is granted.
create or replace function public.listar_padron_acceso(p_busqueda text default '', p_offset integer default 0)
returns table (email text, nombre text, proveedor text, cliente text, estatus_padron text,
               driver_id uuid, estatus_cuenta text, correo_confirmado boolean)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar el padron';
  end if;
  if p_offset is null or p_offset < 0 then raise exception 'Pagina invalida'; end if;
  return query
    with cuentas as (
      select lower(u.email::text) as correo, d.id, d.nombre, d.estatus, u.email_confirmed_at
        from auth.users u join public.drivers d on d.id = u.id
       where d.rol::text in ('driver', 'flotillero') and u.email is not null
    )
    select coalesce(p.email::text, c.correo), coalesce(p.nombre::text, c.nombre::text),
           p.proveedor_nombre::text, p.cliente::text, p.estatus::text,
           c.id, c.estatus::text, c.email_confirmed_at is not null
      from public.padron_fleet p full join cuentas c on lower(p.email::text) = c.correo
     where coalesce(p_busqueda, '') = ''
        or position(lower(btrim(p_busqueda)) in lower(concat_ws(' ', p.email, p.nombre, p.proveedor_nombre, c.correo, c.nombre))) > 0
     order by coalesce(p.nombre::text, c.nombre::text, p.email::text, c.correo), coalesce(p.email::text, c.correo)
     limit 51 offset p_offset;
end;
$$;
revoke all on function public.listar_padron_acceso(text, integer) from public, anon;
grant execute on function public.listar_padron_acceso(text, integer) to authenticated;

-- Applies pending invitations the moment the account's driver profile is created.
create or replace function public.drivers_aplicar_invitacion_red()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_email text;
begin
  select lower(u.email::text) into v_email from auth.users u where u.id = new.id;
  if v_email is not null then perform public.aplicar_invitacion_red_por_correo(v_email); end if;
  return null;
end;
$$;
drop trigger if exists drivers_aplicar_invitacion_red_trg on public.drivers;
create trigger drivers_aplicar_invitacion_red_trg
after insert on public.drivers
for each row execute function public.drivers_aplicar_invitacion_red();

notify pgrst, 'reload schema';
commit;

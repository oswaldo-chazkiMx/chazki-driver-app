-- Ejecutar completo en Supabase después de network-invitations.sql.
-- Las fechas de inactividad anteriores a esta instalación no se inventan.
begin;

create schema if not exists private;

create table if not exists private.drivers_inactividad_inicio (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  inactivo_desde timestamptz not null
);
revoke all on private.drivers_inactividad_inicio from public, anon, authenticated;

create or replace function private.registrar_inicio_inactividad()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if lower(coalesce(new.estatus::text, '')) = 'inactivo' then
    insert into private.drivers_inactividad_inicio (driver_id, inactivo_desde)
    values (new.id, now())
    on conflict (driver_id) do update set inactivo_desde = excluded.inactivo_desde;
  else
    delete from private.drivers_inactividad_inicio where driver_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.registrar_inicio_inactividad() from public, anon, authenticated;
drop trigger if exists drivers_registrar_inicio_inactividad_insert on public.drivers;
create trigger drivers_registrar_inicio_inactividad_insert
  after insert on public.drivers for each row
  when (lower(coalesce(new.estatus::text, '')) = 'inactivo')
  execute function private.registrar_inicio_inactividad();
drop trigger if exists drivers_registrar_inicio_inactividad_update on public.drivers;
create trigger drivers_registrar_inicio_inactividad_update
  after update of estatus on public.drivers for each row
  when (old.estatus is distinct from new.estatus)
  execute function private.registrar_inicio_inactividad();

create or replace function private.estado_invitacion_correo(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
  select jsonb_build_object(
    'en_padron', exists (select 1 from public.padron_fleet p
                         where lower(btrim(p.email::text)) = lower(btrim(p_email))),
    'padron_activo', exists (select 1 from public.padron_fleet p
                             where lower(btrim(p.email::text)) = lower(btrim(p_email))
                               and upper(btrim(p.estatus::text)) = 'ACTIVO'),
    'cuenta_inactiva', coalesce(lower(d.estatus::text) = 'inactivo', false),
    'cuenta_bloqueada', coalesce(u.banned_until > now(), false),
    'inactivo_desde', case when lower(d.estatus::text) = 'inactivo' then i.inactivo_desde end
  )
  from (select 1) base
  left join auth.users u on lower(btrim(u.email::text)) = lower(btrim(p_email))
  left join public.drivers d on d.id = u.id and d.rol::text in ('driver', 'flotillero')
  left join private.drivers_inactividad_inicio i on i.driver_id = d.id;
$$;
revoke all on function private.estado_invitacion_correo(text) from public, anon, authenticated;

create or replace function public.consultar_estado_invitacion(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar el estado de la invitacion';
  end if;
  if lower(btrim(coalesce(p_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo invalido';
  end if;
  return private.estado_invitacion_correo(p_email);
end;
$$;
revoke all on function public.consultar_estado_invitacion(text) from public, anon;
grant execute on function public.consultar_estado_invitacion(text) to authenticated;

create table if not exists public.invitaciones_red_auditoria (
  id bigserial primary key,
  invitacion_id bigint not null references public.invitaciones_red(id),
  evento text not null check (evento in ('solicitud', 'invitacion', 'correo', 'whatsapp')),
  actor_id uuid not null,
  registrado_en timestamptz not null default now(),
  estado jsonb not null
);
alter table public.invitaciones_red_auditoria enable row level security;
revoke all on public.invitaciones_red_auditoria from public, anon, authenticated;
grant select on public.invitaciones_red_auditoria to authenticated;
drop policy if exists invitaciones_red_auditoria_visible on public.invitaciones_red_auditoria;
create policy invitaciones_red_auditoria_visible on public.invitaciones_red_auditoria
  for select to authenticated using (
    coalesce(public.mi_acceso_administrativo(), false)
    and coalesce(public.operativo_rol_actual(), '') in ('master', 'ops', 'coordinador', 'ih')
    and exists (select 1 from public.invitaciones_red inv
            where inv.id = invitacion_id and public.invitacion_red_visible(inv))
  );

create or replace function private.auditar_invitacion_red()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  insert into public.invitaciones_red_auditoria (invitacion_id, evento, actor_id, estado)
  values (new.id, case when new.estatus = 'pendiente_aprobacion' then 'solicitud' else 'invitacion' end,
          auth.uid(), private.estado_invitacion_correo(new.email));
  return new;
end;
$$;
revoke all on function private.auditar_invitacion_red() from public, anon, authenticated;
drop trigger if exists invitaciones_red_auditar_insert on public.invitaciones_red;
create trigger invitaciones_red_auditar_insert
  after insert on public.invitaciones_red for each row
  execute function private.auditar_invitacion_red();
drop trigger if exists invitaciones_red_auditar_aprobacion on public.invitaciones_red;
create trigger invitaciones_red_auditar_aprobacion
  after update of estatus on public.invitaciones_red for each row
  when (old.estatus = 'pendiente_aprobacion' and new.estatus = 'enviada')
  execute function private.auditar_invitacion_red();

-- Registra la preparación del mensaje; no afirma que el correo o WhatsApp se envió.
create or replace function public.registrar_preparacion_invitacion_red(p_id bigint, p_canal text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_inv public.invitaciones_red%rowtype;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para preparar esta invitacion';
  end if;
  if p_canal is null or p_canal not in ('correo', 'whatsapp') then
    raise exception 'Canal invalido';
  end if;
  select * into v_inv from public.invitaciones_red where id = p_id for update;
  if not found or not public.invitacion_red_visible(v_inv)
     or v_inv.estatus not in ('enviada', 'aceptada') then
    raise exception 'La invitacion no esta disponible';
  end if;
  insert into public.invitaciones_red_auditoria (invitacion_id, evento, actor_id, estado)
  values (v_inv.id, p_canal, auth.uid(), private.estado_invitacion_correo(v_inv.email));
end;
$$;
revoke all on function public.registrar_preparacion_invitacion_red(bigint, text) from public, anon;
grant execute on function public.registrar_preparacion_invitacion_red(bigint, text) to authenticated;

commit;

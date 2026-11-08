-- Ejecutar completo después de network-invitations.sql e invitation-status-audit.sql.
-- Autoriza registros nuevos únicamente mediante una invitación aprobada.
begin;

-- El padrón de Flota ya no controla el estado de las cuentas de la app.
drop trigger if exists padron_baja on public.padron_fleet;

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
        or (public.operativo_rol_actual() in ('ih', 'coordinador') and (
          (p_inv.tipo = 'driver' and p_inv.cedis_id is null)
          or exists (
            select 1 from public.asignaciones_operativas a
            where a.cedis_id = p_inv.cedis_id
              and ((public.operativo_rol_actual() = 'ih' and a.supervisor_id = auth.uid())
                or (public.operativo_rol_actual() = 'coordinador' and a.coordinador_id = auth.uid()))
          )
        ))
      )
    )
  );
$$;
revoke all on function public.invitacion_red_visible(public.invitaciones_red) from public, anon;
grant execute on function public.invitacion_red_visible(public.invitaciones_red) to authenticated;

create or replace function public.invitar_driver_flotillero(
  p_email text, p_nombre text, p_proveedor_id bigint
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol text := public.operativo_rol_actual();
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para enviar invitaciones';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo invalido'; end if;
  if not exists (select 1 from public.proveedores p
                 where p.id = p_proveedor_id and p.tipo = 'flotillero' and p.activo) then
    raise exception 'Selecciona un flotillero activo';
  end if;
  begin
    insert into public.invitaciones_red
      (email, nombre, tipo, esquema, proveedor_id, cedis_id, estatus, invitado_por, invitado_por_rol)
    values
      (v_email, nullif(btrim(coalesce(p_nombre, '')), ''), 'driver', null, p_proveedor_id, null,
       'enviada', auth.uid(), v_rol);
  exception when unique_violation then
    raise exception 'Ya existe una invitacion activa para ese correo';
  end;
  perform public.aplicar_invitacion_red_por_correo(v_email);
  return 'Invitacion registrada. Comparte el aviso por correo o WhatsApp';
end;
$$;
revoke all on function public.invitar_driver_flotillero(text, text, bigint) from public, anon;
grant execute on function public.invitar_driver_flotillero(text, text, bigint) to authenticated;

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
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
begin
  select * into v_inv from public.invitaciones_red where id = p_inv_id and estatus = 'enviada' for update;
  if not found then return; end if;
  select d.nombre into v_nombre
    from public.drivers d join auth.users u on u.id = d.id
   where d.id = p_driver_id and lower(btrim(u.email::text)) = lower(btrim(v_inv.email))
     and d.rol::text in ('driver', 'flotillero') and lower(d.estatus::text) = 'activo'
     and (u.banned_until is null or u.banned_until <= now())
   for update of d;
  if not found then return; end if;
  if v_inv.tipo = 'driver' and not exists (
    select 1 from public.proveedores where id = v_inv.proveedor_id and tipo = 'flotillero' and activo
  ) then raise exception 'La flotilla de la invitacion no esta activa'; end if;

  if v_inv.tipo in ('flotillero', 'independiente') then
    select id into v_prov from public.proveedores where titular_id = p_driver_id limit 1;
    if v_prov is null then
      insert into public.proveedores (nombre, tipo, tipo_registro, titular_id)
      values (coalesce(nullif(v_inv.nombre, ''), v_nombre, v_inv.email), v_inv.tipo, v_inv.esquema, p_driver_id)
      returning id into v_prov;
    else
      update public.proveedores
         set tipo = v_inv.tipo, tipo_registro = coalesce(v_inv.esquema, tipo_registro)
       where id = v_prov;
    end if;
  else
    v_prov := v_inv.proveedor_id;
  end if;
  perform set_config('app.trusted', '1', true);
  update public.drivers
     set proveedor_id = v_prov,
         rol = case when v_inv.tipo = 'flotillero' then 'flotillero'
                    when v_inv.tipo in ('driver', 'independiente') then 'driver' else rol end
   where id = p_driver_id;
  perform set_config('app.trusted', v_trusted, true);
  update public.invitaciones_red
     set estatus = 'aceptada', aceptada_por = p_driver_id, resuelto_en = now()
   where id = v_inv.id;
end;
$$;
revoke all on function public.aplicar_invitacion_red(bigint, uuid) from public, anon, authenticated;

create or replace function private.nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text;
  v_nom text;
  v_est text := 'activo';
  v_inv public.invitaciones_red%rowtype;
  em text := lower(btrim(new.email));
begin
  if em ~ '^[^@]+@chazki\.com$' then
    select rol, nombre into v_rol, v_nom from public.staff_invitados where email = em;
  end if;
  if v_rol is null then
    select * into v_inv from public.invitaciones_red
     where lower(btrim(email)) = em and estatus = 'enviada'
     for update;
    if not found then
      raise exception 'Registro no autorizado: se requiere una invitacion aprobada';
    end if;
    if v_inv.tipo = 'driver' and not exists (
      select 1 from public.proveedores where id = v_inv.proveedor_id and tipo = 'flotillero' and activo
    ) then
      raise exception 'La flotilla de la invitacion no esta activa';
    end if;
    v_rol := 'driver';
  end if;
  insert into public.drivers (id, nombre, codigo, rol, estatus)
  values (new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre',''), nullif(new.raw_user_meta_data->>'full_name',''),
             nullif(new.raw_user_meta_data->>'name',''), v_nom, nullif(v_inv.nombre,''), split_part(new.email,'@',1)),
    'DRV-' || lpad(nextval('public.drivers_codigo_seq')::text, 6, '0'), v_rol, v_est)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Una invitación determina la categoría de un nuevo conductor; la lista anterior
-- de flotilleros autorizados conserva su comportamiento para las demás cuentas.
create or replace function public.drivers_asignar_flotillero()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if new.rol::text = 'driver' and exists (
    select 1 from auth.users u
    join public.flotilleros_autorizados f on f.email = lower(u.email::text)
    where u.id = new.id and u.email_confirmed_at is not null
      and not exists (select 1 from public.invitaciones_red i
                      where lower(btrim(i.email)) = lower(btrim(u.email::text))
                        and i.estatus = 'enviada')
  ) then
    new.rol := 'flotillero';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;

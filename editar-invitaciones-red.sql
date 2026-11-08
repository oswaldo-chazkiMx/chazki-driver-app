-- Ejecutar después de gestion-flotillas-supervisor.sql y las migraciones de invitaciones.
-- Corrige únicamente invitaciones enviadas que todavía no se han aplicado.
begin;

create table if not exists private.cambios_invitacion_red (
  id bigint generated always as identity primary key,
  invitacion_id bigint not null references public.invitaciones_red(id),
  actor_id uuid not null,
  antes jsonb not null,
  despues jsonb not null,
  creado_en timestamptz not null default now()
);
revoke all on private.cambios_invitacion_red from public, anon, authenticated;

create or replace function public.editar_invitacion_red(
  p_id bigint, p_original jsonb, p_email text, p_nombre text, p_tipo text,
  p_esquema text, p_cedis_id bigint, p_proveedor_id bigint, p_invitacion_flotillero_id bigint
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_actual public.invitaciones_red%rowtype;
  v_padre public.invitaciones_red%rowtype;
  v_rol text := public.operativo_rol_actual();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_antes jsonb;
  v_despues jsonb;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para editar invitaciones';
  end if;
  select * into v_actual from public.invitaciones_red where id = p_id for update;
  if not found or v_actual.estatus <> 'enviada' or not public.invitacion_red_visible(v_actual) then
    raise exception 'La invitacion ya no esta disponible para editar';
  end if;
  v_antes := jsonb_build_object('email', v_actual.email, 'nombre', v_actual.nombre,
    'tipo', v_actual.tipo, 'esquema', v_actual.esquema, 'cedis_id', v_actual.cedis_id,
    'proveedor_id', v_actual.proveedor_id, 'invitacion_flotillero_id', v_actual.invitacion_flotillero_id);
  if v_antes is distinct from p_original then
    raise exception 'La invitacion cambio; actualiza la lista e intenta de nuevo';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Correo invalido';
  end if;
  if length(coalesce(p_nombre, '')) > 200 then raise exception 'Nombre demasiado largo'; end if;
  if p_tipo is null or p_tipo not in ('driver', 'flotillero', 'independiente') then
    raise exception 'Categoria invalida';
  end if;
  if exists (select 1 from auth.users u where lower(btrim(u.email::text)) in (lower(btrim(v_actual.email)), v_email)) then
    raise exception 'Ya existe una cuenta para el correo anterior o nuevo; solicita ayuda al administrador';
  end if;
  if v_actual.tipo = 'flotillero'
     and (p_tipo <> 'flotillero' or v_email <> lower(btrim(v_actual.email)))
     and exists (select 1 from public.invitaciones_red i
                 where i.invitacion_flotillero_id = p_id
                   and i.estatus in ('enviada', 'pendiente_aprobacion')) then
    raise exception 'Primero cancela o cambia las invitaciones de drivers vinculadas a este flotillero';
  end if;
  if p_tipo = 'driver' then
    if p_esquema is not null or p_cedis_id is not null
       or (p_proveedor_id is null) = (p_invitacion_flotillero_id is null) then
      raise exception 'Selecciona una sola flotilla; el driver no lleva esquema ni CEDIS';
    end if;
    if p_proveedor_id is not null then
      if not exists (select 1 from public.proveedores p
                     where p.id = p_proveedor_id and p.tipo = 'flotillero' and p.activo) then
        raise exception 'La flotilla seleccionada no esta activa';
      end if;
    else
      if p_invitacion_flotillero_id = p_id then raise exception 'La invitacion no puede vincularse a si misma'; end if;
      select * into v_padre from public.invitaciones_red where id = p_invitacion_flotillero_id for update;
      if not found or v_padre.tipo <> 'flotillero' or v_padre.estatus <> 'enviada' then
        raise exception 'La invitacion del flotillero ya no esta disponible';
      end if;
      if lower(btrim(v_padre.email)) = v_email then raise exception 'El correo debe ser diferente al del flotillero'; end if;
    end if;
  else
    if p_proveedor_id is not null or p_invitacion_flotillero_id is not null
       or (p_esquema is not null and p_esquema not in ('FACTURA', 'SIN FACTURA')) then
      raise exception 'Configuracion de categoria invalida';
    end if;
    if v_rol in ('ih', 'coordinador') and not exists (
      select 1 from public.asignaciones_operativas a where a.cedis_id = p_cedis_id
        and ((v_rol = 'ih' and a.supervisor_id = auth.uid())
          or (v_rol = 'coordinador' and a.coordinador_id = auth.uid()))
    ) then raise exception 'Selecciona un CEDIS asignado a tu cuenta'; end if;
    if p_cedis_id is not null and not exists (select 1 from public.cedis c where c.id = p_cedis_id) then
      raise exception 'CEDIS invalido';
    end if;
  end if;
  begin
    update public.invitaciones_red
       set email = v_email, nombre = nullif(btrim(coalesce(p_nombre, '')), ''),
           tipo = p_tipo, esquema = p_esquema, cedis_id = p_cedis_id,
           proveedor_id = p_proveedor_id, invitacion_flotillero_id = p_invitacion_flotillero_id
     where id = p_id returning * into v_actual;
  exception when unique_violation then
    raise exception 'Ya existe una invitacion activa para ese correo';
  end;
  v_despues := jsonb_build_object('email', v_actual.email, 'nombre', v_actual.nombre,
    'tipo', v_actual.tipo, 'esquema', v_actual.esquema, 'cedis_id', v_actual.cedis_id,
    'proveedor_id', v_actual.proveedor_id, 'invitacion_flotillero_id', v_actual.invitacion_flotillero_id);
  insert into private.cambios_invitacion_red(invitacion_id, actor_id, antes, despues)
  values (p_id, auth.uid(), v_antes, v_despues);
  return 'Invitacion actualizada. Prepara y envia de nuevo el aviso si es necesario';
end;
$$;
revoke all on function public.editar_invitacion_red(bigint, jsonb, text, text, text, text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.editar_invitacion_red(bigint, jsonb, text, text, text, text, bigint, bigint, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

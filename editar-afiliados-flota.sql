-- Ejecutar después de gestion-flotillas-supervisor.sql.
-- Permite editar los datos de proveedores y drivers desde el panel de Operaciones.
begin;

alter table public.drivers
  add column if not exists cedis_default_id bigint
    references public.cedis(id) on delete set null;

create index if not exists drivers_cedis_default_id_idx
  on public.drivers(cedis_default_id) where cedis_default_id is not null;

create table if not exists private.ediciones_afiliados_flota (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  driver_id uuid references public.drivers(id),
  proveedor_id bigint references public.proveedores(id),
  operacion text not null check (operacion in ('driver', 'proveedor')),
  creado_en timestamptz not null default now()
);
revoke all on private.ediciones_afiliados_flota from public, anon, authenticated;

create or replace function public.listar_afiliados_edicion_flota()
returns table (
  id uuid, nombre text, codigo text, rol text, estatus text, proveedor_id bigint,
  proveedor_nombre text, proveedor_tipo text, proveedor_tipo_registro text,
  titular_id uuid, proveedor_activo boolean, telefono text, correo_contacto text,
  cedis_default_id bigint, cedis_default_nombre text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(public.operativo_rol_actual(), '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar afiliados';
  end if;
  return query
    select d.id, d.nombre::text, d.codigo::text, d.rol::text, d.estatus::text,
           p.id, p.nombre::text, p.tipo::text, p.tipo_registro::text, p.titular_id, p.activo,
           d.telefono::text, d.correo_contacto::text, d.cedis_default_id, ce.nombre::text
      from public.drivers d
      left join public.proveedores p on p.id = d.proveedor_id
      left join public.cedis ce on ce.id = d.cedis_default_id
     where d.rol::text in ('driver', 'flotillero')
     order by d.nombre, d.id;
end;
$$;
revoke all on function public.listar_afiliados_edicion_flota() from public, anon, authenticated;
grant execute on function public.listar_afiliados_edicion_flota() to authenticated;

create or replace function public.listar_cedis_edicion_flota()
returns table (id bigint, nombre text, cliente_id bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_rol text := public.operativo_rol_actual();
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para consultar CEDIS';
  end if;
  return query
    select c.id, c.nombre::text, c.cliente_id
      from public.cedis c
     where c.activo
       and (v_rol in ('master', 'ops') or exists (
         select 1 from public.asignaciones_operativas a
          where a.cedis_id = c.id
            and ((v_rol = 'ih' and a.supervisor_id = auth.uid())
              or (v_rol = 'coordinador' and a.coordinador_id = auth.uid()))
       ))
     order by c.nombre, c.id;
end;
$$;
revoke all on function public.listar_cedis_edicion_flota() from public, anon, authenticated;
grant execute on function public.listar_cedis_edicion_flota() to authenticated;

create or replace function public.editar_datos_driver_flota(
  p_driver_id uuid, p_proveedor_id bigint, p_nombre text, p_telefono text,
  p_correo_contacto text, p_cedis_default_id bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol text := public.operativo_rol_actual();
  v_cedis_actual bigint;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para editar este driver';
  end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is null or length(btrim(p_nombre)) > 200 then
    raise exception 'Escribe un nombre de hasta 200 caracteres';
  end if;
  if length(coalesce(p_telefono, '')) > 50 then raise exception 'Telefono demasiado largo'; end if;
  if length(coalesce(p_correo_contacto, '')) > 254 or
     (nullif(btrim(coalesce(p_correo_contacto, '')), '') is not null
      and btrim(p_correo_contacto) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Correo de contacto invalido';
  end if;
  select d.cedis_default_id into v_cedis_actual
    from public.drivers d
   where d.id = p_driver_id and d.proveedor_id is not distinct from p_proveedor_id
     and d.rol::text in ('driver', 'flotillero')
   for update;
  if not found then raise exception 'El driver ya no pertenece al registro seleccionado'; end if;
  if p_cedis_default_id is distinct from v_cedis_actual and p_cedis_default_id is not null
     and not exists (
       select 1 from public.cedis c where c.id = p_cedis_default_id and c.activo
     ) then raise exception 'Selecciona un CEDIS activo'; end if;
  if p_cedis_default_id is distinct from v_cedis_actual
     and p_cedis_default_id is not null and v_rol in ('ih', 'coordinador') and not exists (
    select 1 from public.asignaciones_operativas a
     where a.cedis_id = p_cedis_default_id
       and ((v_rol = 'ih' and a.supervisor_id = auth.uid())
         or (v_rol = 'coordinador' and a.coordinador_id = auth.uid()))
  ) then raise exception 'Selecciona un CEDIS asignado a tu cuenta'; end if;

  update public.drivers d
     set nombre = btrim(p_nombre),
         telefono = nullif(btrim(coalesce(p_telefono, '')), ''),
         correo_contacto = nullif(lower(btrim(coalesce(p_correo_contacto, ''))), ''),
         cedis_default_id = p_cedis_default_id
   where d.id = p_driver_id and d.proveedor_id is not distinct from p_proveedor_id
     and d.rol::text in ('driver', 'flotillero');
  if not found then raise exception 'El driver ya no pertenece al registro seleccionado'; end if;

  insert into private.ediciones_afiliados_flota(actor_id, driver_id, proveedor_id, operacion)
  values (auth.uid(), p_driver_id, p_proveedor_id, 'driver');
end;
$$;
revoke all on function public.editar_datos_driver_flota(uuid, bigint, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.editar_datos_driver_flota(uuid, bigint, text, text, text, bigint)
  to authenticated;

create or replace function public.editar_proveedor_flota(
  p_proveedor_id bigint, p_nombre text, p_tipo text, p_tipo_registro text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_rol text := public.operativo_rol_actual();
  v_titular uuid;
  v_tipo_actual text;
begin
  if auth.uid() is null or not coalesce(public.mi_acceso_administrativo(), false)
     or coalesce(v_rol, '') not in ('master', 'ops', 'coordinador', 'ih') then
    raise exception 'No tienes permiso para editar este proveedor';
  end if;
  if nullif(btrim(coalesce(p_nombre, '')), '') is null or length(btrim(p_nombre)) > 200 then
    raise exception 'Escribe un nombre o razon social de hasta 200 caracteres';
  end if;
  if p_tipo is null or p_tipo not in ('flotillero', 'independiente') then raise exception 'Categoria invalida'; end if;
  if p_tipo_registro is not null and p_tipo_registro not in ('FACTURA', 'SIN FACTURA') then
    raise exception 'Esquema invalido';
  end if;

  select p.titular_id, p.tipo into v_titular, v_tipo_actual
    from public.proveedores p where p.id = p_proveedor_id for update;
  if not found then raise exception 'El proveedor ya no esta disponible'; end if;
  if v_titular is null then
    if v_tipo_actual is distinct from 'independiente' or p_tipo <> 'independiente' then
      raise exception 'Solo se pueden editar datos de un proveedor independiente sin titular';
    end if;
  else
    perform 1 from public.drivers d
     where d.id = v_titular and d.proveedor_id = p_proveedor_id
       and d.rol::text in ('driver', 'flotillero') for update;
    if not found then raise exception 'El titular del proveedor ya no esta disponible'; end if;
  end if;
  if p_tipo = 'independiente' and exists (
    select 1 from public.drivers d
     where d.proveedor_id = p_proveedor_id and d.id <> v_titular and d.rol::text = 'driver'
  ) then raise exception 'No se puede cambiar a independiente mientras tenga drivers vinculados'; end if;
  if p_tipo = 'flotillero' and v_titular is null then
    raise exception 'No se puede cambiar a flotillero sin un titular';
  end if;

  update public.proveedores
     set nombre = btrim(p_nombre), tipo = p_tipo, tipo_registro = p_tipo_registro
   where id = p_proveedor_id;
  if v_titular is not null then
    update public.drivers
       set rol = case when p_tipo = 'flotillero' then 'flotillero' else 'driver' end
     where id = v_titular and proveedor_id = p_proveedor_id;
  end if;

  insert into private.ediciones_afiliados_flota(actor_id, driver_id, proveedor_id, operacion)
  values (auth.uid(), v_titular, p_proveedor_id, 'proveedor');
end;
$$;
revoke all on function public.editar_proveedor_flota(bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.editar_proveedor_flota(bigint, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;

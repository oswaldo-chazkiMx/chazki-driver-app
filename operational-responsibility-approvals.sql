-- Proposed operational-scope and tariff-approval migration.
-- Assumptions verified against this repository:
--   * cedis.cliente_id identifies the owning client.
--   * drivers.id matches auth.uid(); staff roles are ih/coordinador/ops/master.
--   * notificaciones uses usuario, titulo, cuerpo, tipo, ref_tipo and ref_id.
--   * mi_acceso_administrativo() and the existing resolver_cancelacion(bigint, text, text)
--     and resolver_desactivacion_driver(bigint, boolean, text) RPCs are installed.
-- Upload the workload CSV through the master-only import action in ops.html after
-- applying this migration. The contact-list column is intentionally not used.
begin;

create table if not exists public.asignaciones_operativas (
  cliente_id bigint not null references public.clientes(id) on delete cascade,
  cedis_id bigint not null references public.cedis(id) on delete cascade,
  supervisor_id uuid not null references public.drivers(id),
  coordinador_id uuid not null references public.drivers(id),
  actualizado_en timestamptz not null default now(),
  primary key (cliente_id, cedis_id)
);

create index if not exists asignaciones_operativas_supervisor_idx
  on public.asignaciones_operativas (supervisor_id, cliente_id, cedis_id);
create index if not exists asignaciones_operativas_coordinador_idx
  on public.asignaciones_operativas (coordinador_id, cliente_id, cedis_id);

alter table public.asignaciones_operativas enable row level security;
revoke all on public.asignaciones_operativas from anon, authenticated;
grant select on public.asignaciones_operativas to authenticated;

create or replace function public.operativo_normalizar(p_texto text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
    translate(lower(btrim(coalesce(p_texto, ''))), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', '', 'g'
  );
$$;

create or replace function public.operativo_rol_actual()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select d.rol::text
  from public.drivers d
  where d.id = auth.uid();
$$;

create or replace function public.operativo_asignado_a(
  p_cliente_id bigint,
  p_cedis_id bigint,
  p_rol text default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.asignaciones_operativas a
    where a.cliente_id = p_cliente_id
      and a.cedis_id = p_cedis_id
      and (
        (p_rol = 'ih' and a.supervisor_id = auth.uid())
        or (p_rol = 'coordinador' and a.coordinador_id = auth.uid())
        or (p_rol is null and auth.uid() in (a.supervisor_id, a.coordinador_id))
      )
  );
$$;

create or replace function public.operativo_cuenta_cliente(p_cuenta text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case upper(btrim(coalesce(p_cuenta, '')))
    when 'MELI' then 'MERCADOLIBRE'
    when 'MERCADO LIBRE' then 'MERCADOLIBRE'
    when 'COPPEL BT' then 'COPPEL'
    else public.operativo_normalizar(p_cuenta)
  end;
$$;

create or replace function public.operativo_tarifa_asignada(
  p_cuenta text,
  p_ubicacion text,
  p_usuario uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select p_usuario is not null and exists (
    select 1
    from public.asignaciones_operativas a
    join public.clientes cl on cl.id = a.cliente_id
    join public.cedis ce on ce.id = a.cedis_id and ce.cliente_id = a.cliente_id
    where public.operativo_cuenta_cliente(cl.nombre) = public.operativo_cuenta_cliente(p_cuenta)
      and (
        public.operativo_normalizar(ce.nombre) = public.operativo_normalizar(p_ubicacion)
        or public.operativo_normalizar(split_part(ce.nombre, ' - ', 1))
             = public.operativo_normalizar(p_ubicacion)
      )
      and p_usuario in (a.supervisor_id, a.coordinador_id)
  );
$$;

create or replace function public.operativo_cuenta_asignada(
  p_cuenta text,
  p_usuario uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select p_usuario is not null and exists (
    select 1
    from public.asignaciones_operativas a
    join public.clientes cl on cl.id = a.cliente_id
    where public.operativo_cuenta_cliente(cl.nombre) = public.operativo_cuenta_cliente(p_cuenta)
      and p_usuario = a.coordinador_id
    group by a.cliente_id
    having count(distinct a.cedis_id) = (
      select count(*) from public.cedis ce where ce.cliente_id = a.cliente_id
    )
  );
$$;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'asignaciones_operativas'
  loop
    execute format('drop policy %I on public.asignaciones_operativas', p.policyname);
  end loop;
end;
$$;
create policy asignaciones_operativas_read_scoped on public.asignaciones_operativas
  for select to authenticated
  using (
    public.mi_acceso_administrativo()
    and (
      public.operativo_rol_actual() in ('master', 'ops')
      or auth.uid() in (supervisor_id, coordinador_id)
    )
  );

-- Import only the responsible-name columns from the uploaded CSV. The broader
-- email/contact list is deliberately ignored. Ambiguous or unmatched rows are
-- returned to the master for correction instead of granting access by guess.
create or replace function public.importar_asignaciones_operativas(p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_fila jsonb;
  v_cliente text;
  v_cedis text;
  v_supervisor text;
  v_coordinador text;
  v_clientes bigint[];
  v_cedis_ids bigint[];
  v_supervisores uuid[];
  v_coordinadores uuid[];
  v_importadas integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or public.operativo_rol_actual() <> 'master' then
    raise exception 'Solo la cuenta maestra puede importar responsables operativos';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 5000 then
    raise exception 'El archivo debe contener una lista de hasta 5,000 filas';
  end if;

  for v_fila in select value from jsonb_array_elements(p_filas)
  loop
    v_cliente := btrim(coalesce(v_fila->>'CLIENTE', ''));
    v_cedis := btrim(coalesce(v_fila->>'CEDIS', ''));
    v_supervisor := btrim(coalesce(v_fila->>'SUPERVISOR', ''));
    v_coordinador := btrim(coalesce(v_fila->>'COORDINADOR ASIGNADO', ''));

    select array_agg(cl.id order by cl.id)
      into v_clientes
      from public.clientes cl
     where public.operativo_normalizar(cl.nombre) = public.operativo_normalizar(v_cliente);
    select array_agg(ce.id order by ce.id)
      into v_cedis_ids
      from public.cedis ce
      join public.clientes cl on cl.id = ce.cliente_id
     where ce.cliente_id = any(coalesce(v_clientes, array[]::bigint[]))
       and public.operativo_normalizar(ce.nombre) = public.operativo_normalizar(v_cedis);

    select array_agg(d.id order by d.id)
      into v_supervisores
      from public.drivers d
     where d.rol::text = 'ih'
       and public.operativo_normalizar(d.nombre) = public.operativo_normalizar(v_supervisor);
    select array_agg(d.id order by d.id)
      into v_coordinadores
      from public.drivers d
     where d.rol::text = 'coordinador'
       and public.operativo_normalizar(d.nombre) = public.operativo_normalizar(v_coordinador);

    if cardinality(coalesce(v_clientes, array[]::bigint[])) <> 1
       or cardinality(coalesce(v_cedis_ids, array[]::bigint[])) <> 1
       or cardinality(coalesce(v_supervisores, array[]::uuid[])) <> 1
       or cardinality(coalesce(v_coordinadores, array[]::uuid[])) <> 1 then
      v_errores := v_errores || jsonb_build_array(jsonb_build_object(
        'cliente', v_cliente,
        'cedis', v_cedis,
        'supervisor', v_supervisor,
        'coordinador', v_coordinador,
        'cliente_resuelto', cardinality(coalesce(v_clientes, array[]::bigint[])) = 1,
        'cedis_resuelto', cardinality(coalesce(v_cedis_ids, array[]::bigint[])) = 1,
        'supervisor_resuelto', cardinality(coalesce(v_supervisores, array[]::uuid[])) = 1,
        'coordinador_resuelto', cardinality(coalesce(v_coordinadores, array[]::uuid[])) = 1
      ));
      continue;
    end if;

    insert into public.asignaciones_operativas (
      cliente_id, cedis_id, supervisor_id, coordinador_id, actualizado_en
    ) values (
      v_clientes[1], v_cedis_ids[1], v_supervisores[1], v_coordinadores[1], now()
    )
    on conflict (cliente_id, cedis_id) do update
      set supervisor_id = excluded.supervisor_id,
          coordinador_id = excluded.coordinador_id,
          actualizado_en = excluded.actualizado_en;
    v_importadas := v_importadas + 1;
  end loop;

  return jsonb_build_object('importadas', v_importadas, 'errores', v_errores);
end;
$$;

create table if not exists public.cambios_tarifario_solicitudes (
  id bigint generated always as identity primary key,
  entidad text not null check (entidad in ('tarifas', 'reglas_penalizacion')),
  entidad_id bigint,
  cliente_id bigint not null references public.clientes(id),
  cedis_id bigint references public.cedis(id),
  datos_nuevos jsonb not null check (jsonb_typeof(datos_nuevos) = 'object'),
  datos_anteriores jsonb,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'rechazada')),
  solicitada_por uuid not null references auth.users(id),
  solicitada_en timestamptz not null default now(),
  resuelta_por uuid references auth.users(id),
  resuelta_en timestamptz,
  nota_resolucion text
);
create index if not exists cambios_tarifario_pendientes_idx
  on public.cambios_tarifario_solicitudes (estado, solicitada_en desc);
create index if not exists cambios_tarifario_solicitante_idx
  on public.cambios_tarifario_solicitudes (solicitada_por, solicitada_en desc);

alter table public.cambios_tarifario_solicitudes enable row level security;
revoke all on public.cambios_tarifario_solicitudes from anon, authenticated;
grant select on public.cambios_tarifario_solicitudes to authenticated;
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'cambios_tarifario_solicitudes'
  loop
    execute format('drop policy %I on public.cambios_tarifario_solicitudes', p.policyname);
  end loop;
end;
$$;
create policy cambios_tarifario_read_scoped on public.cambios_tarifario_solicitudes
  for select to authenticated
  using (
    public.mi_acceso_administrativo()
    and (
      public.operativo_rol_actual() = 'master'
      or solicitada_por = auth.uid()
    )
  );

create or replace function public.solicitar_cambio_tarifario(
  p_entidad text,
  p_entidad_id bigint,
  p_datos jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_cliente_id bigint;
  v_cedis_id bigint;
  v_cuenta text;
  v_ubicacion text;
  v_anterior jsonb;
  v_id bigint;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or public.operativo_rol_actual() <> 'coordinador' then
    raise exception 'Solo un coordinador autorizado puede solicitar cambios al tarifario';
  end if;
  if jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos del cambio deben ser un objeto JSON';
  end if;

  if p_entidad = 'tarifas' then
    if p_entidad_id is not null then
      select to_jsonb(t), t.cuenta, t.ubicacion
        into v_anterior, v_cuenta, v_ubicacion
        from public.tarifas t where t.id = p_entidad_id;
      if not found then raise exception 'La tarifa ya no existe'; end if;
      v_cuenta := coalesce(p_datos->>'cuenta', v_cuenta);
      v_ubicacion := coalesce(p_datos->>'ubicacion', v_ubicacion);
    else
      v_cuenta := p_datos->>'cuenta';
      v_ubicacion := p_datos->>'ubicacion';
    end if;

    select a.cliente_id, a.cedis_id into v_cliente_id, v_cedis_id
      from public.asignaciones_operativas a
      join public.clientes cl on cl.id = a.cliente_id
      join public.cedis ce on ce.id = a.cedis_id and ce.cliente_id = a.cliente_id
     where a.coordinador_id = auth.uid()
       and public.operativo_cuenta_cliente(cl.nombre) = public.operativo_cuenta_cliente(v_cuenta)
       and (
         public.operativo_normalizar(ce.nombre) = public.operativo_normalizar(v_ubicacion)
         or public.operativo_normalizar(split_part(ce.nombre, ' - ', 1))
              = public.operativo_normalizar(v_ubicacion)
       )
     order by a.cliente_id, a.cedis_id
     limit 1;
    if v_cedis_id is null then
      raise exception 'La tarifa no coincide con un CEDIS asignado a tu cuenta';
    end if;
  elsif p_entidad = 'reglas_penalizacion' then
    v_cuenta := p_datos->>'cuenta';
    if p_entidad_id is not null then
      select to_jsonb(g), g.cuenta into v_anterior, v_cuenta
        from public.reglas_penalizacion g where g.id = p_entidad_id;
      if not found then raise exception 'La regla ya no existe'; end if;
    end if;
    if not public.operativo_cuenta_asignada(v_cuenta) then
      raise exception 'Para editar reglas de una cuenta debes tener asignados todos sus CEDIS';
    end if;
    select a.cliente_id, min(a.cedis_id) into v_cliente_id, v_cedis_id
      from public.asignaciones_operativas a
      join public.clientes cl on cl.id = a.cliente_id
     where a.coordinador_id = auth.uid()
       and public.operativo_cuenta_cliente(cl.nombre) = public.operativo_cuenta_cliente(v_cuenta)
     group by a.cliente_id;
  else
    raise exception 'Tipo de cambio no permitido';
  end if;

  insert into public.cambios_tarifario_solicitudes (
    entidad, entidad_id, cliente_id, cedis_id, datos_nuevos,
    datos_anteriores, solicitada_por
  ) values (
    p_entidad, p_entidad_id, v_cliente_id, v_cedis_id, p_datos,
    v_anterior, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resolver_cambio_tarifario(
  p_id bigint,
  p_aprobar boolean,
  p_nota text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_solicitud public.cambios_tarifario_solicitudes%rowtype;
  v_tarifa public.tarifas%rowtype;
  v_regla public.reglas_penalizacion%rowtype;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or public.operativo_rol_actual() <> 'master' then
    raise exception 'Solo la cuenta maestra puede resolver cambios del tarifario';
  end if;
  select * into v_solicitud
    from public.cambios_tarifario_solicitudes
   where id = p_id
   for update;
  if not found then raise exception 'No se encontró la solicitud'; end if;
  if v_solicitud.estado <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta';
  end if;

  if p_aprobar then
    if v_solicitud.entidad = 'tarifas' then
      if v_solicitud.entidad_id is null then
        select * into v_tarifa
          from jsonb_populate_record(null::public.tarifas, v_solicitud.datos_nuevos);
        insert into public.tarifas (
          cuenta, cliente, conc, ubicacion, ciudad, tipo_unidad, esquema,
          zona, variable, pago_base, tarifa_cliente, vigencia_desde,
          vigencia_hasta, activo, fuente
        ) values (
          v_tarifa.cuenta, coalesce(v_tarifa.cliente, v_tarifa.cuenta), v_tarifa.conc,
          v_tarifa.ubicacion, v_tarifa.ciudad, v_tarifa.tipo_unidad, v_tarifa.esquema,
          v_tarifa.zona, v_tarifa.variable, v_tarifa.pago_base, v_tarifa.tarifa_cliente,
          v_tarifa.vigencia_desde, v_tarifa.vigencia_hasta, coalesce(v_tarifa.activo, true),
          coalesce(v_tarifa.fuente, 'Panel')
        );
      else
        select * into v_tarifa
          from public.tarifas where id = v_solicitud.entidad_id for update;
        if not found then raise exception 'La tarifa fue eliminada antes de aprobar el cambio'; end if;
        select * into v_tarifa
          from jsonb_populate_record(v_tarifa, v_solicitud.datos_nuevos);
        update public.tarifas set
          cuenta = v_tarifa.cuenta, cliente = v_tarifa.cliente, conc = v_tarifa.conc,
          ubicacion = v_tarifa.ubicacion, ciudad = v_tarifa.ciudad,
          tipo_unidad = v_tarifa.tipo_unidad, esquema = v_tarifa.esquema,
          zona = v_tarifa.zona, variable = v_tarifa.variable,
          pago_base = v_tarifa.pago_base, tarifa_cliente = v_tarifa.tarifa_cliente,
          vigencia_desde = v_tarifa.vigencia_desde, vigencia_hasta = v_tarifa.vigencia_hasta,
          activo = v_tarifa.activo, fuente = v_tarifa.fuente
        where id = v_solicitud.entidad_id;
      end if;
    else
      if v_solicitud.entidad_id is null then
        select * into v_regla
          from jsonb_populate_record(null::public.reglas_penalizacion, v_solicitud.datos_nuevos);
        insert into public.reglas_penalizacion (
          cuenta, tipo_regla, aplica_a, valor, efectividad_menor_que,
          efectividad_minima, entregados_minimos, prioridad,
          excepcion_validacion_supervisor, tipo_unidad, esquema, vigencia_desde,
          descripcion, por_confirmar, activo
        ) values (
          v_regla.cuenta, v_regla.tipo_regla, v_regla.aplica_a, v_regla.valor,
          v_regla.efectividad_menor_que, v_regla.efectividad_minima,
          v_regla.entregados_minimos, v_regla.prioridad,
          coalesce(v_regla.excepcion_validacion_supervisor, false),
          v_regla.tipo_unidad, v_regla.esquema, coalesce(v_regla.vigencia_desde, current_date),
          v_regla.descripcion, coalesce(v_regla.por_confirmar, false),
          coalesce(v_regla.activo, true)
        );
      else
        select * into v_regla
          from public.reglas_penalizacion where id = v_solicitud.entidad_id for update;
        if not found then raise exception 'La regla fue eliminada antes de aprobar el cambio'; end if;
        select * into v_regla
          from jsonb_populate_record(v_regla, v_solicitud.datos_nuevos);
        update public.reglas_penalizacion set
          cuenta = v_regla.cuenta, tipo_regla = v_regla.tipo_regla,
          aplica_a = v_regla.aplica_a, valor = v_regla.valor,
          efectividad_menor_que = v_regla.efectividad_menor_que,
          efectividad_minima = v_regla.efectividad_minima,
          entregados_minimos = v_regla.entregados_minimos, prioridad = v_regla.prioridad,
          excepcion_validacion_supervisor = v_regla.excepcion_validacion_supervisor,
          tipo_unidad = v_regla.tipo_unidad, esquema = v_regla.esquema,
          vigencia_desde = v_regla.vigencia_desde, descripcion = v_regla.descripcion,
          por_confirmar = v_regla.por_confirmar, activo = v_regla.activo
        where id = v_solicitud.entidad_id;
      end if;
    end if;
  end if;

  update public.cambios_tarifario_solicitudes
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         resuelta_por = auth.uid(), resuelta_en = now(),
         nota_resolucion = nullif(btrim(p_nota), '')
   where id = p_id;
  return case when p_aprobar then 'aprobada' else 'rechazada' end;
end;
$$;

revoke all on function public.operativo_normalizar(text) from public, anon, authenticated;
revoke all on function public.operativo_rol_actual() from public, anon;
revoke all on function public.operativo_asignado_a(bigint, bigint, text) from public, anon;
revoke all on function public.operativo_cuenta_cliente(text) from public, anon, authenticated;
revoke all on function public.operativo_tarifa_asignada(text, text, uuid) from public, anon;
revoke all on function public.operativo_cuenta_asignada(text, uuid) from public, anon;
revoke all on function public.importar_asignaciones_operativas(jsonb) from public, anon, authenticated;
revoke all on function public.solicitar_cambio_tarifario(text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.resolver_cambio_tarifario(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.operativo_rol_actual() to authenticated;
grant execute on function public.operativo_asignado_a(bigint, bigint, text) to authenticated;
grant execute on function public.operativo_normalizar(text) to authenticated;
grant execute on function public.operativo_cuenta_cliente(text) to authenticated;
grant execute on function public.operativo_tarifa_asignada(text, text, uuid) to authenticated;
grant execute on function public.operativo_cuenta_asignada(text, uuid) to authenticated;
grant execute on function public.importar_asignaciones_operativas(jsonb) to authenticated;
grant execute on function public.solicitar_cambio_tarifario(text, bigint, jsonb) to authenticated;
grant execute on function public.resolver_cambio_tarifario(bigint, boolean, text) to authenticated;

-- Replace legacy tariff policies so a permissive policy cannot grant broader
-- access than the new CEDIS scope. Coordinators never write directly.
do $$
declare p record;
begin
  alter table public.tarifas enable row level security;
  alter table public.reglas_penalizacion enable row level security;
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('tarifas', 'reglas_penalizacion')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

grant select, insert, update, delete on public.tarifas, public.reglas_penalizacion to authenticated;
create policy tarifas_read_scoped on public.tarifas
  for select to authenticated
  using (
    public.mi_acceso_administrativo()
    and (
      public.operativo_rol_actual() in ('master', 'ops')
      or (
        public.operativo_rol_actual() in ('ih', 'coordinador')
        and public.operativo_tarifa_asignada(cuenta, ubicacion)
      )
    )
  );
create policy reglas_penalizacion_read_scoped on public.reglas_penalizacion
  for select to authenticated
  using (
    public.mi_acceso_administrativo()
    and (
      public.operativo_rol_actual() in ('master', 'ops')
      or (
        public.operativo_rol_actual() in ('ih', 'coordinador')
        and public.operativo_cuenta_cliente(cuenta) in (
          select public.operativo_cuenta_cliente(cl.nombre)
          from public.asignaciones_operativas a
          join public.clientes cl on cl.id = a.cliente_id
          where auth.uid() in (a.supervisor_id, a.coordinador_id)
        )
      )
    )
  );
create policy tarifas_write_master_ops on public.tarifas
  for all to authenticated
  using (public.mi_acceso_administrativo() and public.operativo_rol_actual() in ('master', 'ops'))
  with check (public.mi_acceso_administrativo() and public.operativo_rol_actual() in ('master', 'ops'));
create policy reglas_penalizacion_write_master_ops on public.reglas_penalizacion
  for all to authenticated
  using (public.mi_acceso_administrativo() and public.operativo_rol_actual() in ('master', 'ops'))
  with check (public.mi_acceso_administrativo() and public.operativo_rol_actual() in ('master', 'ops'));

-- Notifications are private to their explicit recipient, regardless of broad
-- legacy policies. Operational requests are routed to their assigned staff.
do $$
declare p record;
begin
  alter table public.notificaciones enable row level security;
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'notificaciones'
  loop
    execute format('drop policy %I on public.notificaciones', p.policyname);
  end loop;
end;
$$;
create policy notificaciones_read_own on public.notificaciones
  for select to authenticated using (usuario = auth.uid());
grant select on public.notificaciones to authenticated;

alter table public.rutas
  add column if not exists cliente_id bigint references public.clientes(id);
update public.rutas r
   set cliente_id = ce.cliente_id
  from public.cedis ce
 where ce.id = r.cedis_id and r.cliente_id is null;

create or replace function public.enriquecer_ruta_cliente_notificar_responsables()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  select ce.cliente_id into new.cliente_id
    from public.cedis ce
   where ce.id = new.cedis_id;
  if new.cliente_id is null then
    raise exception 'El CEDIS de la ruta no tiene un cliente asociado';
  end if;
  return new;
end;
$$;

create or replace function public.notificar_responsables_ruta()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_usuario uuid;
begin
  for v_usuario in
    select a.supervisor_id from public.asignaciones_operativas a
     where a.cliente_id = new.cliente_id and a.cedis_id = new.cedis_id
    union
    select a.coordinador_id from public.asignaciones_operativas a
     where a.cliente_id = new.cliente_id and a.cedis_id = new.cedis_id
  loop
    insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
    values (v_usuario, 'Nuevo registro de ruta',
      'Un driver registró una ruta en el CEDIS asignado.', 'ruta_registrada', 'ruta', new.id);
  end loop;
  if not found then
    insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
    select d.id, 'Ruta sin responsables asignados',
      'Se registró una ruta, pero el CEDIS no tiene responsables operativos importados.',
      'configuracion_operativa', 'ruta_sin_asignacion', new.id
      from public.drivers d where d.rol::text = 'master';
  end if;
  return new;
end;
$$;

drop trigger if exists rutas_responsables_notificar on public.rutas;
drop trigger if exists rutas_cliente_enriquecer on public.rutas;
create trigger rutas_cliente_enriquecer
before insert or update of cedis_id, cliente_id on public.rutas
for each row execute function public.enriquecer_ruta_cliente_notificar_responsables();
create trigger rutas_responsables_notificar
after insert on public.rutas
for each row execute function public.notificar_responsables_ruta();

create or replace function public.notificar_responsables_cancelacion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_cliente_id bigint; v_usuario uuid;
begin
  select ce.cliente_id into v_cliente_id from public.cedis ce where ce.id = new.cedis_id;
  if v_cliente_id is null then return new; end if;
  for v_usuario in
    select a.supervisor_id from public.asignaciones_operativas a
     where a.cliente_id = v_cliente_id and a.cedis_id = new.cedis_id
    union
    select a.coordinador_id from public.asignaciones_operativas a
     where a.cliente_id = v_cliente_id and a.cedis_id = new.cedis_id
  loop
    insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
    values (v_usuario, 'Nueva cancelación reportada',
      'Un driver reportó una cancelación en el CEDIS asignado.', 'cancelacion_nueva', 'cancelacion', new.id);
  end loop;
  if not found then
    insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
    select d.id, 'Cancelación sin responsables asignados',
      'Se reportó una cancelación, pero el CEDIS no tiene responsables operativos importados.',
      'configuracion_operativa', 'cancelacion_sin_asignacion', new.id
      from public.drivers d where d.rol::text = 'master';
  end if;
  return new;
end;
$$;
drop trigger if exists cancelaciones_responsables_notificar on public.cancelaciones;
create trigger cancelaciones_responsables_notificar
after insert on public.cancelaciones
for each row execute function public.notificar_responsables_cancelacion();

-- Deactivation requests have no CEDIS column, so their responsible staff are
-- scoped by the driver's configured default client.
create or replace function public.operativo_baja_asignada(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.drivers d
      join public.asignaciones_operativas a on a.cliente_id = d.cliente_default_id
     where d.id = p_driver_id
       and (
         (public.operativo_rol_actual() = 'ih' and a.supervisor_id = auth.uid())
         or (public.operativo_rol_actual() = 'coordinador' and a.coordinador_id = auth.uid())
       )
  );
$$;

create or replace function public.operativo_baja_propietaria(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null and exists (
    select 1 from public.drivers d
    join public.proveedores p on p.id = d.proveedor_id
    where d.id = p_driver_id and p.titular_id = auth.uid()
  );
$$;

create or replace function public.notificar_responsables_baja()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_cliente_id bigint; v_usuario uuid;
begin
  select d.cliente_default_id into v_cliente_id
    from public.drivers d where d.id = new.driver_id;
  for v_usuario in
    select a.supervisor_id from public.asignaciones_operativas a where a.cliente_id = v_cliente_id
    union
    select a.coordinador_id from public.asignaciones_operativas a where a.cliente_id = v_cliente_id
  loop
    insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
    values (v_usuario, 'Solicitud de desactivación de driver',
      'Hay una solicitud pendiente para un driver del cliente asignado.', 'baja', 'baja', new.id);
  end loop;
  if not found then
    insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
    select d.id, 'Solicitud de desactivación sin responsables asignados',
      'Una solicitud requiere atención, pero el cliente no tiene responsables operativos importados.',
      'configuracion_operativa', 'baja_sin_asignacion', new.id
      from public.drivers d where d.rol::text = 'master';
  end if;
  return new;
end;
$$;
drop trigger if exists bajas_responsables_notificar on public.bajas_solicitudes;
create trigger bajas_responsables_notificar
after insert on public.bajas_solicitudes
for each row execute function public.notificar_responsables_baja();

alter table public.cancelaciones
  add column if not exists aprob_supervisor boolean not null default false,
  add column if not exists aprob_coord boolean not null default false;

create or replace function public.resolver_cancelacion_asignada(
  p_id bigint,
  p_accion text,
  p_texto text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_cancelacion public.cancelaciones%rowtype;
  v_rol text;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo() then
    raise exception 'Debes iniciar sesión con una cuenta administrativa autorizada';
  end if;
  select * into v_cancelacion from public.cancelaciones where id = p_id for update;
  if not found then raise exception 'No se encontró la cancelación'; end if;
  v_rol := public.operativo_rol_actual();

  if v_rol in ('ih', 'coordinador') and not public.operativo_asignado_a(
    (select ce.cliente_id from public.cedis ce where ce.id = v_cancelacion.cedis_id),
    v_cancelacion.cedis_id,
    v_rol
  ) then
    raise exception 'No tienes asignado el cliente y CEDIS de esta cancelación';
  end if;

  if p_accion = 'aprobar' and v_cancelacion.ubicacion_validada = 'dentro' then
    if v_cancelacion.estatus = 'aprobada' then
      raise exception 'La cancelación ya fue aprobada';
    end if;
    if v_rol = 'ih' then
      update public.cancelaciones set aprob_supervisor = true where id = p_id;
    elsif v_rol = 'coordinador' then
      update public.cancelaciones set aprob_coord = true where id = p_id;
    else
      raise exception 'La aprobación dentro del CEDIS requiere un supervisor y un coordinador asignados';
    end if;
    select * into v_cancelacion from public.cancelaciones where id = p_id;
    if v_cancelacion.aprob_supervisor and v_cancelacion.aprob_coord then
      perform public.resolver_cancelacion(p_id, 'aprobar', null);
      return 'aprobada';
    end if;
    return case when v_cancelacion.aprob_supervisor
      then 'pendiente_coordinador' else 'pendiente_supervisor' end;
  end if;

  if v_rol not in ('ih', 'coordinador', 'master', 'ops') then
    raise exception 'Tu rol no puede resolver esta cancelación';
  end if;
  perform public.resolver_cancelacion(p_id, p_accion, p_texto);
  return case when p_accion = 'aprobar' then 'aprobada' else p_accion end;
end;
$$;

create or replace function public.resolver_desactivacion_asignada(
  p_id bigint,
  p_aprobar boolean,
  p_nota text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_solicitud public.bajas_solicitudes%rowtype;
  v_resultado text;
  v_rol text;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo() then
    raise exception 'Debes iniciar sesión con una cuenta administrativa autorizada';
  end if;
  select * into v_solicitud from public.bajas_solicitudes where id = p_id for update;
  if not found then raise exception 'No se encontró la solicitud'; end if;
  v_rol := public.operativo_rol_actual();
  if v_rol in ('ih', 'coordinador') and not public.operativo_baja_asignada(v_solicitud.driver_id) then
    raise exception 'No tienes asignado el cliente del driver de esta solicitud';
  end if;
  if v_rol not in ('ih', 'coordinador', 'master', 'ops') then
    raise exception 'Tu rol no puede resolver esta solicitud';
  end if;
  select public.resolver_desactivacion_driver(p_id, p_aprobar, p_nota) into v_resultado;
  return v_resultado;
end;
$$;

-- Scope route and cancellation reads to the assigned client/CEDIS while
-- preserving drivers' own records and global Operations access.
do $$
declare p record;
begin
  alter table public.rutas enable row level security;
  alter table public.cancelaciones enable row level security;
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('rutas', 'cancelaciones')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;
create policy rutas_read_scoped on public.rutas
  for select to authenticated
  using (
    driver_id = auth.uid()
    or (
      public.mi_acceso_administrativo()
      and (
        public.operativo_rol_actual() in ('master', 'ops', 'finanzas')
        or public.operativo_asignado_a(cliente_id, cedis_id)
      )
    )
  );
create policy cancelaciones_read_scoped on public.cancelaciones
  for select to authenticated
  using (
    driver_id = auth.uid()
    or (
      public.mi_acceso_administrativo()
      and (
        public.operativo_rol_actual() in ('master', 'ops', 'finanzas')
        or public.operativo_asignado_a(
          (select ce.cliente_id from public.cedis ce where ce.id = cancelaciones.cedis_id),
          cancelaciones.cedis_id
        )
      )
    )
  );
create policy rutas_insert_own on public.rutas
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and exists (select 1 from public.cedis ce where ce.id = cedis_id)
  );
create policy rutas_update_own on public.rutas
  for update to authenticated
  using (driver_id = auth.uid())
  with check (
    driver_id = auth.uid()
    and exists (select 1 from public.cedis ce where ce.id = cedis_id)
  );
create policy cancelaciones_insert_own on public.cancelaciones
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and exists (select 1 from public.cedis ce where ce.id = cedis_id)
  );
grant select, insert, update on public.rutas to authenticated;
grant select, insert on public.cancelaciones to authenticated;

do $$
declare p record;
begin
  alter table public.bajas_solicitudes enable row level security;
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'bajas_solicitudes'
  loop
    execute format('drop policy %I on public.bajas_solicitudes', p.policyname);
  end loop;
end;
$$;
create policy bajas_solicitudes_read_scoped on public.bajas_solicitudes
  for select to authenticated
  using (
    (public.mi_acceso_administrativo() and (
      public.operativo_rol_actual() in ('master', 'ops')
      or public.operativo_baja_asignada(driver_id)
    ))
    or public.operativo_baja_propietaria(driver_id)
  );
grant select on public.bajas_solicitudes to authenticated;

do $$
declare v_funcion regprocedure;
begin
  for v_funcion in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'resolver_cancelacion' and p.pronargs = 3
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_funcion);
  end loop;
end;
$$;
do $$
declare v_funcion regprocedure;
begin
  for v_funcion in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'resolver_desactivacion_driver' and p.pronargs = 3
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_funcion);
  end loop;
end;
$$;
revoke all on function public.resolver_cancelacion_asignada(bigint, text, text) from public, anon, authenticated;
grant execute on function public.resolver_cancelacion_asignada(bigint, text, text) to authenticated;
revoke all on function public.operativo_baja_asignada(uuid) from public, anon;
revoke all on function public.operativo_baja_propietaria(uuid) from public, anon;
grant execute on function public.operativo_baja_asignada(uuid) to authenticated;
grant execute on function public.operativo_baja_propietaria(uuid) to authenticated;
revoke all on function public.resolver_desactivacion_asignada(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.resolver_desactivacion_asignada(bigint, boolean, text) to authenticated;

notify pgrst, 'reload schema';
commit;

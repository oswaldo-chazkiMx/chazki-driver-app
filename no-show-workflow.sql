begin;

create table if not exists public.no_show_casos (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id),
  proveedor_id bigint references public.proveedores(id),
  cliente_id bigint not null references public.clientes(id),
  cedis_id bigint not null references public.cedis(id),
  cliente_nombre text not null,
  cedis_nombre text not null,
  driver_nombre text not null,
  cuenta text not null,
  tipo_unidad text not null,
  fecha_servicio date not null,
  entregas_contratadas integer check (entregas_contratadas is null or entregas_contratadas > 0),
  tarifa_servicio_id bigint not null references public.tarifas(id),
  tarifa_no_show_id bigint references public.tarifas(id),
  pago_penalizacion_id bigint unique references public.pagos(id),
  pago_reversion_id bigint unique references public.pagos(id),
  valor_servicio_contratado numeric(12,2) not null check (valor_servicio_contratado >= 0),
  metodo_calculo text not null,
  observaciones_supervisor text not null check (length(observaciones_supervisor) <= 200),
  monto_penalizacion numeric(12,2) not null check (monto_penalizacion >= 0),
  estado text not null default 'reportado'
    check (estado in ('reportado','apelado','apelacion_aceptada','apelacion_rechazada')),
  apelacion text check (apelacion is null or length(apelacion) <= 300),
  apelacion_en timestamptz,
  vence_apelacion_en timestamptz not null default (now() + interval '6 hours'),
  resolucion text,
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz,
  creado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now()
);

alter table public.no_show_casos
  add column if not exists pago_penalizacion_id bigint unique references public.pagos(id),
  add column if not exists pago_reversion_id bigint unique references public.pagos(id);

create index if not exists no_show_casos_driver_creado_idx
  on public.no_show_casos (driver_id, creado_en desc);
create index if not exists no_show_casos_proveedor_creado_idx
  on public.no_show_casos (proveedor_id, creado_en desc);
create index if not exists no_show_casos_apelacion_idx
  on public.no_show_casos (vence_apelacion_en)
  where estado = 'apelado';

create table if not exists public.no_show_eventos (
  id bigint generated always as identity primary key,
  caso_id uuid not null references public.no_show_casos(id),
  tipo text not null check (tipo in ('reportado','apelacion_driver','apelacion_aceptada','apelacion_rechazada')),
  mensaje text not null default '',
  actor_id uuid references auth.users(id),
  creado_en timestamptz not null default now()
);
create index if not exists no_show_eventos_timeline_idx
  on public.no_show_eventos (caso_id, creado_en, id);

alter table public.no_show_casos enable row level security;
alter table public.no_show_eventos enable row level security;
grant select on public.no_show_casos, public.no_show_eventos to authenticated;

create or replace function public.no_show_es_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.mi_acceso_administrativo()
    and exists (select 1 from public.drivers where id = auth.uid() and rol = 'ih');
$$;

create or replace function public.no_show_es_coordinador()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.mi_acceso_administrativo()
    and exists (select 1 from public.drivers where id = auth.uid() and rol in ('master','ops','coordinador'));
$$;

create or replace function public.no_show_es_flotillero()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (select 1 from public.drivers where id = auth.uid() and rol = 'flotillero');
$$;

create or replace function public.no_show_texto_inapropiado(p_texto text)
returns boolean
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v_texto text;
begin
  v_texto := regexp_replace(
    translate(lower(coalesce(p_texto, '')), 'áéíóúü', 'aeiouu'),
    '[^a-z0-9]+', ' ', 'g'
  );
  return v_texto ~ '(^| )(puta|puto|putas|putos|mierda|chingar|chingado|chingada|chingados|chingadas|chingue|chingues|verga|vergas|pendejo|pendeja|pendejos|pendejas|culero|culera|culeros|culeras|cabron|cabrona|cabrones|cabronas|pinche|pinches|jodido|jodida|joder|maricon|maricona|maricones|fuck|fucking|shit|bitch|asshole|bastard)($| )';
end;
$$;

revoke all on function public.no_show_es_supervisor() from public, anon;
revoke all on function public.no_show_es_coordinador() from public, anon;
revoke all on function public.no_show_es_flotillero() from public, anon;
revoke all on function public.no_show_texto_inapropiado(text) from public, anon, authenticated;
grant execute on function public.no_show_es_supervisor() to authenticated;
grant execute on function public.no_show_es_coordinador() to authenticated;
grant execute on function public.no_show_es_flotillero() to authenticated;

drop policy if exists no_show_casos_read_scoped on public.no_show_casos;
create policy no_show_casos_read_scoped on public.no_show_casos
  for select to authenticated
  using (
    driver_id = auth.uid()
    or public.no_show_es_coordinador()
    or (creado_por = auth.uid() and public.no_show_es_supervisor())
    or (
      public.no_show_es_flotillero()
      and proveedor_id = (select proveedor_id from public.drivers where id = auth.uid())
    )
  );

drop policy if exists no_show_eventos_read_scoped on public.no_show_eventos;
create policy no_show_eventos_read_scoped on public.no_show_eventos
  for select to authenticated
  using (
    exists (
      select 1
      from public.no_show_casos c
      where c.id = caso_id
        and (
          c.driver_id = auth.uid()
          or public.no_show_es_coordinador()
          or (c.creado_por = auth.uid() and public.no_show_es_supervisor())
          or (
            public.no_show_es_flotillero()
            and c.proveedor_id = (select proveedor_id from public.drivers where id = auth.uid())
          )
        )
    )
  );

create or replace function public.crear_reporte_no_show(
  p_driver_id uuid,
  p_cedis_id bigint,
  p_fecha_servicio date,
  p_observaciones text,
  p_entregas_contratadas integer default null,
  p_monto_manual numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caso_id uuid;
  v_pago_penalizacion_id bigint;
  v_driver record;
  v_cedis record;
  v_tarifa_servicio record;
  v_tarifa_no_show record;
  v_regla record;
  v_cuenta text;
  v_fecha date;
  v_valor_servicio numeric(12,2);
  v_base_penalizacion numeric(12,2);
  v_penalizacion numeric(12,2);
  v_metodo text;
  v_paquetes boolean;
  v_tiene_tarifa_no_show boolean := false;
begin
  if auth.uid() is null or not public.no_show_es_supervisor() then
    raise exception 'Solo un supervisor autorizado puede reportar un NO SHOW';
  end if;
  if p_driver_id is null or p_cedis_id is null or p_fecha_servicio is null
     or p_observaciones is null or length(btrim(p_observaciones)) not between 1 and 200 then
    raise exception 'Completa driver, CEDIS, fecha y observaciones (máximo 200 caracteres)';
  end if;
  if public.no_show_texto_inapropiado(p_observaciones) then
    raise exception 'Las observaciones contienen lenguaje no permitido';
  end if;

  v_fecha := p_fecha_servicio;
  if v_fecha > current_date then
    raise exception 'La fecha del servicio no puede ser futura';
  end if;

  select d.id, d.nombre, d.proveedor_id, v.tipo as tipo_unidad
    into v_driver
  from public.drivers d
  left join lateral (
    select tipo
    from public.vehiculos
    where driver_id = d.id and activo
    order by id desc
    limit 1
  ) v on true
  where d.id = p_driver_id and d.rol = 'driver';
  if not found then raise exception 'El driver seleccionado no existe'; end if;
  if v_driver.tipo_unidad is null then
    raise exception 'El driver no tiene un vehículo activo; registra su vehículo antes de calcular la penalización';
  end if;

  select ce.id, ce.nombre, ce.cliente_id, cl.nombre as cliente_nombre
    into v_cedis
  from public.cedis ce
  join public.clientes cl on cl.id = ce.cliente_id
  where ce.id = p_cedis_id;
  if not found then raise exception 'El CEDIS seleccionado no existe'; end if;

  v_cuenta := case upper(btrim(v_cedis.cliente_nombre))
    when 'MERCADO LIBRE' then 'MELI'
    when 'COPPEL BT' then 'COPPEL'
    else upper(btrim(v_cedis.cliente_nombre))
  end;

  select t.*
    into v_tarifa_servicio
  from public.tarifas t
  where t.activo
    and t.cuenta = v_cuenta
    and upper(coalesce(t.esquema, '')) <> 'NO SHOW'
    and regexp_replace(upper(coalesce(t.tipo_unidad, '')), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(v_driver.tipo_unidad), '[^A-Z0-9]', '', 'g')
    and t.vigencia_desde <= v_fecha
    and (t.vigencia_hasta is null or t.vigencia_hasta >= v_fecha)
    and (nullif(btrim(t.ubicacion), '') is null or upper(btrim(t.ubicacion)) = upper(btrim(v_cedis.nombre)) or upper(btrim(coalesce(t.ciudad, ''))) = upper(btrim(v_cedis.nombre)))
  order by
    case when upper(btrim(coalesce(t.ubicacion, ''))) = upper(btrim(v_cedis.nombre)) then 0
         when upper(btrim(coalesce(t.ciudad, ''))) = upper(btrim(v_cedis.nombre)) then 1
         else 2 end,
    case when upper(t.esquema) = 'RUTA' then 0 else 1 end,
    t.vigencia_desde desc,
    t.id desc
  limit 1;
  if not found then
    raise exception 'No hay una tarifa normal activa con pago al driver para % / % / % en la fecha indicada',
      v_cedis.cliente_nombre, v_cedis.nombre, v_driver.tipo_unidad;
  end if;
  if v_tarifa_servicio.pago_base is null then
    raise exception 'La tarifa normal aplicable no tiene un pago base configurado';
  end if;

  v_paquetes :=
    (v_tarifa_servicio.cuenta = 'CUBBO' and v_tarifa_servicio.esquema = 'PAQUETE')
    or (v_tarifa_servicio.cuenta = 'COPPEL' and v_tarifa_servicio.esquema <> 'RUTA')
    or (v_tarifa_servicio.cuenta = 'LIVERPOOL' and v_tarifa_servicio.esquema = 'PAQUETE')
    or (v_tarifa_servicio.cuenta = 'MELI' and v_tarifa_servicio.esquema in ('AMBULANCIA MELI PAQUETE','AMBULANCIA INTERNA'))
    or (v_tarifa_servicio.cuenta = 'ESTAFETA' and v_tarifa_servicio.esquema = 'PAQUETE');
  if v_paquetes and coalesce(p_entregas_contratadas, 0) <= 0 then
    raise exception 'Indica la cantidad de entregas contratadas para calcular el valor total del servicio';
  end if;
  if v_paquetes and p_entregas_contratadas > 10000 then
    raise exception 'La cantidad de entregas contratadas excede el límite permitido';
  end if;
  v_valor_servicio := round(v_tarifa_servicio.pago_base * case when v_paquetes then p_entregas_contratadas else 1 end, 2);

  select t.*
    into v_tarifa_no_show
  from public.tarifas t
  where t.activo
    and t.cuenta = v_cuenta
    and upper(coalesce(t.esquema, '')) = 'NO SHOW'
    and regexp_replace(upper(coalesce(t.tipo_unidad, '')), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(v_driver.tipo_unidad), '[^A-Z0-9]', '', 'g')
    and t.vigencia_desde <= v_fecha
    and (t.vigencia_hasta is null or t.vigencia_hasta >= v_fecha)
    and (nullif(btrim(t.ubicacion), '') is null or upper(btrim(t.ubicacion)) = upper(btrim(v_cedis.nombre)) or upper(btrim(coalesce(t.ciudad, ''))) = upper(btrim(v_cedis.nombre)))
  order by
    case when upper(btrim(coalesce(t.ubicacion, ''))) = upper(btrim(v_cedis.nombre)) then 0
         when upper(btrim(coalesce(t.ciudad, ''))) = upper(btrim(v_cedis.nombre)) then 1
         else 2 end,
    t.vigencia_desde desc,
    t.id desc
  limit 1;
  v_tiene_tarifa_no_show := found;

  select g.tipo_regla, g.valor, g.descripcion
    into v_regla
  from public.reglas_penalizacion g
  where g.activo
    and not coalesce(g.por_confirmar, false)
    and g.cuenta = v_cuenta
    and g.aplica_a = 'pago'
    and g.tipo_regla in ('porcentaje_descuento','pago_fijo')
    and upper(coalesce(g.esquema, '')) = 'NO SHOW'
    and (g.tipo_unidad is null or regexp_replace(upper(g.tipo_unidad), '[^A-Z0-9]', '', 'g')
       = regexp_replace(upper(v_driver.tipo_unidad), '[^A-Z0-9]', '', 'g'))
    and g.vigencia_desde <= v_fecha
  order by g.prioridad
  limit 1;

  if found then
    if v_tiene_tarifa_no_show and v_tarifa_no_show.pago_base is null then
      raise exception 'La tarifa NO SHOW aplicable no tiene un pago base configurado';
    end if;
    v_base_penalizacion := case
      when v_tiene_tarifa_no_show then coalesce(v_tarifa_no_show.pago_base, 0)
      else v_valor_servicio
    end;
    v_penalizacion := case v_regla.tipo_regla
      when 'porcentaje_descuento' then round(v_base_penalizacion * v_regla.valor, 2)
      else greatest(round(v_base_penalizacion - v_regla.valor, 2), 0)
    end;
    v_metodo := 'regla_no_show:' || coalesce(v_regla.descripcion, v_regla.tipo_regla);
  elsif v_tiene_tarifa_no_show then
    if v_tarifa_no_show.pago_base is null then
      raise exception 'La tarifa NO SHOW aplicable no tiene un pago base configurado';
    end if;
    v_penalizacion := round(v_tarifa_no_show.pago_base, 2);
    v_metodo := 'tarifa_no_show';
  else
    if p_monto_manual is null or p_monto_manual <= 0 then
      raise exception 'No hay tarifa ni regla NO SHOW; captura un importe manual para continuar';
    end if;
    v_penalizacion := round(p_monto_manual, 2);
    v_metodo := 'manual';
  end if;

  if v_penalizacion < 0 or v_penalizacion > v_valor_servicio then
    raise exception 'La penalización (%) no puede exceder el valor contratado del servicio (%)',
      to_char(v_penalizacion, 'FM$999,999,999,990.00'),
      to_char(v_valor_servicio, 'FM$999,999,999,990.00');
  end if;

  insert into public.no_show_casos (
    driver_id, proveedor_id, cliente_id, cedis_id, cliente_nombre, cedis_nombre,
    driver_nombre, cuenta, tipo_unidad, fecha_servicio, entregas_contratadas,
    tarifa_servicio_id, tarifa_no_show_id, valor_servicio_contratado,
    metodo_calculo, observaciones_supervisor, monto_penalizacion, creado_por
  ) values (
    p_driver_id, v_driver.proveedor_id, v_cedis.cliente_id, v_cedis.id,
    v_cedis.cliente_nombre, v_cedis.nombre, v_driver.nombre, v_cuenta,
    v_driver.tipo_unidad, v_fecha, case when v_paquetes then p_entregas_contratadas else null end,
    v_tarifa_servicio.id, case when v_tiene_tarifa_no_show then v_tarifa_no_show.id else null end, v_valor_servicio,
    v_metodo, btrim(p_observaciones), v_penalizacion, auth.uid()
  ) returning id into v_caso_id;

  if v_penalizacion > 0 then
    insert into public.pagos (driver_id, proveedor_id, ruta_id, concepto, monto, fecha, estatus)
    values (p_driver_id, v_driver.proveedor_id, null, 'ajuste', -v_penalizacion, current_date, 'pendiente')
    returning id into v_pago_penalizacion_id;

    update public.no_show_casos
    set pago_penalizacion_id = v_pago_penalizacion_id
    where id = v_caso_id;
  end if;

  insert into public.no_show_eventos (caso_id, tipo, mensaje, actor_id)
  values (v_caso_id, 'reportado', btrim(p_observaciones), auth.uid());
  return v_caso_id;
end;
$$;

create or replace function public.apelar_no_show(
  p_caso_id uuid,
  p_contestacion text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caso public.no_show_casos%rowtype;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para apelar'; end if;
  if p_contestacion is null or length(btrim(p_contestacion)) not between 1 and 300 then
    raise exception 'Escribe una contestación de hasta 300 caracteres';
  end if;
  if public.no_show_texto_inapropiado(p_contestacion) then
    raise exception 'La contestación contiene lenguaje no permitido';
  end if;

  select * into v_caso
  from public.no_show_casos
  where id = p_caso_id and driver_id = auth.uid()
  for update;
  if not found then raise exception 'No se encontró el NO SHOW de tu cuenta'; end if;
  if v_caso.estado <> 'reportado' or v_caso.apelacion_en is not null then
    raise exception 'Este NO SHOW ya fue apelado o ya no admite apelaciones';
  end if;
  if v_caso.vence_apelacion_en is null or v_caso.vence_apelacion_en <= now() then
    raise exception 'El plazo de 6 horas para apelar ya venció';
  end if;

  update public.no_show_casos
  set estado = 'apelado',
      apelacion = btrim(p_contestacion),
      apelacion_en = now()
  where id = p_caso_id;

  insert into public.no_show_eventos (caso_id, tipo, mensaje, actor_id)
  values (p_caso_id, 'apelacion_driver', btrim(p_contestacion), auth.uid());
end;
$$;

create or replace function public.resolver_apelacion_no_show(
  p_caso_id uuid,
  p_accion text,
  p_mensaje text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caso public.no_show_casos%rowtype;
  v_tipo text;
  v_pago_reversion_id bigint;
begin
  if auth.uid() is null or not public.no_show_es_coordinador() then
    raise exception 'Solo Coordinación puede resolver apelaciones de NO SHOW';
  end if;
  if p_accion not in ('aceptar','rechazar') then
    raise exception 'La resolución debe ser aceptar o rechazar';
  end if;
  if p_mensaje is not null and length(p_mensaje) > 500 then
    raise exception 'La nota de resolución no puede exceder 500 caracteres';
  end if;
  if public.no_show_texto_inapropiado(p_mensaje) then
    raise exception 'La nota de resolución contiene lenguaje no permitido';
  end if;

  select * into v_caso
  from public.no_show_casos
  where id = p_caso_id
  for update;
  if not found then raise exception 'No se encontró el caso NO SHOW'; end if;
  if v_caso.estado <> 'apelado' then
    raise exception 'Este caso no tiene una apelación pendiente';
  end if;

  if p_accion = 'aceptar' then
    if v_caso.monto_penalizacion > 0 then
      insert into public.pagos (driver_id, proveedor_id, ruta_id, concepto, monto, fecha, estatus)
      values (v_caso.driver_id, v_caso.proveedor_id, null, 'ajuste', v_caso.monto_penalizacion, current_date, 'pendiente')
      returning id into v_pago_reversion_id;
    end if;
    update public.no_show_casos
    set estado = 'apelacion_aceptada',
        resolucion = nullif(btrim(p_mensaje), ''),
        resuelto_por = auth.uid(),
        resuelto_en = now(),
        pago_reversion_id = v_pago_reversion_id
    where id = p_caso_id;
    v_tipo := 'apelacion_aceptada';
  else
    update public.no_show_casos
    set estado = 'apelacion_rechazada',
        resolucion = nullif(btrim(p_mensaje), ''),
        resuelto_por = auth.uid(),
        resuelto_en = now()
    where id = p_caso_id;
    v_tipo := 'apelacion_rechazada';
  end if;

  insert into public.no_show_eventos (caso_id, tipo, mensaje, actor_id)
  values (
    p_caso_id, v_tipo,
    coalesce(nullif(btrim(p_mensaje), ''), case when p_accion = 'aceptar' then 'Apelación aceptada; penalización revertida.' else 'Apelación rechazada; penalización vigente.' end),
    auth.uid()
  );
end;
$$;

revoke all on function public.crear_reporte_no_show(uuid, bigint, date, text, integer, numeric) from public, anon, authenticated;
revoke all on function public.apelar_no_show(uuid, text) from public, anon, authenticated;
revoke all on function public.resolver_apelacion_no_show(uuid, text, text) from public, anon, authenticated;
grant execute on function public.crear_reporte_no_show(uuid, bigint, date, text, integer, numeric) to authenticated;
grant execute on function public.apelar_no_show(uuid, text) to authenticated;
grant execute on function public.resolver_apelacion_no_show(uuid, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';

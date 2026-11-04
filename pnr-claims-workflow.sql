begin;

create table if not exists public.pnr_reclamos (
  id uuid primary key default gen_random_uuid(),
  pnr text not null check (length(btrim(pnr)) between 1 and 120),
  driver_id uuid not null references public.drivers(id),
  cliente text not null check (length(btrim(cliente)) between 1 and 200),
  ruta_id text,
  detalle text not null check (length(btrim(detalle)) between 1 and 5000),
  monto numeric(12,2) not null check (monto > 0),
  estado text not null default 'esperando_driver'
    check (estado in ('esperando_driver','revision','esperando_soporte','cerrada_sin_cargo','cerrada_con_cargo')),
  intentos smallint not null default 0 check (intentos between 0 and 2),
  vence_en timestamptz not null default (now() + interval '24 hours'),
  creado_por uuid not null references auth.users(id),
  creado_por_email text,
  creado_en timestamptz not null default now(),
  cerrado_en timestamptz
);

create index if not exists pnr_reclamos_driver_creado_idx
  on public.pnr_reclamos (driver_id, creado_en desc);
create index if not exists pnr_reclamos_vencimiento_idx
  on public.pnr_reclamos (vence_en)
  where estado in ('esperando_driver','esperando_soporte');

create table if not exists public.pnr_reclamo_eventos (
  id bigint generated always as identity primary key,
  reclamo_id uuid not null references public.pnr_reclamos(id),
  tipo text not null check (tipo in (
    'creado','respuesta_driver','solicitud_soporte','evidencia_adicional',
      'evidencia_aceptada','evidencia_rechazada','vencido','descuento_aplicado'
  )),
  mensaje text not null default '' check (length(mensaje) <= 5000),
  adjuntos text[] not null default '{}',
  actor_id uuid references auth.users(id),
  actor_email text,
  creado_en timestamptz not null default now()
);
create index if not exists pnr_reclamo_eventos_timeline_idx
  on public.pnr_reclamo_eventos (reclamo_id, creado_en, id);

create table if not exists public.pnr_descuentos (
  reclamo_id uuid primary key references public.pnr_reclamos(id),
  driver_id uuid not null references public.drivers(id),
  monto numeric(12,2) not null check (monto > 0),
  saldo_pendiente numeric(12,2) not null check (saldo_pendiente >= 0),
  monto_aplicado numeric(12,2) not null default 0 check (monto_aplicado >= 0),
  creado_en timestamptz not null default now(),
  aplicado_en timestamptz
);

create table if not exists public.pnr_descuentos_aplicaciones (
  id bigint generated always as identity primary key,
  reclamo_id uuid not null references public.pnr_reclamos(id),
  driver_id uuid not null references public.drivers(id),
  ruta_id text not null,
  monto numeric(12,2) not null check (monto > 0),
  aplicado_en timestamptz not null default now()
);
create index if not exists pnr_descuentos_aplicaciones_driver_idx
  on public.pnr_descuentos_aplicaciones (driver_id, aplicado_en desc);

alter table public.pnr_reclamos enable row level security;
alter table public.pnr_reclamo_eventos enable row level security;
alter table public.pnr_descuentos enable row level security;
alter table public.pnr_descuentos_aplicaciones enable row level security;

grant select on public.pnr_reclamos, public.pnr_reclamo_eventos,
  public.pnr_descuentos, public.pnr_descuentos_aplicaciones to authenticated;

drop policy if exists pnr_reclamos_read_own_or_admin on public.pnr_reclamos;
create policy pnr_reclamos_read_own_or_admin on public.pnr_reclamos
  for select to authenticated
  using (driver_id = auth.uid() or public.mi_acceso_administrativo());

drop policy if exists pnr_eventos_read_own_or_admin on public.pnr_reclamo_eventos;
create policy pnr_eventos_read_own_or_admin on public.pnr_reclamo_eventos
  for select to authenticated
  using (
    exists (
      select 1 from public.pnr_reclamos r
      where r.id = reclamo_id
        and (r.driver_id = auth.uid() or public.mi_acceso_administrativo())
    )
  );

drop policy if exists pnr_descuentos_read_own_or_admin on public.pnr_descuentos;
create policy pnr_descuentos_read_own_or_admin on public.pnr_descuentos
  for select to authenticated
  using (driver_id = auth.uid() or public.mi_acceso_administrativo());

drop policy if exists pnr_aplicaciones_read_own_or_admin on public.pnr_descuentos_aplicaciones;
create policy pnr_aplicaciones_read_own_or_admin on public.pnr_descuentos_aplicaciones
  for select to authenticated
  using (driver_id = auth.uid() or public.mi_acceso_administrativo());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pnr-evidence', 'pnr-evidence', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pnr_evidence_read_own_or_admin on storage.objects;
create policy pnr_evidence_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pnr-evidence'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.mi_acceso_administrativo()
    )
  );

drop policy if exists pnr_evidence_insert_own_or_admin on storage.objects;
create policy pnr_evidence_insert_own_or_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pnr-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.crear_reclamo_pnr(
  p_pnr text,
  p_driver_id uuid,
  p_cliente text,
  p_ruta_id text,
  p_detalle text,
  p_monto numeric,
  p_adjuntos text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or not exists (select 1 from public.drivers where id = auth.uid() and rol in ('master','ops','coordinador')) then
    raise exception 'No tienes autorización para crear reclamos PNR';
  end if;
  if p_pnr is null or length(btrim(p_pnr)) not between 1 and 120
     or p_cliente is null or length(btrim(p_cliente)) not between 1 and 200
     or p_detalle is null or length(btrim(p_detalle)) not between 1 and 5000
     or p_monto is null or p_monto <= 0 then
    raise exception 'Completa PNR, cliente, detalle e importe válido';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id and rol = 'driver') then
    raise exception 'El driver seleccionado no existe o no es una cuenta de driver';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_adjuntos, '{}')) as path
    where path not like auth.uid()::text || '/%'
  ) then raise exception 'Los archivos adjuntos no pertenecen a tu sesión'; end if;

  insert into public.pnr_reclamos (
    pnr, driver_id, cliente, ruta_id, detalle, monto, creado_por, creado_por_email
  ) values (
    btrim(p_pnr), p_driver_id, btrim(p_cliente), nullif(btrim(p_ruta_id), ''),
    btrim(p_detalle), p_monto, auth.uid(), auth.jwt() ->> 'email'
  ) returning id into v_id;

  insert into public.pnr_reclamo_eventos (reclamo_id, tipo, mensaje, adjuntos, actor_id, actor_email)
  values (v_id, 'creado', btrim(p_detalle), coalesce(p_adjuntos, '{}'), auth.uid(), auth.jwt() ->> 'email');
  return v_id;
end;
$$;

create or replace function public.responder_reclamo_pnr(
  p_reclamo_id uuid,
  p_mensaje text,
  p_adjuntos text[] default '{}'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reclamo public.pnr_reclamos%rowtype;
  v_evento text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_reclamo from public.pnr_reclamos
  where id = p_reclamo_id and driver_id = auth.uid()
  for update;
  if not found then raise exception 'No se encontró el reclamo'; end if;
  if v_reclamo.estado not in ('esperando_driver','esperando_soporte') or v_reclamo.vence_en <= now() then
    raise exception 'El plazo para responder venció o el reclamo ya está cerrado';
  end if;
  if p_mensaje is null or length(btrim(p_mensaje)) not between 1 and 5000 then
    raise exception 'Escribe una respuesta de hasta 5000 caracteres';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_adjuntos, '{}')) as path
    where path not like auth.uid()::text || '/%'
  ) then raise exception 'Los archivos adjuntos no pertenecen a tu sesión'; end if;

  v_evento := case when v_reclamo.estado = 'esperando_driver' then 'respuesta_driver' else 'evidencia_adicional' end;
  update public.pnr_reclamos
  set estado = 'revision', intentos = intentos + 1, vence_en = null
  where id = p_reclamo_id;
  insert into public.pnr_reclamo_eventos (reclamo_id, tipo, mensaje, adjuntos, actor_id, actor_email)
  values (p_reclamo_id, v_evento, btrim(p_mensaje), coalesce(p_adjuntos, '{}'), auth.uid(), auth.jwt() ->> 'email');
  return true;
end;
$$;

create or replace function public.resolver_reclamo_pnr(
  p_reclamo_id uuid,
  p_accion text,
  p_mensaje text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reclamo public.pnr_reclamos%rowtype;
  v_evento text;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or not exists (select 1 from public.drivers where id = auth.uid() and rol in ('master','ops','coordinador')) then
    raise exception 'No tienes autorización para resolver reclamos PNR';
  end if;
  select * into v_reclamo from public.pnr_reclamos where id = p_reclamo_id for update;
  if not found or v_reclamo.estado <> 'revision' then
    raise exception 'El reclamo no está disponible para revisión';
  end if;

  if p_accion = 'aceptar' then
    update public.pnr_reclamos set estado = 'cerrada_sin_cargo', vence_en = null, cerrado_en = now()
    where id = p_reclamo_id;
    v_evento := 'evidencia_aceptada';
  elsif p_accion = 'solicitar_soporte' and v_reclamo.intentos = 1 then
    update public.pnr_reclamos
    set estado = 'esperando_soporte', vence_en = now() + interval '24 hours'
    where id = p_reclamo_id;
    v_evento := 'solicitud_soporte';
  elsif p_accion = 'rechazar' and v_reclamo.intentos = 2 then
    update public.pnr_reclamos set estado = 'cerrada_con_cargo', vence_en = null, cerrado_en = now()
    where id = p_reclamo_id;
    insert into public.pnr_descuentos (reclamo_id, driver_id, monto, saldo_pendiente)
    values (p_reclamo_id, v_reclamo.driver_id, v_reclamo.monto, v_reclamo.monto)
    on conflict (reclamo_id) do nothing;
    v_evento := 'evidencia_rechazada';
  else
    raise exception 'Acción no permitida para la etapa actual del reclamo';
  end if;

  insert into public.pnr_reclamo_eventos (reclamo_id, tipo, mensaje, actor_id, actor_email)
  values (p_reclamo_id, v_evento, coalesce(nullif(btrim(p_mensaje), ''), ''), auth.uid(), auth.jwt() ->> 'email');
  return true;
end;
$$;

create or replace function public.cerrar_pnrs_vencidos()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reclamo public.pnr_reclamos%rowtype;
  v_cerrados integer := 0;
begin
  for v_reclamo in
    select * from public.pnr_reclamos
    where estado in ('esperando_driver','esperando_soporte') and vence_en <= now()
    for update skip locked
  loop
    update public.pnr_reclamos set estado = 'cerrada_con_cargo', vence_en = null, cerrado_en = now()
    where id = v_reclamo.id;
    insert into public.pnr_descuentos (reclamo_id, driver_id, monto, saldo_pendiente)
    values (v_reclamo.id, v_reclamo.driver_id, v_reclamo.monto, v_reclamo.monto)
    on conflict (reclamo_id) do nothing;
    insert into public.pnr_reclamo_eventos (reclamo_id, tipo, mensaje)
    values (v_reclamo.id, 'vencido', 'El plazo de 24 horas venció sin una respuesta válida.');
    v_cerrados := v_cerrados + 1;
  end loop;
  return v_cerrados;
end;
$$;

create or replace function public.aplicar_descuentos_pnr_a_pago()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_descuento record;
  v_disponible numeric(12,2);
  v_aplicar numeric(12,2);
  v_total_aplicado numeric(12,2) := 0;
begin
  if new.concepto <> 'servicio' or new.estatus <> 'pendiente' or new.monto <= 0 or new.driver_id is null or new.ruta_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and (old.estatus = 'pendiente' and old.monto = new.monto) then
    return new;
  end if;

  v_disponible := new.monto;
  for v_descuento in
    select reclamo_id, saldo_pendiente
    from public.pnr_descuentos
    where driver_id = new.driver_id and saldo_pendiente > 0
    order by creado_en, reclamo_id
    for update
  loop
    exit when v_disponible <= 0;
    v_aplicar := least(v_descuento.saldo_pendiente, v_disponible);
    update public.pnr_descuentos
    set saldo_pendiente = saldo_pendiente - v_aplicar,
        monto_aplicado = monto_aplicado + v_aplicar,
        aplicado_en = case when saldo_pendiente - v_aplicar = 0 then now() else aplicado_en end
    where reclamo_id = v_descuento.reclamo_id;
    insert into public.pnr_descuentos_aplicaciones (reclamo_id, driver_id, ruta_id, monto)
    values (v_descuento.reclamo_id, new.driver_id, new.ruta_id::text, v_aplicar);
    insert into public.pnr_reclamo_eventos (reclamo_id, tipo, mensaje)
    values (
      v_descuento.reclamo_id,
      'descuento_aplicado',
      'Se aplicaron ' || to_char(v_aplicar, 'FM$999,999,999,990.00') ||
      ' a la liquidación de ruta ' || new.ruta_id::text ||
      case when v_descuento.saldo_pendiente > v_aplicar then
        '; el saldo restante se aplicará a próximas liquidaciones.'
      else '. El descuento quedó cubierto.' end
    );
    v_disponible := v_disponible - v_aplicar;
    v_total_aplicado := v_total_aplicado + v_aplicar;
  end loop;

  new.monto := v_disponible;
  update public.liquidaciones
  set dcto_pago = coalesce(dcto_pago, 0) + v_total_aplicado,
      pago_driver = greatest(0, coalesce(pago_driver, 0) - v_total_aplicado)
  where ruta_id::text = new.ruta_id::text;
  return new;
end;
$$;

drop trigger if exists aplicar_descuentos_pnr_a_pago on public.pagos;
create trigger aplicar_descuentos_pnr_a_pago
before insert or update of monto, estatus on public.pagos
for each row execute function public.aplicar_descuentos_pnr_a_pago();

revoke all on function public.crear_reclamo_pnr(text, uuid, text, text, text, numeric, text[]) from public, anon, authenticated;
revoke all on function public.responder_reclamo_pnr(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.resolver_reclamo_pnr(uuid, text, text) from public, anon, authenticated;
revoke all on function public.cerrar_pnrs_vencidos() from public, anon, authenticated;
grant execute on function public.crear_reclamo_pnr(text, uuid, text, text, text, numeric, text[]) to authenticated;
grant execute on function public.responder_reclamo_pnr(uuid, text, text[]) to authenticated;
grant execute on function public.resolver_reclamo_pnr(uuid, text, text) to authenticated;

commit;

create extension if not exists pg_cron with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'cerrar-pnrs-vencidos';
select cron.schedule('cerrar-pnrs-vencidos', '*/10 * * * *', 'select public.cerrar_pnrs_vencidos()');

-- Aplicar antes de publicar la app. Requiere route-auxiliary-evidence.sql,
-- rutas/cedis/clientes/drivers y mi_acceso_administrativo() existentes.
-- Solo BT: Liverpool BT, Coppel BT (incluye cuenta base con unidad 3.5T)
-- y Walmart 3.5T. Circuito conserva el flujo previo, sin fotos por articulo.
-- Cada ID se cuenta como un articulo; cada fallido se trata como devolucion.
-- llegada_at es la hora automatica del dispositivo al pulsar Llegue (admite
-- trabajo offline); recibida_at es la hora del servidor al recibirla.
-- Fotos privadas, dos por articulo, acceso del propietario/administracion.
-- La app conserva fotos y avance en IndexedDB hasta confirmar la sincronizacion.
-- Captura BT con camara del celular (input capture; Android usa ACTION_IMAGE_CAPTURE).
-- Chazki reduce el resultado, incluida marca de agua, a JPEG con lado mayor <=2560 px
-- y <=2 MiB. No controla la resolucion original de la app de camara.
-- Rotacion/zoom dependen de la app de camara instalada; en escritorio puede abrir un selector.
-- Validacion: node --test scripts/test-high-value.cjs
-- Web/Android: npm run android:prepare despues de modificar los fuentes.
begin;

create table if not exists public.ruta_llegadas (
  id uuid primary key,
  driver_id uuid not null references public.drivers(id),
  cedis_id bigint not null references public.cedis(id),
  llegada_at timestamptz not null,
  recibida_at timestamptz not null default now(),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  precision_m double precision not null check (precision_m >= 0 and precision_m < 'Infinity'::float8),
  distancia_m integer not null check (distancia_m >= 0),
  viaja_con_auxiliar boolean not null,
  tipo_unidad text,
  foto_path text not null,
  inicio_ruta_at timestamptz
);
create index if not exists ruta_llegadas_driver_pendiente
  on public.ruta_llegadas(driver_id,llegada_at desc) where inicio_ruta_at is null;

alter table public.rutas
  add column if not exists alto_valor boolean not null default false,
  add column if not exists modalidad_operacion text check (modalidad_operacion in ('bt','circuito')),
  add column if not exists llegada_id uuid references public.ruta_llegadas(id),
  add column if not exists progreso_bt jsonb,
  add column if not exists evidencia_carga jsonb not null default '[]',
  add column if not exists evidencia_devoluciones jsonb not null default '[]';
create unique index if not exists rutas_llegada_unica on public.rutas(llegada_id) where llegada_id is not null;

alter table public.ruta_llegadas enable row level security;
revoke all on public.ruta_llegadas from anon,authenticated;
grant select,insert on public.ruta_llegadas to authenticated;
drop policy if exists llegada_read on public.ruta_llegadas;
create policy llegada_read on public.ruta_llegadas for select to authenticated
  using (driver_id=auth.uid() or public.mi_acceso_administrativo());
drop policy if exists llegada_insert on public.ruta_llegadas;
create policy llegada_insert on public.ruta_llegadas for insert to authenticated
  with check (driver_id=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('ruta-articulos','ruta-articulos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists articulos_read on storage.objects;
create policy articulos_read on storage.objects for select to authenticated
  using (bucket_id='ruta-articulos' and ((storage.foldername(name))[1]=auth.uid()::text or public.mi_acceso_administrativo()));
drop policy if exists articulos_insert on storage.objects;
create policy articulos_insert on storage.objects for insert to authenticated
  with check (bucket_id='ruta-articulos' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists articulos_update on storage.objects;
create policy articulos_update on storage.objects for update to authenticated
  using (bucket_id='ruta-articulos' and (storage.foldername(name))[1]=auth.uid()::text)
  with check (bucket_id='ruta-articulos' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.validar_llegada_alto_valor() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cedis; h double precision;
begin
  select * into c from public.cedis where id=new.cedis_id;
  if c.lat is null or c.lng is null then
    raise exception 'El CEDIS requiere coordenadas para registrar la llegada';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='ruta-articulos' and name=new.foto_path
    and split_part(name,'/',1)=new.driver_id::text) then
    raise exception 'Falta la evidencia privada de llegada';
  end if;
  h=sin(radians(c.lat-new.lat)/2)^2+cos(radians(new.lat))*cos(radians(c.lat))*sin(radians(c.lng-new.lng)/2)^2;
  new.distancia_m=round(12742000*asin(sqrt(least(1,greatest(0,h)))));
  return new;
end $$;
drop trigger if exists validar_llegada_alto_valor on public.ruta_llegadas;
create trigger validar_llegada_alto_valor before insert on public.ruta_llegadas
  for each row execute function public.validar_llegada_alto_valor();

create or replace function public.evidencia_articulos_completa(fotos jsonb,cantidad integer,propietario uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case when jsonb_typeof(fotos)<>'array' or cantidad is null or cantidad<0 then false
  else jsonb_array_length(fotos)::bigint=cantidad::bigint*2
    and (select count(distinct f->>'path') from jsonb_array_elements(fotos) f)=cantidad::bigint*2
    and not exists(
      select 1 from jsonb_array_elements(fotos) f
      where jsonb_typeof(f->'item') is distinct from 'number'
        or not ((f->>'item') ~ '^[1-9][0-9]*$')
        or (f->>'item')::numeric>cantidad
        or not exists(select 1 from storage.objects o where o.bucket_id='ruta-articulos'
          and o.name=f->>'path' and split_part(o.name,'/',1)=propietario::text)
    )
    and not exists(select 1 from jsonb_array_elements(fotos) f group by f->>'item' having count(*)<>2)
  end
$$;

create or replace function public.validar_ruta_alto_valor() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.ruta_llegadas; cliente text; unidad text; elegible boolean;
begin
  select upper(trim(cl.nombre)) into cliente from public.cedis c join public.clientes cl on cl.id=c.cliente_id
    where c.id=new.cedis_id;
  unidad=regexp_replace(upper(coalesce(new.tipo_unidad,'')),'[\s.,]','','g');
  elegible=case when cliente in ('LIVERPOOL','LIVERPOOL BT','COPPEL','COPPEL BT')
    then cliente like '% BT' or unidad='35T'
    else cliente in ('WALMART','WALMART 3.5T','WALMART 3.5 T','WALMART 3,5T')
      and (unidad='35T' or cliente<>'WALMART') end;
  if new.alto_valor or (new.modalidad_operacion='bt' and elegible) then
    if not new.alto_valor or new.modalidad_operacion is distinct from 'bt' or not coalesce(elegible,false) then
      raise exception 'La evidencia de alto valor solo aplica a las tres modalidades BT habilitadas';
    end if;
    select * into a from public.ruta_llegadas where id=new.llegada_id for update;
    if a.id is null or a.driver_id<>new.driver_id or a.cedis_id<>new.cedis_id
      or a.viaja_con_auxiliar<>new.viaja_con_auxiliar then
      raise exception 'La llegada no corresponde al driver, CEDIS o modalidad de esta ruta';
    end if;
    if not public.evidencia_articulos_completa(new.evidencia_carga,new.paquetes_asignados,new.driver_id) then
      raise exception 'Se requieren exactamente dos fotos por articulo cargado';
    end if;
    if new.estado='cerrada' and not public.evidencia_articulos_completa(new.evidencia_devoluciones,new.fallidos,new.driver_id) then
      raise exception 'Se requieren exactamente dos fotos por articulo devuelto';
    end if;
    if new.estado='cerrada' and exists(
      select 1 from jsonb_array_elements(new.evidencia_devoluciones) d
      join jsonb_array_elements(new.evidencia_carga) c on c->>'path'=d->>'path'
    ) then raise exception 'Las devoluciones requieren fotos nuevas'; end if;
    new.hora_llegada_cedis=a.llegada_at;
    update public.ruta_llegadas set inicio_ruta_at=coalesce(inicio_ruta_at,new.checkin_at) where id=a.id;
  end if;
  if tg_op='UPDATE' and old.alto_valor and
    (not new.alto_valor or new.llegada_id is distinct from old.llegada_id or new.modalidad_operacion is distinct from old.modalidad_operacion) then
    raise exception 'No se puede desactivar la evidencia de una ruta BT iniciada';
  end if;
  return new;
end $$;
drop trigger if exists validar_ruta_alto_valor on public.rutas;
create trigger validar_ruta_alto_valor before insert or update on public.rutas
  for each row execute function public.validar_ruta_alto_valor();

revoke all on function public.validar_llegada_alto_valor() from public;
revoke all on function public.validar_ruta_alto_valor() from public;
revoke all on function public.evidencia_articulos_completa(jsonb,integer,uuid) from public;
commit;

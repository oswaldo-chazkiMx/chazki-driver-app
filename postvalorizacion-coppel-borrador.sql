-- BORRADOR: no ejecutar ni publicar. Falta aplicar conceptos a pagos.
-- El driver identifica el precierre de origen; el concepto pertenece al proveedor.
begin;

create table if not exists private.postvalorizaciones_coppel (
  id uuid primary key,
  driver_contexto uuid not null references public.drivers(id),
  lunes date not null,
  proveedor_id bigint not null references public.proveedores(id),
  tipo text not null check (tipo in ('abono','descuento')),
  monto_base numeric(12,2) not null check (monto_base>0),
  descripcion text not null check (length(btrim(descripcion)) between 5 and 1000),
  creado_por uuid not null references public.drivers(id),
  creado_en timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  aprobado_por uuid references public.drivers(id),
  aprobado_en timestamptz,
  rechazado_por uuid references public.drivers(id),
  rechazado_en timestamptz,
  motivo_rechazo text,
  check ((estado='pendiente' and aprobado_por is null and aprobado_en is null
      and rechazado_por is null and rechazado_en is null and motivo_rechazo is null)
    or (estado='aprobado' and aprobado_por is not null and aprobado_en is not null
      and rechazado_por is null and rechazado_en is null and motivo_rechazo is null)
    or (estado='rechazado' and aprobado_por is null and aprobado_en is null
      and rechazado_por is not null and rechazado_en is not null
      and motivo_rechazo is not null and length(btrim(motivo_rechazo)) between 5 and 1000))
);
revoke all on private.postvalorizaciones_coppel from public, anon, authenticated;

create or replace function private.coppel_postval_bloqueo_proveedor(p_proveedor_id bigint,p_lunes date)
returns void language sql set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('coppel-postval:'||p_proveedor_id::text||':'||p_lunes::text,0)
  )
$$;
revoke all on function private.coppel_postval_bloqueo_proveedor(bigint,date) from public, anon, authenticated;

create or replace function public.coppel_postval_proponer(
  p_id uuid,p_driver_id uuid,p_lunes date,p_proveedor_id bigint,
  p_tipo text,p_monto_base numeric,p_descripcion text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_precierre jsonb;
  v_existente private.postvalorizaciones_coppel%rowtype;
  v_descripcion text:=btrim(p_descripcion);
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' then
    raise exception 'Solo el supervisor asignado puede proponer post valorizaciones';
  end if;
  if p_id is null or p_driver_id is null or p_lunes is null or p_proveedor_id is null
    or p_tipo is null or p_tipo not in ('abono','descuento')
    or p_monto_base is null or p_monto_base::text in ('NaN','Infinity','-Infinity')
    or p_monto_base<=0 or p_monto_base>9999999999.99 or p_monto_base<>round(p_monto_base,2)
    or v_descripcion is null or length(v_descripcion) not between 5 and 1000 then
    raise exception 'Indica proveedor, tipo, importe base y descripcion validos';
  end if;
  perform private.coppel_peak_bloqueo_semana(p_driver_id,p_lunes);
  v_precierre:=public.coppel_peak_consultar_precierre(p_driver_id,p_lunes);
  if v_precierre->>'estado' is distinct from 'completo' then
    raise exception 'Se requiere un precierre COPPEL abierto y con acceso completo';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_precierre->'rutas') r
      where nullif(r->>'proveedor_id','')::bigint=p_proveedor_id
    union all
    select 1 from jsonb_array_elements(v_precierre->'cancelaciones') c
      where nullif(c->>'proveedor_id','')::bigint=p_proveedor_id
  ) then raise exception 'El proveedor no figura en el precierre COPPEL'; end if;
  perform private.coppel_postval_bloqueo_proveedor(p_proveedor_id,p_lunes);
  insert into private.postvalorizaciones_coppel(
    id,driver_contexto,lunes,proveedor_id,tipo,monto_base,descripcion,creado_por
  ) values (p_id,p_driver_id,p_lunes,p_proveedor_id,p_tipo,p_monto_base,v_descripcion,auth.uid())
  on conflict (id) do nothing;
  select * into v_existente from private.postvalorizaciones_coppel where id=p_id;
  if v_existente.driver_contexto is distinct from p_driver_id
    or v_existente.lunes is distinct from p_lunes
    or v_existente.proveedor_id is distinct from p_proveedor_id
    or v_existente.tipo is distinct from p_tipo
    or v_existente.monto_base is distinct from p_monto_base
    or v_existente.descripcion is distinct from v_descripcion
    or v_existente.creado_por is distinct from auth.uid() then
    raise exception 'El identificador corresponde a otra post valorizacion';
  end if;
  return to_jsonb(v_existente);
end;
$$;
revoke all on function public.coppel_postval_proponer(uuid,uuid,date,bigint,text,numeric,text) from public, anon;
grant execute on function public.coppel_postval_proponer(uuid,uuid,date,bigint,text,numeric,text) to authenticated;

create or replace function public.coppel_postval_aprobar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_concepto private.postvalorizaciones_coppel%rowtype;
  v_precierre jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'coordinador' then
    raise exception 'Solo coordinacion puede aprobar post valorizaciones';
  end if;
  select * into v_concepto from private.postvalorizaciones_coppel where id=p_id;
  if not found then raise exception 'No se encontro la post valorizacion'; end if;
  perform private.coppel_peak_bloqueo_semana(v_concepto.driver_contexto,v_concepto.lunes);
  v_precierre:=public.coppel_peak_consultar_precierre(v_concepto.driver_contexto,v_concepto.lunes);
  if v_precierre->>'estado' is distinct from 'completo' then
    raise exception 'Se requiere un precierre COPPEL abierto y con acceso completo';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_precierre->'rutas') r
      where nullif(r->>'proveedor_id','')::bigint=v_concepto.proveedor_id
    union all
    select 1 from jsonb_array_elements(v_precierre->'cancelaciones') c
      where nullif(c->>'proveedor_id','')::bigint=v_concepto.proveedor_id
  ) then raise exception 'El proveedor ya no figura en el precierre COPPEL'; end if;
  perform private.coppel_postval_bloqueo_proveedor(v_concepto.proveedor_id,v_concepto.lunes);
  select * into v_concepto from private.postvalorizaciones_coppel where id=p_id for update;
  if v_concepto.estado='aprobado' then return to_jsonb(v_concepto); end if;
  if v_concepto.estado<>'pendiente' then raise exception 'La post valorizacion ya fue rechazada'; end if;
  update private.postvalorizaciones_coppel
    set estado='aprobado',aprobado_por=auth.uid(),aprobado_en=now()
    where id=p_id returning * into v_concepto;
  return to_jsonb(v_concepto);
end;
$$;
revoke all on function public.coppel_postval_aprobar(uuid) from public, anon;
grant execute on function public.coppel_postval_aprobar(uuid) to authenticated;

create or replace function public.coppel_postval_rechazar(p_id uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_concepto private.postvalorizaciones_coppel%rowtype;
  v_precierre jsonb;
  v_motivo text:=btrim(p_motivo);
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'coordinador' then
    raise exception 'Solo coordinacion puede rechazar post valorizaciones';
  end if;
  if v_motivo is null or length(v_motivo) not between 5 and 1000 then
    raise exception 'Indica el motivo del rechazo';
  end if;
  select * into v_concepto from private.postvalorizaciones_coppel where id=p_id;
  if not found then raise exception 'No se encontro la post valorizacion'; end if;
  perform private.coppel_peak_bloqueo_semana(v_concepto.driver_contexto,v_concepto.lunes);
  v_precierre:=public.coppel_peak_consultar_precierre(v_concepto.driver_contexto,v_concepto.lunes);
  if v_precierre->>'estado' is distinct from 'completo' then
    raise exception 'Se requiere un precierre COPPEL abierto y con acceso completo';
  end if;
  perform private.coppel_postval_bloqueo_proveedor(v_concepto.proveedor_id,v_concepto.lunes);
  select * into v_concepto from private.postvalorizaciones_coppel where id=p_id for update;
  if v_concepto.estado='rechazado' then
    if v_concepto.motivo_rechazo is distinct from v_motivo then
      raise exception 'La post valorizacion ya fue rechazada con otro motivo';
    end if;
    return to_jsonb(v_concepto);
  end if;
  if v_concepto.estado<>'pendiente' then raise exception 'La post valorizacion ya fue aprobada'; end if;
  update private.postvalorizaciones_coppel
    set estado='rechazado',rechazado_por=auth.uid(),rechazado_en=now(),motivo_rechazo=v_motivo
    where id=p_id returning * into v_concepto;
  return to_jsonb(v_concepto);
end;
$$;
revoke all on function public.coppel_postval_rechazar(uuid,text) from public, anon;
grant execute on function public.coppel_postval_rechazar(uuid,text) to authenticated;

create or replace function public.coppel_postval_listar(p_driver_id uuid,p_lunes date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_precierre jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is null
    or public.operativo_rol_actual() not in ('ih','coordinador') then
    raise exception 'Solo el supervisor o coordinador asignado pueden consultar post valorizaciones';
  end if;
  v_precierre:=public.coppel_peak_consultar_precierre(p_driver_id,p_lunes);
  if v_precierre->>'estado' not in ('completo','cerrada')
    or v_precierre->>'estado' is null then
    raise exception 'Se requiere acceso completo a la semana COPPEL';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_en,x.id),'[]'::jsonb)
    from private.postvalorizaciones_coppel x
    where x.driver_contexto=p_driver_id and x.lunes=p_lunes
  );
end;
$$;
revoke all on function public.coppel_postval_listar(uuid,date) from public, anon;
grant execute on function public.coppel_postval_listar(uuid,date) to authenticated;

commit;

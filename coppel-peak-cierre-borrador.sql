-- BORRADOR INCOMPLETO: no ejecutar ni publicar.
-- Los ajustes retroactivos y la detección de rutas tardías aún no están integrados.
begin;

create table if not exists private.coppel_peak_cierres (
  driver_id uuid not null references public.drivers(id),
  lunes date not null,
  cerrado_por uuid not null references public.drivers(id),
  cerrado_en timestamptz not null default now(),
  resumen jsonb not null,
  precierre jsonb not null,
  rutas jsonb not null,
  cancelaciones jsonb not null,
  no_shows jsonb not null,
  centros jsonb not null,
  asistencia jsonb not null,
  domingo jsonb,
  bono_domingo_pago_id bigint unique references public.pagos(id),
  primary key (driver_id,lunes)
);
revoke all on private.coppel_peak_cierres from public, anon, authenticated;

create or replace function public.coppel_peak_consultar_semana(
  p_driver_id uuid, p_lunes date
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rol text;
  v_cierre private.coppel_peak_cierres%rowtype;
  v_actividad_accesible bigint;
  v_fuera_de_alcance boolean;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Sin permiso para consultar el precierre COPPEL';
  end if;
  v_rol:=public.operativo_rol_actual();
  if v_rol is null or v_rol not in ('ih','coordinador','ops','master') then
    raise exception 'Sin permiso para consultar el precierre COPPEL';
  end if;
  if p_driver_id is null or p_lunes is null or extract(isodow from p_lunes)<>1
    or p_lunes<date '2026-11-09' or p_lunes+6>date '2027-01-10' then
    raise exception 'Driver o semana COPPEL inválidos';
  end if;
  select * into v_cierre from private.coppel_peak_cierres
    where driver_id=p_driver_id and lunes=p_lunes;
  if found then
    select count(*) filter (where x.accesible),coalesce(bool_or(not x.accesible),false)
    into v_actividad_accesible,v_fuera_de_alcance
    from (
      select v_rol in ('ops','master')
        or public.operativo_asignado_a(c.cliente_id,c.cedis_id,v_rol) is true as accesible
      from jsonb_to_recordset(v_cierre.centros) as c(cliente_id bigint,cedis_id bigint)
    ) x;
    if v_actividad_accesible=0 then raise exception 'Sin actividad COPPEL accesible para este driver y semana'; end if;
    if v_fuera_de_alcance then return jsonb_build_object('estado','requiere_revision',
      'mensaje','Precierre incompleto: solicita revisión a coordinación con acceso completo o a Operaciones'); end if;
    return jsonb_build_object('estado','cerrada','resumen',v_cierre.resumen,'precierre',v_cierre.precierre,'rutas',v_cierre.rutas,'cancelaciones',v_cierre.cancelaciones,'no_shows',v_cierre.no_shows,
      'asistencia',v_cierre.asistencia,'domingo',v_cierre.domingo,'cerrado_en',v_cierre.cerrado_en);
  end if;
  select count(*) filter (where x.accesible),coalesce(bool_or(not x.accesible),false)
  into v_actividad_accesible,v_fuera_de_alcance
  from (
    select v_rol in ('ops','master')
      or public.operativo_asignado_a(c.cliente_id,c.cedis_id,v_rol) is true as accesible
    from private.coppel_peak_centros_semana(p_driver_id,p_lunes) c
  ) x;
  if v_actividad_accesible=0 then raise exception 'Sin actividad COPPEL accesible para este driver y semana'; end if;
  if v_fuera_de_alcance then return jsonb_build_object('estado','requiere_revision',
    'mensaje','Precierre incompleto: solicita revisión a coordinación con acceso completo o a Operaciones'); end if;
  return jsonb_build_object('estado','completo','resumen',private.coppel_peak_previsualizar_semana(p_driver_id,p_lunes));
end;
$$;
revoke all on function public.coppel_peak_consultar_semana(uuid,date) from public, anon;
grant execute on function public.coppel_peak_consultar_semana(uuid,date) to authenticated;

create or replace function private.coppel_peak_bloqueo_semana(p_driver_id uuid,p_lunes date)
returns void language sql set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('coppel-peak:'||p_driver_id::text||':'||p_lunes::text,0)
  )
$$;
revoke all on function private.coppel_peak_bloqueo_semana(uuid,date) from public, anon, authenticated;

create or replace function private.coppel_peak_proteger_ruta_cerrada()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_dato record;
  v_lunes date;
  v_clave text;
  v_antes jsonb;
  v_despues jsonb;
begin
  if tg_op<>'INSERT' then v_antes:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_despues:=to_jsonb(new); end if;
  for v_dato in
    select distinct x.driver_id,x.cedis_id,x.checkin_at
    from jsonb_to_recordset(jsonb_build_array(coalesce(v_antes,'{}'::jsonb),coalesce(v_despues,'{}'::jsonb)))
      as x(driver_id uuid,cedis_id bigint,checkin_at timestamptz)
    where x.driver_id is not null and x.cedis_id is not null and x.checkin_at is not null
    order by x.driver_id,x.checkin_at,x.cedis_id
  loop
    if exists (
      select 1 from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
      where ce.id=v_dato.cedis_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
    ) then
      v_lunes:=(v_dato.checkin_at at time zone 'America/Mexico_City')::date;
      v_lunes:=v_lunes-(extract(isodow from v_lunes)::integer-1);
      perform private.coppel_peak_bloqueo_semana(v_dato.driver_id,v_lunes);
    end if;
  end loop;
  if tg_op<>'INSERT' and exists (
    select 1 from private.coppel_peak_cierres c,
      jsonb_array_elements(c.rutas) r
    where (r->>'ruta_id')::bigint=old.id
  ) then
    if tg_op='DELETE' then
      raise exception 'La ruta pertenece a una semana COPPEL cerrada; registra la diferencia para revisión retroactiva';
    end if;
    foreach v_clave in array array['driver_id','cedis_id','checkin_at','paquetes_asignados',
      'entregados','fallidos','tipo_unidad','estado','checkout_at'] loop
      if v_antes->v_clave is distinct from v_despues->v_clave then
        raise exception 'La ruta pertenece a una semana COPPEL cerrada; registra la diferencia para revisión retroactiva';
      end if;
    end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_ruta_cerrada() from public, anon, authenticated;
drop trigger if exists coppel_peak_ruta_cerrada on public.rutas;
create trigger coppel_peak_ruta_cerrada before insert or update or delete on public.rutas
for each row execute function private.coppel_peak_proteger_ruta_cerrada();

create or replace function private.coppel_peak_proteger_cancelacion_cerrada()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_dato record; v_lunes date; v_antes jsonb; v_despues jsonb;
begin
  if tg_op<>'INSERT' then v_antes:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_despues:=to_jsonb(new); end if;
  for v_dato in
    select distinct x.driver_id,x.cedis_id,x.capturado_at
    from jsonb_to_recordset(jsonb_build_array(coalesce(v_antes,'{}'::jsonb),coalesce(v_despues,'{}'::jsonb)))
      as x(driver_id uuid,cedis_id bigint,capturado_at timestamptz)
    where x.driver_id is not null and x.cedis_id is not null and x.capturado_at is not null
    order by x.driver_id,x.capturado_at,x.cedis_id
  loop
    if exists (select 1 from public.cedis ce join public.clientes cl on cl.id=ce.cliente_id
      where ce.id=v_dato.cedis_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')) then
      v_lunes:=(v_dato.capturado_at at time zone 'America/Mexico_City')::date;
      v_lunes:=v_lunes-(extract(isodow from v_lunes)::integer-1);
      perform private.coppel_peak_bloqueo_semana(v_dato.driver_id,v_lunes);
      if exists (select 1 from private.coppel_peak_cierres c
        where c.driver_id=v_dato.driver_id and c.lunes=v_lunes)
        and (v_antes->>'estatus'='aprobada' or v_despues->>'estatus'='aprobada') then
        raise exception 'La semana COPPEL está cerrada; registra la cancelación para revisión retroactiva';
      end if;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_cancelacion_cerrada() from public, anon, authenticated;
drop trigger if exists coppel_peak_cancelacion_cerrada on public.cancelaciones;
create trigger coppel_peak_cancelacion_cerrada before insert or update or delete on public.cancelaciones
for each row execute function private.coppel_peak_proteger_cancelacion_cerrada();

create or replace function private.coppel_peak_proteger_no_show_cerrado()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_dato record; v_lunes date; v_antes jsonb; v_despues jsonb;
begin
  if tg_op<>'INSERT' then v_antes:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_despues:=to_jsonb(new); end if;
  for v_dato in
    select distinct x.driver_id,x.fecha_servicio
    from jsonb_to_recordset(jsonb_build_array(coalesce(v_antes,'{}'::jsonb),coalesce(v_despues,'{}'::jsonb)))
      as x(driver_id uuid,fecha_servicio date,cuenta text)
    where x.driver_id is not null and x.fecha_servicio is not null and x.cuenta='COPPEL'
    order by x.driver_id,x.fecha_servicio
  loop
    v_lunes:=v_dato.fecha_servicio-(extract(isodow from v_dato.fecha_servicio)::integer-1);
    perform private.coppel_peak_bloqueo_semana(v_dato.driver_id,v_lunes);
    if exists (select 1 from private.coppel_peak_cierres c
      where c.driver_id=v_dato.driver_id and c.lunes=v_lunes) then
      raise exception 'La semana COPPEL está cerrada; registra el NO SHOW para revisión retroactiva';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_no_show_cerrado() from public, anon, authenticated;
drop trigger if exists coppel_peak_no_show_cerrado on public.no_show_casos;
create trigger coppel_peak_no_show_cerrado before insert or update or delete on public.no_show_casos
for each row execute function private.coppel_peak_proteger_no_show_cerrado();

create or replace function private.coppel_peak_proteger_liquidacion_cerrada()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_ruta record; v_lunes date; v_ruta_id bigint;
begin
  for v_ruta_id in
    select distinct x.id from unnest(array[
      case when tg_op<>'INSERT' then old.ruta_id end,
      case when tg_op<>'DELETE' then new.ruta_id end
    ]) x(id) where x.id is not null order by x.id
  loop
    select r.driver_id,(r.checkin_at at time zone 'America/Mexico_City')::date as dia,
      public.operativo_normalizar(cl.nombre) as cliente
    into v_ruta from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id where r.id=v_ruta_id;
    if found and v_ruta.cliente in ('coppel','coppelbt') and v_ruta.dia is not null then
      v_lunes := v_ruta.dia-(extract(isodow from v_ruta.dia)::integer-1);
      perform private.coppel_peak_bloqueo_semana(v_ruta.driver_id,v_lunes);
      if exists (select 1 from private.coppel_peak_cierres c
        where c.driver_id=v_ruta.driver_id and c.lunes=v_lunes) then
        raise exception 'La semana COPPEL está cerrada; registra la diferencia para revisión retroactiva';
      end if;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_liquidacion_cerrada() from public, anon, authenticated;
drop trigger if exists coppel_peak_liquidacion_cerrada on public.liquidaciones;
create trigger coppel_peak_liquidacion_cerrada before insert or update or delete on public.liquidaciones
for each row execute function private.coppel_peak_proteger_liquidacion_cerrada();

create or replace function private.coppel_peak_proteger_pago_cerrado()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_cerrado boolean; v_driver_id uuid; v_lunes date; v_pago public.pagos%rowtype;
begin
  if tg_op='INSERT' then v_pago:=new; else v_pago:=old; end if;
  select r.driver_id,
    (r.checkin_at at time zone 'America/Mexico_City')::date
      -(extract(isodow from (r.checkin_at at time zone 'America/Mexico_City')::date)::integer-1)
  into v_driver_id,v_lunes
  from public.rutas r join public.cedis ce on ce.id=r.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  where r.id=v_pago.ruta_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt');
  if v_driver_id is null then
    select a.driver_id,a.lunes into v_driver_id,v_lunes
    from private.coppel_peak_aprobaciones_asistencia a where a.pago_id=v_pago.id;
  end if;
  if v_driver_id is null then
    select ca.driver_id,ca.lunes into v_driver_id,v_lunes
    from private.coppel_peak_cancelaciones ca where ca.pago_id=v_pago.id;
  end if;
  if v_driver_id is null then
    select ns.driver_id,ns.fecha_servicio-(extract(isodow from ns.fecha_servicio)::integer-1)
    into v_driver_id,v_lunes
    from public.no_show_casos ns
    where ns.cuenta='COPPEL' and v_pago.id in (ns.pago_penalizacion_id,ns.pago_reversion_id);
  end if;
  if v_driver_id is not null and v_lunes is not null then
    perform private.coppel_peak_bloqueo_semana(v_driver_id,v_lunes);
  end if;
  if tg_op='INSERT' then
    if exists (select 1 from private.coppel_peak_cierres c
      where c.driver_id=v_driver_id and c.lunes=v_lunes) then
      raise exception 'La semana COPPEL está cerrada; registra la diferencia para revisión retroactiva';
    end if;
    return new;
  end if;
  if tg_op='UPDATE' and new.ruta_id is distinct from old.ruta_id then
    select r.driver_id,
      (r.checkin_at at time zone 'America/Mexico_City')::date
        -(extract(isodow from (r.checkin_at at time zone 'America/Mexico_City')::date)::integer-1)
    into v_driver_id,v_lunes
    from public.rutas r join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=new.ruta_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt');
    if v_driver_id is not null and v_lunes is not null then
      perform private.coppel_peak_bloqueo_semana(v_driver_id,v_lunes);
      if exists (select 1 from private.coppel_peak_cierres c
        where c.driver_id=v_driver_id and c.lunes=v_lunes) then
        raise exception 'La semana COPPEL está cerrada; registra la diferencia para revisión retroactiva';
      end if;
    end if;
  end if;
  select exists (
    select 1 from private.coppel_peak_cierres c
    where c.bono_domingo_pago_id=old.id
      or exists (select 1 from private.coppel_peak_aprobaciones_asistencia a
        where a.driver_id=c.driver_id and a.lunes=c.lunes and a.pago_id=old.id)
      or exists (select 1 from private.coppel_peak_cancelaciones ca
        where ca.driver_id=c.driver_id and ca.lunes=c.lunes and ca.pago_id=old.id)
      or exists (select 1 from jsonb_array_elements(c.no_shows) ns
        where old.id in (nullif(ns->>'pago_penalizacion_id','')::bigint,
          nullif(ns->>'pago_reversion_id','')::bigint))
      or exists (select 1 from jsonb_array_elements(c.rutas) r
        where (r->>'pago_id')::bigint=old.id)
  ) into v_cerrado;
  if v_cerrado then
    if tg_op='DELETE' then
      raise exception 'El pago pertenece a una semana COPPEL cerrada; requiere ajuste retroactivo';
    end if;
    if new.driver_id is distinct from old.driver_id or new.proveedor_id is distinct from old.proveedor_id
      or new.ruta_id is distinct from old.ruta_id or new.concepto is distinct from old.concepto
      or new.monto is distinct from old.monto or new.fecha is distinct from old.fecha
      or (new.estatus is distinct from old.estatus and not (old.estatus='pendiente' and new.estatus='pagado')) then
      raise exception 'El pago pertenece a una semana COPPEL cerrada; requiere ajuste retroactivo';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_pago_cerrado() from public, anon, authenticated;
drop trigger if exists coppel_peak_pago_cerrado on public.pagos;
create trigger coppel_peak_pago_cerrado before insert or update or delete on public.pagos
for each row execute function private.coppel_peak_proteger_pago_cerrado();

create or replace function public.coppel_peak_consultar_precierre(p_driver_id uuid,p_lunes date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_consulta jsonb;
  v_rutas jsonb;
  v_cancelaciones jsonb;
  v_no_shows jsonb;
begin
  v_consulta:=public.coppel_peak_consultar_semana(p_driver_id,p_lunes);
  if v_consulta->>'estado' is distinct from 'completo' then return v_consulta; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ruta_id',r.id,'fecha',(r.checkin_at at time zone 'America/Mexico_City')::date,
    'cedis_id',r.cedis_id,'asignados',l.asignados,'entregados',l.entregados,
    'pago_base',l.pago_base,'descuento',l.dcto_pago,'bono_efectividad',l.bono_pago,
    'pago_id',p.id,'pago',p.monto,'proveedor_id',p.proveedor_id,'pago_estatus',p.estatus
  ) order by r.checkin_at,r.id,p.id),'[]'::jsonb) into v_rutas
  from public.rutas r join public.cedis ce on ce.id=r.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  left join public.liquidaciones l on l.ruta_id=r.id and l.cuenta='COPPEL'
  left join public.pagos p on p.ruta_id=r.id and p.concepto='servicio'
  where r.driver_id=p_driver_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
    and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6;
  select coalesce(jsonb_agg(jsonb_build_object(
    'cancelacion_id',c.id,'fecha',(c.capturado_at at time zone 'America/Mexico_City')::date,
    'cedis_id',c.cedis_id,'base',ca.base,'fiscal',ca.fiscal,'pnr_aplicado',ca.pnr_aplicado,
    'pago_id',ca.pago_id,'proveedor_id',ca.proveedor_id,
    'pago',p.monto,'pago_estatus',p.estatus,'pago_driver_id',p.driver_id,
    'pago_proveedor_id',p.proveedor_id,'pago_concepto',p.concepto,'pago_ruta_id',p.ruta_id
  ) order by c.id),'[]'::jsonb) into v_cancelaciones
  from public.cancelaciones c join public.cedis ce on ce.id=c.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  left join private.coppel_peak_cancelaciones ca on ca.cancelacion_id=c.id
  left join public.pagos p on p.id=ca.pago_id
  where c.driver_id=p_driver_id and c.estatus='aprobada'
    and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
    and (c.capturado_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6;
  select coalesce(jsonb_agg(jsonb_build_object(
    'caso_id',ns.id,'fecha',ns.fecha_servicio,'estado',ns.estado,
    'pago_penalizacion_id',ns.pago_penalizacion_id,'pago_reversion_id',ns.pago_reversion_id,
    'penalizacion',p.monto,'penalizacion_estatus',p.estatus,
    'reversion',pr.monto,'reversion_estatus',pr.estatus,'vence_apelacion_en',ns.vence_apelacion_en
  ) order by ns.fecha_servicio,ns.id),'[]'::jsonb) into v_no_shows
  from public.no_show_casos ns
  left join public.pagos p on p.id=ns.pago_penalizacion_id
  left join public.pagos pr on pr.id=ns.pago_reversion_id
  where ns.driver_id=p_driver_id and ns.cuenta='COPPEL' and ns.fecha_servicio between p_lunes and p_lunes+6;
  return jsonb_build_object('estado','completo','resumen',v_consulta->'resumen',
    'rutas',v_rutas,'cancelaciones',v_cancelaciones,'no_shows',v_no_shows);
end;
$$;
revoke all on function public.coppel_peak_consultar_precierre(uuid,date) from public, anon;
grant execute on function public.coppel_peak_consultar_precierre(uuid,date) to authenticated;

create or replace function public.coppel_peak_cerrar_semana(
  p_driver_id uuid,p_lunes date,p_aplicar_asistencia boolean,p_precierre_esperado jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_consulta jsonb;
  v_resumen jsonb;
  v_rutas jsonb;
  v_cancelaciones jsonb;
  v_no_shows jsonb;
  v_centros jsonb;
  v_ya_cerrada private.coppel_peak_cierres%rowtype;
  v_asistencia jsonb;
  v_domingo record;
  v_retencion numeric;
  v_comision numeric;
  v_iva numeric;
  v_fiscal jsonb;
  v_pago_id bigint;
  v_proveedor bigint;
begin
  if p_driver_id is null or p_lunes is null or p_aplicar_asistencia is null
    or p_precierre_esperado is null or jsonb_typeof(p_precierre_esperado)<>'object' then
    raise exception 'Se requiere una decisión y un resumen válido';
  end if;
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() not in ('ih','coordinador','ops','master')
    or public.operativo_rol_actual() is null then raise exception 'Sin permiso para cerrar la semana COPPEL'; end if;
  perform private.coppel_peak_bloqueo_semana(p_driver_id,p_lunes);
  v_consulta := public.coppel_peak_consultar_precierre(p_driver_id,p_lunes);
  if v_consulta->>'estado' not in ('completo','cerrada') or v_consulta->>'estado' is null then
    raise exception 'La semana requiere revisión por un responsable con acceso completo';
  end if;
  select * into v_ya_cerrada from private.coppel_peak_cierres
  where driver_id=p_driver_id and lunes=p_lunes;
  if found then
    if v_ya_cerrada.precierre is distinct from p_precierre_esperado
      or not exists (select 1 from private.coppel_peak_aprobaciones_asistencia a
        where a.driver_id=p_driver_id and a.lunes=p_lunes and a.aplica=p_aplicar_asistencia) then
      raise exception 'La semana ya está cerrada; revisa su historial';
    end if;
    return v_consulta;
  end if;
  if to_regclass('private.postvalorizaciones_coppel') is not null then
    for v_proveedor in
      select distinct x.proveedor_id from (
        select nullif(r->>'proveedor_id','')::bigint as proveedor_id
          from jsonb_array_elements(v_consulta->'rutas') r
        union all
        select nullif(c->>'proveedor_id','')::bigint as proveedor_id
          from jsonb_array_elements(v_consulta->'cancelaciones') c
      ) x where x.proveedor_id is not null order by x.proveedor_id
    loop
      perform private.coppel_postval_bloqueo_proveedor(v_proveedor,p_lunes);
    end loop;
    if exists (
      select 1 from private.postvalorizaciones_coppel x
      where x.lunes=p_lunes and x.estado<>'rechazado' and (
        exists (select 1 from jsonb_array_elements(v_consulta->'rutas') r
          where nullif(r->>'proveedor_id','')::bigint=x.proveedor_id)
        or exists (select 1 from jsonb_array_elements(v_consulta->'cancelaciones') c
          where nullif(c->>'proveedor_id','')::bigint=x.proveedor_id)
      )
    ) then
      raise exception 'La semana tiene post valorizaciones pendientes de integrar a pagos; no se puede cerrar';
    end if;
  end if;
  v_resumen := v_consulta->'resumen';
  if v_consulta is distinct from p_precierre_esperado then
    raise exception 'El precierre cambió; vuelve a revisarlo antes de cerrar';
  end if;
  if exists (
    select 1 from public.rutas r join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.driver_id=p_driver_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
      and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
      and (not exists (select 1 from public.liquidaciones l where l.ruta_id=r.id and l.cuenta='COPPEL')
        or (select count(*) from public.pagos p where p.ruta_id=r.id and p.concepto='servicio')<>1)
  ) then raise exception 'Hay rutas COPPEL sin liquidación o con pagos de servicio incompletos; revisa antes del cierre'; end if;
  if exists (
    select 1 from public.cancelaciones c join public.cedis ce on ce.id=c.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where c.driver_id=p_driver_id and c.estatus='aprobada'
      and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
      and (c.capturado_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
      and not exists (select 1 from private.coppel_peak_cancelaciones ca where ca.cancelacion_id=c.id)
  ) then raise exception 'Captura el importe de cada cancelación COPPEL aprobada antes del cierre'; end if;
  if exists (
    select 1 from private.coppel_peak_cancelaciones ca
    left join public.pagos p on p.id=ca.pago_id
    where ca.driver_id=p_driver_id and ca.lunes=p_lunes
      and ((ca.base=0 and ca.pago_id is not null)
        or (ca.base>0 and (p.id is null or p.driver_id is distinct from ca.driver_id
          or p.proveedor_id is distinct from ca.proveedor_id
          or p.ruta_id is not null or p.concepto is distinct from 'servicio'
          or p.monto is distinct from (ca.fiscal->>'pago_proveedor')::numeric-ca.pnr_aplicado
          or p.estatus is null or p.estatus not in ('pendiente','pagado')))
        or ca.pnr_aplicado is distinct from (
          select coalesce(sum(x.monto),0) from private.coppel_peak_cancelaciones_pnr x
          where x.cancelacion_id=ca.cancelacion_id
        ) or exists (select 1 from private.coppel_peak_cancelaciones_pnr x
          where x.cancelacion_id=ca.cancelacion_id and x.driver_id is distinct from ca.driver_id))
  ) then raise exception 'El pago de una cancelación COPPEL no coincide con su importe registrado'; end if;
  if exists (
    select 1 from public.no_show_casos ns
    where ns.driver_id=p_driver_id and ns.cuenta='COPPEL' and ns.fecha_servicio between p_lunes and p_lunes+6
      and (ns.estado='apelado' or (ns.estado='reportado' and ns.vence_apelacion_en>now()))
  ) then raise exception 'Hay un NO SHOW con apelación pendiente o plazo vigente; revisa antes del cierre'; end if;
  v_asistencia := public.coppel_peak_aprobar_asistencia(p_driver_id,p_lunes,p_aplicar_asistencia,v_resumen);
  if (v_resumen->>'bono_domingo_base')::numeric>0 then
    if (v_resumen->>'domingo_requiere_revision')::boolean is not false then
      raise exception 'Revisa el proveedor y el registro fiscal de las rutas del domingo';
    end if;
    select min(l.proveedor_id) as proveedor_id,min(l.registro_fiscal) as registro_fiscal
      into v_domingo from public.rutas r join public.liquidaciones l on l.ruta_id=r.id
      join public.cedis ce on ce.id=r.cedis_id join public.clientes cl on cl.id=ce.cliente_id
      where r.driver_id=p_driver_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
        and (r.checkin_at at time zone 'America/Mexico_City')::date=p_lunes+6;
    select max(valor) filter (where clave='retencion_sin_factura'),
      max(valor) filter (where clave='comision_sin_factura'),max(valor) filter (where clave='iva')
      into v_retencion,v_comision,v_iva from public.parametros_pago
      where clave in ('retencion_sin_factura','comision_sin_factura','iva');
    v_fiscal := private.coppel_peak_fiscal_bono(300,v_domingo.registro_fiscal,v_retencion,v_comision,v_iva);
    insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
    values(p_driver_id,v_domingo.proveedor_id,null,'bono',(v_fiscal->>'pago_proveedor')::numeric,p_lunes+6,'pendiente')
    returning id into v_pago_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ruta_id',r.id,'fecha',(r.checkin_at at time zone 'America/Mexico_City')::date,
    'cedis_id',r.cedis_id,'asignados',l.asignados,'entregados',l.entregados,
    'pago_base',l.pago_base,'descuento',l.dcto_pago,'bono_efectividad',l.bono_pago,
    'pago_id',p.id,'pago',p.monto,'proveedor_id',p.proveedor_id
  ) order by r.checkin_at,r.id),'[]'::jsonb) into v_rutas
  from public.rutas r join public.cedis ce on ce.id=r.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  join public.liquidaciones l on l.ruta_id=r.id and l.cuenta='COPPEL'
  join public.pagos p on p.ruta_id=r.id and p.concepto='servicio'
  where r.driver_id=p_driver_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
    and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6;
  select coalesce(jsonb_agg(jsonb_build_object('cliente_id',c.cliente_id,'cedis_id',c.cedis_id)
    order by c.cliente_id,c.cedis_id),'[]'::jsonb) into v_centros
    from private.coppel_peak_centros_semana(p_driver_id,p_lunes) c;
  select coalesce(jsonb_agg(jsonb_build_object(
    'cancelacion_id',ca.cancelacion_id,'base',ca.base,'fiscal',ca.fiscal,
    'pago_id',ca.pago_id,'proveedor_id',ca.proveedor_id,'pnr_aplicado',ca.pnr_aplicado,
    'pago_neto',(ca.fiscal->>'pago_proveedor')::numeric-ca.pnr_aplicado
  ) order by ca.cancelacion_id),'[]'::jsonb) into v_cancelaciones
  from private.coppel_peak_cancelaciones ca where ca.driver_id=p_driver_id and ca.lunes=p_lunes;
  select coalesce(jsonb_agg(jsonb_build_object(
    'caso_id',ns.id,'fecha',ns.fecha_servicio,'estado',ns.estado,
    'pago_penalizacion_id',ns.pago_penalizacion_id,'pago_reversion_id',ns.pago_reversion_id
  ) order by ns.fecha_servicio,ns.id),'[]'::jsonb) into v_no_shows
  from public.no_show_casos ns
  where ns.driver_id=p_driver_id and ns.cuenta='COPPEL' and ns.fecha_servicio between p_lunes and p_lunes+6;
  insert into private.coppel_peak_cierres(driver_id,lunes,cerrado_por,resumen,precierre,rutas,cancelaciones,no_shows,centros,asistencia,domingo,bono_domingo_pago_id)
  values(p_driver_id,p_lunes,auth.uid(),v_resumen,v_consulta,v_rutas,v_cancelaciones,v_no_shows,v_centros,v_asistencia,v_fiscal,v_pago_id);
  return jsonb_build_object('estado','cerrada','resumen',v_resumen,'rutas',v_rutas,'cancelaciones',v_cancelaciones,'no_shows',v_no_shows,
    'asistencia',v_asistencia,'domingo',v_fiscal);
end;
$$;
revoke all on function public.coppel_peak_cerrar_semana(uuid,date,boolean,jsonb) from public, anon;
grant execute on function public.coppel_peak_cerrar_semana(uuid,date,boolean,jsonb) to authenticated;
revoke execute on function public.coppel_peak_aprobar_asistencia(uuid,date,boolean,jsonb) from authenticated;

commit;

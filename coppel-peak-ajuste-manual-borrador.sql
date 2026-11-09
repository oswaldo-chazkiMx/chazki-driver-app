-- BORRADOR: no instalar hasta validar la migracion completa en Supabase de pruebas.
-- El importe es final y afecta solo a la semana de destino, no a la semana cerrada.
begin;

create table if not exists private.coppel_peak_ajustes_manuales (
  id uuid primary key,
  driver_id uuid not null references public.drivers(id),
  proveedor_id bigint not null references public.proveedores(id),
  lunes_origen date not null,
  lunes_destino date not null,
  monto numeric(12,2) not null check (monto<>0 and monto::text not in ('NaN','Infinity','-Infinity')),
  motivo text not null check (length(btrim(motivo)) between 5 and 1000),
  pago_id bigint not null unique references public.pagos(id),
  registrado_por uuid not null references public.drivers(id),
  registrado_en timestamptz not null default now(),
  foreign key (driver_id,lunes_origen) references private.coppel_peak_cierres(driver_id,lunes),
  check (extract(isodow from lunes_destino)=1 and lunes_destino>lunes_origen)
);
revoke all on private.coppel_peak_ajustes_manuales from public, anon, authenticated;

create or replace function public.coppel_peak_posibles_retroactivos(p_driver_id uuid,p_lunes date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_consulta jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' then
    raise exception 'Solo el supervisor asignado puede revisar retroactivos';
  end if;
  v_consulta:=public.coppel_peak_consultar_semana(p_driver_id,p_lunes);
  if v_consulta->>'estado' is distinct from 'cerrada' then
    raise exception 'Se requiere acceso completo a la semana COPPEL cerrada';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.tipo,x.id),'[]'::jsonb) from (
      select 'ruta'::text as tipo,r.id::text as id,r.cedis_id
      from public.rutas r join public.cedis ce on ce.id=r.cedis_id
      join public.clientes cl on cl.id=ce.cliente_id
      where r.driver_id=p_driver_id
        and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
        and public.operativo_asignado_a(ce.cliente_id,ce.id,'ih') is true
        and (r.checkin_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
        and not exists (select 1 from jsonb_array_elements(v_consulta->'rutas') old
          where old->>'ruta_id'=r.id::text)
      union all
      select 'cancelacion',c.id::text,c.cedis_id
      from public.cancelaciones c join public.cedis ce on ce.id=c.cedis_id
      join public.clientes cl on cl.id=ce.cliente_id
      where c.driver_id=p_driver_id and c.estatus='aprobada'
        and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
        and public.operativo_asignado_a(ce.cliente_id,ce.id,'ih') is true
        and (c.capturado_at at time zone 'America/Mexico_City')::date between p_lunes and p_lunes+6
        and not exists (select 1 from jsonb_array_elements(v_consulta->'cancelaciones') old
          where old->>'cancelacion_id'=c.id::text)
      union all
      select 'no_show',ns.id::text,ns.cedis_id
      from public.no_show_casos ns
      where ns.driver_id=p_driver_id and ns.cuenta='COPPEL'
        and ns.fecha_servicio between p_lunes and p_lunes+6
        and public.operativo_asignado_a(ns.cliente_id,ns.cedis_id,'ih') is true
        and not exists (select 1 from jsonb_array_elements(v_consulta->'no_shows') old
          where old->>'caso_id'=ns.id::text and old->>'estado'=ns.estado)
    ) x
  );
end;
$$;
revoke all on function public.coppel_peak_posibles_retroactivos(uuid,date) from public, anon;
grant execute on function public.coppel_peak_posibles_retroactivos(uuid,date) to authenticated;

create or replace function public.coppel_peak_listar_ajustes_manuales(p_driver_id uuid,p_lunes date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_consulta jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' then
    raise exception 'Solo el supervisor asignado puede consultar retroactivos';
  end if;
  v_consulta:=public.coppel_peak_consultar_semana(p_driver_id,p_lunes);
  if v_consulta->>'estado' is distinct from 'cerrada' then
    raise exception 'Se requiere acceso completo a la semana COPPEL cerrada';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'proveedor_id',a.proveedor_id,'lunes_destino',a.lunes_destino,
      'monto',a.monto,'motivo',a.motivo
    ) order by a.registrado_en,a.id),'[]'::jsonb)
    from private.coppel_peak_ajustes_manuales a
    where a.driver_id=p_driver_id and a.lunes_origen=p_lunes
  );
end;
$$;
revoke all on function public.coppel_peak_listar_ajustes_manuales(uuid,date) from public, anon;
grant execute on function public.coppel_peak_listar_ajustes_manuales(uuid,date) to authenticated;

create or replace function public.coppel_peak_registrar_ajuste_manual(
  p_id uuid,p_driver_id uuid,p_lunes_origen date,p_proveedor_id bigint,
  p_lunes_destino date,p_monto numeric,p_motivo text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_consulta jsonb;
  v_ajuste private.coppel_peak_ajustes_manuales%rowtype;
  v_motivo text:=btrim(p_motivo);
  v_pago_id bigint;
  v_lunes_actual date:=(now() at time zone 'America/Mexico_City')::date;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' then
    raise exception 'Solo el supervisor asignado puede registrar el retroactivo';
  end if;
  if p_id is null or p_driver_id is null or p_lunes_origen is null or p_proveedor_id is null
    or p_lunes_destino is null or extract(isodow from p_lunes_destino)<>1 or p_lunes_destino<=p_lunes_origen
    or p_monto is null or p_monto::text in ('NaN','Infinity','-Infinity')
    or p_monto=0 or abs(p_monto)>9999999999.99 or p_monto<>round(p_monto,2)
    or v_motivo is null or length(v_motivo) not between 5 and 1000 then
    raise exception 'Indica una semana posterior, un importe final distinto de cero y un motivo válido';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coppel-ajuste-manual:'||p_id::text,0));
  perform private.coppel_peak_bloqueo_semana(p_driver_id,p_lunes_origen);
  v_consulta:=public.coppel_peak_consultar_semana(p_driver_id,p_lunes_origen);
  if v_consulta->>'estado' is distinct from 'cerrada' then
    raise exception 'Se requiere acceso completo a la semana COPPEL cerrada';
  end if;
  select * into v_ajuste from private.coppel_peak_ajustes_manuales where id=p_id;
  if found then
    if v_ajuste.driver_id is distinct from p_driver_id or v_ajuste.proveedor_id is distinct from p_proveedor_id
      or v_ajuste.lunes_origen is distinct from p_lunes_origen or v_ajuste.lunes_destino is distinct from p_lunes_destino
      or v_ajuste.monto is distinct from p_monto or v_ajuste.motivo is distinct from v_motivo
      or v_ajuste.registrado_por is distinct from auth.uid() then
      raise exception 'El identificador corresponde a otro ajuste';
    end if;
    if not exists (select 1 from public.pagos p where p.id=v_ajuste.pago_id
      and p.driver_id=v_ajuste.driver_id and p.proveedor_id=v_ajuste.proveedor_id
      and p.ruta_id is null and p.concepto='ajuste' and p.monto=v_ajuste.monto
      and p.fecha=v_ajuste.lunes_destino and p.estatus in ('pendiente','pagado')) then
      raise exception 'El pago del ajuste requiere revisión';
    end if;
    return to_jsonb(v_ajuste);
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_consulta->'rutas') r
      where nullif(r->>'proveedor_id','')::bigint=p_proveedor_id
    union all
    select 1 from jsonb_array_elements(v_consulta->'cancelaciones') c
      where nullif(c->>'proveedor_id','')::bigint=p_proveedor_id
  ) then raise exception 'El proveedor no figura en la semana cerrada'; end if;
  v_lunes_actual:=v_lunes_actual-(extract(isodow from v_lunes_actual)::integer-1);
  if p_lunes_destino<v_lunes_actual then raise exception 'Selecciona la semana actual o una futura'; end if;
  perform private.coppel_peak_bloqueo_semana(p_driver_id,p_lunes_destino);
  if exists (select 1 from private.coppel_peak_cierres c
    where c.driver_id=p_driver_id and c.lunes=p_lunes_destino) then
    raise exception 'La semana de destino ya está cerrada';
  end if;
  insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
    values(p_driver_id,p_proveedor_id,null,'ajuste',p_monto,p_lunes_destino,'pendiente')
    returning id into v_pago_id;
  insert into private.coppel_peak_ajustes_manuales(
    id,driver_id,proveedor_id,lunes_origen,lunes_destino,monto,motivo,pago_id,registrado_por
  ) values (p_id,p_driver_id,p_proveedor_id,p_lunes_origen,p_lunes_destino,p_monto,v_motivo,v_pago_id,auth.uid())
    returning * into v_ajuste;
  return to_jsonb(v_ajuste);
end;
$$;
revoke all on function public.coppel_peak_registrar_ajuste_manual(uuid,uuid,date,bigint,date,numeric,text) from public, anon;
grant execute on function public.coppel_peak_registrar_ajuste_manual(uuid,uuid,date,bigint,date,numeric,text) to authenticated;

create or replace function private.coppel_peak_proteger_ajuste_manual()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='coppel_peak_ajustes_manuales' then
    raise exception 'El ajuste manual requiere corrección auditada';
  end if;
  if exists (select 1 from private.coppel_peak_ajustes_manuales a where a.pago_id=old.id) then
    if tg_op='DELETE' then raise exception 'El ajuste manual requiere corrección auditada'; end if;
    if new.driver_id is distinct from old.driver_id or new.proveedor_id is distinct from old.proveedor_id
      or new.ruta_id is distinct from old.ruta_id or new.concepto is distinct from old.concepto
      or new.monto is distinct from old.monto or new.fecha is distinct from old.fecha
      or (new.estatus is distinct from old.estatus
        and (old.estatus is distinct from 'pendiente' or new.estatus is distinct from 'pagado')) then
      raise exception 'El ajuste manual requiere corrección auditada';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_ajuste_manual() from public, anon, authenticated;
drop trigger if exists coppel_peak_proteger_ajuste_manual on private.coppel_peak_ajustes_manuales;
create trigger coppel_peak_proteger_ajuste_manual before update or delete on private.coppel_peak_ajustes_manuales
for each row execute function private.coppel_peak_proteger_ajuste_manual();
drop trigger if exists coppel_peak_proteger_pago_ajuste_manual on public.pagos;
create trigger coppel_peak_proteger_pago_ajuste_manual before update or delete on public.pagos
for each row execute function private.coppel_peak_proteger_ajuste_manual();

commit;

-- BORRADOR: no instalar ni activar antes de validar permisos y concurrencia.
-- Requiere los borradores Walmart de NO SHOW, liquidaciones y cancelaciones.
begin;

create table if not exists private.walmart_no_show_decisiones (
  caso_id uuid primary key references public.no_show_casos(id),
  solicitud_id uuid not null unique,
  driver_id uuid not null references public.drivers(id),
  proveedor_id bigint not null references public.proveedores(id),
  lunes date not null check (extract(isodow from lunes)=1),
  monto numeric(12,2) not null check (monto>0),
  pago_id bigint not null unique references public.pagos(id),
  registrado_por uuid not null references public.drivers(id),
  registrado_en timestamptz not null default clock_timestamp()
);
revoke all on private.walmart_no_show_decisiones from public, anon, authenticated;

create or replace function public.walmart_consultar_no_show_precierre(p_driver_id uuid,p_lunes date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actual date:=(pg_catalog.now() at time zone 'America/Mexico_City')::date;
  v_casos jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede consultar el precierre Walmart';
  end if;
  if p_driver_id is null or p_lunes is null or extract(isodow from p_lunes)<>1 then
    raise exception 'Selecciona un driver y el lunes de la semana';
  end if;
  v_actual:=v_actual-(extract(isodow from v_actual)::integer-1);
  if exists (
    select 1 from public.no_show_casos c
    left join private.walmart_no_show_reportes r on r.caso_id=c.id
    where c.driver_id=p_driver_id and public.operativo_normalizar(c.cuenta)='walmart'
      and coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en))<=p_lunes
      and public.operativo_asignado_a(c.cliente_id,c.cedis_id,'ih') is not true
  ) then raise exception 'Se requiere acceso a todos los CEDIS de los NO SHOW'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'caso_id',c.id,'fecha_servicio',c.fecha_servicio,'cedis_id',c.cedis_id,
    'cedis',c.cedis_nombre,'proveedor_id',c.proveedor_id,'estado',c.estado,
    'semana_registro',coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en)),'monto',c.monto_penalizacion,
    'semana_aplicada',d.lunes,'aplicado',d.caso_id is not null,
    'seleccionable',coalesce(
      r.caso_id is not null and d.caso_id is null and p_lunes>=v_actual
      and c.pago_penalizacion_id is null and c.pago_reversion_id is null
      and c.proveedor_id=r.proveedor_id
      and c.monto_penalizacion>0
      and c.monto_penalizacion=round(c.valor_servicio_contratado*0.60,2)
      and (s.caso_id is null or (s.proveedor_id=c.proveedor_id and s.driver_id=c.driver_id
        and s.monto=c.monto_penalizacion and s.saldo_pendiente=s.monto and s.monto_aplicado=0))
      and ((c.estado='reportado' and c.vence_apelacion_en<=pg_catalog.now()
          and c.vence_apelacion_en<=((p_lunes+4)::timestamp+interval '18 hours') at time zone 'America/Mexico_City')
        or (c.estado='apelacion_rechazada' and c.resuelto_en is not null
          and c.resuelto_en<=pg_catalog.now()
          and c.resuelto_en<=((p_lunes+4)::timestamp+interval '18 hours') at time zone 'America/Mexico_City')),false)
  ) order by coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en)),c.fecha_servicio,c.id),'[]'::jsonb) into v_casos
  from public.no_show_casos c
  left join private.walmart_no_show_reportes r on r.caso_id=c.id
  left join private.walmart_no_show_saldos s on s.caso_id=c.id
  left join private.walmart_no_show_decisiones d on d.caso_id=c.id
  where c.driver_id=p_driver_id and public.operativo_normalizar(c.cuenta)='walmart'
    and coalesce(r.semana_no_show,private.walmart_semana_no_show(c.creado_en))<=p_lunes
    and (d.caso_id is null or d.lunes=p_lunes);
  return jsonb_build_object('driver_id',p_driver_id,'lunes',p_lunes,
    'cantidad',jsonb_array_length(v_casos),'casos',v_casos);
end;
$$;
revoke all on function public.walmart_consultar_no_show_precierre(uuid,date) from public, anon;
grant execute on function public.walmart_consultar_no_show_precierre(uuid,date) to authenticated;

create or replace function public.walmart_aplicar_no_show_precierre(
  p_solicitud_id uuid,p_caso_id uuid,p_lunes date,p_monto_esperado numeric
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_caso public.no_show_casos%rowtype;
  v_reporte private.walmart_no_show_reportes%rowtype;
  v_existente private.walmart_no_show_decisiones%rowtype;
  v_semana jsonb;
  v_caso_revisado jsonb;
  v_pago bigint;
  v_cerrada boolean;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede aplicar el NO SHOW';
  end if;
  if p_solicitud_id is null or p_caso_id is null or p_lunes is null
    or p_monto_esperado is null or p_monto_esperado::text in ('NaN','Infinity','-Infinity')
    or p_monto_esperado<=0 or p_monto_esperado<>round(p_monto_esperado,2) then
    raise exception 'Selecciona un caso y revisa el importe';
  end if;
  select * into v_caso from public.no_show_casos where id=p_caso_id;
  if not found or v_caso.proveedor_id is null
    or public.operativo_asignado_a(v_caso.cliente_id,v_caso.cedis_id,'ih') is not true then
    raise exception 'NO SHOW no encontrado o no asignado';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('walmart-no-show-decision:'||p_solicitud_id::text,0));
  perform private.walmart_no_show_bloquear(v_caso.proveedor_id,v_caso.driver_id);
  select * into v_caso from public.no_show_casos where id=p_caso_id for update;
  select * into v_reporte from private.walmart_no_show_reportes where caso_id=p_caso_id;
  if not found then raise exception 'El NO SHOW anterior requiere revision manual'; end if;
  select * into v_existente from private.walmart_no_show_decisiones
    where caso_id=p_caso_id or solicitud_id=p_solicitud_id;
  if found then
    if v_existente.caso_id is distinct from p_caso_id or v_existente.solicitud_id is distinct from p_solicitud_id
      or v_existente.lunes is distinct from p_lunes or v_existente.monto is distinct from p_monto_esperado
      or v_existente.registrado_por is distinct from auth.uid() then
      raise exception 'El NO SHOW o la solicitud ya tiene una decision diferente';
    end if;
    if not exists (select 1 from public.pagos p where p.id=v_existente.pago_id
      and p.driver_id=v_existente.driver_id and p.proveedor_id=v_existente.proveedor_id
      and p.ruta_id is null and p.concepto='ajuste' and p.monto=-v_existente.monto
      and p.fecha=v_existente.lunes and p.estatus in ('pendiente','pagado')) then
      raise exception 'El pago NO SHOW requiere revision';
    end if;
    return to_jsonb(v_existente);
  end if;
  if to_regprocedure('private.coppel_peak_bloqueo_semana(uuid,date)') is not null then
    execute 'select private.coppel_peak_bloqueo_semana($1,$2)' using v_caso.driver_id,p_lunes;
  end if;
  if to_regclass('private.coppel_peak_cierres') is not null then
    execute 'select exists(select 1 from private.coppel_peak_cierres where driver_id=$1 and lunes=$2)'
      into v_cerrada using v_caso.driver_id,p_lunes;
    if v_cerrada then raise exception 'La semana de destino ya esta cerrada'; end if;
  end if;
  v_semana:=public.walmart_consultar_no_show_precierre(v_caso.driver_id,p_lunes);
  select x into v_caso_revisado from jsonb_array_elements(v_semana->'casos') x where x->>'caso_id'=p_caso_id::text;
  if v_caso_revisado is null or (v_caso_revisado->>'seleccionable')::boolean is not true
    or (v_caso_revisado->>'monto')::numeric is distinct from p_monto_esperado then
    raise exception 'El NO SHOW no esta disponible o cambio; vuelve a revisar el precierre';
  end if;
  perform private.walmart_registrar_saldo_no_show(p_caso_id,v_reporte.opcion,
    v_reporte.calculo-'proveedor_id'-'fecha_servicio');
  update private.walmart_no_show_saldos set saldo_pendiente=0,monto_aplicado=monto
    where caso_id=p_caso_id and saldo_pendiente=monto and monto_aplicado=0;
  if not found then raise exception 'El saldo NO SHOW cambio; vuelve a revisar'; end if;
  insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
    values(v_caso.driver_id,v_caso.proveedor_id,null,'ajuste',-p_monto_esperado,p_lunes,'pendiente')
    returning id into v_pago;
  insert into private.walmart_no_show_decisiones(caso_id,solicitud_id,driver_id,proveedor_id,lunes,monto,pago_id,registrado_por)
    values(p_caso_id,p_solicitud_id,v_caso.driver_id,v_caso.proveedor_id,p_lunes,p_monto_esperado,v_pago,auth.uid())
    returning * into v_existente;
  insert into public.no_show_eventos(caso_id,tipo,mensaje,actor_id)
    values(p_caso_id,'descuento_aplicado','Descuento seleccionado en el precierre Walmart de la semana '||p_lunes::text||'.',auth.uid());
  return to_jsonb(v_existente);
end;
$$;
revoke all on function public.walmart_aplicar_no_show_precierre(uuid,uuid,date,numeric) from public, anon, authenticated;

create or replace function public.walmart_aplicar_no_shows_precierre(
  p_driver_id uuid,p_lunes date,p_seleccion jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_fila record;
  v_resultados jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede aplicar los NO SHOW';
  end if;
  if p_driver_id is null or p_lunes is null or jsonb_typeof(p_seleccion) is distinct from 'array'
    or jsonb_array_length(p_seleccion) not between 1 and 100 then
    raise exception 'Selecciona entre uno y cien NO SHOW';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_seleccion) x
    where jsonb_typeof(x) is distinct from 'object' or x->>'caso_id' is null
      or x->>'solicitud_id' is null or x->>'monto' is null
  ) or (select count(distinct x->>'caso_id') from jsonb_array_elements(p_seleccion) x)<>jsonb_array_length(p_seleccion)
    or (select count(distinct x->>'solicitud_id') from jsonb_array_elements(p_seleccion) x)<>jsonb_array_length(p_seleccion) then
    raise exception 'La seleccion contiene casos o solicitudes invalidos o duplicados';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_seleccion) x
    left join public.no_show_casos c on c.id=(x->>'caso_id')::uuid
    where c.id is null or c.driver_id is distinct from p_driver_id or c.proveedor_id is null
      or public.operativo_asignado_a(c.cliente_id,c.cedis_id,'ih') is not true
  ) then raise exception 'La seleccion contiene casos no asignados al driver o supervisor'; end if;
  for v_fila in
    select distinct c.proveedor_id from jsonb_array_elements(p_seleccion) x
    join public.no_show_casos c on c.id=(x->>'caso_id')::uuid order by c.proveedor_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'walmart-no-show-proveedor:'||v_fila.proveedor_id::text,0));
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('walmart-no-show-driver:'||p_driver_id::text,0));
  for v_fila in select x from jsonb_array_elements(p_seleccion) x order by x->>'caso_id'
  loop
    v_resultados:=v_resultados||jsonb_build_array(public.walmart_aplicar_no_show_precierre(
      (v_fila.x->>'solicitud_id')::uuid,(v_fila.x->>'caso_id')::uuid,p_lunes,(v_fila.x->>'monto')::numeric
    ));
  end loop;
  return v_resultados;
end;
$$;
revoke all on function public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb) from public, anon;
grant execute on function public.walmart_aplicar_no_shows_precierre(uuid,date,jsonb) to authenticated;

create or replace function private.walmart_proteger_no_show_decision()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='walmart_no_show_decisiones' then
    raise exception 'La decision NO SHOW requiere correccion auditada';
  end if;
  if exists (select 1 from private.walmart_no_show_decisiones d where d.pago_id=old.id) then
    if tg_op='DELETE' then raise exception 'El descuento NO SHOW requiere correccion auditada'; end if;
    if new.driver_id is distinct from old.driver_id or new.proveedor_id is distinct from old.proveedor_id
      or new.ruta_id is distinct from old.ruta_id or new.concepto is distinct from old.concepto
      or new.monto is distinct from old.monto or new.fecha is distinct from old.fecha
      or (new.estatus is distinct from old.estatus
        and (old.estatus is distinct from 'pendiente' or new.estatus is distinct from 'pagado')) then
      raise exception 'El descuento NO SHOW requiere correccion auditada';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_no_show_decision() from public, anon, authenticated;
drop trigger if exists walmart_proteger_no_show_decision on private.walmart_no_show_decisiones;
create trigger walmart_proteger_no_show_decision before update or delete on private.walmart_no_show_decisiones
for each row execute function private.walmart_proteger_no_show_decision();
drop trigger if exists walmart_proteger_pago_no_show_decision on public.pagos;
create trigger walmart_proteger_pago_no_show_decision before update or delete on public.pagos
for each row execute function private.walmart_proteger_no_show_decision();

commit;

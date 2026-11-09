-- BORRADOR PRIVADO: no instalar ni activar. No transfiere dinero.
-- El registro privado permanece bloqueado por cobertura incompleta.
-- Faltan fuentes de descuentos, concurrencia integral, Finanzas y pantallas.
begin;

create table if not exists private.walmart_liberaciones_proveedor (
  id uuid primary key,
  proveedor_id bigint not null references public.proveedores(id),
  monto numeric(12,2) not null check (monto>0 and monto::text not in ('NaN','Infinity','-Infinity')),
  estatus text not null default 'pendiente' check (estatus in ('pendiente','pagado')),
  creado_por uuid not null references public.drivers(id),
  creado_en timestamptz not null default now(),
  ultima_ruta_en timestamptz not null,
  confirmacion_sincronizacion text not null
    check (length(btrim(confirmacion_sincronizacion)) between 5 and 1000),
  revision jsonb not null check (jsonb_typeof(revision)='object'),
  pagado_por uuid references public.drivers(id),
  pagado_en timestamptz,
  check (creado_en>=ultima_ruta_en+interval '30 days'),
  check ((estatus='pendiente' and pagado_por is null and pagado_en is null)
    or (estatus='pagado' and pagado_por is not null and pagado_en is not null))
);

create table if not exists private.walmart_liberaciones_rutas (
  ruta_id bigint primary key references private.walmart_liquidaciones(ruta_id),
  liberacion_id uuid not null references private.walmart_liberaciones_proveedor(id),
  monto numeric(12,2) not null check (monto>0 and monto::text not in ('NaN','Infinity','-Infinity'))
);

create table if not exists private.walmart_liberaciones_cancelaciones (
  cancelacion_id bigint primary key references private.walmart_cancelaciones_pagadas(cancelacion_id),
  liberacion_id uuid not null references private.walmart_liberaciones_proveedor(id),
  monto numeric(12,2) not null check (monto>0 and monto::text not in ('NaN','Infinity','-Infinity'))
);

revoke all on private.walmart_liberaciones_proveedor,private.walmart_liberaciones_rutas,
  private.walmart_liberaciones_cancelaciones from public, anon, authenticated;

create or replace function private.walmart_verificar_liberacion_contable()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_id uuid;
  v_pago private.walmart_liberaciones_proveedor%rowtype;
  v_total numeric;
begin
  v_id:=(to_jsonb(new)->>tg_argv[0])::uuid;
  select * into strict v_pago from private.walmart_liberaciones_proveedor where id=v_id;
  if exists (
    select 1 from private.walmart_liberaciones_rutas x
    join private.walmart_liquidaciones w on w.ruta_id=x.ruta_id
    where x.liberacion_id=v_id
      and (w.proveedor_id is distinct from v_pago.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) or exists (
    select 1 from private.walmart_liberaciones_cancelaciones x
    join private.walmart_cancelaciones_pagadas w on w.cancelacion_id=x.cancelacion_id
    where x.liberacion_id=v_id
      and (w.proveedor_id is distinct from v_pago.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) then raise exception 'La liberacion no coincide con los saldos originales del proveedor'; end if;

  select coalesce(sum(monto),0) into v_total from (
    select monto from private.walmart_liberaciones_rutas where liberacion_id=v_id
    union all
    select monto from private.walmart_liberaciones_cancelaciones where liberacion_id=v_id
  ) origenes;
  if v_total is distinct from v_pago.monto then
    raise exception 'El movimiento del proveedor no coincide con sus saldos originales';
  end if;
  return null;
end;
$$;
revoke all on function private.walmart_verificar_liberacion_contable() from public, anon, authenticated;

drop trigger if exists walmart_verificar_liberacion on private.walmart_liberaciones_proveedor;
create constraint trigger walmart_verificar_liberacion after insert on private.walmart_liberaciones_proveedor
deferrable initially deferred for each row execute function private.walmart_verificar_liberacion_contable('id');
drop trigger if exists walmart_verificar_ruta_liberada on private.walmart_liberaciones_rutas;
create constraint trigger walmart_verificar_ruta_liberada after insert on private.walmart_liberaciones_rutas
deferrable initially deferred for each row execute function private.walmart_verificar_liberacion_contable('liberacion_id');
drop trigger if exists walmart_verificar_cancelacion_liberada on private.walmart_liberaciones_cancelaciones;
create constraint trigger walmart_verificar_cancelacion_liberada after insert on private.walmart_liberaciones_cancelaciones
deferrable initially deferred for each row execute function private.walmart_verificar_liberacion_contable('liberacion_id');

create or replace function private.walmart_proteger_liberacion_contable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_table_name is distinct from 'walmart_liberaciones_proveedor' or tg_op='DELETE' then
    raise exception 'La liberacion requiere una correccion contable auditada';
  end if;
  if old.estatus is distinct from 'pendiente' or new.estatus is distinct from 'pagado'
    or new.id is distinct from old.id or new.proveedor_id is distinct from old.proveedor_id
    or new.monto is distinct from old.monto or new.creado_por is distinct from old.creado_por
    or new.creado_en is distinct from old.creado_en
    or new.ultima_ruta_en is distinct from old.ultima_ruta_en
    or new.confirmacion_sincronizacion is distinct from old.confirmacion_sincronizacion
    or new.revision is distinct from old.revision
    or new.pagado_por is null or new.pagado_en is null then
    raise exception 'La liberacion requiere una correccion contable auditada';
  end if;
  return new;
end;
$$;
revoke all on function private.walmart_proteger_liberacion_contable() from public, anon, authenticated;

drop trigger if exists walmart_proteger_liberacion on private.walmart_liberaciones_proveedor;
create trigger walmart_proteger_liberacion before update or delete on private.walmart_liberaciones_proveedor
for each row execute function private.walmart_proteger_liberacion_contable();
drop trigger if exists walmart_proteger_ruta_liberada on private.walmart_liberaciones_rutas;
create trigger walmart_proteger_ruta_liberada before update or delete on private.walmart_liberaciones_rutas
for each row execute function private.walmart_proteger_liberacion_contable();
drop trigger if exists walmart_proteger_cancelacion_liberada on private.walmart_liberaciones_cancelaciones;
create trigger walmart_proteger_cancelacion_liberada before update or delete on private.walmart_liberaciones_cancelaciones
for each row execute function private.walmart_proteger_liberacion_contable();

-- Esta consulta no comprueba plazo, reclamaciones ni autorizacion.
create or replace function private.walmart_saldo_retenido_sin_liberar(p_proveedor_id bigint)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  v_rutas numeric;
  v_cancelaciones numeric;
  v_num_rutas bigint;
  v_num_cancelaciones bigint;
begin
  if p_proveedor_id is null or not exists (
    select 1 from public.proveedores p where p.id=p_proveedor_id
  ) then raise exception 'Se requiere un proveedor valido'; end if;
  if exists (
    select 1 from private.walmart_liquidaciones w
    where w.proveedor_id=p_proveedor_id
      and (w.saldo_retenido is null or w.saldo_retenido::text in ('NaN','Infinity','-Infinity') or w.saldo_retenido<0)
  ) or exists (
    select 1 from private.walmart_cancelaciones_pagadas w
    where w.proveedor_id=p_proveedor_id
      and (w.saldo_retenido is null or w.saldo_retenido::text in ('NaN','Infinity','-Infinity') or w.saldo_retenido<0)
  ) then raise exception 'Hay saldos retenidos invalidos; requiere revision'; end if;
  if exists (
    select 1 from private.walmart_liberaciones_rutas x
    join private.walmart_liquidaciones w on w.ruta_id=x.ruta_id
    join private.walmart_liberaciones_proveedor p on p.id=x.liberacion_id
    where (w.proveedor_id=p_proveedor_id or p.proveedor_id=p_proveedor_id)
      and (w.proveedor_id is distinct from p.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) or exists (
    select 1 from private.walmart_liberaciones_cancelaciones x
    join private.walmart_cancelaciones_pagadas w on w.cancelacion_id=x.cancelacion_id
    join private.walmart_liberaciones_proveedor p on p.id=x.liberacion_id
    where (w.proveedor_id=p_proveedor_id or p.proveedor_id=p_proveedor_id)
      and (w.proveedor_id is distinct from p.proveedor_id or w.saldo_retenido is distinct from x.monto)
  ) then raise exception 'Los saldos liberados cambiaron; requiere revision contable'; end if;

  select coalesce(sum(w.saldo_retenido),0),count(*)
    into v_rutas,v_num_rutas
  from private.walmart_liquidaciones w
  where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
    and not exists (select 1 from private.walmart_liberaciones_rutas x where x.ruta_id=w.ruta_id);

  select coalesce(sum(w.saldo_retenido),0),count(*)
    into v_cancelaciones,v_num_cancelaciones
  from private.walmart_cancelaciones_pagadas w
  where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
    and not exists (
      select 1 from private.walmart_liberaciones_cancelaciones x where x.cancelacion_id=w.cancelacion_id
    );

  return jsonb_build_object(
    'proveedor_id',p_proveedor_id,'saldo_rutas',v_rutas,'rutas',v_num_rutas,
    'saldo_cancelaciones',v_cancelaciones,'cancelaciones',v_num_cancelaciones,
    'saldo_total',v_rutas+v_cancelaciones,'liberacion_validada',false
  );
end;
$$;
revoke all on function private.walmart_saldo_retenido_sin_liberar(bigint) from public, anon, authenticated;

create or replace function private.walmart_drivers_historicos(p_proveedor_id bigint)
returns table(driver_id uuid) language sql stable set search_path = ''
as $$
  select r.driver_id from private.walmart_proveedores_confirmados w
    join public.rutas r on r.id=w.ruta_id
    where w.proveedor_id=p_proveedor_id and r.driver_id is not null
  union
  select r.driver_id from private.walmart_liquidaciones w
    join public.rutas r on r.id=w.ruta_id
    where w.proveedor_id=p_proveedor_id and r.driver_id is not null
  union
  select w.driver_id from private.walmart_cancelaciones_pagadas w
    where w.proveedor_id=p_proveedor_id and w.driver_id is not null
  union
  select c.driver_id from public.no_show_casos c
    where c.proveedor_id=p_proveedor_id and public.operativo_normalizar(c.cuenta)='walmart'
      and c.driver_id is not null
$$;
revoke all on function private.walmart_drivers_historicos(bigint) from public, anon, authenticated;

-- Solo detecta bloqueos conocidos; no certifica fuentes pendientes de integrar.
create or replace function private.walmart_bloqueos_retencion(p_proveedor_id bigint)
returns jsonb language sql stable set search_path = ''
as $$
  with conductores as (
    select driver_id from private.walmart_drivers_historicos(p_proveedor_id)
  ), reclamos as (
    select r.* from public.pnr_reclamos r
    where r.driver_id in (select driver_id from conductores)
  ), casos as (
    select c.* from public.no_show_casos c
    where public.operativo_normalizar(c.cuenta)='walmart'
      and (c.proveedor_id=p_proveedor_id
        or (c.proveedor_id is null and c.driver_id in (select driver_id from conductores)))
  )
  select jsonb_build_object(
    'pnr_abiertos',exists (
      select 1 from reclamos r where r.estado is null or r.estado not in ('cerrada_sin_cargo','cerrada_con_cargo')
    ),
    'pnr_saldo_pendiente',exists (
      select 1 from public.pnr_descuentos d join reclamos r on r.id=d.reclamo_id
      where d.saldo_pendiente<>0 or d.saldo_pendiente is null
        or d.saldo_pendiente::text in ('NaN','Infinity','-Infinity')
    ),
    'no_show_requiere_revision',exists (
      select 1 from casos c
      where c.metodo_calculo is distinct from 'walmart_60_saldo'
        or c.proveedor_id is distinct from p_proveedor_id
        or c.pago_penalizacion_id is not null or c.pago_reversion_id is not null
        or (
          (c.estado='apelacion_aceptada' and exists (
            select 1 from private.walmart_no_show_reportes r where r.caso_id=c.id and r.proveedor_id=p_proveedor_id
          ) and not exists (
            select 1 from private.walmart_no_show_saldos s where s.caso_id=c.id
          ))
          or ((c.estado='apelacion_rechazada'
            or (c.estado='reportado' and c.vence_apelacion_en<pg_catalog.now()))
            and exists (
              select 1 from private.walmart_no_show_saldos s
              where s.caso_id=c.id and s.proveedor_id=p_proveedor_id
                and s.driver_id=c.driver_id and s.saldo_pendiente=0
            ))
        ) is not true
    ),
    'ajustes_negativos_pendientes',exists (
      select 1 from public.pagos p
      where p.estatus='pendiente' and p.concepto='ajuste'
        and (p.proveedor_id=p_proveedor_id
          or (p.proveedor_id is null and p.driver_id in (select driver_id from conductores)))
        and (p.monto<0 or p.monto is null or p.monto::text in ('NaN','Infinity','-Infinity'))
    ),
    'cobertura_completa',false
  )
$$;
revoke all on function private.walmart_bloqueos_retencion(bigint) from public, anon, authenticated;

create or replace function public.walmart_consultar_retencion_proveedor(p_proveedor_id bigint)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fuente record;
  v_encontrada boolean:=false;
  v_rol text;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or coalesce(public.operativo_rol_actual(),'') not in ('ih','coordinador') or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede consultar la retencion del proveedor';
  end if;
  v_rol:=public.operativo_rol_actual();
  for v_fuente in
    select ce.id as cedis_id,ce.cliente_id
    from private.walmart_proveedores_confirmados w
    left join public.rutas r on r.id=w.ruta_id
    left join public.cedis ce on ce.id=r.cedis_id
    where w.proveedor_id=p_proveedor_id
    union
    select ce.id,ce.cliente_id
    from private.walmart_liquidaciones w
    left join public.rutas r on r.id=w.ruta_id
    left join public.cedis ce on ce.id=r.cedis_id
    where w.proveedor_id=p_proveedor_id
    union
    select ce.id,ce.cliente_id
    from private.walmart_cancelaciones_pagadas w
    left join public.cancelaciones c on c.id=w.cancelacion_id
    left join public.cedis ce on ce.id=c.cedis_id
    where w.proveedor_id=p_proveedor_id
    union
    select ce.id,ce.cliente_id
    from public.no_show_casos c
    left join public.cedis ce on ce.id=c.cedis_id
    where public.operativo_normalizar(c.cuenta)='walmart'
      and (c.proveedor_id=p_proveedor_id
        or (c.proveedor_id is null and c.driver_id in (
          select h.driver_id from private.walmart_drivers_historicos(p_proveedor_id) h
        )))
  loop
    v_encontrada:=true;
    if v_fuente.cedis_id is null or v_fuente.cliente_id is null
      or public.operativo_asignado_a(v_fuente.cliente_id,v_fuente.cedis_id,v_rol) is not true then
      raise exception 'Se requiere acceso a todos los CEDIS del proveedor';
    end if;
  end loop;
  if not v_encontrada then raise exception 'No hay actividad Walmart confirmada para consultar'; end if;
  return jsonb_build_object(
    'plazo',private.walmart_consultar_plazo(p_proveedor_id,pg_catalog.clock_timestamp())-'rutas_sin_proveedor',
    'saldo',private.walmart_saldo_retenido_sin_liberar(p_proveedor_id),
    'bloqueos',private.walmart_bloqueos_retencion(p_proveedor_id),
    'reclamaciones_verificadas',false,'liberacion_validada',false
  );
end;
$$;
revoke all on function public.walmart_consultar_retencion_proveedor(bigint) from public, anon;
grant execute on function public.walmart_consultar_retencion_proveedor(bigint) to authenticated;

-- No se expone a la API. La cobertura incompleta bloquea incluso a este registrador.
-- Los bloqueos de tablas son provisionales y requieren pruebas de concurrencia y carga.
create or replace function private.walmart_registrar_liberacion(
  p_id uuid,p_proveedor_id bigint,p_revision jsonb,p_confirmacion text
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_actual jsonb;
  v_existente private.walmart_liberaciones_proveedor%rowtype;
  v_monto numeric;
  v_ultima timestamptz;
  v_confirmacion text:=btrim(p_confirmacion);
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih' or private.es_valida() is not true then
    raise exception 'Solo el supervisor asignado puede registrar la liberacion';
  end if;
  if p_id is null or p_proveedor_id is null or jsonb_typeof(p_revision) is distinct from 'object'
    or v_confirmacion is null or length(v_confirmacion) not between 5 and 1000 then
    raise exception 'Revisa el saldo y documenta la conciliacion de rutas sincronizadas';
  end if;
  if (private.walmart_bloqueos_retencion(p_proveedor_id)->>'cobertura_completa')::boolean is not true then
    raise exception 'La revision de descuentos todavia no cubre todas las fuentes';
  end if;
  lock table public.drivers,public.proveedores,public.clientes,public.cedis,public.asignaciones_operativas,
    public.rutas,public.cancelaciones,public.pnr_reclamos,public.pnr_descuentos,public.no_show_casos,public.pagos,
    private.walmart_proveedores_confirmados,private.walmart_liquidaciones,private.walmart_cancelaciones_pagadas,
    private.walmart_no_show_saldos,private.walmart_no_show_reportes,private.walmart_liberaciones_proveedor,
    private.walmart_liberaciones_rutas,private.walmart_liberaciones_cancelaciones in share row exclusive mode;
  v_actual:=public.walmart_consultar_retencion_proveedor(p_proveedor_id);
  select * into v_existente from private.walmart_liberaciones_proveedor where id=p_id;
  if found then
    if v_existente.proveedor_id is distinct from p_proveedor_id
      or v_existente.creado_por is distinct from auth.uid()
      or v_existente.revision is distinct from p_revision
      or v_existente.confirmacion_sincronizacion is distinct from v_confirmacion then
      raise exception 'El identificador corresponde a otra liberacion';
    end if;
    return jsonb_build_object('id',v_existente.id,'monto',v_existente.monto,'estatus',v_existente.estatus);
  end if;
  if v_actual is distinct from p_revision then
    raise exception 'La revision de retencion cambio; consulta el proveedor nuevamente';
  end if;
  if (v_actual->>'reclamaciones_verificadas')::boolean is not true
    or (v_actual->'bloqueos'->>'cobertura_completa')::boolean is not true
    or (v_actual->'bloqueos'->>'pnr_abiertos')::boolean is not false
    or (v_actual->'bloqueos'->>'pnr_saldo_pendiente')::boolean is not false
    or (v_actual->'bloqueos'->>'no_show_requiere_revision')::boolean is not false
    or (v_actual->'bloqueos'->>'ajustes_negativos_pendientes')::boolean is not false then
    raise exception 'La retencion tiene reclamaciones o descuentos pendientes de revision';
  end if;
  if v_actual->'plazo'->>'estado' is distinct from 'calculado'
    or (v_actual->'plazo'->>'plazo_cumplido')::boolean is not true then
    raise exception 'El plazo de retencion no esta cumplido o requiere revision';
  end if;
  v_monto:=(v_actual->'saldo'->>'saldo_total')::numeric;
  v_ultima:=(v_actual->'plazo'->>'ultima_ruta')::timestamptz;
  if v_monto is null or v_monto::text in ('NaN','Infinity','-Infinity')
    or v_monto<=0 or v_monto>9999999999.99 or v_monto<>round(v_monto,2)
    or v_ultima is null then raise exception 'No hay saldo o ultima ruta validos para liberar'; end if;
  insert into private.walmart_liberaciones_proveedor(
    id,proveedor_id,monto,creado_por,ultima_ruta_en,confirmacion_sincronizacion,revision
  ) values (p_id,p_proveedor_id,v_monto,auth.uid(),v_ultima,v_confirmacion,p_revision);
  insert into private.walmart_liberaciones_rutas(ruta_id,liberacion_id,monto)
    select w.ruta_id,p_id,w.saldo_retenido from private.walmart_liquidaciones w
    where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
      and not exists (select 1 from private.walmart_liberaciones_rutas x where x.ruta_id=w.ruta_id);
  insert into private.walmart_liberaciones_cancelaciones(cancelacion_id,liberacion_id,monto)
    select w.cancelacion_id,p_id,w.saldo_retenido from private.walmart_cancelaciones_pagadas w
    where w.proveedor_id=p_proveedor_id and w.saldo_retenido>0
      and not exists (
        select 1 from private.walmart_liberaciones_cancelaciones x where x.cancelacion_id=w.cancelacion_id
      );
  return jsonb_build_object('id',p_id,'monto',v_monto,'estatus','pendiente');
end;
$$;
revoke all on function private.walmart_registrar_liberacion(uuid,bigint,jsonb,text) from public, anon, authenticated;

-- Solo lectura de movimientos ya registrados; no permite crear ni liberar pagos.
create or replace function public.walmart_mis_liberaciones(p_desde date)
returns table(id uuid,concepto text,monto numeric,fecha date,estatus text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_desde is null then
    raise exception 'Se requiere una sesion y fecha validas para consultar pagos';
  end if;
  if not exists (
    select 1 from public.drivers d
    join public.proveedores p on p.id=d.proveedor_id and p.titular_id=d.id
    where d.id=auth.uid() and d.rol::text in ('driver','flotillero')
      and lower(coalesce(d.estatus::text,''))='activo'
  ) then raise exception 'Sin permiso para consultar movimientos del proveedor'; end if;
  return query
    select l.id,'liberacion_retencion_walmart'::text,l.monto,
      (l.creado_en at time zone 'America/Mexico_City')::date,l.estatus
    from private.walmart_liberaciones_proveedor l
    join public.proveedores p on p.id=l.proveedor_id and p.titular_id=auth.uid()
    join public.drivers d on d.id=auth.uid() and d.proveedor_id=p.id
      and d.rol::text in ('driver','flotillero')
      and lower(coalesce(d.estatus::text,''))='activo'
    where (l.creado_en at time zone 'America/Mexico_City')::date>=p_desde
    order by l.creado_en desc,l.id desc;
end;
$$;
revoke all on function public.walmart_mis_liberaciones(date) from public, anon;
grant execute on function public.walmart_mis_liberaciones(date) to authenticated;

commit;

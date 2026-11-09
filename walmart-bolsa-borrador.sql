-- BORRADOR: no instalar ni activar antes de probar permisos, concurrencia y avisos.
-- Los movimientos son pendientes; no acreditan una transferencia bancaria.
begin;

create table if not exists private.walmart_bolsa_decisiones (
  liberacion_id uuid primary key references private.walmart_liberaciones_proveedor(id),
  descuento numeric(12,2) not null check (descuento>=0 and descuento::text not in ('NaN','Infinity','-Infinity')),
  motivo text,
  lunes_pago date not null check (extract(isodow from lunes_pago)=1),
  check ((descuento=0 and motivo is null) or (descuento>0 and length(btrim(motivo)) between 5 and 1000))
);
revoke all on private.walmart_bolsa_decisiones from public, anon, authenticated;

create or replace function public.walmart_decidir_bolsa(
  p_id uuid,p_proveedor_id bigint,p_revision jsonb,p_descuento numeric,p_motivo text,p_confirmado boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actual jsonb;
  v_existente private.walmart_liberaciones_proveedor%rowtype;
  v_decision private.walmart_bolsa_decisiones%rowtype;
  v_monto numeric;
  v_ultima timestamptz;
  v_motivo text:=nullif(btrim(p_motivo),'');
  v_lunes date:=(pg_catalog.clock_timestamp() at time zone 'America/Mexico_City')::date;
  v_confirmacion constant text:='Coordinacion confirma que las rutas estan sincronizadas';
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'coordinador' or private.es_valida() is not true then
    raise exception 'Solo el coordinador asignado puede decidir sobre la bolsa Walmart';
  end if;
  if p_id is null or p_proveedor_id is null or jsonb_typeof(p_revision) is distinct from 'object'
    or p_confirmado is not true or p_descuento is null
    or p_descuento::text in ('NaN','Infinity','-Infinity') or p_descuento<0
    or p_descuento>9999999999.99 or p_descuento<>round(p_descuento,2)
    or (p_descuento=0 and v_motivo is not null)
    or (p_descuento>0 and (v_motivo is null or length(v_motivo) not between 5 and 1000)) then
    raise exception 'Revisa la bolsa, confirma las rutas y documenta cualquier descuento';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('walmart-bolsa-solicitud:'||p_id::text,0));
  lock table public.drivers,public.proveedores,public.clientes,public.cedis,public.asignaciones_operativas,
    public.rutas,public.cancelaciones,public.pnr_reclamos,public.pnr_descuentos,public.no_show_casos,public.pagos,
    private.walmart_proveedores_confirmados,private.walmart_liquidaciones,private.walmart_cancelaciones_pagadas,
    private.walmart_no_show_saldos,private.walmart_no_show_reportes,private.walmart_liberaciones_proveedor,
    private.walmart_liberaciones_rutas,private.walmart_liberaciones_cancelaciones,private.walmart_bolsa_decisiones
    in share row exclusive mode;
  select * into v_existente from private.walmart_liberaciones_proveedor where id=p_id;
  if found then
    select * into v_decision from private.walmart_bolsa_decisiones where liberacion_id=p_id;
    if not found or v_existente.proveedor_id is distinct from p_proveedor_id
      or v_existente.creado_por is distinct from auth.uid() or v_existente.revision is distinct from p_revision
      or v_decision.descuento is distinct from p_descuento or v_decision.motivo is distinct from v_motivo then
      raise exception 'El identificador corresponde a otra decision';
    end if;
    perform public.walmart_consultar_retencion_proveedor(p_proveedor_id);
    return jsonb_build_object('id',p_id,'acumulado',v_existente.monto,'descuento',v_decision.descuento,
      'neto',v_existente.monto-v_decision.descuento,'lunes_pago',v_decision.lunes_pago,'estatus',v_existente.estatus);
  end if;
  v_actual:=public.walmart_consultar_retencion_proveedor(p_proveedor_id);
  if v_actual is distinct from p_revision then
    raise exception 'La bolsa cambio; vuelve a consultar antes de confirmar';
  end if;
  if v_actual->>'reclamaciones_verificadas' is distinct from 'true'
    or v_actual->'bloqueos'->>'cobertura_completa' is distinct from 'true'
    or v_actual->'bloqueos'->>'pnr_abiertos' is distinct from 'false'
    or v_actual->'bloqueos'->>'pnr_saldo_pendiente' is distinct from 'false'
    or v_actual->'bloqueos'->>'no_show_requiere_revision' is distinct from 'false'
    or v_actual->'bloqueos'->>'ajustes_negativos_pendientes' is distinct from 'false' then
    raise exception 'La bolsa tiene descuentos sin cobertura verificada; no se puede aprobar';
  end if;
  if v_actual->'plazo'->>'estado' is distinct from 'calculado'
    or (v_actual->'plazo'->>'plazo_cumplido')::boolean is not true then
    raise exception 'No han transcurrido 30 dias desde el cierre de la ultima ruta o se requiere revision';
  end if;
  v_monto:=(v_actual->'saldo'->>'saldo_total')::numeric;
  v_ultima:=(v_actual->'plazo'->>'ultima_ruta')::timestamptz;
  if v_monto is null or v_monto::text in ('NaN','Infinity','-Infinity') or v_monto<=0
    or v_monto>9999999999.99 or v_monto<>round(v_monto,2) or v_ultima is null
    or p_descuento>v_monto then
    raise exception 'El descuento no puede exceder la bolsa acumulada';
  end if;
  v_lunes:=v_lunes-(extract(isodow from v_lunes)::integer-1)+7;
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
      and not exists (select 1 from private.walmart_liberaciones_cancelaciones x where x.cancelacion_id=w.cancelacion_id);
  insert into private.walmart_bolsa_decisiones(liberacion_id,descuento,motivo,lunes_pago)
    values(p_id,p_descuento,v_motivo,v_lunes);
  return jsonb_build_object('id',p_id,'acumulado',v_monto,'descuento',p_descuento,
    'neto',v_monto-p_descuento,'lunes_pago',v_lunes,'estatus','pendiente');
end;
$$;
revoke all on function public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean) from public, anon;
grant execute on function public.walmart_decidir_bolsa(uuid,bigint,jsonb,numeric,text,boolean) to authenticated;

create or replace function private.walmart_proteger_bolsa_decision()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'La decision de bolsa requiere correccion auditada';
end;
$$;
revoke all on function private.walmart_proteger_bolsa_decision() from public, anon, authenticated;
drop trigger if exists walmart_proteger_bolsa_decision on private.walmart_bolsa_decisiones;
create trigger walmart_proteger_bolsa_decision before update or delete on private.walmart_bolsa_decisiones
for each row execute function private.walmart_proteger_bolsa_decision();

create or replace function public.walmart_mi_bolsa()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_proveedor_id bigint;
  v_plazo jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesion'; end if;
  select p.id into v_proveedor_id
  from public.drivers d
  join public.proveedores p on p.id=d.proveedor_id and p.titular_id=d.id
  where d.id=auth.uid() and d.rol::text='flotillero'
    and lower(coalesce(d.estatus::text,''))='activo'
    and p.tipo='flotillero' and p.activo;
  if not found then raise exception 'Solo el flotillero titular activo puede consultar su bolsa'; end if;
  v_plazo:=private.walmart_consultar_plazo(v_proveedor_id,pg_catalog.clock_timestamp());
  return jsonb_build_object(
    'proveedor_id',v_proveedor_id,
    'saldo',private.walmart_saldo_retenido_sin_liberar(v_proveedor_id),
    'plazo',v_plazo-'rutas_sin_proveedor',
    'liberacion_validada',false
  );
end;
$$;
revoke all on function public.walmart_mi_bolsa() from public, anon;
grant execute on function public.walmart_mi_bolsa() to authenticated;

create or replace function public.walmart_mis_movimientos_bolsa(p_desde date)
returns table(id uuid,concepto text,monto numeric,fecha date,estatus text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_desde is null or not exists (
    select 1 from public.drivers d
    join public.proveedores p on p.id=d.proveedor_id and p.titular_id=d.id
    where d.id=auth.uid() and d.rol::text='flotillero'
      and lower(coalesce(d.estatus::text,''))='activo'
      and p.tipo='flotillero' and p.activo
  ) then raise exception 'Se requiere una sesion activa y fecha validas'; end if;
  return query
    select l.id,'liberacion_retencion_walmart'::text,l.monto-b.descuento,b.lunes_pago,l.estatus
    from private.walmart_liberaciones_proveedor l
    join private.walmart_bolsa_decisiones b on b.liberacion_id=l.id
    join public.proveedores p on p.id=l.proveedor_id and p.titular_id=auth.uid()
      and p.tipo='flotillero' and p.activo
    join public.drivers d on d.id=auth.uid() and d.proveedor_id=p.id and d.rol::text='flotillero'
      and lower(coalesce(d.estatus::text,''))='activo'
    where b.lunes_pago>=p_desde and l.monto>b.descuento
    order by b.lunes_pago desc,l.id desc;
end;
$$;
revoke all on function public.walmart_mis_movimientos_bolsa(date) from public, anon;
grant execute on function public.walmart_mis_movimientos_bolsa(date) to authenticated;

commit;

-- BORRADOR INCOMPLETO: no ejecutar ni publicar.
-- Falta integrar la captura en pantalla y los ajustes de semanas cerradas.
begin;

create table if not exists private.coppel_peak_cancelaciones (
  cancelacion_id bigint primary key references public.cancelaciones(id),
  driver_id uuid not null references public.drivers(id),
  lunes date not null,
  proveedor_id bigint not null references public.proveedores(id),
  registro_fiscal text not null,
  base numeric(12,2) not null check (base>=0),
  fiscal jsonb not null,
  pnr_aplicado numeric(12,2) not null default 0
    check (pnr_aplicado>=0 and pnr_aplicado::text not in ('NaN','Infinity','-Infinity')),
  pago_id bigint unique references public.pagos(id),
  registrado_por uuid not null references public.drivers(id),
  registrado_en timestamptz not null default now()
);
revoke all on private.coppel_peak_cancelaciones from public, anon, authenticated;

create table if not exists private.coppel_peak_cancelaciones_pnr (
  cancelacion_id bigint not null references private.coppel_peak_cancelaciones(cancelacion_id),
  reclamo_id uuid not null references public.pnr_descuentos(reclamo_id),
  driver_id uuid not null references public.drivers(id),
  monto numeric(12,2) not null check (monto>0 and monto::text not in ('NaN','Infinity','-Infinity')),
  aplicado_en timestamptz not null default now(),
  primary key (cancelacion_id,reclamo_id)
);
revoke all on private.coppel_peak_cancelaciones_pnr from public, anon, authenticated;

create or replace function public.coppel_peak_registrar_cancelacion(
  p_cancelacion_id bigint,p_base numeric,p_proveedor_confirmado bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_rol text;
  v_cancelacion record;
  v_anterior private.coppel_peak_cancelaciones%rowtype;
  v_lunes date;
  v_retencion numeric;
  v_comision numeric;
  v_iva numeric;
  v_fiscal jsonb;
  v_pago_id bigint;
  v_descuento record;
  v_disponible numeric(12,2);
  v_aplicar numeric(12,2);
  v_pnr numeric(12,2):=0;
  v_pago record;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true then
    raise exception 'Sin permiso para registrar la cancelación COPPEL';
  end if;
  v_rol:=public.operativo_rol_actual();
  if v_rol is null or v_rol not in ('ih','coordinador','ops','master') then
    raise exception 'Sin permiso para registrar la cancelación COPPEL';
  end if;
  if p_cancelacion_id is null or p_proveedor_confirmado is null or p_base is null
    or p_base::text in ('NaN','Infinity','-Infinity') or p_base<0 or p_base>9999999999.99
    or p_base<>round(p_base,2) then
    raise exception 'Indica el proveedor y un importe base válido';
  end if;
  select c.driver_id,c.cedis_id,c.estatus,ce.cliente_id,
    (c.capturado_at at time zone 'America/Mexico_City')::date as dia,
    d.proveedor_id,p.tipo_registro
  into v_cancelacion
  from public.cancelaciones c
  join public.cedis ce on ce.id=c.cedis_id
  join public.clientes cl on cl.id=ce.cliente_id
  join public.drivers d on d.id=c.driver_id
  left join public.proveedores p on p.id=d.proveedor_id
  where c.id=p_cancelacion_id and public.operativo_normalizar(cl.nombre) in ('coppel','coppelbt')
  for update of c;
  if not found or v_cancelacion.estatus is distinct from 'aprobada'
    or v_cancelacion.dia not between date '2026-11-09' and date '2027-01-10'
    or v_cancelacion.dia is null
    or (v_rol in ('ih','coordinador')
      and public.operativo_asignado_a(v_cancelacion.cliente_id,v_cancelacion.cedis_id,v_rol) is not true) then
    raise exception 'Cancelación COPPEL aprobada y dentro de tu alcance requerida';
  end if;
  v_lunes:=v_cancelacion.dia-(extract(isodow from v_cancelacion.dia)::integer-1);
  perform private.coppel_peak_bloqueo_semana(v_cancelacion.driver_id,v_lunes);
  if exists (select 1 from private.coppel_peak_cierres c
    where c.driver_id=v_cancelacion.driver_id and c.lunes=v_lunes) then
    raise exception 'La semana ya está cerrada; registra la diferencia como ajuste retroactivo';
  end if;
  select * into v_anterior from private.coppel_peak_cancelaciones where cancelacion_id=p_cancelacion_id;
  if found then
    if v_anterior.base is distinct from p_base or v_anterior.proveedor_id is distinct from p_proveedor_confirmado then
      raise exception 'La cancelación ya tiene un importe registrado; requiere revisión';
    end if;
    if v_anterior.base>0 then
      select p.driver_id,p.proveedor_id,p.ruta_id,p.concepto,p.monto,p.estatus into v_pago
      from public.pagos p where p.id=v_anterior.pago_id;
      if not found or v_pago.driver_id is distinct from v_anterior.driver_id
        or v_pago.proveedor_id is distinct from v_anterior.proveedor_id
        or v_pago.ruta_id is not null or v_pago.concepto is distinct from 'servicio'
        or v_pago.monto is distinct from (v_anterior.fiscal->>'pago_proveedor')::numeric-v_anterior.pnr_aplicado
        or v_pago.estatus is null or v_pago.estatus not in ('pendiente','pagado') then
        raise exception 'El pago de cancelación COPPEL cambió; requiere revisión';
      end if;
    end if;
    if (select coalesce(sum(monto),0) from private.coppel_peak_cancelaciones_pnr
      where cancelacion_id=p_cancelacion_id) is distinct from v_anterior.pnr_aplicado
      or exists (select 1 from private.coppel_peak_cancelaciones_pnr
        where cancelacion_id=p_cancelacion_id and driver_id is distinct from v_anterior.driver_id) then
      raise exception 'El historial PNR de la cancelación COPPEL requiere revisión';
    end if;
    return jsonb_build_object('pago_id',v_anterior.pago_id,'fiscal',v_anterior.fiscal,
      'pnr_aplicado',v_anterior.pnr_aplicado);
  end if;
  if v_cancelacion.proveedor_id is distinct from p_proveedor_confirmado
    or v_cancelacion.tipo_registro is null
    or v_cancelacion.tipo_registro not in ('FACTURA','SIN FACTURA') then
    raise exception 'El proveedor o su registro fiscal no coincide; revisa antes de registrar';
  end if;
  if exists (
    select 1 from public.liquidaciones l join public.rutas r on r.id=l.ruta_id
    where r.driver_id=v_cancelacion.driver_id and l.cuenta='COPPEL'
      and (r.checkin_at at time zone 'America/Mexico_City')::date between v_lunes and v_lunes+6
      and (l.proveedor_id is distinct from p_proveedor_confirmado
        or l.registro_fiscal is distinct from v_cancelacion.tipo_registro)
  ) then raise exception 'Hay proveedores o registros fiscales distintos en la semana; requiere revisión'; end if;
  select max(valor) filter (where clave='retencion_sin_factura'),
    max(valor) filter (where clave='comision_sin_factura'),max(valor) filter (where clave='iva')
    into v_retencion,v_comision,v_iva from public.parametros_pago
    where clave in ('retencion_sin_factura','comision_sin_factura','iva');
  v_fiscal:=private.coppel_peak_fiscal_bono(p_base,v_cancelacion.tipo_registro,v_retencion,v_comision,v_iva);
  if (v_fiscal->>'pago_proveedor')::numeric>9999999999.99 then
    raise exception 'El importe fiscalizado excede el máximo permitido para el pago';
  end if;
  insert into private.coppel_peak_cancelaciones
    (cancelacion_id,driver_id,lunes,proveedor_id,registro_fiscal,base,fiscal,registrado_por)
  values(p_cancelacion_id,v_cancelacion.driver_id,v_lunes,p_proveedor_confirmado,
    v_cancelacion.tipo_registro,p_base,v_fiscal,auth.uid());
  v_disponible:=(v_fiscal->>'pago_proveedor')::numeric;
  for v_descuento in
    select d.reclamo_id,d.driver_id,d.saldo_pendiente from public.pnr_descuentos d
    where d.driver_id=v_cancelacion.driver_id and d.saldo_pendiente>0
    order by d.creado_en,d.reclamo_id for update of d
  loop
    exit when v_disponible<=0;
    if v_descuento.saldo_pendiente::text in ('NaN','Infinity','-Infinity') then
      raise exception 'El saldo PNR requiere revisión';
    end if;
    v_aplicar:=least(v_disponible,v_descuento.saldo_pendiente);
    update public.pnr_descuentos set saldo_pendiente=saldo_pendiente-v_aplicar,
      monto_aplicado=monto_aplicado+v_aplicar,
      aplicado_en=case when saldo_pendiente-v_aplicar=0 then now() else aplicado_en end
      where reclamo_id=v_descuento.reclamo_id;
    insert into private.coppel_peak_cancelaciones_pnr(cancelacion_id,reclamo_id,driver_id,monto)
      values(p_cancelacion_id,v_descuento.reclamo_id,v_descuento.driver_id,v_aplicar);
    insert into public.pnr_reclamo_eventos(reclamo_id,tipo,mensaje)
      values(v_descuento.reclamo_id,'descuento_aplicado',
        'Se aplicaron '||to_char(v_aplicar,'FM$999,999,999,990.00')
        ||' al pago de la cancelación COPPEL '||p_cancelacion_id::text||'.');
    v_disponible:=v_disponible-v_aplicar;
    v_pnr:=v_pnr+v_aplicar;
  end loop;
  if p_base>0 then
    insert into public.pagos(driver_id,proveedor_id,ruta_id,concepto,monto,fecha,estatus)
    values(v_cancelacion.driver_id,p_proveedor_confirmado,null,'servicio',
      v_disponible,v_cancelacion.dia,'pendiente')
    returning id into v_pago_id;
  end if;
  update private.coppel_peak_cancelaciones set pago_id=v_pago_id,pnr_aplicado=v_pnr
    where cancelacion_id=p_cancelacion_id;
  return jsonb_build_object('pago_id',v_pago_id,'fiscal',v_fiscal,'pnr_aplicado',v_pnr);
end;
$$;
revoke all on function public.coppel_peak_registrar_cancelacion(bigint,numeric,bigint) from public, anon;
grant execute on function public.coppel_peak_registrar_cancelacion(bigint,numeric,bigint) to authenticated;

create or replace function private.coppel_peak_proteger_cancelacion_pnr()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'La aplicación PNR de la cancelación requiere corrección auditada';
end;
$$;
revoke all on function private.coppel_peak_proteger_cancelacion_pnr() from public, anon, authenticated;
drop trigger if exists coppel_peak_proteger_cancelacion_pnr on private.coppel_peak_cancelaciones_pnr;
create trigger coppel_peak_proteger_cancelacion_pnr before update or delete
on private.coppel_peak_cancelaciones_pnr for each row
execute function private.coppel_peak_proteger_cancelacion_pnr();

create or replace function private.coppel_peak_proteger_cancelacion_registrada()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.coppel_peak_cancelaciones ca where ca.cancelacion_id=old.id) then
    if tg_op='DELETE' then raise exception 'La cancelación COPPEL registrada requiere corrección auditada'; end if;
    if new.id is distinct from old.id or new.driver_id is distinct from old.driver_id
      or new.cedis_id is distinct from old.cedis_id or new.capturado_at is distinct from old.capturado_at
      or new.estatus is distinct from old.estatus then
      raise exception 'La cancelación COPPEL registrada requiere corrección auditada';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_cancelacion_registrada() from public, anon, authenticated;
drop trigger if exists coppel_peak_proteger_cancelacion_registrada on public.cancelaciones;
create trigger coppel_peak_proteger_cancelacion_registrada before update or delete on public.cancelaciones
for each row execute function private.coppel_peak_proteger_cancelacion_registrada();

create or replace function private.coppel_peak_proteger_pago_cancelacion()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.coppel_peak_cancelaciones ca where ca.pago_id=old.id) then
    if tg_op='DELETE' then raise exception 'El pago de cancelación COPPEL requiere corrección auditada'; end if;
    if new.driver_id is distinct from old.driver_id or new.proveedor_id is distinct from old.proveedor_id
      or new.ruta_id is distinct from old.ruta_id or new.concepto is distinct from old.concepto
      or new.monto is distinct from old.monto or new.fecha is distinct from old.fecha
      or (new.estatus is distinct from old.estatus
        and (old.estatus is distinct from 'pendiente' or new.estatus is distinct from 'pagado')) then
      raise exception 'El pago de cancelación COPPEL requiere corrección auditada';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.coppel_peak_proteger_pago_cancelacion() from public, anon, authenticated;
drop trigger if exists coppel_peak_proteger_pago_cancelacion on public.pagos;
create trigger coppel_peak_proteger_pago_cancelacion before update or delete on public.pagos
for each row execute function private.coppel_peak_proteger_pago_cancelacion();

commit;

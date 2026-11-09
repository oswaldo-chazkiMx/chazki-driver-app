-- BORRADOR: no ejecutar ni conectar a pagos.
-- Falta certificar toda la actividad del proveedor y coordinar las altas concurrentes de PNR.
begin;

create table if not exists private.postval_pnr_lotes (
  postval_id uuid primary key references private.postvalorizaciones_coppel(id),
  monto_disponible numeric(12,2) not null check (monto_disponible>=0),
  monto_aplicado numeric(12,2) not null default 0 check (monto_aplicado>=0 and monto_aplicado<=monto_disponible),
  creado_en timestamptz not null default now()
);
revoke all on private.postval_pnr_lotes from public, anon, authenticated;

create table if not exists private.postval_pnr_aplicaciones (
  postval_id uuid not null references private.postval_pnr_lotes(postval_id),
  reclamo_id uuid not null references public.pnr_descuentos(reclamo_id),
  driver_id uuid not null references public.drivers(id),
  monto numeric(12,2) not null check (monto>0),
  aplicado_en timestamptz not null default now(),
  primary key (postval_id,reclamo_id)
);
revoke all on private.postval_pnr_aplicaciones from public, anon, authenticated;

create or replace function private.postval_aplicar_pnr_a_abono(
  p_postval_id uuid,p_monto_disponible numeric
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_concepto private.postvalorizaciones_coppel%rowtype;
  v_lote private.postval_pnr_lotes%rowtype;
  v_descuento record;
  v_disponible numeric(12,2);
  v_aplicar numeric(12,2);
  v_total numeric(12,2):=0;
begin
  if p_postval_id is null or p_monto_disponible is null
    or p_monto_disponible::text in ('NaN','Infinity','-Infinity')
    or p_monto_disponible<0 or p_monto_disponible>9999999999.99
    or p_monto_disponible<>round(p_monto_disponible,2) then
    raise exception 'Se requiere un importe disponible valido';
  end if;
  select * into v_concepto from private.postvalorizaciones_coppel where id=p_postval_id;
  if not found or v_concepto.estado is distinct from 'aprobado'
    or v_concepto.tipo is distinct from 'abono' then
    raise exception 'Se requiere una post valorizacion de abono aprobada';
  end if;
  perform private.coppel_postval_bloqueo_proveedor(v_concepto.proveedor_id,v_concepto.lunes);
  select * into v_lote from private.postval_pnr_lotes where postval_id=p_postval_id;
  if found then
    if v_lote.monto_disponible is distinct from p_monto_disponible then
      raise exception 'La post valorizacion ya tiene otro importe aplicado';
    end if;
    return jsonb_build_object('aplicado',v_lote.monto_aplicado,
      'restante',v_lote.monto_disponible-v_lote.monto_aplicado);
  end if;
  insert into private.postval_pnr_lotes(postval_id,monto_disponible)
    values(p_postval_id,p_monto_disponible);
  v_disponible:=p_monto_disponible;
  for v_descuento in
    select d.reclamo_id,d.driver_id,d.saldo_pendiente
    from public.pnr_descuentos d
    where d.saldo_pendiente>0 and d.driver_id in (
      select distinct a.driver_id
      from private.postval_actividad_confirmada(v_concepto.proveedor_id,v_concepto.lunes) a
    )
    order by d.creado_en,d.reclamo_id
    for update of d
  loop
    exit when v_disponible<=0;
    v_aplicar:=least(v_descuento.saldo_pendiente,v_disponible);
    update public.pnr_descuentos
      set saldo_pendiente=saldo_pendiente-v_aplicar,
        monto_aplicado=monto_aplicado+v_aplicar,
        aplicado_en=case when saldo_pendiente-v_aplicar=0 then now() else aplicado_en end
      where reclamo_id=v_descuento.reclamo_id;
    insert into private.postval_pnr_aplicaciones(postval_id,reclamo_id,driver_id,monto)
      values(p_postval_id,v_descuento.reclamo_id,v_descuento.driver_id,v_aplicar);
    insert into public.pnr_reclamo_eventos(reclamo_id,tipo,mensaje)
      values(v_descuento.reclamo_id,'descuento_aplicado',
        'Se aplicaron '||to_char(v_aplicar,'FM$999,999,999,990.00')
        ||' a una post valorizacion semanal del proveedor.');
    v_disponible:=v_disponible-v_aplicar;
    v_total:=v_total+v_aplicar;
  end loop;
  update private.postval_pnr_lotes set monto_aplicado=v_total where postval_id=p_postval_id;
  return jsonb_build_object('aplicado',v_total,'restante',v_disponible);
end;
$$;
revoke all on function private.postval_aplicar_pnr_a_abono(uuid,numeric) from public, anon, authenticated;

commit;

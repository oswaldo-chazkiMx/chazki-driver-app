-- BORRADOR: no ejecutar ni publicar hasta integrar y probar el flujo completo.
begin;

create table if not exists private.walmart_decisiones_retencion (
  ruta_id bigint primary key references public.rutas(id),
  aplicar_retencion boolean not null,
  porcentaje_retencion smallint check (porcentaje_retencion in (0,10,15,25)),
  seleccionado_por uuid not null references public.drivers(id),
  seleccionado_en timestamptz not null default clock_timestamp()
);
revoke all on private.walmart_decisiones_retencion from public, anon, authenticated;

create table if not exists private.walmart_proveedores_confirmados (
  ruta_id bigint primary key references public.rutas(id),
  proveedor_id bigint not null references public.proveedores(id),
  opcion smallint not null check (opcion in (1,2)),
  confirmado_por uuid not null references public.drivers(id),
  confirmado_en timestamptz not null default clock_timestamp()
);
revoke all on private.walmart_proveedores_confirmados from public, anon, authenticated;

create or replace function public.walmart_consultar_retencion(p_ruta_id bigint)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_aplicar boolean;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or private.es_valida() is not true
    or not exists (
      select 1 from public.rutas r
      join public.cedis ce on ce.id=r.cedis_id
      join public.clientes cl on cl.id=ce.cliente_id
      where r.id=p_ruta_id and r.estado='cerrada'
        and public.operativo_normalizar(cl.nombre)='walmart'
        and public.operativo_asignado_a(ce.cliente_id,ce.id,'ih') is true
    ) then
    raise exception 'Solo el supervisor asignado puede consultar la retencion de una ruta Walmart cerrada';
  end if;
  select d.aplicar_retencion into v_aplicar
    from private.walmart_decisiones_retencion d where d.ruta_id=p_ruta_id;
  return coalesce(v_aplicar,true);
end;
$$;
revoke all on function public.walmart_consultar_retencion(bigint) from public, anon;
grant execute on function public.walmart_consultar_retencion(bigint) to authenticated;

create or replace function public.walmart_elegir_retencion(p_ruta_id bigint, p_aplicar boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_ruta record;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or private.es_valida() is not true then
    raise exception 'Solo el supervisor autorizado puede elegir la retencion Walmart';
  end if;
  if p_aplicar is null then raise exception 'Selecciona si aplica la retencion Walmart'; end if;
  select r.id,r.estado,r.cedis_id,ce.cliente_id,cl.nombre as cliente
    into v_ruta
    from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=p_ruta_id for update of r;
  if not found or v_ruta.estado is distinct from 'cerrada'
    or public.operativo_normalizar(v_ruta.cliente)<>'walmart'
    or public.operativo_asignado_a(v_ruta.cliente_id,v_ruta.cedis_id,'ih') is not true then
    raise exception 'Ruta Walmart cerrada y asignada requerida';
  end if;
  if exists (select 1 from public.liquidaciones l where l.ruta_id=p_ruta_id)
    or exists (select 1 from public.pagos p where p.ruta_id=p_ruta_id)
    or exists (select 1 from public.validaciones_pendientes v
      where v.ruta_id=p_ruta_id and v.estatus='pendiente') then
    raise exception 'No se puede cambiar la retencion de una ruta validada, con pagos o pendiente de aprobacion';
  end if;
  insert into private.walmart_decisiones_retencion(ruta_id,aplicar_retencion,seleccionado_por)
    values(p_ruta_id,p_aplicar,auth.uid())
  on conflict (ruta_id) do update set aplicar_retencion=excluded.aplicar_retencion,
    porcentaje_retencion=null,
    seleccionado_por=excluded.seleccionado_por,seleccionado_en=clock_timestamp();
  return p_aplicar;
end;
$$;
revoke all on function public.walmart_elegir_retencion(bigint,boolean) from public, anon;
grant execute on function public.walmart_elegir_retencion(bigint,boolean) to authenticated;

create or replace function public.walmart_confirmar_proveedor_ruta(
  p_ruta_id bigint, p_proveedor_id bigint
) returns smallint language plpgsql security definer set search_path = ''
as $$
declare
  v_ruta record;
  v_opcion smallint;
begin
  if auth.uid() is null or public.mi_acceso_administrativo() is not true
    or public.operativo_rol_actual() is distinct from 'ih'
    or private.es_valida() is not true then
    raise exception 'Solo el supervisor autorizado puede confirmar el proveedor Walmart';
  end if;
  select r.id,r.estado,r.cedis_id,r.checkin_at,ce.cliente_id,cl.nombre as cliente
    into v_ruta
    from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=p_ruta_id for update of r;
  if not found or v_ruta.estado is distinct from 'cerrada'
    or public.operativo_normalizar(v_ruta.cliente)<>'walmart'
    or public.operativo_asignado_a(v_ruta.cliente_id,v_ruta.cedis_id,'ih') is not true then
    raise exception 'Ruta Walmart cerrada y asignada requerida';
  end if;
  if p_proveedor_id is null or not exists (
    select 1 from public.proveedores p where p.id=p_proveedor_id
  ) then raise exception 'Confirma un proveedor existente para la ruta Walmart'; end if;
  if exists (select 1 from public.liquidaciones l where l.ruta_id=p_ruta_id)
    or exists (select 1 from public.pagos p where p.ruta_id=p_ruta_id)
    or exists (select 1 from public.validaciones_pendientes v
      where v.ruta_id=p_ruta_id and v.estatus='pendiente') then
    raise exception 'No se puede cambiar el proveedor de una ruta validada, con pagos o pendiente de aprobacion';
  end if;
  insert into private.walmart_acuerdos(proveedor_id,cedis_id)
    values(p_proveedor_id,v_ruta.cedis_id) on conflict do nothing;
  perform 1 from private.walmart_acuerdos a
    where a.proveedor_id=p_proveedor_id and a.cedis_id=v_ruta.cedis_id for update;
  v_opcion := private.walmart_opcion_al_iniciar(p_proveedor_id,v_ruta.cedis_id,v_ruta.checkin_at);
  insert into private.walmart_proveedores_confirmados(
    ruta_id,proveedor_id,opcion,confirmado_por
  ) values (p_ruta_id,p_proveedor_id,v_opcion,auth.uid())
  on conflict (ruta_id) do update set
    proveedor_id=excluded.proveedor_id,opcion=excluded.opcion,
    confirmado_por=excluded.confirmado_por,confirmado_en=clock_timestamp();
  return v_opcion;
end;
$$;
revoke all on function public.walmart_confirmar_proveedor_ruta(bigint,bigint) from public, anon;
grant execute on function public.walmart_confirmar_proveedor_ruta(bigint,bigint) to authenticated;

create or replace function private.walmart_calcular_decision_guardada(
  p_ruta_id bigint,
  p_aplicar_visitas boolean, p_aplicar_fallida boolean,
  p_registro_fiscal text, p_retencion_fiscal numeric, p_iva numeric, p_comision numeric
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_ruta record;
  v_decision record;
  v_proveedor record;
  v_calculo jsonb;
begin
  select r.id,r.cedis_id,r.tipo_unidad,r.checkin_at,r.estado,
         r.walmart_visitas_asignadas,r.walmart_visitas_realizadas,
         r.walmart_requiere_revision,cl.nombre as cliente
    into v_ruta
    from public.rutas r
    join public.cedis ce on ce.id=r.cedis_id
    join public.clientes cl on cl.id=ce.cliente_id
    where r.id=p_ruta_id for update of r;
  if not found or v_ruta.estado is distinct from 'cerrada'
    or public.operativo_normalizar(v_ruta.cliente)<>'walmart' then
    raise exception 'Se requiere una ruta Walmart cerrada';
  end if;
  if p_aplicar_visitas is true and v_ruta.walmart_requiere_revision is distinct from false then
    raise exception 'Las visitas Walmart requieren revision antes de calcular el pago';
  end if;
  select d.aplicar_retencion,d.porcentaje_retencion,d.seleccionado_por,d.seleccionado_en
    into v_decision from private.walmart_decisiones_retencion d
    where d.ruta_id=p_ruta_id;
  if not found then
    raise exception 'El supervisor debe confirmar la retencion Walmart antes de calcular el pago';
  end if;
  select p.proveedor_id,p.opcion,p.confirmado_por,p.confirmado_en
    into v_proveedor from private.walmart_proveedores_confirmados p
    where p.ruta_id=p_ruta_id;
  if not found then
    raise exception 'El supervisor debe confirmar el proveedor Walmart antes de calcular el pago';
  end if;
  v_calculo := private.calcular_walmart_ruta_con_retencion(
    v_ruta.cedis_id,(v_ruta.checkin_at at time zone 'America/Mexico_City')::date,
    v_ruta.tipo_unidad,v_proveedor.opcion,v_ruta.walmart_visitas_asignadas,
    v_ruta.walmart_visitas_realizadas,p_aplicar_visitas,p_aplicar_fallida,
    p_registro_fiscal,p_retencion_fiscal,p_iva,p_comision,v_decision.aplicar_retencion
  );
  if v_decision.porcentaje_retencion is not null then
    v_calculo:=private.walmart_aplicar_porcentaje_retencion(v_calculo,v_decision.porcentaje_retencion);
  end if;
  return v_calculo || jsonb_build_object(
    'ruta_id',v_ruta.id,'retencion_seleccionada_por',v_decision.seleccionado_por,
    'retencion_seleccionada_en',v_decision.seleccionado_en,
    'proveedor_id',v_proveedor.proveedor_id,'proveedor_confirmado_por',v_proveedor.confirmado_por,
    'proveedor_confirmado_en',v_proveedor.confirmado_en
  );
end;
$$;
revoke all on function private.walmart_calcular_decision_guardada(
  bigint,boolean,boolean,text,numeric,numeric,numeric
) from public, anon, authenticated;

create or replace function public.walmart_previsualizar_ruta(
  p_ruta_id bigint, p_proveedor_id bigint, p_aplicar_retencion boolean,
  p_aplicar_visitas boolean, p_aplicar_fallida boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_registro text;
  v_retencion numeric;
  v_iva numeric;
  v_comision numeric;
begin
  perform public.walmart_confirmar_proveedor_ruta(p_ruta_id,p_proveedor_id);
  perform public.walmart_elegir_retencion(p_ruta_id,p_aplicar_retencion);
  select p.tipo_registro into v_registro from public.proveedores p where p.id=p_proveedor_id;
  if v_registro is null or v_registro not in ('FACTURA','SIN FACTURA') then
    raise exception 'El proveedor no tiene un registro fiscal valido';
  end if;
  select max(valor) filter (where clave='retencion_sin_factura'),
         max(valor) filter (where clave='iva'),
         max(valor) filter (where clave='comision_sin_factura')
    into v_retencion,v_iva,v_comision from public.parametros_pago
    where clave in ('retencion_sin_factura','iva','comision_sin_factura');
  return private.walmart_calcular_decision_guardada(
    p_ruta_id,p_aplicar_visitas,p_aplicar_fallida,
    v_registro,v_retencion,v_iva,v_comision
  ) || jsonb_build_object('aplicar_visitas',p_aplicar_visitas,'aplicar_fallida',p_aplicar_fallida);
end;
$$;
revoke all on function public.walmart_previsualizar_ruta(bigint,bigint,boolean,boolean,boolean)
  from public, anon;
grant execute on function public.walmart_previsualizar_ruta(bigint,bigint,boolean,boolean,boolean)
  to authenticated;

create or replace function public.walmart_previsualizar_ruta_porcentaje(
  p_ruta_id bigint,p_proveedor_id bigint,p_porcentaje_retencion smallint,
  p_aplicar_visitas boolean,p_aplicar_fallida boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_calculo jsonb;
  v_decision private.walmart_decisiones_retencion%rowtype;
begin
  if p_porcentaje_retencion is null or p_porcentaje_retencion not in (0,10,15,25) then
    raise exception 'Selecciona una retencion Walmart de 0, 10, 15 o 25 por ciento';
  end if;
  v_calculo:=public.walmart_previsualizar_ruta(
    p_ruta_id,p_proveedor_id,p_porcentaje_retencion>0,p_aplicar_visitas,p_aplicar_fallida
  );
  update private.walmart_decisiones_retencion set porcentaje_retencion=p_porcentaje_retencion
    where ruta_id=p_ruta_id returning * into strict v_decision;
  return private.walmart_aplicar_porcentaje_retencion(v_calculo,p_porcentaje_retencion)
    ||jsonb_build_object('retencion_seleccionada_por',v_decision.seleccionado_por,
      'retencion_seleccionada_en',v_decision.seleccionado_en);
end;
$$;
revoke all on function public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean) from public, anon;
grant execute on function public.walmart_previsualizar_ruta_porcentaje(bigint,bigint,smallint,boolean,boolean) to authenticated;

commit;

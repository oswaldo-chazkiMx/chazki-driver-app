-- Ejecutar después de documentos-carga-y-finanzas.sql y gestion-flotillas-supervisor.sql.
-- No elimina vehículos, documentos ni solicitudes.
-- Las versiones antiguas de la app deberán actualizarse para modificar contacto.
begin;

create or replace function public.categoria_tarifaria_vehiculo(p_tipo text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select case p_tipo
    when 'Moto' then 'Moto'
    when 'Auto hatch' then 'Sedan'
    when 'Auto sedan' then 'Sedan'
    when 'Small van' then 'Small'
    when 'Large van' then 'Large'
    when '3.5T' then '3.5T'
    else null
  end;
$$;

alter table public.drivers
  add column if not exists emergencia_nombre text,
  add column if not exists emergencia_telefono text,
  add column if not exists emergencia_parentesco text;

alter table public.vehiculos add column if not exists tipo_detalle text;
alter table public.vehiculos drop constraint if exists vehiculos_tipo_check;
alter table public.vehiculos add constraint vehiculos_tipo_check
  check (tipo in ('Moto','Sedan','Small','Large','Pickup','Van','3.5T','4.5T','5T',
                  'RABÓN','TORTON SECO','TORTON REFRIGERADO','TRAILER 53 SECO','TRAILER 53 REFRIGERADO'));

create unique index if not exists vehiculos_uno_activo_por_driver
  on public.vehiculos(driver_id) where activo;
create unique index if not exists cambios_perfil_uno_pendiente_por_driver
  on public.cambios_perfil(driver_id) where estatus = 'pendiente';

create or replace function private.coincide_tipo_tarifa_perfil(p_tipo text, p_tarifa text)
returns boolean language sql immutable set search_path = ''
as $$
  select case when p_tipo in ('4.5T','5T','RABÓN','TORTON SECO','TORTON REFRIGERADO','TRAILER 53 SECO','TRAILER 53 REFRIGERADO')
    then translate(upper(btrim(p_tipo)),'ÁÉÍÓÚ','AEIOU')=translate(upper(btrim(p_tarifa)),'ÁÉÍÓÚ','AEIOU')
    else regexp_replace(upper(coalesce(p_tarifa,'')),'[^A-Z0-9]','','g')=
         regexp_replace(upper(p_tipo),'[^A-Z0-9]','','g') end;
$$;

create or replace function private.validar_tarifa_tipo_perfil(p_tipo text, p_tarifa_id bigint, p_fecha date)
returns void language plpgsql stable set search_path = ''
as $$
begin
  if p_tipo is null or p_tipo not in ('4.5T','5T','RABÓN','TORTON SECO','TORTON REFRIGERADO','TRAILER 53 SECO','TRAILER 53 REFRIGERADO') then
    return;
  end if;
  if not exists (
    select 1 from public.tarifas t where t.id=p_tarifa_id and t.activo
      and private.coincide_tipo_tarifa_perfil(p_tipo,t.tipo_unidad)
      and t.vigencia_desde<=p_fecha and (t.vigencia_hasta is null or t.vigencia_hasta>=p_fecha)
  ) then
    raise exception 'No hay tarifa activa y vigente del tipo % para esta selección',p_tipo;
  end if;
end;
$$;

create or replace function private.validar_tarifa_tipo_ruta(p_ruta_id bigint, p_tarifa_id bigint)
returns void language plpgsql stable set search_path = ''
as $$
declare v_tipo text; v_fecha date;
begin
  select tipo_unidad,(checkin_at at time zone 'America/Mexico_City')::date
    into v_tipo,v_fecha from public.rutas where id=p_ruta_id;
  if not found then raise exception 'Ruta no encontrada'; end if;
  perform private.validar_tarifa_tipo_perfil(v_tipo,p_tarifa_id,v_fecha);
end;
$$;

-- Conserva el cálculo existente y añade la validación en su punto común.
do $$
declare
  v_def text;
  v_needle text := 'if not found then raise exception ''Tarifa no encontrada''; end if;';
  v_call text := 'perform private.validar_tarifa_tipo_ruta(p_ruta_id, p_tarifa_id);';
begin
  select pg_get_functiondef('private.calc_liquidacion(bigint,bigint,text,boolean,numeric,numeric)'::regprocedure) into v_def;
  if position(v_call in v_def)=0 then
    if position(v_needle in v_def)=0 or
       length(v_def)-length(replace(v_def,v_needle,''))<>length(v_needle) then
      raise exception 'La función de cálculo cambió; no se puede instalar la protección automáticamente';
    end if;
    execute replace(v_def,v_needle,v_needle || E'\n  ' || v_call);
  end if;
end;
$$;

do $$
declare
  v_def text;
  v_tarifa text := $pattern$regexp_replace\(upper\(coalesce\(t\.tipo_unidad, ''\)\), '\[\^A-Z0-9\]', '', 'g'\)\s*=\s*regexp_replace\(upper\(v_driver\.tipo_unidad\), '\[\^A-Z0-9\]', '', 'g'\)$pattern$;
  v_regla text := $pattern$regexp_replace\(upper\(g\.tipo_unidad\), '\[\^A-Z0-9\]', '', 'g'\)\s*=\s*regexp_replace\(upper\(v_driver\.tipo_unidad\), '\[\^A-Z0-9\]', '', 'g'\)$pattern$;
  v_count integer;
begin
  select pg_get_functiondef('public.crear_reporte_no_show(uuid,bigint,date,text,integer,numeric)'::regprocedure) into v_def;
  if position('private.coincide_tipo_tarifa_perfil(v_driver.tipo_unidad, t.tipo_unidad)' in v_def)=0 then
    select count(*) into v_count from regexp_matches(v_def,v_tarifa,'g');
    if v_count<>2 then raise exception 'La selección de tarifas NO SHOW cambió; revisa la migración'; end if;
    select count(*) into v_count from regexp_matches(v_def,v_regla,'g');
    if v_count<>1 then raise exception 'La selección de reglas NO SHOW cambió; revisa la migración'; end if;
    v_def:=regexp_replace(v_def,v_tarifa,'private.coincide_tipo_tarifa_perfil(v_driver.tipo_unidad, t.tipo_unidad)','g');
    v_def:=regexp_replace(v_def,v_regla,'private.coincide_tipo_tarifa_perfil(v_driver.tipo_unidad, g.tipo_unidad)','g');
    execute v_def;
  end if;
end;
$$;

create or replace function private.validar_tarifa_no_show_perfil()
returns trigger language plpgsql set search_path = ''
as $$
begin
  perform private.validar_tarifa_tipo_perfil(new.tipo_unidad,new.tarifa_servicio_id,new.fecha_servicio);
  if new.tarifa_no_show_id is not null then
    perform private.validar_tarifa_tipo_perfil(new.tipo_unidad,new.tarifa_no_show_id,new.fecha_servicio);
  end if;
  return new;
end;
$$;
drop trigger if exists validar_tarifa_no_show_perfil on public.no_show_casos;
create trigger validar_tarifa_no_show_perfil before insert on public.no_show_casos
for each row execute function private.validar_tarifa_no_show_perfil();

create or replace function public.contacto_perfil_actual(p_driver_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'telefono', d.telefono, 'correo_contacto', d.correo_contacto,
    'emergencia_nombre', d.emergencia_nombre, 'emergencia_telefono', d.emergencia_telefono,
    'emergencia_parentesco', d.emergencia_parentesco
  ) from public.drivers d where d.id = p_driver_id;
$$;
revoke all on function public.contacto_perfil_actual(uuid) from public, anon, authenticated;

create or replace function public.solicitar_contacto_perfil(p_datos jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actual jsonb;
  v_nuevo jsonb := '{}'::jsonb;
  v_anterior jsonb := '{}'::jsonb;
  v_inicial jsonb := '{}'::jsonb;
  v_campo text;
  v_valor text;
  v_cambio_existente boolean := false;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  perform 1 from public.drivers where id = auth.uid() and rol in ('driver', 'flotillero') for update;
  if not found then raise exception 'No tienes un perfil de driver o flotillero'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or p_datos = '{}'::jsonb then
    raise exception 'Indica los datos a actualizar';
  end if;
  v_actual := public.contacto_perfil_actual(auth.uid());
  for v_campo in select jsonb_object_keys(p_datos) loop
    if v_campo not in ('telefono','correo_contacto','emergencia_nombre','emergencia_telefono','emergencia_parentesco')
       or jsonb_typeof(p_datos->v_campo) not in ('string', 'null') then
      raise exception 'Dato de contacto no permitido';
    end if;
    v_valor := nullif(btrim(p_datos->>v_campo), '');
    if length(coalesce(v_valor,'')) > (case when v_campo = 'correo_contacto' then 254 else 200 end) then
      raise exception 'Dato de contacto demasiado largo';
    end if;
    if v_campo = 'correo_contacto' and v_valor is not null then
      v_valor := lower(v_valor);
      if v_valor !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo de contacto invalido'; end if;
    end if;
    if v_valor is distinct from v_actual->>v_campo then
      if nullif(v_actual->>v_campo,'') is null then
        v_inicial := v_inicial || jsonb_build_object(v_campo,v_valor);
      else
        v_nuevo := v_nuevo || jsonb_build_object(v_campo,v_valor);
        v_anterior := v_anterior || jsonb_build_object(v_campo,v_actual->v_campo);
        v_cambio_existente := true;
      end if;
    end if;
  end loop;
  if v_nuevo = '{}'::jsonb and v_inicial = '{}'::jsonb then return 'sin_cambios'; end if;
  if exists (select 1 from public.cambios_perfil where driver_id = auth.uid() and estatus = 'pendiente') then
    raise exception 'Ya existe una solicitud de perfil pendiente';
  end if;
  if v_inicial <> '{}'::jsonb then
    perform set_config('app.trusted','1',true);
    update public.drivers d set
      telefono = case when v_inicial ? 'telefono' then v_inicial->>'telefono' else d.telefono end,
      correo_contacto = case when v_inicial ? 'correo_contacto' then v_inicial->>'correo_contacto' else d.correo_contacto end,
      emergencia_nombre = case when v_inicial ? 'emergencia_nombre' then v_inicial->>'emergencia_nombre' else d.emergencia_nombre end,
      emergencia_telefono = case when v_inicial ? 'emergencia_telefono' then v_inicial->>'emergencia_telefono' else d.emergencia_telefono end,
      emergencia_parentesco = case when v_inicial ? 'emergencia_parentesco' then v_inicial->>'emergencia_parentesco' else d.emergencia_parentesco end
    where d.id = auth.uid();
  end if;
  if v_cambio_existente then
    insert into public.cambios_perfil(driver_id,datos,anterior) values(auth.uid(),v_nuevo,v_anterior);
    return 'pendiente';
  end if;
  return 'guardado';
end;
$$;
revoke all on function public.solicitar_contacto_perfil(jsonb) from public, anon, authenticated;
grant execute on function public.solicitar_contacto_perfil(jsonb) to authenticated;

create or replace function public.solicitar_vehiculo_perfil(p_placas text, p_tipo text, p_marca_modelo text)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actual public.vehiculos%rowtype;
  v_base text;
  v_detalle text := nullif(btrim(p_tipo),'');
  v_placas text := nullif(btrim(p_placas),'');
  v_marca text := nullif(btrim(p_marca_modelo),'');
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  perform 1 from public.drivers where id=auth.uid() and rol in ('driver','flotillero') for update;
  if not found then raise exception 'No tienes un perfil de driver o flotillero'; end if;
  if v_placas is null or length(v_placas)>30 or length(coalesce(v_marca,''))>200
     or v_detalle is null or v_detalle not in
      ('Moto','Auto hatch','Auto sedan','Small van','Large van','3.5T','4.5T','5T',
       'RABÓN','TORTON SECO','TORTON REFRIGERADO','TRAILER 53 SECO','TRAILER 53 REFRIGERADO') then
    raise exception 'Indica placas y un tipo de vehículo válido';
  end if;
  v_base := coalesce(public.categoria_tarifaria_vehiculo(v_detalle),v_detalle);
  if (select count(*) from public.vehiculos where driver_id=auth.uid() and activo)>1 then
    raise exception 'Hay varios vehículos activos; contacta a Operaciones';
  end if;
  select * into v_actual from public.vehiculos where driver_id=auth.uid() and activo;
  if exists (select 1 from public.cambios_perfil where driver_id=auth.uid() and estatus='pendiente') then
    raise exception 'Ya existe una solicitud de perfil pendiente';
  end if;
  if v_actual.id is null then
    insert into public.vehiculos(driver_id,placas,tipo,tipo_detalle,marca_modelo,activo)
    values(auth.uid(),v_placas,v_base,v_detalle,v_marca,true);
    return 'guardado';
  end if;
  if v_actual.placas is not distinct from v_placas and v_actual.tipo is not distinct from v_base
    and coalesce(v_actual.tipo_detalle,v_actual.tipo) is not distinct from v_detalle
    and v_actual.marca_modelo is not distinct from v_marca then return 'sin_cambios'; end if;
  insert into public.cambios_perfil(driver_id,datos,anterior) values(
    auth.uid(),
    jsonb_build_object('placas',v_placas,'tipo',v_base,'tipo_detalle',v_detalle,'marca_modelo',v_marca),
    jsonb_build_object('placas',v_actual.placas,'tipo',v_actual.tipo,'tipo_detalle',v_actual.tipo_detalle,'marca_modelo',v_actual.marca_modelo,'vehiculo_id',v_actual.id)
  );
  return 'pendiente';
end;
$$;
revoke all on function public.solicitar_vehiculo_perfil(text,text,text) from public, anon, authenticated;
grant execute on function public.solicitar_vehiculo_perfil(text,text,text) to authenticated;

create or replace function public.solicitar_licencia_perfil(p_numero text, p_tipo text, p_vigencia date)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_actual public.licencias%rowtype; v_numero text:=nullif(btrim(p_numero),''); v_tipo text:=nullif(btrim(p_tipo),'');
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  perform 1 from public.drivers where id=auth.uid() and rol in ('driver','flotillero') for update;
  if not found then raise exception 'No tienes un perfil de driver o flotillero'; end if;
  if v_numero is null or v_tipo is null or p_vigencia is null or length(v_numero)>100 or length(v_tipo)>100 then
    raise exception 'Indica número, tipo y vigencia de la licencia';
  end if;
  select * into v_actual from public.licencias where driver_id=auth.uid();
  if exists (select 1 from public.cambios_perfil where driver_id=auth.uid() and estatus='pendiente') then
    raise exception 'Ya existe una solicitud de perfil pendiente';
  end if;
  if v_actual.driver_id is null then
    insert into public.licencias(driver_id,numero,tipo,vigencia) values(auth.uid(),v_numero,v_tipo,p_vigencia);
    return 'guardado';
  end if;
  if v_actual.numero is not distinct from v_numero and v_actual.tipo is not distinct from v_tipo
     and v_actual.vigencia is not distinct from p_vigencia then return 'sin_cambios'; end if;
  insert into public.cambios_perfil(driver_id,datos,anterior) values(
    auth.uid(),jsonb_build_object('licencia_numero',v_numero,'licencia_tipo',v_tipo,'licencia_vigencia',p_vigencia),
    jsonb_build_object('licencia_numero',v_actual.numero,'licencia_tipo',v_actual.tipo,'licencia_vigencia',v_actual.vigencia)
  );
  return 'pendiente';
end;
$$;
revoke all on function public.solicitar_licencia_perfil(text,text,date) from public, anon, authenticated;
grant execute on function public.solicitar_licencia_perfil(text,text,date) to authenticated;

create or replace function private.proteger_contacto_perfil()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('app.trusted', true),'') = '1' then return new; end if;
  if old.id = (select auth.uid()) and not public.puede_gestionar_documentos_driver() and
    (new.telefono is distinct from old.telefono or new.correo_contacto is distinct from old.correo_contacto
     or new.emergencia_nombre is distinct from old.emergencia_nombre
     or new.emergencia_telefono is distinct from old.emergencia_telefono
     or new.emergencia_parentesco is distinct from old.emergencia_parentesco) then
    raise exception 'Solicita los cambios de contacto desde tu perfil';
  end if;
  return new;
end;
$$;
drop trigger if exists proteger_contacto_perfil on public.drivers;
create trigger proteger_contacto_perfil before update on public.drivers
for each row execute function private.proteger_contacto_perfil();
create or replace function public.actualizar_contacto_driver(p_telefono text, p_correo_contacto text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Actualiza la app para solicitar cambios de contacto con aprobación de Operaciones';
end;
$$;
revoke all on function public.actualizar_contacto_driver(text,text) from public, anon, authenticated;
grant execute on function public.actualizar_contacto_driver(text,text) to authenticated;

create or replace function public.resolver_cambio_perfil(p_id bigint, p_aprobar boolean, p_nota text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare c public.cambios_perfil%rowtype; d jsonb; vid bigint; uid uuid := auth.uid(); actual jsonb; campo text;
begin
  if uid is null or not public.puede_gestionar_documentos_driver() then
    raise exception 'Solo Operaciones o master pueden resolver cambios de perfil';
  end if;
  if p_aprobar is null then raise exception 'Indica si apruebas el cambio'; end if;
  select * into c from public.cambios_perfil where id=p_id and estatus='pendiente' for update;
  if not found then raise exception 'La solicitud ya fue resuelta'; end if;
  perform 1 from public.drivers where id=c.driver_id for update;
  if p_aprobar then
    perform 1 from public.vehiculos where driver_id=c.driver_id and activo for update;
    perform 1 from public.licencias where driver_id=c.driver_id for update;
    if (select count(*) from public.vehiculos where driver_id=c.driver_id and activo)>1 then
      raise exception 'Hay varios vehículos activos; revisa el expediente';
    end if;
    select jsonb_build_object('nombre',x.nombre,'telefono',x.telefono,'correo_contacto',x.correo_contacto,
      'emergencia_nombre',x.emergencia_nombre,'emergencia_telefono',x.emergencia_telefono,
      'emergencia_parentesco',x.emergencia_parentesco,
      'placas',v.placas,'tipo',v.tipo,'tipo_detalle',v.tipo_detalle,'marca_modelo',v.marca_modelo,
      'vehiculo_id',v.id,'licencia_numero',l.numero,'licencia_tipo',l.tipo,'licencia_vigencia',l.vigencia)
      into actual from public.drivers x
      left join public.vehiculos v on v.driver_id=x.id and v.activo
      left join public.licencias l on l.driver_id=x.id where x.id=c.driver_id;
    for campo in select jsonb_object_keys(coalesce(c.anterior,'{}'::jsonb)) loop
      if actual ? campo and actual->campo is distinct from c.anterior->campo then
        raise exception 'El dato % cambió desde la solicitud; recházala y solicita una revisión nueva',campo;
      end if;
    end loop;
    perform set_config('app.trusted','1',true);
    d:=c.datos;
    if d ? 'nombre' or d ? 'telefono' or d ? 'correo_contacto' or d ? 'emergencia_nombre'
       or d ? 'emergencia_telefono' or d ? 'emergencia_parentesco' then
      update public.drivers x set
        nombre=case when d?'nombre' then d->>'nombre' else x.nombre end,
        telefono=case when d?'telefono' then d->>'telefono' else x.telefono end,
        correo_contacto=case when d?'correo_contacto' then d->>'correo_contacto' else x.correo_contacto end,
        emergencia_nombre=case when d?'emergencia_nombre' then d->>'emergencia_nombre' else x.emergencia_nombre end,
        emergencia_telefono=case when d?'emergencia_telefono' then d->>'emergencia_telefono' else x.emergencia_telefono end,
        emergencia_parentesco=case when d?'emergencia_parentesco' then d->>'emergencia_parentesco' else x.emergencia_parentesco end
      where x.id=c.driver_id;
    end if;
    if d?'placas' or d?'tipo' or d?'marca_modelo' or d?'tipo_detalle' then
      if (select count(*) from public.vehiculos where driver_id=c.driver_id and activo)>1 then
        raise exception 'Hay varios vehículos activos; revisa el expediente';
      end if;
      select id into vid from public.vehiculos where driver_id=c.driver_id and activo;
      if c.anterior?'vehiculo_id' and vid is distinct from (c.anterior->>'vehiculo_id')::bigint then
        raise exception 'El vehículo cambió desde la solicitud; solicita una revisión nueva';
      end if;
      if vid is null then
        if not (d?'placas' and d?'tipo') then raise exception 'Se requieren placas y tipo'; end if;
        insert into public.vehiculos(driver_id,placas,tipo,tipo_detalle,marca_modelo,activo)
        values(c.driver_id,d->>'placas',d->>'tipo',d->>'tipo_detalle',d->>'marca_modelo',true);
      else
        update public.vehiculos set
          placas=coalesce(d->>'placas',placas),tipo=coalesce(d->>'tipo',tipo),
          tipo_detalle=case when d?'tipo_detalle' then d->>'tipo_detalle'
                            when d?'tipo' and d->>'tipo' is distinct from tipo then null
                            else tipo_detalle end,
          marca_modelo=case when d?'tipo_detalle' and d?'marca_modelo' then d->>'marca_modelo'
                            else coalesce(d->>'marca_modelo',marca_modelo) end
        where id=vid;
      end if;
    end if;
    if d?'licencia_numero' or d?'licencia_tipo' or d?'licencia_vigencia' then
      insert into public.licencias(driver_id,numero,tipo,vigencia)
      values(c.driver_id,d->>'licencia_numero',d->>'licencia_tipo',nullif(d->>'licencia_vigencia','')::date)
      on conflict(driver_id) do update set numero=coalesce(excluded.numero,public.licencias.numero),
        tipo=coalesce(excluded.tipo,public.licencias.tipo),vigencia=coalesce(excluded.vigencia,public.licencias.vigencia);
    end if;
  end if;
  update public.cambios_perfil set estatus=case when p_aprobar then 'aprobada' else 'rechazada' end,
    resuelto_por=uid,resuelto_en=now(),nota=p_nota where id=p_id;
  return case when p_aprobar then 'aprobada' else 'rechazada' end;
end;
$$;
revoke all on function public.resolver_cambio_perfil(bigint,boolean,text) from public, anon, authenticated;
grant execute on function public.resolver_cambio_perfil(bigint,boolean,text) to authenticated;

create or replace function public.flotillero_administra_driver(p_driver_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.drivers titular
    join public.proveedores p on p.id = titular.proveedor_id and p.titular_id = titular.id
    join public.drivers d on d.proveedor_id = p.id
    where titular.id = auth.uid() and titular.rol = 'flotillero'
      and titular.estatus = 'activo' and p.tipo = 'flotillero' and p.activo
      and d.id = p_driver_id and d.rol = 'driver'
  );
$$;
revoke all on function public.flotillero_administra_driver(uuid) from public, anon, authenticated;
grant execute on function public.flotillero_administra_driver(uuid) to authenticated;

create or replace function public.perfil_driver_de_flotilla(p_driver_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare resultado jsonb;
begin
  if not public.flotillero_administra_driver(p_driver_id) then
    raise exception 'No tienes permiso para consultar este driver';
  end if;
  if (select count(*) from public.vehiculos where driver_id = p_driver_id and activo) > 1 then
    raise exception 'El driver tiene más de un vehículo activo; contacta a Operaciones';
  end if;
  select jsonb_build_object(
    'nombre', d.nombre, 'codigo', d.codigo, 'estatus', d.estatus,
    'telefono', d.telefono, 'correo_contacto', d.correo_contacto,
    'emergencia_nombre', d.emergencia_nombre, 'emergencia_telefono', d.emergencia_telefono,
    'emergencia_parentesco', d.emergencia_parentesco,
    'vehiculo', (select jsonb_build_object('placas', v.placas, 'tipo', coalesce(v.tipo_detalle,v.tipo), 'marca_modelo', v.marca_modelo)
      from public.vehiculos v where v.driver_id = d.id and v.activo),
    'licencia', (select jsonb_build_object('numero', l.numero, 'tipo', l.tipo, 'vigencia', l.vigencia)
      from public.licencias l where l.driver_id = d.id)
  ) into resultado from public.drivers d where d.id = p_driver_id;
  return resultado;
end;
$$;
revoke all on function public.perfil_driver_de_flotilla(uuid) from public, anon, authenticated;
grant execute on function public.perfil_driver_de_flotilla(uuid) to authenticated;

drop policy if exists driver_documents_flotillero_read on public.driver_documents;
create policy driver_documents_flotillero_read on public.driver_documents for select to authenticated
  using (tipo in ('seguro','licencia','tarjeta','ine','domicilio')
    and public.flotillero_administra_driver(driver_id));

create or replace function public.flotillero_puede_ver_archivo(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.driver_documents d
    where d.storage_path = p_path and d.tipo in ('seguro','licencia','tarjeta','ine','domicilio')
      and public.flotillero_administra_driver(d.driver_id));
$$;
revoke all on function public.flotillero_puede_ver_archivo(text) from public, anon, authenticated;
grant execute on function public.flotillero_puede_ver_archivo(text) to authenticated;

drop policy if exists driver_documents_flotillero_storage_read on storage.objects;
create policy driver_documents_flotillero_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents' and public.flotillero_puede_ver_archivo(name));

-- El archivo permanece bajo la carpeta del driver para que conserve acceso a su expediente.
create or replace function public.flotillero_puede_subir_archivo(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select split_part(p_path, '/', 3) = 'flotilla'
    and split_part(p_path, '/', 4) = auth.uid()::text
    and split_part(p_path, '/', 2) in ('seguro','licencia','tarjeta','ine','domicilio')
    and exists (select 1 from public.drivers d
      where d.id::text = split_part(p_path, '/', 1)
        and public.flotillero_administra_driver(d.id));
$$;
revoke all on function public.flotillero_puede_subir_archivo(text) from public, anon, authenticated;
grant execute on function public.flotillero_puede_subir_archivo(text) to authenticated;

drop policy if exists driver_documents_flotillero_storage_insert on storage.objects;
create policy driver_documents_flotillero_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-documents' and public.flotillero_puede_subir_archivo(name));

create or replace function public.enviar_documento_flotillero(
  p_driver_id uuid, p_tipo text, p_storage_path text, p_vigencia date
) returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_estado text;
begin
  perform 1 from public.drivers where id = p_driver_id for update;
  if not public.flotillero_administra_driver(p_driver_id) then
    raise exception 'No tienes permiso para modificar documentos de este driver';
  end if;
  if p_tipo is null or p_tipo not in ('seguro','licencia','tarjeta','ine','domicilio')
     or (p_tipo = 'domicilio' and p_vigencia is not null)
     or (p_tipo <> 'domicilio' and p_vigencia is null) then
    raise exception 'Tipo o vigencia del documento invalido';
  end if;
  if p_storage_path is null or
     p_storage_path not like p_driver_id::text || '/' || p_tipo || '/flotilla/' || auth.uid()::text || '/%' then
    raise exception 'La ruta del archivo no corresponde a la flotilla y documento';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'driver-documents' and name = p_storage_path) then
    raise exception 'No se encontró el archivo en el almacenamiento privado';
  end if;
  if exists (select 1 from public.driver_documents where driver_id = p_driver_id and tipo = p_tipo and estado = 'pendiente') then
    raise exception 'Ya existe una actualización pendiente';
  end if;
  v_estado := case when exists (select 1 from public.driver_documents where driver_id = p_driver_id and tipo = p_tipo)
    then 'pendiente' else 'aprobado' end;
  insert into public.driver_documents(driver_id,tipo,storage_path,vigencia,estado,origen,resuelto_en)
  values(p_driver_id,p_tipo,p_storage_path,p_vigencia,v_estado,'driver',case when v_estado = 'aprobado' then now() end);
  return v_estado;
end;
$$;
revoke all on function public.enviar_documento_flotillero(uuid,text,text,date) from public, anon, authenticated;
grant execute on function public.enviar_documento_flotillero(uuid,text,text,date) to authenticated;

notify pgrst, 'reload schema';
commit;

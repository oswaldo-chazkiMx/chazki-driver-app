-- Link supervisors and coordinators by email instead of by name.
-- Run after operational-responsibility-approvals.sql and operational-assignments-manual-adjustments.sql.
begin;

create or replace function public.listar_responsables_operativos()
returns table (id uuid, nombre text, email text, rol text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or public.operativo_rol_actual() <> 'master' then
    raise exception 'Solo la cuenta maestra puede consultar responsables operativos';
  end if;
  return query
    select d.id, d.nombre::text, lower(u.email::text), d.rol::text
      from public.drivers d
      join auth.users u on u.id = d.id
     where d.rol::text in ('ih', 'coordinador')
     order by d.nombre;
end;
$$;

-- Rows are matched only by the exact supervisor and coordinator emails. The broad contact
-- column is ignored; ambiguous or unmatched rows are returned for manual correction.
create or replace function public.importar_asignaciones_operativas(p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_fila jsonb;
  v_cliente text;
  v_cedis text;
  v_correo_sup text;
  v_correo_coo text;
  v_clientes bigint[];
  v_cedis_ids bigint[];
  v_supervisores uuid[];
  v_coordinadores uuid[];
  v_importadas integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.mi_acceso_administrativo()
     or public.operativo_rol_actual() <> 'master' then
    raise exception 'Solo la cuenta maestra puede importar responsables operativos';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 5000 then
    raise exception 'El archivo debe contener una lista de hasta 5,000 filas';
  end if;

  for v_fila in select value from jsonb_array_elements(p_filas)
  loop
    v_cliente := btrim(coalesce(v_fila->>'CLIENTE', ''));
    v_cedis := btrim(coalesce(v_fila->>'CEDIS', ''));
    v_correo_sup := lower(btrim(coalesce(v_fila->>'CORREO SUPERVISOR', '')));
    v_correo_coo := lower(btrim(coalesce(v_fila->>'CORREO COORDINADOR', '')));

    select array_agg(cl.id order by cl.id)
      into v_clientes
      from public.clientes cl
     where public.operativo_normalizar(cl.nombre) = public.operativo_normalizar(v_cliente);
    select array_agg(ce.id order by ce.id)
      into v_cedis_ids
      from public.cedis ce
     where ce.cliente_id = any(coalesce(v_clientes, array[]::bigint[]))
       and public.operativo_normalizar(ce.nombre) = public.operativo_normalizar(v_cedis);

    select array_agg(d.id order by d.id)
      into v_supervisores
      from public.drivers d
      join auth.users u on u.id = d.id
     where d.rol::text = 'ih' and v_correo_sup <> '' and lower(u.email::text) = v_correo_sup;
    select array_agg(d.id order by d.id)
      into v_coordinadores
      from public.drivers d
      join auth.users u on u.id = d.id
     where d.rol::text = 'coordinador' and v_correo_coo <> '' and lower(u.email::text) = v_correo_coo;

    if cardinality(coalesce(v_clientes, array[]::bigint[])) <> 1
       or cardinality(coalesce(v_cedis_ids, array[]::bigint[])) <> 1
       or cardinality(coalesce(v_supervisores, array[]::uuid[])) <> 1
       or cardinality(coalesce(v_coordinadores, array[]::uuid[])) <> 1 then
      v_errores := v_errores || jsonb_build_array(jsonb_build_object(
        'cliente', v_cliente,
        'cedis', v_cedis,
        'supervisor', v_correo_sup,
        'coordinador', v_correo_coo,
        'cliente_resuelto', cardinality(coalesce(v_clientes, array[]::bigint[])) = 1,
        'cedis_resuelto', cardinality(coalesce(v_cedis_ids, array[]::bigint[])) = 1,
        'supervisor_resuelto', cardinality(coalesce(v_supervisores, array[]::uuid[])) = 1,
        'coordinador_resuelto', cardinality(coalesce(v_coordinadores, array[]::uuid[])) = 1
      ));
      continue;
    end if;

    insert into public.asignaciones_operativas (
      cliente_id, cedis_id, supervisor_id, coordinador_id, actualizado_en
    ) values (
      v_clientes[1], v_cedis_ids[1], v_supervisores[1], v_coordinadores[1], now()
    )
    on conflict (cliente_id, cedis_id) do update
      set supervisor_id = excluded.supervisor_id,
          coordinador_id = excluded.coordinador_id,
          actualizado_en = excluded.actualizado_en;
    v_importadas := v_importadas + 1;
  end loop;

  return jsonb_build_object('importadas', v_importadas, 'errores', v_errores);
end;
$$;

revoke all on function public.listar_responsables_operativos() from public, anon;
grant execute on function public.listar_responsables_operativos() to authenticated;

notify pgrst, 'reload schema';
commit;

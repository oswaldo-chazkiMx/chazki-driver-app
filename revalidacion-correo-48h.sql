-- Desplegar supabase/functions/revalidar-correos-48h y configurar estos secretos
-- antes de ejecutar este archivo:
--   supabase functions deploy revalidar-correos-48h
--   supabase secrets set CRON_SECRET='<el mismo secreto aleatorio largo>'
--   vault.create_secret('https://<project-ref>.supabase.co', 'validation_email_48h_project_url')
--   vault.create_secret('<secreto aleatorio largo>', 'validation_email_48h_cron_secret')
-- Configurar el mismo validation_email_48h_cron_secret como CRON_SECRET de la funcion.
-- Ejecutar despues de network-invitations.sql, invitaciones-estado.sql y
-- operational-responsibility-approvals.sql.
begin;

create schema if not exists private;

create table if not exists private.revalidaciones_correo_48h (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invitacion_id bigint not null references public.invitaciones_red(id),
  cedis_id bigint,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'procesando', 'reenviado', 'alerta_supervisor')),
  intentos smallint not null default 0 check (intentos between 0 and 2),
  reclamado_en timestamptz,
  procesado_en timestamptz,
  ultimo_error text
);
revoke all on private.revalidaciones_correo_48h from public, anon, authenticated;

create or replace function private.alertar_falla_revalidacion_correo_48h(
  p_user_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_estado private.revalidaciones_correo_48h%rowtype;
  v_email text;
begin
  select * into v_estado
    from private.revalidaciones_correo_48h
   where user_id = p_user_id
   for update;
  if not found then raise exception 'No existe la revalidacion de correo'; end if;
  if v_estado.estado in ('reenviado', 'alerta_supervisor') then return; end if;

  select email::text into v_email from auth.users where id = p_user_id;
  update private.revalidaciones_correo_48h
     set estado = 'alerta_supervisor',
         procesado_en = now(),
         ultimo_error = left(coalesce(nullif(btrim(p_error), ''), 'No se pudo completar el reenvio automatico'), 1000)
   where user_id = p_user_id;

  insert into public.notificaciones (usuario, titulo, cuerpo, tipo, ref_tipo, ref_id)
  select responsables.usuario,
         'Validacion de correo pendiente',
         format('La cuenta %s lleva mas de 48 horas sin validar el correo. El reenvio automatico fallo; envia manualmente el correo de validacion desde Supabase Auth.', v_email),
         'invitacion_red', 'invitacion_red', v_estado.invitacion_id
    from (
      select distinct a.supervisor_id as usuario
        from public.asignaciones_operativas a
       where a.cedis_id = v_estado.cedis_id
      union
      select d.id
        from public.drivers d
       where d.rol::text in ('master', 'ops')
         and not exists (
           select 1 from public.asignaciones_operativas a
            where a.cedis_id = v_estado.cedis_id and a.supervisor_id is not null
         )
    ) responsables;
  if not found then
    raise exception 'No hay supervisor ni cuenta maestra para recibir la alerta de validacion';
  end if;
end;
$$;
revoke all on function private.alertar_falla_revalidacion_correo_48h(uuid, text) from public, anon, authenticated;

create or replace function public.reclamar_revalidaciones_correo_48h()
returns table(user_id uuid, email text, invitacion_id bigint, cedis_id bigint)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_expirada record;
begin
  for v_expirada in
    select s.user_id, s.intentos
      from private.revalidaciones_correo_48h s
     where s.estado = 'procesando'
       and s.reclamado_en < now() - interval '1 hour'
     for update skip locked
  loop
    if v_expirada.intentos >= 2 then
      perform private.alertar_falla_revalidacion_correo_48h(
        v_expirada.user_id, 'El proceso automatico no confirmo el resultado despues de dos intentos'
      );
    else
      update private.revalidaciones_correo_48h
         set estado = 'pendiente', reclamado_en = null
       where private.revalidaciones_correo_48h.user_id = v_expirada.user_id;
    end if;
  end loop;

  insert into private.revalidaciones_correo_48h (user_id, invitacion_id, cedis_id)
  select candidatos.user_id, candidatos.invitacion_id, candidatos.cedis_id
    from (
      select u.id as user_id, i.id as invitacion_id, i.cedis_id
        from auth.users u
        join public.drivers d on d.id = u.id
          and d.rol::text in ('driver', 'flotillero')
        join lateral (
          select inv.id, inv.cedis_id
            from public.invitaciones_red inv
           where lower(btrim(inv.email)) = lower(btrim(u.email::text))
             and inv.estatus in ('enviada', 'aceptada')
           order by (inv.cedis_id is not null) desc, inv.creado_en desc, inv.id desc
           limit 1
        ) i on true
       where u.email_confirmed_at is null
         and u.created_at <= now() - interval '48 hours'
         and not exists (
           select 1 from private.revalidaciones_correo_48h existing
            where existing.user_id = u.id
         )
       order by u.created_at, u.id
       limit 100
    ) candidatos
  on conflict on constraint revalidaciones_correo_48h_pkey do nothing;

  return query
  with pendientes as (
    select s.user_id
      from private.revalidaciones_correo_48h s
     where s.estado = 'pendiente'
     order by s.user_id
     limit 1
     for update skip locked
  ),
  reclamados as (
    update private.revalidaciones_correo_48h s
       set estado = 'procesando',
           intentos = s.intentos + 1,
           reclamado_en = now()
      from pendientes p
     where s.user_id = p.user_id
     returning s.user_id, s.invitacion_id, s.cedis_id
  )
  select r.user_id, u.email::text, r.invitacion_id, r.cedis_id
    from reclamados r
    join auth.users u on u.id = r.user_id;
end;
$$;
revoke all on function public.reclamar_revalidaciones_correo_48h() from public, anon, authenticated;
grant execute on function public.reclamar_revalidaciones_correo_48h() to service_role;

create or replace function public.finalizar_revalidacion_correo_48h(
  p_user_id uuid,
  p_enviado boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
  if p_enviado is null then raise exception 'Resultado de envio invalido'; end if;
  if not exists (
    select 1 from private.revalidaciones_correo_48h
     where user_id = p_user_id and estado = 'procesando'
  ) then raise exception 'La revalidacion no esta en proceso'; end if;

  if p_enviado then
    update private.revalidaciones_correo_48h
       set estado = 'reenviado', procesado_en = now(), ultimo_error = null
     where user_id = p_user_id;
  else
    perform private.alertar_falla_revalidacion_correo_48h(
      p_user_id, coalesce(p_error, 'El proveedor de correo rechazo el reenvio')
    );
  end if;
end;
$$;
revoke all on function public.finalizar_revalidacion_correo_48h(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finalizar_revalidacion_correo_48h(uuid, boolean, text) to service_role;

commit;

-- Ejecuta como maximo un reenvio cada 30 minutos para respetar los limites de Auth.
-- El cron llama a la Edge Function; la clave de acceso solo se almacena en Supabase Vault.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'validation_email_48h_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'validation_email_48h_cron_secret') then
    raise exception 'Configura los secretos validation_email_48h_project_url y validation_email_48h_cron_secret en Supabase Vault';
  end if;
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'revalidar-correos-48h';
  perform cron.schedule(
    'revalidar-correos-48h',
    '*/30 * * * *',
    $job$
      select net.http_post(
        url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'validation_email_48h_project_url'), '/')
          || '/functions/v1/revalidar-correos-48h',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'validation_email_48h_cron_secret')
        ),
        body := '{}'::jsonb
      );
    $job$
  );
end;
$$;

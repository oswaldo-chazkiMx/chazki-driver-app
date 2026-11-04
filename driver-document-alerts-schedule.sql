create extension if not exists pg_cron;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'driver-document-daily-alerts';

  perform cron.schedule(
    'driver-document-daily-alerts',
    '0 14 * * *',
    'select public.generar_alertas_vigencia_documentos()'
  );
end;
$$;

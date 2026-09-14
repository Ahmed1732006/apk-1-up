-- Optional but recommended: make PDF preparation run automatically every minute.
-- Prerequisites in Supabase Dashboard:
-- 1) Deploy supabase/functions/prepare-pdfs/index.ts
-- 2) Add Edge Function secret: MIDAD_PDF_PREP_SECRET = a long random value.
-- 3) Enable pg_cron and pg_net extensions if they are not already enabled.
-- 4) Put the SAME secret into a Vault secret named midad_pdf_prep_secret.
--    Put the project URL into a Vault secret named midad_pdf_supabase_url.
--
-- This job only wakes the queue worker. Actual PDF generation happens in the
-- Edge Function with the service-role key kept server-side.

select cron.unschedule(jobid)
from cron.job
where jobname='midad-pdf-preparation-worker';

select cron.schedule(
  'midad-pdf-preparation-worker',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='midad_pdf_supabase_url')
           || '/functions/v1/prepare-pdfs',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-midad-pdf-prep-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='midad_pdf_prep_secret')
    ),
    body := jsonb_build_object('action','process_queue')
  );
  $job$
);

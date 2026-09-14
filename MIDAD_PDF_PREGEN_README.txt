# PDF Pre-Generation — IN THE VOID

This upgrade moves PDF fingerprint generation from the member's browser to a
Supabase Edge Function. Each active account gets its own ready-to-download
fingerprinted PDF in the private `prepared-pdfs` bucket.

## One-time setup

1. Run `MIDAD_PDF_PREGEN.sql` in Supabase SQL Editor **after**
   `MIDAD_PDF_FINGERPRINT.sql`.
2. Deploy `supabase/functions/prepare-pdfs/index.ts` as the Edge Function
   named `prepare-pdfs`.
3. Set Edge Function secrets:
   - `SUPABASE_SERVICE_ROLE_KEY` (normally provided by Supabase)
   - `MIDAD_PDF_PREP_SECRET` = a long random secret.
4. For fully automatic background processing, configure
   `MIDAD_PDF_PREGEN_CRON.sql` after storing the same secret and project URL in
   Supabase Vault.

The application already:
- queues every new PDF for every active account;
- queues all existing PDFs for newly created active accounts;
- re-queues a PDF when its Storage path changes;
- shows preparation progress in the profile;
- waits for a prepared copy when a member clicks Download;
- falls back to the old browser fingerprint path if the prepared service is
  unavailable, so the original download flow is not lost;
- records the real download time when a prepared copy is downloaded.

The forensic scanner and existing fingerprint table remain in place.

-- Run once after the pre-generation schema.
-- Marks the already-prepared forensic copy as actually downloaded by its owner.
-- The PDF bytes/fingerprint are NOT changed by this function.

create or replace function public.midad_mark_prepared_pdf_download(
  p_prepared_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_fp text;
  v_ts timestamptz := now();
  v_date date := (v_ts at time zone 'Africa/Cairo')::date;
  v_time time := (v_ts at time zone 'Africa/Cairo')::time;
  v_day text := case extract(dow from (v_ts at time zone 'Africa/Cairo'))::int
    when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
    when 6 then 'السبت' end;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select f.fingerprint
    into v_fp
  from public.iv_pdf_prepared_files p
  join public.iv_pdf_download_fingerprints f
    on upper(f.fingerprint) = upper(p.fingerprint)
   and f.user_id = p.user_id
  where p.id = p_prepared_id
    and p.user_id = v_user
    and p.status = 'ready'
  limit 1;

  if v_fp is null then
    raise exception 'PREPARED_FILE_NOT_FOUND';
  end if;

  update public.iv_pdf_download_fingerprints
  set downloaded_at = v_ts,
      download_date = v_date,
      download_time = v_time,
      download_day = v_day
  where upper(fingerprint) = upper(v_fp)
    and user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'fingerprint', v_fp,
    'downloaded_at', v_ts
  );
end;
$$;

revoke all on function public.midad_mark_prepared_pdf_download(uuid) from public;
grant execute on function public.midad_mark_prepared_pdf_download(uuid) to authenticated;

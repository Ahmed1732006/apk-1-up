-- IN THE VOID — PDF Forensic Fingerprint v3
-- Safe migration: keeps the old fingerprint table intact and moves the
-- feature onto a clean internal table with a stable API.

create table if not exists public.iv_pdf_download_fingerprints (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  user_id uuid not null,
  user_name text not null,
  role text not null,
  role_label text not null,
  material_id text null,
  file_name text null,
  source_path text null,
  parent_fingerprints text[] not null default '{}',
  parent_count integer not null default 0,
  final_sha256 text null,
  downloaded_at timestamptz not null default now(),
  download_date date not null default current_date,
  download_time time not null default localtime,
  download_day text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists iv_pdf_fp_material_idx
  on public.iv_pdf_download_fingerprints(material_id);
create index if not exists iv_pdf_fp_user_idx
  on public.iv_pdf_download_fingerprints(user_id);
create index if not exists iv_pdf_fp_parent_gin_idx
  on public.iv_pdf_download_fingerprints using gin(parent_fingerprints);

alter table public.iv_pdf_download_fingerprints enable row level security;

drop policy if exists "iv_pdf_fp_admin_select" on public.iv_pdf_download_fingerprints;
create policy "iv_pdf_fp_admin_select"
on public.iv_pdf_download_fingerprints
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','super_admin')
      and coalesce(p.status,'active') not in ('pending','revoked')
  )
);

drop policy if exists "iv_pdf_fp_block_insert" on public.iv_pdf_download_fingerprints;
create policy "iv_pdf_fp_block_insert"
on public.iv_pdf_download_fingerprints
for insert to authenticated with check (false);

drop policy if exists "iv_pdf_fp_block_update" on public.iv_pdf_download_fingerprints;
create policy "iv_pdf_fp_block_update"
on public.iv_pdf_download_fingerprints
for update to authenticated using (false) with check (false);

drop policy if exists "iv_pdf_fp_block_delete" on public.iv_pdf_download_fingerprints;
create policy "iv_pdf_fp_block_delete"
on public.iv_pdf_download_fingerprints
for delete to authenticated using (false);

-- Migrate the earlier table created by the first implementation, if it exists.
-- This migration is deliberately schema-agnostic for optional legacy columns.
-- In particular, it NEVER references a legacy user_role column directly.
do $$
declare
  v_sql text;
begin
  if to_regclass('public.midad_pdf_download_fingerprints') is not null then
    v_sql := $q$
      insert into public.iv_pdf_download_fingerprints (
        id, fingerprint, user_id, user_name, role, role_label,
        material_id, file_name, source_path, parent_fingerprints,
        parent_count, final_sha256, downloaded_at, download_date,
        download_time, download_day, created_at
      )
      select
        o.id,
        upper(trim(o.fingerprint)),
        o.user_id,
        coalesce(to_jsonb(o)->>'user_name','عضو'),
        coalesce((select p.role from public.profiles p where p.id=o.user_id),'member'),
        case
          when coalesce((select p.role from public.profiles p where p.id=o.user_id),'member') in ('admin','super_admin') then 'أدمن ذهبي'
          when coalesce((select p.role from public.profiles p where p.id=o.user_id),'member')='moderator' then 'مشرف'
          else 'عضو'
        end,
        nullif(to_jsonb(o)->>'material_id',''),
        nullif(to_jsonb(o)->>'file_name',''),
        nullif(to_jsonb(o)->>'source_path',''),
        case
          when nullif(trim(coalesce(to_jsonb(o)->>'parent_fingerprint','')),'') is null then '{}'::text[]
          else array[trim(to_jsonb(o)->>'parent_fingerprint')]
        end,
        case
          when nullif(trim(coalesce(to_jsonb(o)->>'parent_fingerprint','')),'') is null then 0 else 1
        end,
        nullif(trim(to_jsonb(o)->>'final_sha256'),''),
        coalesce(nullif(to_jsonb(o)->>'created_at','')::timestamptz, now()),
        coalesce(nullif(to_jsonb(o)->>'download_date','')::date, (coalesce(nullif(to_jsonb(o)->>'created_at','')::timestamptz,now()) at time zone 'Africa/Cairo')::date),
        coalesce(nullif(to_jsonb(o)->>'download_time','')::time, (coalesce(nullif(to_jsonb(o)->>'created_at','')::timestamptz,now()) at time zone 'Africa/Cairo')::time),
        coalesce(nullif(to_jsonb(o)->>'download_day',''),'') ,
        coalesce(nullif(to_jsonb(o)->>'created_at','')::timestamptz, now())
      from public.midad_pdf_download_fingerprints o
      where nullif(trim(coalesce(o.fingerprint,'')),'') is not null
      on conflict (fingerprint) do nothing;
    $q$;
    execute v_sql;
  end if;
exception when others then
  -- Do not block the new scanner/download system because a legacy row has
  -- malformed optional data. The new table and RPCs remain usable.
  raise notice 'Legacy fingerprint migration skipped: %', SQLERRM;
end $$;

-- Remove only old RPC definitions. No tables or application data are deleted.
drop function if exists public.midad_register_pdf_download(text,text,uuid,uuid,text,text,text,date,text,time,text,text);
drop function if exists public.midad_register_pdf_download(bigint,text,text,text[],integer);
drop function if exists public.midad_finalize_pdf_download(uuid,text,text[]);
drop function if exists public.midad_lookup_pdf_fingerprint(text);

-- Register a new download using the current logged-in profile.
create or replace function public.midad_register_pdf_download(
  p_material_id bigint default null,
  p_file_name text default null,
  p_source_path text default null,
  p_parent_fingerprints text[] default '{}',
  p_parent_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_fp text;
  v_download_id uuid;
  v_ts timestamptz := now();
  v_role_label text;
  v_date date := (v_ts at time zone 'Africa/Cairo')::date;
  v_time time := (v_ts at time zone 'Africa/Cairo')::time;
  v_day text;
begin
  select * into v_profile from public.profiles where id=auth.uid();
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if coalesce(v_profile.status,'active') in ('pending','revoked') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  v_role_label := case
    when v_profile.role in ('admin','super_admin') then 'أدمن ذهبي'
    when v_profile.role='moderator' then 'مشرف'
    else 'عضو'
  end;
  v_day := case extract(dow from (v_ts at time zone 'Africa/Cairo'))::int
    when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
    when 6 then 'السبت' end;
  v_fp := upper(replace(gen_random_uuid()::text,'-',''));
  v_download_id := gen_random_uuid();

  insert into public.iv_pdf_download_fingerprints (
    id,fingerprint,user_id,user_name,role,role_label,material_id,file_name,source_path,
    parent_fingerprints,parent_count,downloaded_at,download_date,download_time,download_day
  ) values (
    v_download_id,v_fp,v_profile.id,coalesce(v_profile.full_name,v_profile.name,'عضو'),
    coalesce(v_profile.role,'member'),v_role_label,p_material_id::text,p_file_name,p_source_path,
    coalesce(p_parent_fingerprints,'{}'),coalesce(p_parent_count,0),v_ts,v_date,v_time,v_day
  );

  return jsonb_build_object(
    'download_id',v_download_id,'id',v_download_id,'fingerprint',v_fp,'user_id',v_profile.id,
    'user_name',coalesce(v_profile.full_name,v_profile.name,'عضو'),'role',coalesce(v_profile.role,'member'),
    'role_label',v_role_label,'material_id',p_material_id,'file_name',p_file_name,
    'downloaded_at',v_ts,'download_date',v_date,'download_time',v_time,'download_day',v_day,
    'parent_fingerprints',coalesce(p_parent_fingerprints,'{}'),'parent_count',coalesce(p_parent_count,0)
  );
end;
$$;
revoke all on function public.midad_register_pdf_download(bigint,text,text,text[],integer) from public;
grant execute on function public.midad_register_pdf_download(bigint,text,text,text[],integer) to authenticated;

-- Finalize after the browser writes the invisible marker into the PDF.
create or replace function public.midad_finalize_pdf_download(
  p_download_id uuid default null,
  p_final_sha256 text default null,
  p_parent_fingerprints text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_download_id uuid := p_download_id;
begin
  -- Normal path: use the id returned by the register RPC.
  -- Compatibility path: if an older frontend did not receive that key,
  -- finalize the latest still-pending download belonging to this user.
  if v_download_id is null then
    select id
      into v_download_id
    from public.iv_pdf_download_fingerprints
    where user_id = v_user
      and final_sha256 is null
      and created_at >= now() - interval '10 minutes'
    order by created_at desc
    limit 1;
  end if;

  if v_download_id is null then
    raise exception 'DOWNLOAD_NOT_FOUND';
  end if;

  update public.iv_pdf_download_fingerprints
  set final_sha256 = lower(trim(p_final_sha256)),
      parent_fingerprints = coalesce(p_parent_fingerprints, parent_fingerprints),
      parent_count = cardinality(coalesce(p_parent_fingerprints, parent_fingerprints))
  where id = v_download_id
    and user_id = v_user;

  if not found then
    raise exception 'DOWNLOAD_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'ok', true,
    'download_id', v_download_id,
    'final_sha256', lower(trim(p_final_sha256))
  );
end;
$$;
revoke all on function public.midad_finalize_pdf_download(uuid,text,text[]) from public;
grant execute on function public.midad_finalize_pdf_download(uuid,text,text[]) to authenticated;

-- Scanner/admin lookup. Returns a table so Supabase JS receives an array.
create or replace function public.midad_lookup_pdf_fingerprint(p_fingerprint text)
returns table (
  fingerprint text,user_id uuid,user_name text,role text,role_label text,material_id text,
  file_name text,downloaded_at timestamptz,download_date date,download_time time,download_day text,
  parent_fingerprints text[],parent_count integer,final_sha256 text
)
language sql
security definer
set search_path=public
as $$
  select f.fingerprint,f.user_id,f.user_name,f.role,f.role_label,f.material_id,f.file_name,
         f.downloaded_at,f.download_date,f.download_time,f.download_day,
         f.parent_fingerprints,f.parent_count,f.final_sha256
  from public.iv_pdf_download_fingerprints f
  where f.fingerprint=upper(trim(p_fingerprint))
    and exists (
      select 1 from public.profiles p where p.id=auth.uid()
        and p.role in ('admin','super_admin')
        and coalesce(p.status,'active') not in ('pending','revoked')
    );
$$;
revoke all on function public.midad_lookup_pdf_fingerprint(text) from public;
grant execute on function public.midad_lookup_pdf_fingerprint(text) to authenticated;

-- Exact-file fallback for the forensic scanner.
create or replace function public.midad_lookup_pdf_sha256(p_sha256 text)
returns table (
  fingerprint text,user_id uuid,user_name text,role text,role_label text,material_id text,
  file_name text,downloaded_at timestamptz,download_date date,download_time time,download_day text,
  parent_fingerprints text[],parent_count integer,final_sha256 text
)
language sql
security definer
set search_path=public
as $$
  select f.fingerprint,f.user_id,f.user_name,f.role,f.role_label,f.material_id,f.file_name,
         f.downloaded_at,f.download_date,f.download_time,f.download_day,
         f.parent_fingerprints,f.parent_count,f.final_sha256
  from public.iv_pdf_download_fingerprints f
  where f.final_sha256=lower(trim(p_sha256))
    and exists (
      select 1 from public.profiles p where p.id=auth.uid()
        and p.role in ('admin','super_admin')
        and coalesce(p.status,'active') not in ('pending','revoked')
    )
  order by f.downloaded_at asc;
$$;
revoke all on function public.midad_lookup_pdf_sha256(text) from public;
grant execute on function public.midad_lookup_pdf_sha256(text) to authenticated;

notify pgrst,'reload schema';

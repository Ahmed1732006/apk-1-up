-- IN THE VOID — PDF pre-generation / prepared copies
-- Run after MIDAD_PDF_FINGERPRINT.sql.
-- This is additive: it does not delete materials, users, fingerprints, or access rows.

alter table public.iv_pdf_download_fingerprints
  alter column downloaded_at drop not null;

alter table public.iv_pdf_download_fingerprints
  add column if not exists prepared_at timestamptz null,
  add column if not exists is_prepared boolean not null default false;

create index if not exists iv_pdf_fp_prepared_idx
  on public.iv_pdf_download_fingerprints(is_prepared, material_id, user_id);

create table if not exists public.iv_pdf_prepared_files (
  id uuid primary key default gen_random_uuid(),
  material_id bigint not null,
  user_id uuid not null,
  fingerprint text null,
  source_path text not null,
  prepared_path text null,
  file_name text null,
  final_sha256 text null,
  status text not null default 'pending'
    check (status in ('pending','processing','ready','error')),
  progress integer not null default 0 check (progress between 0 and 100),
  error_message text null,
  prepared_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(material_id,user_id)
);

create index if not exists iv_pdf_prepared_user_idx
  on public.iv_pdf_prepared_files(user_id,status);
create index if not exists iv_pdf_prepared_material_idx
  on public.iv_pdf_prepared_files(material_id,status);

create table if not exists public.iv_pdf_prepare_queue (
  id uuid primary key default gen_random_uuid(),
  material_id bigint null,
  user_id uuid null,
  status text not null default 'pending'
    check (status in ('pending','processing','done','error')),
  result jsonb null,
  error_message text null,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null
);
create index if not exists iv_pdf_prepare_queue_pending_idx
  on public.iv_pdf_prepare_queue(status,created_at);
create unique index if not exists iv_pdf_prepare_queue_pair_unique
  on public.iv_pdf_prepare_queue(material_id,user_id)
  where material_id is not null and user_id is not null and status in ('pending','processing');

-- Private bucket for the already-fingerprinted copies.
insert into storage.buckets (id,name,public)
values ('prepared-pdfs','prepared-pdfs',false)
on conflict (id) do update set public=false;

alter table public.iv_pdf_prepared_files enable row level security;
alter table public.iv_pdf_prepare_queue enable row level security;

drop policy if exists "iv_pdf_prepared_select_own" on public.iv_pdf_prepared_files;
create policy "iv_pdf_prepared_select_own"
on public.iv_pdf_prepared_files
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.role in ('admin','super_admin')
      and coalesce(p.status,'active') not in ('pending','revoked')
  )
);

drop policy if exists "iv_pdf_prepared_block_write" on public.iv_pdf_prepared_files;
create policy "iv_pdf_prepared_block_write"
on public.iv_pdf_prepared_files
for all to authenticated
using (false) with check (false);

drop policy if exists "iv_pdf_queue_admin_select" on public.iv_pdf_prepare_queue;
create policy "iv_pdf_queue_admin_select"
on public.iv_pdf_prepare_queue
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.role in ('admin','super_admin')
      and coalesce(p.status,'active') not in ('pending','revoked')
  )
);

-- Members can download only their own prepared object:
drop policy if exists "iv_pdf_prepared_storage_select" on storage.objects;
create policy "iv_pdf_prepared_storage_select"
on storage.objects
for select to authenticated
using (
  bucket_id='prepared-pdfs'
  and split_part(name,'/',1)=auth.uid()::text
);

drop policy if exists "iv_pdf_prepared_storage_admin" on storage.objects;
create policy "iv_pdf_prepared_storage_admin"
on storage.objects
for select to authenticated
using (
  bucket_id='prepared-pdfs'
  and exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.role in ('admin','super_admin')
      and coalesce(p.status,'active') not in ('pending','revoked')
  )
);

-- Queue helpers. These are deliberately small and idempotent.
create or replace function public.midad_enqueue_pdf_material(p_material_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','super_admin') and coalesce(p.status,'active') not in ('pending','revoked')) then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_material_id is null then return jsonb_build_object('ok',false,'reason','NO_MATERIAL'); end if;
  if not exists(select 1 from public.materials where id=p_material_id and file_path is not null and lower(file_path) like '%.pdf') then
    return jsonb_build_object('ok',false,'reason','NOT_PDF');
  end if;
  if not exists(select 1 from public.iv_pdf_prepare_queue q where q.material_id=p_material_id and q.status in ('pending','processing')) then
    insert into public.iv_pdf_prepare_queue(material_id,status) values(p_material_id,'pending');
  end if;
  return jsonb_build_object('ok',true,'queued',true,'material_id',p_material_id);
end;
$$;

create or replace function public.midad_enqueue_pdf_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','super_admin') and coalesce(p.status,'active') not in ('pending','revoked')) then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_user_id is null then return jsonb_build_object('ok',false,'reason','NO_USER'); end if;
  if not exists(select 1 from public.profiles where id=p_user_id and coalesce(status,'active') not in ('pending','revoked')) then
    return jsonb_build_object('ok',false,'reason','USER_NOT_ACTIVE');
  end if;
  if not exists(select 1 from public.iv_pdf_prepare_queue q where q.user_id=p_user_id and q.status in ('pending','processing')) then
    insert into public.iv_pdf_prepare_queue(user_id,status) values(p_user_id,'pending');
  end if;
  return jsonb_build_object('ok',true,'queued',true,'user_id',p_user_id);
end;
$$;

revoke all on function public.midad_enqueue_pdf_material(bigint) from public;
revoke all on function public.midad_enqueue_pdf_user(uuid) from public;
grant execute on function public.midad_enqueue_pdf_material(bigint) to authenticated;
grant execute on function public.midad_enqueue_pdf_user(uuid) to authenticated;

-- Automatic queueing when a PDF is created/changed, and when an active user is created.
create or replace function public.iv_pdf_prepare_material_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if ((tg_op='INSERT' and new.file_path is not null)
     or (tg_op='UPDATE' and coalesce(new.file_path,'') <> coalesce(old.file_path,'')))
     and lower(coalesce(new.file_path,'')) like '%.pdf' then
    insert into public.iv_pdf_prepare_queue(material_id,user_id,status)
    select new.id,p.id,'pending'
    from public.profiles p
    where coalesce(p.status,'active') not in ('pending','revoked')
      and not exists (
        select 1 from public.iv_pdf_prepare_queue q
        where q.material_id=new.id and q.user_id=p.id and q.status in ('pending','processing')
      );
  end if;
  return new;
end;
$$;

drop trigger if exists iv_pdf_prepare_material_after_write on public.materials;
create trigger iv_pdf_prepare_material_after_write
after insert or update of file_path on public.materials
for each row execute function public.iv_pdf_prepare_material_trigger();

create or replace function public.iv_pdf_prepare_user_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if coalesce(new.status,'active') not in ('pending','revoked') then
    insert into public.iv_pdf_prepare_queue(material_id,user_id,status)
    select m.id,new.id,'pending'
    from public.materials m
    where m.is_active=true and m.file_path is not null and lower(m.file_path) like '%.pdf'
      and not exists (
        select 1 from public.iv_pdf_prepare_queue q
        where q.material_id=m.id and q.user_id=new.id and q.status in ('pending','processing')
      );
  end if;
  return new;
end;
$$;

drop trigger if exists iv_pdf_prepare_user_after_insert on public.profiles;
create trigger iv_pdf_prepare_user_after_insert
after insert on public.profiles
for each row execute function public.iv_pdf_prepare_user_trigger();

-- Member status card: aggregate preparation state for the current user.
create or replace function public.midad_get_my_pdf_preparation_status()
returns jsonb
language sql
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.materials m where m.is_active=true and m.file_path is not null and lower(m.file_path) like '%.pdf'),
    'ready', (select count(*) from public.iv_pdf_prepared_files f join public.materials m on m.id=f.material_id
              where f.user_id=auth.uid() and f.status='ready' and m.is_active=true and m.file_path is not null and lower(m.file_path) like '%.pdf'),
    'processing', (select count(*) from public.iv_pdf_prepared_files f where f.user_id=auth.uid() and f.status in ('pending','processing')),
    'errors', (select count(*) from public.iv_pdf_prepared_files f where f.user_id=auth.uid() and f.status='error')
  );
$$;
revoke all on function public.midad_get_my_pdf_preparation_status() from public;
grant execute on function public.midad_get_my_pdf_preparation_status() to authenticated;

create or replace function public.midad_get_my_pdf_prepared(p_material_id bigint)
returns table (
  id uuid, material_id bigint, status text, progress integer,
  prepared_path text, file_name text, fingerprint text, final_sha256 text,
  source_path text, prepared_at timestamptz, updated_at timestamptz, error_message text
)
language sql
security definer
set search_path=public
as $$
  select f.id,f.material_id,f.status,f.progress,f.prepared_path,f.file_name,f.fingerprint,
         f.final_sha256,f.source_path,f.prepared_at,f.updated_at,f.error_message
  from public.iv_pdf_prepared_files f
  where f.material_id=p_material_id and f.user_id=auth.uid();
$$;
revoke all on function public.midad_get_my_pdf_prepared(bigint) from public;
grant execute on function public.midad_get_my_pdf_prepared(bigint) to authenticated;

-- Record the real download time without rebuilding the PDF.
create or replace function public.midad_mark_prepared_pdf_download(p_prepared_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v uuid;
begin
  select id into v
  from public.iv_pdf_prepared_files
  where id=p_prepared_id and user_id=auth.uid() and status='ready';
  if v is null then raise exception 'PREPARED_FILE_NOT_FOUND'; end if;

  update public.iv_pdf_prepared_files set updated_at=now() where id=v;

  update public.iv_pdf_download_fingerprints f
  set downloaded_at=now()
  where f.fingerprint=(select fingerprint from public.iv_pdf_prepared_files where id=v);

  return jsonb_build_object('ok',true,'downloaded_at',now());
end;
$$;
revoke all on function public.midad_mark_prepared_pdf_download(uuid) from public;
grant execute on function public.midad_mark_prepared_pdf_download(uuid) to authenticated;

-- Backfill existing PDFs and active users once. This only creates queue rows; it
-- does not process PDFs inside the browser or change existing files.
insert into public.iv_pdf_prepare_queue(material_id,user_id,status)
select m.id,p.id,'pending'
from public.materials m
cross join public.profiles p
where m.is_active=true
  and m.file_path is not null
  and lower(m.file_path) like '%.pdf'
  and coalesce(p.status,'active') not in ('pending','revoked')
  and not exists (
    select 1 from public.iv_pdf_prepared_files f
    where f.material_id=m.id and f.user_id=p.id and f.status='ready' and f.source_path=m.file_path
  )
  and not exists (
    select 1 from public.iv_pdf_prepare_queue q
    where q.material_id=m.id and q.user_id=p.id and q.status in ('pending','processing')
  );

notify pgrst,'reload schema';

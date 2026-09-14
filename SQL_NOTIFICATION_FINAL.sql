-- IN THE VOID — FINAL notification/admin-message repair
-- Run once in Supabase SQL Editor.
-- Uses the REAL schema found in the current database.

begin;

-- ============================================================
-- A) ADMIN MESSAGE READS
-- user_messages.id = bigint
-- user_message_reads(message_id bigint, user_id uuid, read_at timestamptz, view_count integer)
-- ============================================================

create unique index if not exists user_message_reads_user_message_uidx
  on public.user_message_reads(user_id, message_id);

create or replace function public.mark_my_messages_read(p_message_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولًا';
  end if;

  insert into public.user_message_reads(user_id, message_id, read_at, view_count)
  select auth.uid(), m.id, now(), 1
  from public.user_messages m
  where m.id = any(coalesce(p_message_ids, '{}'::bigint[]))
    and m.is_active = true
    and (m.target_user_id is null or m.target_user_id = auth.uid())
  on conflict (user_id, message_id) do update
    set read_at = now(),
        view_count = coalesce(public.user_message_reads.view_count,0) + 1;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.mark_my_messages_read(bigint[]) to authenticated;

-- Return only currently available admin messages.
-- A message disappears after its configured max_views is reached.
create or replace function public.midad_get_my_admin_messages()
returns setof public.user_messages
language sql
security definer
set search_path = public
as $$
  select m.*
  from public.user_messages m
  left join public.user_message_reads r
    on r.message_id = m.id
   and r.user_id = auth.uid()
  where auth.uid() is not null
    and m.is_active = true
    and (m.target_user_id is null or m.target_user_id = auth.uid())
    and (
      m.max_views is null
      or coalesce(r.view_count,0) < greatest(m.max_views,1)
    )
  order by m.created_at desc;
$$;

grant execute on function public.midad_get_my_admin_messages() to authenticated;

-- Admin history: who read each admin message.
create or replace function public.midad_admin_user_message_reads(p_message_ids bigint[])
returns table(
  message_id bigint,
  user_id uuid,
  read_at timestamptz,
  view_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id=auth.uid() and role in ('admin','super_admin')
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select r.message_id, r.user_id, r.read_at, coalesce(r.view_count,1)
  from public.user_message_reads r
  where r.message_id = any(coalesce(p_message_ids,'{}'::bigint[]))
  order by r.read_at desc;
end;
$$;

grant execute on function public.midad_admin_user_message_reads(bigint[]) to authenticated;

-- ============================================================
-- B) NORMAL NOTIFICATIONS
-- notif_center is separate from user_messages.
-- notif_center_views is the ONLY receipt table used by V3.
-- ============================================================

create or replace function public.midad_notif_center_admin_send(
  p_title text,
  p_body text,
  p_target_type text default 'all',
  p_target_user_ids uuid[] default '{}',
  p_excluded_user_ids uuid[] default '{}',
  p_media_path text default null,
  p_media_type text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_target_type text := case
    when lower(coalesce(p_target_type,'all')) in ('all','selected','excluded')
      then lower(coalesce(p_target_type,'all'))
    else 'all'
  end;
begin
  if not exists (
    select 1 from public.profiles
    where id=auth.uid() and role in ('admin','super_admin')
  ) then
    raise exception 'not authorized';
  end if;

  if nullif(trim(coalesce(p_title,'')),'') is null then
    raise exception 'notification title is required';
  end if;

  if v_target_type='selected'
     and coalesce(array_length(p_target_user_ids,1),0)=0 then
    raise exception 'selected notification requires at least one recipient';
  end if;

  -- Current schema: target_user_ids is an ARRAY and excluded_user_ids is jsonb.
  insert into public.notif_center(
    title, body, media_type, media_path,
    target_type, target_user_ids, created_by, excluded_user_ids
  )
  values(
    p_title, coalesce(p_body,''), p_media_type, p_media_path,
    v_target_type, coalesce(p_target_user_ids,'{}'::uuid[]),
    auth.uid(), to_jsonb(coalesce(p_excluded_user_ids,'{}'::uuid[]))
  )
  returning id::text into v_id;

  return v_id;
end;
$$;

grant execute on function public.midad_notif_center_admin_send(text,text,text,uuid[],uuid[],text,text) to authenticated;

-- Member list must use notif_center_views, not the old notif_center_reads table.
create or replace function public.midad_notif_center_my_list()
returns table(
  id uuid,
  title text,
  body text,
  media_type text,
  media_path text,
  created_at timestamptz,
  open_count integer,
  first_opened_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.title, n.body, n.media_type, n.media_path, n.created_at,
         coalesce(v.opened_count,0), v.first_opened_at
  from public.notif_center n
  left join public.notif_center_views v
    on v.notification_id=n.id::text and v.user_id=auth.uid()
  left join public.notif_center_user_hidden h
    on h.notification_id=n.id::text and h.user_id=auth.uid()
  where auth.uid() is not null
    and h.notification_id is null
    and (
      v.first_opened_at is null
      or v.first_opened_at > now() - interval '24 hours'
    )
    and (
      coalesce(n.target_type,'all')='all'
      or (
        coalesce(n.target_type,'all')='selected'
        and coalesce(to_jsonb(n.target_user_ids),'[]'::jsonb) ? auth.uid()::text
      )
      or (
        coalesce(n.target_type,'all')='excluded'
        and not (coalesce(to_jsonb(n.excluded_user_ids),'[]'::jsonb) ? auth.uid()::text)
      )
    )
  order by n.created_at desc;
$$;

grant execute on function public.midad_notif_center_my_list() to authenticated;

-- Keep the existing V2 list available and consistent.
create or replace function public.notif_center_my_list_v2()
returns table(
  id text,
  title text,
  body text,
  target_type text,
  target_user_ids jsonb,
  excluded_user_ids jsonb,
  media_path text,
  media_type text,
  created_at timestamptz,
  updated_at timestamptz,
  open_count integer,
  first_opened_at timestamptz,
  last_opened_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id::text, n.title, n.body,
         coalesce(n.target_type,'all'),
         coalesce(to_jsonb(n.target_user_ids),'[]'::jsonb),
         coalesce(n.excluded_user_ids,'[]'::jsonb),
         n.media_path, n.media_type, n.created_at, n.updated_at,
         coalesce(v.opened_count,0), v.first_opened_at, v.last_opened_at
  from public.notif_center n
  left join public.notif_center_views v
    on v.notification_id=n.id::text and v.user_id=auth.uid()
  left join public.notif_center_user_hidden h
    on h.notification_id=n.id::text and h.user_id=auth.uid()
  where auth.uid() is not null
    and h.notification_id is null
    and (
      v.first_opened_at is null
      or v.first_opened_at > now() - interval '24 hours'
    )
    and (
      coalesce(n.target_type,'all')='all'
      or (coalesce(n.target_type,'all')='selected'
          and coalesce(to_jsonb(n.target_user_ids),'[]'::jsonb) ? auth.uid()::text)
      or (coalesce(n.target_type,'all')='excluded'
          and not (coalesce(n.excluded_user_ids,'[]'::jsonb) ? auth.uid()::text)
      )
    )
  order by n.created_at desc;
$$;

grant execute on function public.notif_center_my_list_v2() to authenticated;

-- Record notification opening in notif_center_views.
create or replace function public.notif_center_mark_opened_v2(p_notif_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.notif_center n
    where n.id::text=p_notif_id
      and (
        coalesce(n.target_type,'all')='all'
        or (coalesce(n.target_type,'all')='selected'
            and coalesce(to_jsonb(n.target_user_ids),'[]'::jsonb) ? auth.uid()::text)
        or (coalesce(n.target_type,'all')='excluded'
            and not (coalesce(n.excluded_user_ids,'[]'::jsonb) ? auth.uid()::text)
        )
      )
  ) then
    raise exception 'notification not addressed to this user';
  end if;

  insert into public.notif_center_views(
    notification_id,user_id,opened_count,first_opened_at,last_opened_at
  ) values(p_notif_id,auth.uid(),1,now(),now())
  on conflict(notification_id,user_id) do update set
    opened_count=public.notif_center_views.opened_count+1,
    last_opened_at=now();
end;
$$;

grant execute on function public.notif_center_mark_opened_v2(text) to authenticated;

commit;

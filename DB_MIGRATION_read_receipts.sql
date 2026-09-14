-- ============================================================
-- Run this ONCE in Supabase → SQL editor.
-- It adds: (1) a per-user "who opened it / when" table if you
-- don't already have one, (2) an admin-only RPC to read that
-- list for one notification, (3) an admin-only RPC to delete
-- one person's read-receipt, and (4) auto-purge of any
-- read-receipt older than 7 days (runs automatically every
-- time an admin opens the "من شاف" list — no cron needed).
-- Safe to re-run: everything uses IF NOT EXISTS / OR REPLACE.
-- ============================================================

-- 1) Per-user status table (id/columns match what notif_center_my_list
--    and notif_center_mark_opened already rely on: notif_id, user_id,
--    open_count, opened_at). If your table already exists with these
--    columns this is a no-op.
create table if not exists public.notif_center_status (
  notif_id uuid not null references public.notif_center(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  open_count int not null default 0,
  opened_at timestamptz,
  deleted_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (notif_id, user_id)
);

alter table public.notif_center_status enable row level security;

drop policy if exists "own status" on public.notif_center_status;
create policy "own status" on public.notif_center_status
  for select using (auth.uid() = user_id);

drop policy if exists "own status upsert" on public.notif_center_status;
create policy "own status upsert" on public.notif_center_status
  for insert with check (auth.uid() = user_id);

drop policy if exists "own status update" on public.notif_center_status;
create policy "own status update" on public.notif_center_status
  for update using (auth.uid() = user_id);

-- Admins can read/delete every row (adjust the role check to match
-- how your `profiles.role` values are spelled if different).
drop policy if exists "admin full access" on public.notif_center_status;
create policy "admin full access" on public.notif_center_status
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );

-- 2) Admin: list who opened a given notification + when, and
--    self-clean anything older than 7 days on every call.
create or replace function public.notif_center_admin_receipts(p_notif_id uuid)
returns table(user_id uuid, name text, email text, open_count int, opened_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','super_admin')) then
    raise exception 'not authorized';
  end if;

  -- auto-purge read-receipts older than 7 days
  delete from public.notif_center_status ncs
    where ncs.notif_id = p_notif_id and ncs.opened_at is not null and ncs.opened_at < now() - interval '7 days';

  return query
    select s.user_id, p.name, p.email, s.open_count, s.opened_at
    from public.notif_center_status s
    join public.profiles p on p.id = s.user_id
    where s.notif_id = p_notif_id and s.opened_at is not null
    order by s.opened_at desc;
end;
$$;

grant execute on function public.notif_center_admin_receipts(uuid) to authenticated;

-- 3) Admin: delete one person's read-receipt for one notification
--    (does not delete the notification itself, just the "who saw it"
--    record for that one user).
create or replace function public.notif_center_admin_clear_receipt(p_notif_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','super_admin')) then
    raise exception 'not authorized';
  end if;
  delete from public.notif_center_status where notif_id = p_notif_id and user_id = p_user_id;
end;
$$;

grant execute on function public.notif_center_admin_clear_receipt(uuid, uuid) to authenticated;

-- ============================================================
-- 4) Fix: the "رسالة من الإدارة" welcome/admin-message popup was
--    never being marked as read, so `get_my_unread_messages` kept
--    returning the same message forever. Your actual tables are
--    `user_messages` and `user_message_reads(user_id, message_id)`
--    — this just adds the missing RPC that inserts into the real
--    read-tracking table when the app shows a message. No changes
--    to your existing get_my_unread_messages function are needed.
-- ============================================================

-- (cleanup: drop the wrong guess from the previous version of this file,
--  if you already ran it — safe no-op if it was never created)
drop function if exists public.mark_user_messages_seen(uuid[]);
drop table if exists public.admin_message_seen;

create or replace function public.mark_user_messages_seen(p_message_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_message_reads(user_id, message_id)
  select auth.uid(), m_id
  from unnest(p_message_ids) as m_id
  where not exists (
    select 1 from public.user_message_reads r
    where r.user_id = auth.uid() and r.message_id = m_id
  );
end;
$$;

grant execute on function public.mark_user_messages_seen(uuid[]) to authenticated;

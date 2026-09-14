-- Stores one row per (user, device token) so the server can push a real
-- OS-level notification via Firebase Cloud Messaging. The client already
-- writes to this table after registering for push (see app/index.html).
create table if not exists public.device_push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.device_push_tokens enable row level security;

drop policy if exists "device_push_tokens_owner_rw" on public.device_push_tokens;
create policy "device_push_tokens_owner_rw"
  on public.device_push_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The send-push Edge Function runs with the service role key, which
-- bypasses RLS entirely, so no extra policy is needed for it.

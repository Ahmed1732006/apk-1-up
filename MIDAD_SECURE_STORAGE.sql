-- MIDAD: secure material downloads + admin attachments.
-- Run once in Supabase SQL Editor.
-- This works with the new client code that uses Storage.download(), not public/signed URLs.

-- 1) Make the relevant buckets private.
update storage.buckets set public = false where id in ('materials', 'admin-messages', 'member-uploads');

-- 2) Approved/active signed-in accounts may read study materials and admin-message attachments.
drop policy if exists "midad_materials_select_authenticated" on storage.objects;
create policy "midad_materials_select_authenticated"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'materials'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

drop policy if exists "midad_admin_messages_select_authenticated" on storage.objects;
create policy "midad_admin_messages_select_authenticated"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'admin-messages'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

-- 3) Admin/super-admin can upload, update, and delete material files.
drop policy if exists "midad_materials_admin_insert" on storage.objects;
create policy "midad_materials_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'materials'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

drop policy if exists "midad_materials_admin_update" on storage.objects;
create policy "midad_materials_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'materials'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
)
with check (
  bucket_id = 'materials'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

drop policy if exists "midad_materials_admin_delete" on storage.objects;
create policy "midad_materials_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'materials'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

-- 4) Admin/super-admin can manage welcome-message attachments.
drop policy if exists "midad_admin_messages_admin_insert" on storage.objects;
create policy "midad_admin_messages_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'admin-messages'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

drop policy if exists "midad_admin_messages_admin_update" on storage.objects;
create policy "midad_admin_messages_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'admin-messages'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
)
with check (
  bucket_id = 'admin-messages'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

drop policy if exists "midad_admin_messages_admin_delete" on storage.objects;
create policy "midad_admin_messages_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'admin-messages'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

-- 5) Members still need to be able to upload to member-uploads; only admins are
-- allowed to read those objects back from the admin panel.
drop policy if exists "midad_member_uploads_insert_authenticated" on storage.objects;
create policy "midad_member_uploads_insert_authenticated"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'member-uploads'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

drop policy if exists "midad_member_uploads_select_admin" on storage.objects;
create policy "midad_member_uploads_select_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'member-uploads'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

-- Optional: allow admins to clean up member-upload objects from the admin panel.
drop policy if exists "midad_member_uploads_admin_delete" on storage.objects;
create policy "midad_member_uploads_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'member-uploads'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
      and coalesce(p.status, 'active') not in ('pending', 'revoked')
  )
);

notify pgrst, 'reload schema';

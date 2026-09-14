-- IN THE VOID · Notification / Admin Messages diagnostics
-- Run this in Supabase SQL Editor and copy the result sets back.
-- This file ONLY READS metadata/data; it does not modify anything.

-- 1) Exact table columns + types
select table_name,column_name,data_type,udt_name,is_nullable,column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('notif_center','notif_center_views','notif_center_status','notif_center_user_hidden',
                     'user_messages','user_message_reads','message_reads')
order by table_name,ordinal_position;

-- 2) RLS / policies on the two separate systems
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname='public'
  and tablename in ('notif_center','notif_center_views','notif_center_user_hidden','user_messages','user_message_reads','message_reads')
order by tablename,policyname;

-- 3) Notification-related functions and their real definitions
select n.nspname as schema_name,p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as returns,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'notif_center_my_list','notif_center_my_list_v2','notif_center_mark_opened','notif_center_mark_opened_v2',
    'notif_center_admin_views','midad_notif_center_my_list','midad_notif_center_mark_opened',
    'midad_notif_center_admin_views','midad_notif_center_admin_send',
    'get_my_unread_messages','mark_user_messages_seen','midad_get_my_admin_messages','midad_mark_admin_messages_seen',
    'midad_admin_user_message_reads'
  )
order by p.proname,arguments;

-- 4) Latest notification rows (safe metadata/content check)
select id,title,target_type,target_user_ids,excluded_user_ids,created_at,updated_at
from public.notif_center
order by created_at desc
limit 20;

-- 5) Latest notification open records
select notification_id,user_id,opened_count,first_opened_at,last_opened_at
from public.notif_center_views
order by last_opened_at desc nulls last
limit 100;

-- 6) Latest ADMIN MESSAGE rows
select id,target_user_id,title,message_kind,max_views,is_active,created_at
from public.user_messages
order by created_at desc
limit 30;

-- 7) Latest ADMIN MESSAGE read records
select *
from public.user_message_reads
order by seen_at desc
limit 100;

-- 8) Current authenticated user + role (when run from the app SQL context)
select auth.uid() as current_uid,
       (select jsonb_build_object('id',p.id,'role',p.role,'is_owner_admin',p.is_owner_admin,'email',p.email)
        from public.profiles p where p.id=auth.uid()) as current_profile;

-- 9) Quick counts to spot the exact failure
select
  (select count(*) from public.notif_center) as notifications_total,
  (select count(*) from public.notif_center_views) as notification_views_total,
  (select count(*) from public.user_messages) as admin_messages_total,
  (select count(*) from public.user_message_reads) as admin_message_views_total;

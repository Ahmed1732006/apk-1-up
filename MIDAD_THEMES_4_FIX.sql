-- MIDAD Themes + public manager info migration
-- Safe to run more than once.

alter table public.user_theme_preferences
  add column if not exists themes_bottom_button_enabled boolean not null default false;

alter table public.platform_profile
  add column if not exists public_version text not null default '3';
alter table public.platform_profile
  add column if not exists news_items jsonb not null default '[]'::jsonb;

update public.platform_profile set public_version='3' where public_version is null or btrim(public_version)='';
update public.platform_profile set news_items='[]'::jsonb where news_items is null;

notify pgrst, 'reload schema';

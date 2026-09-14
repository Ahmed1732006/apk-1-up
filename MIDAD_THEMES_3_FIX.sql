-- MIDAD: safe repair for the 3 additional themes.
-- Run once in Supabase SQL Editor. Safe to run again.

create table if not exists public.platform_themes (
  id bigint generated always as identity primary key,
  theme_key text not null,
  display_name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_default boolean not null default false,
  parent_theme_id bigint null references public.platform_themes(id) on delete set null,
  route text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_themes add column if not exists route text;
alter table public.platform_themes add column if not exists parent_theme_id bigint;
alter table public.platform_themes add column if not exists is_active boolean not null default true;
alter table public.platform_themes add column if not exists is_default boolean not null default false;
alter table public.platform_themes add column if not exists sort_order integer not null default 0;

insert into public.platform_themes (theme_key, display_name, sort_order, is_active, is_default, parent_theme_id, route)
select v.theme_key, v.display_name,
       coalesce((select max(sort_order) from public.platform_themes),0) + v.rn,
       true, false, null, v.route
from (values
  (1,'theme-baby-blue','الأزرق الفاتح','themes/2-baby-blue.html'),
  (2,'theme-aurora-glass','زجاج الشفق','themes/2-aurora-glass.html'),
  (3,'theme-warda-pink','الوردي الورد','themes/2-warda-pink.html')
) v(rn,theme_key,display_name,route)
where not exists (
  select 1 from public.platform_themes p
  where p.theme_key=v.theme_key and p.parent_theme_id is null
);

update public.platform_themes p
set route=v.route, updated_at=now()
from (values
  ('theme-baby-blue','themes/2-baby-blue.html'),
  ('theme-aurora-glass','themes/2-aurora-glass.html'),
  ('theme-warda-pink','themes/2-warda-pink.html')
) v(theme_key,route)
where p.theme_key=v.theme_key and p.parent_theme_id is null;

notify pgrst, 'reload schema';

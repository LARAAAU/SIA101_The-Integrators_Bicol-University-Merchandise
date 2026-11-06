-- MerchSys migration 07: shop open/closed and maintenance mode
-- Run in Supabase SQL Editor. Safe to run more than once.
-- The admin controls these in Admin > Shop status.
create table if not exists public.shop_settings (
  id integer primary key default 1 check (id = 1),      -- one row only
  is_open boolean not null default true,                -- false = students cannot place new orders
  closed_message text,                                  -- shown to students while the shop is closed
  maintenance_mode boolean not null default false,      -- true = only staff and admin can use the site
  maintenance_message text,                             -- shown on the maintenance screen
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.shop_settings enable row level security;

insert into public.shop_settings (id) values (1) on conflict (id) do nothing;

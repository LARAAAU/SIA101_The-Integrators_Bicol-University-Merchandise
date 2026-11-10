-- BU Merch migration 14: homepage hero pictures (the 3 floating items beside "Wear BU.")
-- Run in Supabase SQL Editor. Safe to run more than once.
-- The admin edits them in Admin > Shop status > Homepage pictures. An empty slot picks a product automatically.
alter table public.shop_settings add column if not exists hero1_url text;
alter table public.shop_settings add column if not exists hero1_label text;
alter table public.shop_settings add column if not exists hero2_url text;
alter table public.shop_settings add column if not exists hero2_label text;
alter table public.shop_settings add column if not exists hero3_url text;
alter table public.shop_settings add column if not exists hero3_label text;

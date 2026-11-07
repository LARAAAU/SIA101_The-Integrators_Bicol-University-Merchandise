-- MerchSys migration 10: announcement popup (text and optional image shown to students when they open the site)
-- Run in Supabase SQL Editor. Safe to run more than once.
-- The admin edits it in Admin > Shop status. Leave both the text and the image empty to show no popup.
alter table public.shop_settings add column if not exists announcement_enabled boolean not null default true;
alter table public.shop_settings add column if not exists announcement_text text;
alter table public.shop_settings add column if not exists announcement_image_url text;  -- optional poster/image shown in the popup

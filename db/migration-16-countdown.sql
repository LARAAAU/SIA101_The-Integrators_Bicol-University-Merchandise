-- BU Merch migration 16: editable pre-order countdown (the timer beside "Wear BU." on the home page)
-- Run in Supabase SQL Editor. Safe to run more than once.
-- The admin edits it in Admin > Shop status > Pre-order countdown.
-- Leave countdown_at empty to follow the earliest product pre-order deadline automatically.
alter table public.shop_settings add column if not exists countdown_enabled boolean not null default true;
alter table public.shop_settings add column if not exists countdown_at timestamptz;   -- custom closing date and time
alter table public.shop_settings add column if not exists countdown_label text;       -- optional label, default "Next pre-order closes in"

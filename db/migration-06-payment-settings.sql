-- BU Merch migration 06: editable GCash account for manual payments
-- Run in Supabase SQL Editor. Safe to run more than once.
-- The admin edits these values in Admin > Payment settings.
create table if not exists public.payment_settings (
  id integer primary key default 1 check (id = 1),   -- one row only
  gcash_name text not null default '',
  gcash_number text not null default '',
  gcash_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.payment_settings enable row level security;

insert into public.payment_settings (id) values (1) on conflict (id) do nothing;

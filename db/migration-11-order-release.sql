-- BU Merch migration 11: pickup release confirmation
-- Run in Supabase SQL Editor. Safe to run more than once (also safe if you already ran an earlier version of it).
-- When staff hand an order over, they check the student's school ID and press "Release order".
-- These columns record who collected it and who released it. (The ID number itself is only checked, never stored.)
alter table public.orders add column if not exists released_at timestamptz;
alter table public.orders add column if not exists released_by uuid;                      -- staff/admin who released it. Deliberately NOT a foreign key to profiles:
                                                                                         -- a second link from orders to profiles makes "profiles(...)" in the API ambiguous.
alter table public.orders add column if not exists released_to text;                      -- name of the person who collected the order
alter table public.orders add column if not exists received_by text check (received_by in ('student', 'representative'));

-- If an earlier version of this migration created the foreign key, remove it
alter table public.orders drop constraint if exists orders_released_by_fkey;

-- Make the API pick up the change right away
notify pgrst, 'reload schema';

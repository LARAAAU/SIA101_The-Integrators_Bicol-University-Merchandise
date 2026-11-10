-- BU Merch migration 09: scheduled order pickup reminders
-- Run in Supabase SQL Editor. Safe to run more than once.
-- Remembers how many pickup reminders an order already got (so students are never emailed twice
-- for the same thing) and lets the order history show "Pickup reminder emailed".
alter table public.orders add column if not exists pickup_reminder_count int not null default 0;
alter table public.orders add column if not exists last_pickup_reminder_at timestamptz;

alter table public.order_events drop constraint if exists order_events_event_check;
alter table public.order_events add constraint order_events_event_check
  check (event in ('placed','status','payment','receipt','reminder'));

create index if not exists idx_orders_ready on public.orders (status) where status = 'ready_for_pickup';

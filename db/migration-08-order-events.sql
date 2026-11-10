-- BU Merch migration 08: order status timeline (who changed what, and when)
-- Run in Supabase SQL Editor. Safe to run more than once.
-- Every order gets a history: placed, each status change, payment updates and receipt uploads,
-- together with the person (student, staff, admin) or the system that did it.
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event text not null check (event in ('placed','status','payment','receipt')),
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null default 'system' check (actor_role in ('student','staff','admin','system')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_events_order on public.order_events (order_id, created_at);
alter table public.order_events enable row level security;  -- only the server (service role) reads and writes it

-- Give orders that existed before this migration a starting history.
insert into public.order_events (order_id, event, to_status, actor_id, actor_role, note, created_at)
select o.id, 'placed', 'pending', o.student_id, 'student', 'Order placed', o.created_at
from public.orders o
where not exists (select 1 from public.order_events e where e.order_id = o.id);

insert into public.order_events (order_id, event, from_status, to_status, actor_role, note, created_at)
select o.id, 'status', 'pending', o.status, 'system', 'Recorded before the timeline was added', o.updated_at
from public.orders o
where o.status <> 'pending'
  and not exists (select 1 from public.order_events e where e.order_id = o.id and e.event = 'status');

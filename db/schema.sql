-- MerchSys v2 - Supabase (PostgreSQL) schema
-- Run this whole file once in: Supabase Dashboard > SQL Editor > New query

create extension if not exists "pgcrypto";

-- ===== TABLES =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  university_email text not null unique,
  course text,
  role text not null default 'student' check (role in ('student','staff','admin')),
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 5,
  image_url text,
  preorder_deadline timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity,
  student_id uuid not null references public.profiles(id),
  total numeric(10,2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','approved','ready_for_pickup','completed','cancelled')),
  payment_method text not null check (payment_method in ('gcash_online','gcash_manual','onsite')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','pending_verification','paid','failed')),
  pickup_date date,
  reference_number text,
  receipt_path text,
  paymongo_checkout_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name text not null,          -- snapshot so history survives product edits
  unit_price numeric(10,2) not null,
  quantity integer not null check (quantity > 0)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,              -- 'paymongo' | 'manual'
  provider_ref text,
  amount numeric(10,2) not null,
  status text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);

-- ===== INDEXES (fast dashboards and lists) =====
create index idx_orders_student_created on public.orders (student_id, created_at desc);
create index idx_orders_status on public.orders (status);
create index idx_orders_created on public.orders (created_at desc);
create index idx_orders_checkout on public.orders (paymongo_checkout_id);
create index idx_items_order on public.order_items (order_id);
create index idx_items_product on public.order_items (product_id);
create unique index uq_payments_provider_ref on public.payments (provider, provider_ref) where provider_ref is not null;

-- ===== SECURITY =====
-- The browser never talks to the database directly; only our server does, using the service-role key.
-- RLS enabled with NO policies = direct access with the public anon key is denied.
alter table public.profiles    enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.payments    enable row level security;

-- ===== STORAGE BUCKETS =====
insert into storage.buckets (id, name, public) values
  ('product-images', 'product-images', true),   -- public: shown on the shop
  ('receipts', 'receipts', false)               -- private: served through signed URLs
on conflict (id) do nothing;

-- ===== TRANSACTIONAL FUNCTIONS =====
-- Place an order atomically: validates deadline + stock, deducts stock, snapshots prices.
create or replace function public.create_order(p_student uuid, p_items jsonb, p_payment_method text)
returns uuid language plpgsql as $$
declare
  v_order uuid;
  v_total numeric(10,2) := 0;
  it jsonb;
  prod record;
  qty integer;
begin
  insert into orders (student_id, payment_method) values (p_student, p_payment_method) returning id into v_order;

  for it in select * from jsonb_array_elements(p_items) loop
    qty := (it->>'quantity')::int;
    select * into prod from products where id = (it->>'product_id')::uuid and is_active for update;
    if not found then raise exception 'A product in your cart is no longer available'; end if;
    if prod.preorder_deadline is not null and prod.preorder_deadline < now() then
      raise exception 'Pre-order for % is already closed', prod.name;
    end if;
    if prod.stock < qty then raise exception 'Not enough stock for % (only % left)', prod.name, prod.stock; end if;

    update products set stock = stock - qty where id = prod.id;
    insert into order_items (order_id, product_id, product_name, unit_price, quantity)
      values (v_order, prod.id, prod.name, prod.price, qty);
    v_total := v_total + prod.price * qty;
  end loop;

  update orders set total = v_total where id = v_order;
  return v_order;
end $$;

-- Cancel an order and put the stock back.
create or replace function public.cancel_order(p_order uuid)
returns void language plpgsql as $$
declare o record;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status in ('cancelled','completed') then raise exception 'Order is already %', o.status; end if;

  update products p set stock = p.stock + oi.quantity
    from order_items oi where oi.order_id = p_order and oi.product_id = p.id;
  update orders set status = 'cancelled', updated_at = now() where id = p_order;
end $$;

-- One call returns every number and chart dataset the admin dashboard needs.
create or replace function public.dashboard_stats()
returns jsonb language sql stable as $$
select jsonb_build_object(
  'totals', (select jsonb_build_object(
      'revenue',          coalesce(sum(total) filter (where payment_status = 'paid'), 0),
      'orders',           count(*),
      'pending_payments', count(*) filter (where payment_status in ('unpaid','pending_verification') and status <> 'cancelled'),
      'completed',        count(*) filter (where status = 'completed'),
      'ready_for_pickup', count(*) filter (where status = 'ready_for_pickup')
    ) from orders),
  'low_stock', (select count(*) from products where is_active and stock <= low_stock_threshold),
  'revenue_by_day', (select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb) from (
      select (created_at at time zone 'Asia/Manila')::date as day,
             coalesce(sum(total) filter (where payment_status = 'paid'), 0) as revenue,
             count(*) as orders
      from orders
      where created_at > now() - interval '30 days' and status <> 'cancelled'
      group by 1) d),
  'orders_by_status', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (
      select status, count(*) as count from orders group by status) s),
  'top_products', (select coalesce(jsonb_agg(p order by p.units desc), '[]'::jsonb) from (
      select oi.product_name as name, sum(oi.quantity) as units
      from order_items oi join orders o on o.id = oi.order_id
      where o.status <> 'cancelled'
      group by oi.product_name order by sum(oi.quantity) desc limit 5) p),
  'payment_split', (select coalesce(jsonb_agg(m), '[]'::jsonb) from (
      select payment_method as method, count(*) as count
      from orders where status <> 'cancelled' group by payment_method) m)
);
$$;

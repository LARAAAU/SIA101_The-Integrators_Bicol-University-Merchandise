-- BU Merch migration 02: campuses (pickup locations), product categories, "shipped" status
-- Run in Supabase SQL Editor AFTER schema.sql. Safe to run more than once.

-- 1. Campuses
create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_main boolean not null default false,
  pickup_note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.campuses enable row level security;

-- 2. Product categories
alter table public.products add column if not exists category text not null default 'Others';
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('Clothes','Bags','Caps','Pins','Others'));

-- 3. Orders: pickup campus, per-order pickup note, new "shipped" status
alter table public.orders add column if not exists pickup_campus_id uuid references public.campuses(id);
alter table public.orders add column if not exists pickup_note text;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','approved','shipped','ready_for_pickup','completed','cancelled'));
create index if not exists idx_orders_campus on public.orders (pickup_campus_id);

-- 4. Placeholder campuses (only when the table is empty). EDIT THESE in Admin > Campuses.
insert into public.campuses (name, address, is_main, pickup_note, sort_order)
select * from (values
  ('BU Main Campus', 'Legazpi City, Albay (update address)', true,
   'Pick up at the Main Campus. Bring your school ID and your order number.', 1),
  ('BU Daraga Campus', 'Daraga, Albay (update address)', false,
   'Your order is delivered to this campus. Bring your school ID. If delivery is delayed, you may be asked to pick up at the Main Campus.', 2),
  ('BU Tabaco Campus', 'Tabaco City, Albay (update address)', false,
   'Your order is delivered to this campus. Bring your school ID. If delivery is delayed, you may be asked to pick up at the Main Campus.', 3),
  ('BU Polangui Campus', 'Polangui, Albay (update address)', false,
   'Your order is delivered to this campus. Bring your school ID. If delivery is delayed, you may be asked to pick up at the Main Campus.', 4),
  ('BU Guinobatan Campus', 'Guinobatan, Albay (update address)', false,
   'Your order is delivered to this campus. Bring your school ID. If delivery is delayed, you may be asked to pick up at the Main Campus.', 5),
  ('BU Gubat Campus', 'Gubat, Sorsogon (update address)', false,
   'Your order is delivered to this campus. Bring your school ID. If delivery is delayed, you may be asked to pick up at the Main Campus.', 6)
) as v(name, address, is_main, pickup_note, sort_order)
where not exists (select 1 from public.campuses);

-- 5. create_order now needs the pickup campus
drop function if exists public.create_order(uuid, jsonb, text);
create or replace function public.create_order(p_student uuid, p_items jsonb, p_payment_method text, p_campus uuid)
returns uuid language plpgsql as $$
declare
  v_order uuid;
  v_total numeric(10,2) := 0;
  it jsonb;
  prod record;
  qty integer;
begin
  if not exists (select 1 from campuses where id = p_campus and is_active) then
    raise exception 'Please choose a pickup campus';
  end if;

  insert into orders (student_id, payment_method, pickup_campus_id)
    values (p_student, p_payment_method, p_campus) returning id into v_order;

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

-- 6. Dashboard: add shipped count and orders per campus
create or replace function public.dashboard_stats()
returns jsonb language sql stable as $$
select jsonb_build_object(
  'totals', (select jsonb_build_object(
      'revenue',          coalesce(sum(total) filter (where payment_status = 'paid'), 0),
      'orders',           count(*),
      'pending_payments', count(*) filter (where payment_status in ('unpaid','pending_verification') and status <> 'cancelled'),
      'completed',        count(*) filter (where status = 'completed'),
      'in_transit',       count(*) filter (where status = 'shipped'),
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
      from orders where status <> 'cancelled' group by payment_method) m),
  'orders_by_campus', (select coalesce(jsonb_agg(c order by c.count desc), '[]'::jsonb) from (
      select coalesce(ca.name, 'Not set') as campus, count(*) as count
      from orders o left join campuses ca on ca.id = o.pickup_campus_id
      where o.status <> 'cancelled' group by 1) c)
);
$$;

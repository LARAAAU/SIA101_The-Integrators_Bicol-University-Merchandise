-- MerchSys migration 05: provider-neutral checkout id (works for Maya or PayMongo)
-- Run BEFORE restarting the server. Safe to run more than once.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'orders' and column_name = 'paymongo_checkout_id') then
    alter table public.orders rename column paymongo_checkout_id to checkout_id;
  end if;
end $$;

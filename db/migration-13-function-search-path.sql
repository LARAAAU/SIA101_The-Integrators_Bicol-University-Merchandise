-- BU Merch migration 13: pin the search_path of the app's database functions
-- Fixes the Supabase Security Advisor warning "Function Search Path Mutable"
-- (create_order, cancel_order, dashboard_stats). Safe to run more than once.
-- Run in: Supabase Dashboard > SQL Editor > New query. It does not change what the functions do:
-- the functions already use the public schema, this only stops the schema from being chosen by the caller.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_order', 'cancel_order', 'dashboard_stats')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;
notify pgrst, 'reload schema';

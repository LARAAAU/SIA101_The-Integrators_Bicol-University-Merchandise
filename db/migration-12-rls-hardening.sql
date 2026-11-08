-- MerchSys migration 12: Row Level Security hardening  (checklist item 90)
--
-- WHY
--   Every database call in MerchSys is made by the Express server with the SERVICE-ROLE key.
--   That key skips RLS on purpose. The browser never talks to the database directly, so the public
--   (anon) and logged-in (authenticated) Data API roles need NO access to anything in the public schema.
--   Supabase gives those roles broad grants by default, and the only thing stopping them is RLS.
--   This file adds two more locks so one mistake (like switching RLS off on a new table) cannot leak data:
--     1) RLS is ON for every table
--     2) anon and authenticated have no table, sequence or function privileges at all
--
-- Safe to run more than once. Run it in: Supabase Dashboard > SQL Editor > New query.
-- Then run db/rls-audit.sql and make sure everything says PASS.

-- 1) Row Level Security on for EVERY table in public (also covers tables from later migrations)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 2) Take every privilege away from the browser-facing roles
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all functions in schema public from public;   -- functions are executable by everyone unless this is revoked

-- 3) The server (service_role) keeps full access
grant all     on all tables    in schema public to service_role;
grant all     on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 4) Same rules for things created LATER by this role (new tables, new functions)
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges                  revoke all on functions from public;
alter default privileges in schema public grant all     on tables    to service_role;
alter default privileges in schema public grant all     on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- 5) Storage buckets: only product photos are public. Receipts and the server's own buckets stay private.
--    (audit-logs and pickup-schedule are created by the server the first time they are used; this does nothing until then.)
update storage.buckets set public = false where id in ('receipts', 'audit-logs', 'pickup-schedule');
update storage.buckets set file_size_limit = 5242880 where id in ('product-images', 'receipts');   -- 5 MB, same as the server

-- Tell the Data API to pick up the new privileges right away
notify pgrst, 'reload schema';

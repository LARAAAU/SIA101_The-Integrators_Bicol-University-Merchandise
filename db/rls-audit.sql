-- BU Merch RLS audit (checklist item 90). READ-ONLY: it changes nothing.
-- Run it in Supabase Dashboard > SQL Editor > New query, before AND after db/migration-12-rls-hardening.sql.
-- Read the result table from the top: the first row is the SUMMARY. Every row should be PASS.
--   FAIL   = a real exposure, fix it (the detail column says how)
--   WARN   = probably wrong, check it
--   REVIEW / INFO = not a problem by itself, but a person should look at it
-- Take a screenshot of the result for your documentation.

with
tbl as (
  select c.oid, c.relname as name, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
fn as (
  select p.oid, p.oid::regprocedure::text as sig, p.prosecdef as definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- ignore extension functions
),
pol as (
  select tablename, count(*) as n, string_agg(policyname, ', ') as names
  from pg_policies where schemaname = 'public' group by tablename
),
checks as (
  select 1 as ord, 'Row Level Security is ON' as check_name, 'table ' || name as item,
         case when rls then 'PASS' else 'FAIL' end as result,
         case when rls then 'RLS is enabled'
              else 'Run migration-12 (or: alter table public.' || name || ' enable row level security)' end as detail
  from tbl
  union all
  select 2, 'Public (anon) role cannot touch tables', 'table ' || name,
         case when has_table_privilege('anon', oid, 'select,insert,update,delete,truncate') then 'FAIL' else 'PASS' end,
         case when has_table_privilege('anon', oid, 'select,insert,update,delete,truncate')
              then 'anon still has privileges here: run migration-12' else 'no privileges' end
  from tbl
  union all
  select 3, 'Logged-in (authenticated) role cannot touch tables', 'table ' || name,
         case when has_table_privilege('authenticated', oid, 'select,insert,update,delete,truncate') then 'FAIL' else 'PASS' end,
         case when has_table_privilege('authenticated', oid, 'select,insert,update,delete,truncate')
              then 'authenticated still has privileges here: run migration-12' else 'no privileges' end
  from tbl
  union all
  select 4, 'Functions cannot be called from the browser', 'function ' || sig,
         case when has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')
              then 'FAIL' else 'PASS' end,
         case when has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')
              then 'callable through /rest/v1/rpc: run migration-12' else 'only the server can run it' end
  from fn
  union all
  select 5, 'Functions run with the caller''s rights', 'function ' || sig,
         case when definer then 'WARN' else 'PASS' end,
         case when definer then 'SECURITY DEFINER bypasses RLS: make sure this is intended' else 'SECURITY INVOKER (default)' end
  from fn
  union all
  select 6, 'Policies on public tables', 'table ' || t.name,
         case when coalesce(p.n, 0) = 0 then 'PASS' else 'INFO' end,
         case when coalesce(p.n, 0) = 0
              then 'no policies: only the server (service role) can use this table'
              else p.n::text || ' policy(ies): ' || p.names || '. Review that they are intended' end
  from tbl t left join pol p on p.tablename = t.name
  union all
  select 7, 'Storage bucket visibility', 'bucket ' || b.id,
         case when b.id = 'product-images' and b.public then 'PASS'
              when b.id = 'product-images' then 'WARN'
              when b.public then 'FAIL' else 'PASS' end,
         case when b.id = 'product-images' and b.public then 'public on purpose (shop photos)'
              when b.id = 'product-images' then 'private: product photos will not show in the shop'
              when b.public then 'must be PRIVATE (files are only served through short-lived signed links)'
              else 'private' end
  from storage.buckets b
  union all
  select 8, 'Storage policies (storage.objects)', 'policy ' || policyname, 'REVIEW',
         'roles: ' || array_to_string(roles, ',') || ' | command: ' || cmd || '. BU Merch uploads only through the server, so none are needed'
  from pg_policies where schemaname = 'storage'
  union all
  select 8, 'Storage policies (storage.objects)', 'none found', 'PASS',
         'uploads and downloads happen only through the server'
  where not exists (select 1 from pg_policies where schemaname = 'storage')
)
select check_name, item, result, detail
from (
  select 0 as ord, 'SUMMARY' as check_name, 'all checks' as item,
         case when count(*) filter (where result = 'FAIL') = 0 then 'PASS' else 'FAIL' end as result,
         (count(*) filter (where result = 'FAIL'))::text || ' failing, '
           || (count(*) filter (where result = 'WARN'))::text || ' warning(s), '
           || count(*)::text || ' checks in total' as detail
  from checks
  union all
  select ord, check_name, item, result, detail from checks
) r
order by case when ord = 0 then -1
              else case result when 'FAIL' then 0 when 'WARN' then 1 when 'REVIEW' then 2 when 'INFO' then 3 else 4 end end,
         ord, item;

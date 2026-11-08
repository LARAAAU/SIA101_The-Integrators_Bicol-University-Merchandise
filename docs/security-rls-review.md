# Security Review: Supabase Row Level Security (RLS)
Checklist item 90 | MerchSys | Reviewed against the latest project ZIP

## 1. How MerchSys uses the database (why this matters)
```
Browser  ->  Express API (checks login + role)  ->  Supabase (service-role key)
                                     \-> the anon key is used ONLY for Supabase Auth (sign in / refresh), never for tables
```
- All reading and writing of tables, RPC functions and Storage files is done by the **server** with the **service-role key**, which bypasses RLS by design.
- Authorization (student / staff / admin) is enforced by the Express middleware (`requireAuth`, `staffOnly`, `adminOnly`).
- So the public (`anon`) and logged-in (`authenticated`) Supabase roles should have **no access at all** to the `public` schema. The anon key is visible to anyone who views the site, so we must assume anyone can call the Data API (`/rest/v1/...`) directly with it.

## 2. What the code and schema review found
| Area | Finding | Result |
|---|---|---|
| RLS enabled | `profiles`, `products`, `orders`, `order_items`, `payments`, `campuses`, `order_events`, `payment_settings`, `shop_settings` all have `enable row level security` in the SQL files | OK |
| Policies | None are defined. With RLS on and no policy, `anon` and `authenticated` get zero rows. This matches the server-only design | OK |
| Table grants | Supabase grants `anon` and `authenticated` broad privileges on new tables by default (the "Automatically expose new tables" option). Only RLS was protecting the data | **Gap, fixed by migration 12** |
| Function access | `create_order`, `cancel_order`, `dashboard_stats` are executable by PUBLIC by default, so they are reachable at `/rest/v1/rpc/...`. They are not SECURITY DEFINER, so RLS still applies to them, but they should not be callable at all | **Gap, fixed by migration 12** |
| anon client usage | `anon()` is used only for `auth.signInWithPassword` and `auth.refreshSession` (routes/auth.js). It never calls `.from()`, `.rpc()` or `.storage` | OK |
| Secrets in the frontend | No service-role key, secret key or Supabase URL appears in `public/` | OK |
| `.env` in Git | `.env` is in `.gitignore` and was never committed (`git log --all -- .env` is empty) | OK |
| `.env.example` | Contains the public Maya **sandbox** keys. They are published by Maya for public testing, so low risk, but placeholders are cleaner | Low, optional |
| Storage buckets | `product-images` is public (shop photos). `receipts` is private and served by signed URLs (1 hour). `audit-logs` and `pickup-schedule` are created by the server as private. No storage policies are defined | OK; migration 12 also forces the private ones to stay private and adds a 5 MB limit |

## 3. Fix: migration 12
`db/migration-12-rls-hardening.sql` adds two more locks on top of RLS:
1. RLS is switched on for every table in `public` (including tables added later if the file is re-run).
2. `anon` and `authenticated` lose all table, sequence and function privileges. `service_role` keeps full access, so the app keeps working. Default privileges are changed so future tables and functions follow the same rule.

It also keeps the private buckets private and limits uploads to 5 MB.

`db/migration-13-function-search-path.sql` is a small follow-up. After migration 12 the Supabase Security Advisor still showed 3 warnings, "Function Search Path Mutable", for `create_order`, `cancel_order` and `dashboard_stats`. Migration 13 pins their `search_path` to `public`. It does not change what the functions do.

## 4. How to verify it in the REAL Supabase project
This could not be run from the code alone, because it depends on the live project's settings. Do these steps and record the results in section 6.

1. **Before the fix:** run `db/rls-audit.sql` (SQL Editor). Screenshot the result. Expect FAIL rows for anon/authenticated table access and function access.
2. Run `db/migration-12-rls-hardening.sql`.
3. **After the fix:** run `db/rls-audit.sql` again. The first row (SUMMARY) must say PASS with `0 failing`. Screenshot it.
4. **Security Advisor:** Dashboard > Advisors > Security. There should be no "RLS Disabled in Public" errors. "RLS Enabled No Policy" notices are expected and fine here (server-only design).
5. **Live attack test with the anon key** (it is visible in any browser, so this is what an outsider can do). Replace the two values with your project URL and anon key. Windows PowerShell:
   ```powershell
   $u = "https://YOUR-REF.supabase.co"; $k = "YOUR-ANON-KEY"
   $h = @{ apikey = $k; Authorization = "Bearer $k" }
   foreach ($t in "profiles","orders","payments","payment_settings","shop_settings") {
     try { $r = Invoke-RestMethod "$u/rest/v1/$t?select=*" -Headers $h; "$t -> returned $($r.Count) rows" }
     catch { "$t -> BLOCKED: " + $_.Exception.Message }
   }
   # RPC and write attempts
   try { Invoke-RestMethod "$u/rest/v1/rpc/dashboard_stats" -Method Post -Headers $h -ContentType "application/json" -Body "{}" } catch { "rpc -> BLOCKED" }
   try { Invoke-RestMethod "$u/rest/v1/products" -Method Post -Headers $h -ContentType "application/json" -Body '{"name":"hack","price":1}' } catch { "insert -> BLOCKED" }
   ```
   **Expected after migration 12:** every line says BLOCKED (permission denied, HTTP 401/403). Before the fix you may see "returned 0 rows", which is still safe (RLS hid the rows) but weaker.
6. **Storage test:** open `https://YOUR-REF.supabase.co/storage/v1/object/public/receipts/anything.png` in a browser. It must NOT show a file (expect "Bucket not found" or 400/404). A product photo URL from the shop must still load.
7. **Dashboard check:** Storage: only `product-images` shows "Public". Authentication > Policies / Database > Tables: every table shows RLS enabled.
8. **Regression test (the app must still work):** log in as student, load the shop, place an order, cancel it, then open the admin dashboard, Orders, Products, Pickup locations, and Users. If anything fails with "permission denied for table ..." in the server terminal, re-run the three `grant ... to service_role` lines of migration 12.

## 5. Residual risks and notes (for the documentation)
- **The service-role key is the real secret.** Anyone who gets it bypasses everything. Keep it only in `.env` and in Vercel Environment Variables. Never commit it or paste it in chat or screenshots. Rotate it (Project Settings > API) if it was ever shared.
- **No per-user policies on purpose.** Authorization is done in the Express API. If the frontend ever calls Supabase directly with supabase-js, per-user policies would have to be written first.
- **Signed links:** receipt images are served through 1-hour signed URLs, so anyone holding a fresh link can open that one file until it expires.
- Default privileges changed by migration 12 apply to objects created by the same database role (`postgres`, which the SQL Editor and Table Editor use). Re-run `migration-12` after adding new tables from another role.

- **Security Advisor after migration 12:** 0 errors, 4 warnings. Three were "Function Search Path Mutable" (fixed by migration 13). The fourth is "Leaked Password Protection Disabled" (Auth). That is a Supabase setting that is only available on the Pro plan, so it cannot be turned on with the Free plan. Accepted risk: the app already requires a password policy and uses Supabase Auth for hashing and login. Enable it in Authentication > Sign In / Providers > Password security if the project is upgraded.
- **Security Advisor info:** 9 suggestions. These should be "RLS Enabled No Policy", one per table. That is expected for this server-only design (see section 2).
- The `permission denied ... GRANT SELECT ... TO anon` hint that Supabase prints in the error is only a generic suggestion. Do NOT run it, it would undo migration 12.

## 6. Test log
Project: SIA101_The Integrators_MerchSys (Supabase, region of the project dashboard). Tester: Queen Lara Bias. All tests run on 11/8/2026.

| # | Test | Expected | Actual | Pass/Fail | Date | Tester |
|---|---|---|---|---|---|---|
| 1 | rls-audit.sql BEFORE migration 12 | Some FAIL rows (shows the gap) | SUMMARY FAIL: 21 failing (9 tables x anon/authenticated = 18, plus 3 functions), 0 warnings, 47 checks | Pass (gap shown) | 11/8/2026 | Queen Lara Bias |
| 2 | rls-audit.sql AFTER migration 12 | SUMMARY = PASS, 0 failing | SUMMARY PASS: 0 failing, 0 warnings, 47 checks. Migration 12 ran with "Success. No rows returned" | Pass | 11/8/2026 | Queen Lara Bias |
| 3 | Security Advisor | No "RLS Disabled" errors | 0 errors. 4 warnings (3 function search_path, fixed by migration 13; 1 leaked password protection, Pro plan only). 9 info suggestions | Pass | 11/8/2026 | Queen Lara Bias |
| 4 | anon key: read profiles, orders, payments, payment_settings, shop_settings | Blocked | All 5 blocked. HTTP 401, code 42501 "permission denied for table ..." (checked for profiles, orders, payments) | Pass | 11/8/2026 | Queen Lara Bias |
| 5 | anon key: call rpc/dashboard_stats | Blocked | Blocked (HTTP 401) | Pass | 11/8/2026 | Queen Lara Bias |
| 6 | anon key: insert into products | Blocked | Blocked (HTTP 401) | Pass | 11/8/2026 | Queen Lara Bias |
| 7 | Open a private receipt URL as public | No file served | HTTP 404 "Bucket not found" (NoSuchBucket) | Pass | 11/8/2026 | Queen Lara Bias |
| 8 | Shop product photo still loads | Loads | University Hoodie image loads from .../storage/v1/object/public/product-images/... | Pass | 11/8/2026 | Queen Lara Bias |
| 9 | Student flow (login, shop, order, cancel) | Works | Works, no "permission denied" in the server terminal | Pass | 11/8/2026 | Queen Lara Bias |
| 10 | Admin flow (dashboard, orders, products, locations, users) | Works | Works, no "permission denied" in the server terminal | Pass | 11/8/2026 | Queen Lara Bias |
| 11 | rls-audit.sql and Security Advisor after migration 13 | 0 failing; no "Function Search Path Mutable" warnings; app still works | rls-audit.sql PASS (0 failing, 0 warnings, 47 checks). Security Advisor: 0 errors, 1 warning (leaked password protection, Pro plan only), 9 info (RLS Enabled No Policy, expected). Student order and cancel and the admin dashboard still work, no errors in the server terminal | Pass | 11/8/2026 | Queen Lara Bias |

## 7. Suggested text for the checklist (item 90)
- **Code evidence / notes:** RLS enabled on all 9 tables; no policies by design (server-only access with the service-role key); anon client used only for Auth; no secrets in `public/`; migration 12 revokes anon/authenticated privileges and function execute; `db/rls-audit.sql` verifies it.
- **Your test result / notes:** 11/8/2026: rls-audit.sql BEFORE migration 12 = 21 failing; AFTER = PASS, 0 failing, 0 warnings, 47 checks. Anon (publishable) key: reading profiles/orders/payments/payment_settings/shop_settings, calling rpc/dashboard_stats and inserting into products are all blocked (HTTP 401, 42501 permission denied). Private receipts bucket returns 404 from the public URL; product photos still load from the public product-images bucket. Student and admin flows still work. Security Advisor after migration 13: 0 errors, 1 warning (leaked password protection, accepted: Pro-plan feature), 9 info (RLS Enabled No Policy, expected). rls-audit.sql still PASS after migration 13 and the app still works.

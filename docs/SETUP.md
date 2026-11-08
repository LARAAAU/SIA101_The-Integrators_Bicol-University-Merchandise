# MerchSys v2: Setup Guide (kayo ang gagawa nito)

## 1. Supabase (database, auth, storage)
1. Sign up at supabase.com, **New project**. Region: **Southeast Asia (Singapore)**. Save the database password.
2. Open **SQL Editor > New query**, paste all of `db/schema.sql`, click **Run**.
3. Run `db/migration-02-campuses.sql` the same way (adds campuses, product categories, and the Shipped status).
4. Run `db/migration-03-student-info.sql` too (adds student ID, year level, block, campus, address, and phone to accounts).
5. Run `db/migration-04-locations-middlename.sql` (adds the real BU colleges and campuses as pickup locations and middle names).
6. Run `db/migration-05-payment-gateway.sql` (renames the checkout id column so any payment provider works).
7. Run `db/migration-06-payment-settings.sql` (adds the editable GCash account for manual payments; set it in Admin > Payment settings).
8. Run `db/migration-07-shop-settings.sql` (adds the shop open/closed switch and maintenance mode; set them in Admin > Shop status).
9. Run `db/migration-08-order-events.sql` (adds the order status timeline: who changed an order and when; shown on the order page and in the admin order window).
9. Run `db/migration-09-pickup-reminders.sql` (adds scheduled pickup reminder emails; on Vercel also set `CRON_SECRET`, see `.env.example`).
10. Run `db/migration-10-announcement.sql` (adds the announcement popup).
11. Run `db/migration-11-order-release.sql` (adds pickup release confirmation: staff check the student's school ID before an order is completed).
12. (Optional) Run `db/seed.sql` for sample products.
7. **Project Settings > API**: copy `Project URL`, `anon` key, and `service_role` key.
   The service_role key is a secret. Never put it in frontend code or commit it.

## 2. Run locally
```bash
npm install
cp .env.example .env     # then fill in the values
npm run dev              # http://localhost:3000
```
Check `http://localhost:3000/api/health`.

## 3. Make your first admin
Register an account through the app (or `POST /api/auth/register`), then in the Supabase SQL Editor:
```sql
update public.profiles set role = 'admin' where university_email = 'your@email.com';
```
After that you can promote staff from the Users page.

## 4. Online payment: Maya Checkout sandbox (no sign-up needed)
PayMongo sign-ups may be paused. Maya publishes **public sandbox keys** for testing, so you can use those.
1. Open https://developers.maya.ph/reference/sandbox-credentials-and-cards
2. In the **Checkout** keys, copy a **public key** (`pk-...`) and its **secret key** (`sk-...`) from the same row.
3. Put them in `.env`:
   ```
   MAYA_PUBLIC_KEY=pk-...
   MAYA_SECRET_KEY=sk-...
   ```
4. Restart the server. Run `db/migration-05-payment-gateway.sql` in Supabase first.
5. To test: place an order with **Online payment**, pay with the **sandbox test card or test Maya wallet** listed on that same Maya page (no real money), then you are redirected back and the order turns **Paid** automatically.
6. These keys are shared by every developer who uses them, so never treat the data as private. Do not put real card numbers.
7. If PayMongo opens again, set `PAYMONGO_SECRET_KEY` and leave the Maya keys blank (or set `PAYMENT_PROVIDER=paymongo`). Nothing else changes.

## 5. Resend (emails)
1. Sign up at resend.com, create an API key, put it in `RESEND_API_KEY`.
2. Without a verified domain, Resend only delivers to the email you signed up with. Use that email for your demo account, or verify a domain.
3. If the key is empty, the app still works and logs "mail skipped".

## 6. New GitHub repository
```bash
git init
git add .
git commit -m "Initial commit: MerchSys v2"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/sia-merchsys.git
git push -u origin main
```
Check `git status` first: `.env` must NOT be listed (it is in `.gitignore`).

## 7. Deploy to Vercel
1. vercel.com > **Add New > Project** > import the GitHub repo. Framework preset: **Other**.
2. Add Environment Variables (same names as `.env.example`). Set `APP_URL` to your Vercel URL after the first deploy, then redeploy.
3. Deploy. Test `https://YOUR-APP.vercel.app/api/health`.

## Security reminder
The old MerchSys repo contained a `.env` with the MongoDB connection string. Change that database password or delete the old cluster.

## Not verified yet
This code was written without internet access, so it has not been run against live Supabase, Maya, or Resend. Test each flow in test mode and check the PayMongo response fields against their docs while testing.

## Submission file names (IT 118 format: SIA101_GroupName_ProjectTitle)
Replace `GroupName` with your actual group name (no spaces).
- Documentation (all documents combined, PDF): `SIA101_GroupName_MerchSys.pdf`
- Source code (ZIP, without `node_modules` and `.env`): `SIA101_GroupName_MerchSys.zip`

# MerchSys v2: Setup Guide (kayo ang gagawa nito)

## 1. Supabase (database, auth, storage)
1. Sign up at supabase.com, **New project**. Region: **Southeast Asia (Singapore)**. Save the database password.
2. Open **SQL Editor > New query**, paste all of `db/schema.sql`, click **Run**.
3. (Optional) Run `db/seed.sql` for sample products.
4. **Project Settings > API**: copy `Project URL`, `anon` key, and `service_role` key.
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

## 4. PayMongo (GCash, test mode)
1. Sign up at paymongo.com, stay in **Test mode**.
2. Developers > API Keys: copy the **secret key** (`sk_test_...`) into `PAYMONGO_SECRET_KEY`.
3. After deploying, Developers > Webhooks > create one:
   - URL: `https://YOUR-APP.vercel.app/api/payments/webhook`
   - Event: `checkout_session.payment.paid`
4. Local testing: webhooks cannot reach localhost, so the order page calls `/api/payments/verify/:orderId` after you return from the GCash test page. Same result.
5. The GCash test page lets you simulate a successful or failed payment (no real money).

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
This code was written without internet access, so it has not been run against live Supabase, PayMongo, or Resend. Test each flow in test mode and check the PayMongo response fields against their docs while testing.

## Submission file names (IT 118 format: SIA101_GroupName_ProjectTitle)
Replace `GroupName` with your actual group name (no spaces).
- Documentation (all documents combined, PDF): `SIA101_GroupName_MerchSys.pdf`
- Source code (ZIP, without `node_modules` and `.env`): `SIA101_GroupName_MerchSys.zip`

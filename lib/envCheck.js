// Startup check for environment variables (secrets and settings). Runs once when the server starts and
// prints plain-language problems in the console / Vercel logs. It never prints the secret values.
// Missing Supabase settings stop the server with a clear message instead of a confusing crash later.
const PLACEHOLDER = /^(your[-_ ]|changeme|change-me|xxx|todo|<)/i;

function checkEnv(env = process.env) {
  const errors = [], warnings = [];
  const prod = env.NODE_ENV === 'production' || !!env.VERCEL;
  const val = (k) => String(env[k] || '').trim();

  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!val(k)) errors.push(`${k} is missing. Copy it from Supabase > Project Settings > API into .env (or Vercel Environment Variables).`);
    else if (PLACEHOLDER.test(val(k))) errors.push(`${k} still has the placeholder text from .env.example. Put the real value.`);
  }
  if (val('SUPABASE_URL') && !/^https:\/\//.test(val('SUPABASE_URL'))) errors.push('SUPABASE_URL must start with https://');
  if (val('SUPABASE_SERVICE_ROLE_KEY') && val('SUPABASE_SERVICE_ROLE_KEY') === val('SUPABASE_ANON_KEY'))
    errors.push('SUPABASE_SERVICE_ROLE_KEY is the same as SUPABASE_ANON_KEY. They are different keys: use the service_role one.');

  const cron = val('CRON_SECRET');
  if (!cron) warnings.push(`CRON_SECRET is empty, so the daily pickup reminders cannot run${prod ? ' (set it in Vercel Environment Variables)' : ''}.`);
  else if (cron.length < 24) warnings.push('CRON_SECRET is short. Use at least 24 random characters (node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))").');

  const gmail = !!(val('GMAIL_USER') && val('GMAIL_APP_PASSWORD'));
  if (!gmail && !val('RESEND_API_KEY')) warnings.push('No email sender: set GMAIL_USER and GMAIL_APP_PASSWORD (or RESEND_API_KEY). Emails will be skipped (order updates, reminders, password reset).');
  if (!gmail && val('RESEND_API_KEY') && /onboarding@resend\.dev/i.test(val('MAIL_FROM') || 'onboarding@resend.dev'))
    warnings.push('MAIL_FROM uses onboarding@resend.dev: Resend only delivers to the email of your own Resend account until you verify a domain.');

  if (prod) {
    if (!val('APP_URL')) warnings.push('APP_URL is empty. Set it to your public URL (https://your-app.vercel.app) so email links and CORS work.');
    else if (!/^https:\/\//.test(val('APP_URL'))) warnings.push('APP_URL should start with https:// in production.');
    if (!val('MAYA_PUBLIC_KEY') || !val('MAYA_SECRET_KEY')) warnings.push('The Maya keys are not set (MAYA_PUBLIC_KEY and MAYA_SECRET_KEY): only manual payments will work.');
    if (/sandbox|paymaya\.com/i.test(val('MAYA_API_URL') || 'https://pg-sandbox.paymaya.com') && val('MAYA_SECRET_KEY'))
      warnings.push('Maya is in SANDBOX mode (test payments only). That is fine for a demo, not for real money.');
  }
  return { errors, warnings };
}

// Call once at startup, before anything creates the Supabase client.
function reportEnv(env = process.env) {
  const { errors, warnings } = checkEnv(env);
  warnings.forEach((w) => console.warn('[config] warning:', w));
  if (errors.length) {
    errors.forEach((e) => console.error('[config] ERROR:', e));
    throw new Error('Configuration problem: ' + errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more, see the log)` : ''));
  }
}

module.exports = { checkEnv, reportEnv };

// The public address of the site, used for links inside emails.
// Order: APP_URL (set this in Vercel) -> the production address Vercel provides -> this deployment's address -> nothing.
function appUrl() {
  const set = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (set) return set;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  return '';
}
module.exports = { appUrl };

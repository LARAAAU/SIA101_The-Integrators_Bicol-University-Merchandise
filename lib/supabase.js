const { createClient } = require('@supabase/supabase-js');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

// Service-role client: bypasses RLS. Used ONLY on the server.
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);

// Fresh anon client per sign-in so sessions never leak between requests.
const anon = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, opts);

module.exports = { admin, anon };

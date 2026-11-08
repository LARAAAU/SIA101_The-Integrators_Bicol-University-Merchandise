// Run before you push or share the project:   npm run check:secrets
// Looks at the files git tracks (what would be pushed) for things that look like real secrets, and checks
// that .env is not tracked or in the git history. It prints file names only, never the secret itself.
const { execSync } = require('child_process');
const fs = require('fs');

const run = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const PATTERNS = [
  ['a Supabase / JWT key', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ['a Resend API key', /\bre_[A-Za-z0-9]{20,}/],
  ['a PayMongo / Stripe style key', /\b[sp]k_(live|test)_[A-Za-z0-9]{16,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];

const files = run('git ls-files');
if (files === null) { console.log('This folder is not a git repository (or git is not installed). Run it inside the project after git init.'); process.exit(2); }
let problems = 0;
const problem = (m) => { problems++; console.log('  PROBLEM:', m); };

console.log('Checking tracked files...');
for (const f of files.split('\n').filter(Boolean)) {
  if (/(^|\/)\.env(\..+)?$/.test(f) && !/\.example$/.test(f)) problem(`${f} is tracked by git. Run: git rm --cached ${f}`);
  if (!fs.existsSync(f) || /\.(png|jpe?g|gif|ico|woff2?|pdf|zip)$/i.test(f) || /package-lock\.json$/.test(f)) continue;
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const [name, re] of PATTERNS) if (re.test(text)) problem(`${f} contains what looks like ${name}`);
}

console.log('Checking git history for .env files...');
const hist = run('git log --all --oneline -- .env .env.local .env.production');
if (hist && hist.trim()) problem('A .env file was committed in the past (commits below). Rotate those keys and clean the history:\n' + hist.trim().split('\n').map((l) => '      ' + l).join('\n'));

console.log('Checking .gitignore...');
const gi = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
if (!/^\.env$/m.test(gi)) problem('.gitignore does not list .env');
if (!/^node_modules\/?$/m.test(gi)) problem('.gitignore does not list node_modules');

console.log(problems ? `\n${problems} problem(s) found. Fix them before pushing or sharing.` : '\nAll good: no secrets found in tracked files or history.');
process.exit(problems ? 1 : 0);

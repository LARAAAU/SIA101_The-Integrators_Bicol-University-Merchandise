// Tiny SMTP client (implicit TLS, port 465) used to send email through Gmail. No npm package needed.
// Gmail login uses an "App Password" (Google Account > Security > 2-Step Verification > App passwords).
const tls = require('tls');
const crypto = require('crypto');

const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();           // no header injection
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=');
const textOf = (html) => String(html).replace(/<(br|\/p|\/h\d|\/div|\/tr)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n').trim();

function smtpConfigured() { return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD); }

function buildMessage({ from, fromName, to, subject, html }) {
  const boundary = '=_bu_' + crypto.randomBytes(8).toString('hex');
  const domain = (from.split('@')[1] || 'localhost');
  const head = [
    `From: ${fromName ? encodeWord(clean(fromName)) + ' ' : ''}<${from}>`,
    `To: <${clean(to)}>`,
    `Subject: ${encodeWord(clean(subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}\r\n`;
  return head + '\r\n\r\n' + part('text/plain', textOf(html)) + part('text/html', html) + `--${boundary}--\r\n`;
}

// Sends one email. Rejects with an Error that has .smtpCode when the server said no (535 = wrong login, 5xx = permanent, 4xx = try later).
function send({ to, subject, html }) {
  const user = process.env.GMAIL_USER.trim();
  const pass = process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '');
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT, 10) || 465;
  const fromName = (process.env.MAIL_FROM || '').match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || 'BICOL UNIVERSITY MERCHANDISE';
  const message = buildMessage({ from: user, fromName, to, subject, html });

  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: process.env.SMTP_INSECURE_TLS !== '1' });
    sock.setEncoding('utf8');
    sock.setTimeout(20000, () => fail(new Error('SMTP timed out')));
    let buf = '', waiter = null, done = false;
    const fail = (e) => { if (done) return; done = true; sock.destroy(); reject(e); };
    sock.on('error', fail);
    sock.on('close', () => fail(new Error('SMTP connection closed early')));
    const pump = () => {
      if (!waiter) return;
      const lines = buf.split('\r\n');
      const last = lines.length - 2;                       // last complete line
      if (last < 0) return;
      if (!/^\d{3} /.test(lines[last]) && !/^\d{3}$/.test(lines[last])) return;   // multi-line reply not finished
      const text = lines.slice(0, last + 1).join('\n');
      buf = lines.slice(last + 1).join('\r\n');
      const w = waiter; waiter = null; w({ code: parseInt(lines[last].slice(0, 3), 10), text });
    };
    sock.on('data', (d) => { buf += d; pump(); });
    const reply = () => new Promise((r) => { waiter = r; pump(); });
    const cmd = async (line, ok) => {
      if (line !== null) sock.write(line + '\r\n');
      const r = await reply();
      if (!ok.includes(r.code)) { const e = new Error(`SMTP ${r.code}: ${r.text.slice(0, 200)}`); e.smtpCode = r.code; throw e; }
      return r;
    };
    sock.once('secureConnect', async () => {
      try {
        await cmd(null, [220]);
        await cmd('EHLO bu-merch', [250]);
        await cmd('AUTH PLAIN ' + b64('\0' + user + '\0' + pass), [235]);
        await cmd(`MAIL FROM:<${user}>`, [250]);
        await cmd(`RCPT TO:<${clean(to)}>`, [250, 251]);
        await cmd('DATA', [354]);
        sock.write(message.replace(/^\./gm, '..') + '\r\n.\r\n');
        await cmd(null, [250]);
        sock.write('QUIT\r\n');
        done = true; sock.end(); resolve({ ok: true });
      } catch (e) { fail(e); }
    });
  });
}

module.exports = { smtpConfigured, send, buildMessage };

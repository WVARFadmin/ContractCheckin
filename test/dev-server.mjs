// Local preview server for testing the app without Netlify.
//   node test/dev-server.mjs [port]      then open http://localhost:8888
//
// Serves public/, runs the real API against an in-memory Postgres, and stands in
// for Netlify Identity (sign-in, password reset, invitations). Nothing is saved
// after it stops; no real emails are sent — links are printed here instead.
//
// Preview sign-in: any email you haven't used yet signs in with whatever password
// you type (and that becomes its password). admin@wvarf.test is the WVARF admin.
import http from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createApi } from '../lib/api-core.mjs';

const port = Number(process.argv[2] || 8888);
const root = new URL('../public/', import.meta.url).pathname;

const db = new PGlite();
const migDir = new URL('../netlify/database/migrations/', import.meta.url);
for (const f of readdirSync(migDir).sort()) await db.exec(readFileSync(new URL(f, migDir), 'utf8'));

// ---------- stand-in for Netlify Identity (GoTrue) ----------
const users = new Map();   // email -> { id, email, password }
const links = new Map();   // one-time code -> { type: 'recovery' | 'invite', email }
const events = [];         // what happened, for tests: GET /__preview/events
const say = (line) => { events.push(line); console.log(`[preview] ${line}`); };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtFor = (u) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, exp: Math.floor(Date.now() / 1000) + 3600 })}.preview`;
const emailFromJwt = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).email; } catch { return null; } };
const userJson = (u) => ({ id: u.id, aud: '', role: '', email: u.email, confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString() });
const tokenResponse = (u) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${u.id}` });
const newUser = (email, password) => { const u = { id: `u${users.size + 1}`, email, password }; users.set(email, u); return u; };
function newLink(type, email) {
  // Asking again cancels earlier links of the same kind, as Netlify does.
  for (const [code, l] of links) if (l.email === email && l.type === type) links.delete(code);
  const code = `${type}-${Math.random().toString(36).slice(2, 10)}`;
  links.set(code, { type, email });
  say(`EMAIL to ${email}: http://localhost:${port}/#${type}_token=${code}`);
  return code;
}

async function identity(req, res, path, body) {
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (path === '/settings') return send(200, { external: {}, disable_signup: true, autoconfirm: false });
  if (path === '/token') {
    const p = new URLSearchParams(body);
    if (p.get('grant_type') === 'refresh_token') {
      const u = [...users.values()].find((x) => `refresh-${x.id}` === p.get('refresh_token'));
      return u ? send(200, tokenResponse(u)) : send(400, { error: 'invalid_grant', error_description: 'Invalid refresh token' });
    }
    const email = (p.get('username') || '').toLowerCase();
    const u = users.get(email) || newUser(email, p.get('password'));
    if (u.password !== p.get('password')) return send(400, { error: 'invalid_grant', error_description: 'No user found with that email, or password invalid.' });
    say(`signed in ${email}`);
    return send(200, tokenResponse(u));
  }
  if (path === '/recover') {
    const { email } = JSON.parse(body || '{}');
    if (users.has(email)) newLink('recovery', email);
    return send(200, {});
  }
  if (path === '/verify') {
    const { token, type, password } = JSON.parse(body || '{}');
    const l = links.get(token);
    const ok = l && ((l.type === 'recovery' && type === 'recovery') || (l.type === 'invite' && type === 'signup'));
    if (!ok) { say(`link rejected (${type})`); return send(404, { code: 404, msg: 'User not found' }); }
    links.delete(token);
    const u = l.type === 'invite' ? (users.get(l.email) || newUser(l.email, password)) : users.get(l.email);
    if (l.type === 'invite') { u.password = password; say(`invite accepted by ${l.email}`); } else say(`reset link redeemed by ${l.email}`);
    return send(200, tokenResponse(u));
  }
  if (path === '/user') {
    const u = users.get(emailFromJwt((req.headers.authorization || '').replace(/^Bearer /, '')));
    if (!u) return send(401, { code: 401, msg: 'Invalid token' });
    if (req.method === 'PUT') {
      const d = JSON.parse(body || '{}');
      if (d.password) { u.password = d.password; say(`password changed for ${u.email}`); }
    }
    return send(200, userJson(u));
  }
  if (path === '/logout') { res.writeHead(204); return res.end(); }
  return send(404, { msg: `The preview has no stand-in for ${path}` });
}

const handle = createApi({
  query: async (text, params) => (await db.query(text, params)).rows,
  getUser: async (req) => {
    const email = emailFromJwt((req.headers.get('authorization') || '').replace(/^Bearer /, ''));
    return email && users.has(email) ? { email, name: null } : null;
  },
  inviteUser: async (email) => {
    if (email.startsWith('fail')) throw new Error('Netlify returned 503');
    if (users.has(email)) return 'already_registered';
    newLink('invite', email);
    return 'sent';
  },
  adminEmails: (process.env.ADMIN_EMAILS || 'admin@wvarf.test').split(','),
});

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString();

  if (url.pathname.startsWith('/.netlify/identity/')) return identity(req, res, url.pathname.slice('/.netlify/identity'.length), body);
  if (url.pathname === '/__preview/events') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(events)); }
  if (url.pathname.startsWith('/api/')) {
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? body : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  const p = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(port, () => console.log(`Preview at http://localhost:${port}  (WVARF admin: admin@wvarf.test)`));

// Local preview server for testing the app without Netlify.
// Serves public/, runs the real API against an in-memory Postgres, and swaps the
// Netlify login widget for a stub where you "sign in" as any email.
//   node test/dev-server.mjs [port]
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

const handle = createApi({
  query: async (text, params) => (await db.query(text, params)).rows,
  getUser: async (req) => {
    const a = req.headers.get('authorization') || '';
    return a.startsWith('Bearer ') ? { email: a.slice(7), name: null } : null;
  },
  adminEmails: (process.env.ADMIN_EMAILS || 'admin@wvarf.test').split(','),
});

const STUB = `
(function () {
  const handlers = {};
  const key = 'stub-user';
  const current = () => { const e = localStorage.getItem(key); return e ? { email: e, jwt: async () => e } : null; };
  window.netlifyIdentity = {
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    currentUser: current,
    open() { const e = prompt('Sign in as (email):'); if (e) { localStorage.setItem(key, e); (handlers.login || []).forEach((f) => f(current())); } },
    close() {},
    logout() { localStorage.removeItem(key); (handlers.logout || []).forEach((f) => f()); },
  };
  document.addEventListener('DOMContentLoaded', () => (handlers.init || []).forEach((f) => f(current())));
})();`;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url, {
      method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
    }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  if (url.pathname === '/identity-stub.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(STUB);
  }
  let p = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end('Not found'); }
  let body = readFileSync(p);
  if (p.endsWith('index.html')) {
    body = body.toString().replace('https://identity.netlify.com/v1/netlify-identity-widget.js', '/identity-stub.js');
  }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(body);
}).listen(port, () => console.log(`Preview at http://localhost:${port}`));

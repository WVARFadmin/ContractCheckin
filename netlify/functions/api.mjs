import { getDatabase } from '@netlify/database';
import { createApi } from '../../lib/api-core.mjs';

const db = getDatabase();

// db.pool is a standard Postgres pool (pg or Neon serverless); both return { rows }.
async function query(text, params = []) {
  const result = await db.pool.query(text, params);
  return result.rows;
}

// Verify the Netlify Identity login by asking this site's Identity service
// who the bearer token belongs to. An invalid or expired token is rejected there.
async function getUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/.netlify/identity/user`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.email) return null;
  return { email: user.email, name: (user.user_metadata && user.user_metadata.full_name) || null };
}

// Send the Netlify Identity invitation email — the same email the dashboard's
// "Invite users" button sends. Netlify gives functions an admin ("operator") token
// for this site's Identity service; it never reaches the browser.
async function inviteUser(email, name) {
  const identity = globalThis.netlifyIdentityContext;
  if (!identity || !identity.url || !identity.token) {
    throw new Error('Netlify Identity is not turned on for this site');
  }
  const res = await fetch(`${identity.url}/invite`, {
    method: 'POST',
    headers: { authorization: `Bearer ${identity.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, data: name ? { full_name: name } : {} }),
  });
  if (res.ok) return 'sent';
  const body = await res.json().catch(() => ({}));
  const msg = body.msg || body.error_description || body.error || `Netlify returned ${res.status}`;
  // Someone who already has a login (accepted an earlier invite) can just sign in.
  if (res.status === 422 && /already/i.test(msg)) return 'already_registered';
  throw new Error(msg);
}

const handle = createApi({
  query,
  getUser,
  inviteUser,
  adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
});

export default (req) => handle(req);

export const config = { path: '/api/*' };

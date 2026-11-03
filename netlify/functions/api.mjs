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

const handle = createApi({
  query,
  getUser,
  adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
});

export default (req) => handle(req);

export const config = { path: '/api/*' };

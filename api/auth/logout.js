import { neon } from '@neondatabase/serverless';

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    cookies[name] = rest.join('=');
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session;

  if (token) {
    try {
      const sql = neon(process.env.DATABASE_URL);
      await sql`DELETE FROM sessions WHERE token = ${token}`;
    } catch (e) {
      // Ignore DB errors on logout
    }
  }

  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
  return res.status(200).json({ success: true });
}

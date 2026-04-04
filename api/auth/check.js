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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session;

  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const sessions = await sql`
      SELECT s.user_id, u.username
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW()
    `;

    if (sessions.length === 0) {
      // Clear invalid cookie
      res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
      return res.status(401).json({ authenticated: false });
    }

    return res.status(200).json({ authenticated: true, username: sessions[0].username });
  } catch (error) {
    return res.status(500).json({ error: 'Auth check failed', message: error.message });
  }
}

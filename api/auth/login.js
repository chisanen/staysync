import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Find user
    const users = await sql`SELECT id, password_hash, password_salt FROM users WHERE username = ${username.toLowerCase()}`;
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = users[0];

    // Verify password
    const hash = crypto.scryptSync(password, user.password_salt, 64).toString('hex');
    if (hash !== user.password_hash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Clean up old sessions for this user
    await sql`DELETE FROM sessions WHERE user_id = ${user.id} AND expires_at < NOW()`;

    // Create new session
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await sql`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expiresAt})
    `;

    // Set cookie
    res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; ${process.env.NODE_ENV === 'production' ? 'Secure;' : ''}`);

    return res.status(200).json({ success: true, username: username.toLowerCase() });
  } catch (error) {
    return res.status(500).json({ error: 'Login failed', message: error.message });
  }
}

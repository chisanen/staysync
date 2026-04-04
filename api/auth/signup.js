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

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Check if user exists
    const existing = await sql`SELECT id FROM users WHERE username = ${username.toLowerCase()}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash password
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');

    // Create user
    const result = await sql`
      INSERT INTO users (username, password_hash, password_salt)
      VALUES (${username.toLowerCase()}, ${hash}, ${salt})
      RETURNING id
    `;

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await sql`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${result[0].id}, ${token}, ${expiresAt})
    `;

    // Set cookie
    res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; ${process.env.NODE_ENV === 'production' ? 'Secure;' : ''}`);

    return res.status(201).json({ success: true, username: username.toLowerCase() });
  } catch (error) {
    return res.status(500).json({ error: 'Signup failed', message: error.message });
  }
}

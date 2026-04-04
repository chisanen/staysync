import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    cookies[name] = rest.join('=');
  });
  return cookies;
}

// --- check ---
async function handleCheck(req, res) {
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
      res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
      return res.status(401).json({ authenticated: false });
    }

    return res.status(200).json({ authenticated: true, username: sessions[0].username });
  } catch (error) {
    return res.status(500).json({ error: 'Auth check failed', message: error.message });
  }
}

// --- login ---
async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const users = await sql`SELECT id, password_hash, password_salt FROM users WHERE username = ${username.toLowerCase()}`;
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = users[0];

    const hash = crypto.scryptSync(password, user.password_salt, 64).toString('hex');
    if (hash !== user.password_hash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    await sql`DELETE FROM sessions WHERE user_id = ${user.id} AND expires_at < NOW()`;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await sql`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expiresAt})
    `;

    res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; ${process.env.NODE_ENV === 'production' ? 'Secure;' : ''}`);

    return res.status(200).json({ success: true, username: username.toLowerCase() });
  } catch (error) {
    return res.status(500).json({ error: 'Login failed', message: error.message });
  }
}

// --- signup ---
async function handleSignup(req, res) {
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
    const existing = await sql`SELECT id FROM users WHERE username = ${username.toLowerCase()}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');

    const result = await sql`
      INSERT INTO users (username, password_hash, password_salt)
      VALUES (${username.toLowerCase()}, ${hash}, ${salt})
      RETURNING id
    `;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await sql`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${result[0].id}, ${token}, ${expiresAt})
    `;

    res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; ${process.env.NODE_ENV === 'production' ? 'Secure;' : ''}`);

    return res.status(201).json({ success: true, username: username.toLowerCase() });
  } catch (error) {
    return res.status(500).json({ error: 'Signup failed', message: error.message });
  }
}

// --- logout ---
async function handleLogout(req, res) {
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

// --- Router ---
export default async function handler(req, res) {
  const action = req.query.action;

  switch (action) {
    case 'check':
      return handleCheck(req, res);
    case 'login':
      return handleLogin(req, res);
    case 'signup':
      return handleSignup(req, res);
    case 'logout':
      return handleLogout(req, res);
    default:
      return res.status(400).json({ error: `Unknown auth action: ${action}` });
  }
}

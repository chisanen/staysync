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

export async function getAuthenticatedUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session;
  if (!token) return null;

  const sql = neon(process.env.DATABASE_URL);
  const sessions = await sql`
    SELECT s.user_id, u.username
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
  `;
  if (sessions.length === 0) return null;
  return { id: sessions[0].user_id, username: sessions[0].username };
}

// Get effective user ID (handles team members seeing owner's data)
export async function getEffectiveUserId(authenticatedUserId) {
  const sql = neon(process.env.DATABASE_URL);
  const membership = await sql`
    SELECT owner_id, role FROM team_members
    WHERE member_user_id = ${authenticatedUserId} AND accepted_at IS NOT NULL
    LIMIT 1
  `;
  if (membership.length > 0) {
    return { userId: membership[0].owner_id, role: membership[0].role };
  }
  return { userId: authenticatedUserId, role: 'owner' };
}

export function checkPermission(role, action) {
  const permissions = {
    owner: ['read', 'write', 'delete', 'admin'],
    manager: ['read', 'write', 'delete'],
    staff: ['read', 'write_bookings', 'write_guests'],
    viewer: ['read']
  };
  const allowed = permissions[role] || [];
  return allowed.includes(action) || allowed.includes('write') || allowed.includes('admin');
}

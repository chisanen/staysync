import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId, checkPermission } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  if (!checkPermission(role, 'admin')) {
    return res.status(403).json({ error: 'Only account owners can invite team members' });
  }

  const { username, role: memberRole } = req.body;

  if (!username || !memberRole) {
    return res.status(400).json({ error: 'Username and role are required' });
  }

  const validRoles = ['manager', 'staff', 'viewer'];
  if (!validRoles.includes(memberRole)) {
    return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Look up user by username
    const users = await sql`SELECT id FROM users WHERE username = ${username}`;
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found. They must create an account first.' });
    }

    const memberUserId = users[0].id;

    if (memberUserId === userId) {
      return res.status(400).json({ error: 'You cannot invite yourself' });
    }

    // Insert team member invitation
    const result = await sql`
      INSERT INTO team_members (owner_id, member_user_id, role, invited_at)
      VALUES (${userId}, ${memberUserId}, ${memberRole}, NOW())
      ON CONFLICT (owner_id, member_user_id) DO UPDATE SET role = ${memberRole}, invited_at = NOW(), accepted_at = NULL
      RETURNING *
    `;

    return res.status(201).json({ success: true, member: result[0] });
  } catch (error) {
    console.error('Error inviting team member:', error);
    return res.status(500).json({ error: 'Failed to invite team member' });
  }
}

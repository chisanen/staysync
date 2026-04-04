import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId, checkPermission } from './_lib/auth.js';

// --- action: invite ---
async function handleInvite(req, res) {
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
    const users = await sql`SELECT id FROM users WHERE username = ${username}`;
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found. They must create an account first.' });
    }

    const memberUserId = users[0].id;

    if (memberUserId === userId) {
      return res.status(400).json({ error: 'You cannot invite yourself' });
    }

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

// --- action: accept ---
async function handleAccept(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    const result = await sql`
      UPDATE team_members
      SET accepted_at = NOW()
      WHERE member_user_id = ${user.id} AND accepted_at IS NULL
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'No pending invitation' });
    }

    return res.status(200).json({ success: true, membership: result[0] });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
}

// --- action: members (list all or single member by memberId) ---
async function handleMembers(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  if (!checkPermission(role, 'admin')) {
    return res.status(403).json({ error: 'Only account owners can manage team members' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const memberId = req.query.memberId;

  // --- Single member operations ---
  if (memberId) {
    if (req.method === 'PUT') {
      const { role: newRole } = req.body;

      if (!newRole) {
        return res.status(400).json({ error: 'Role is required' });
      }

      const validRoles = ['manager', 'staff', 'viewer'];
      if (!validRoles.includes(newRole)) {
        return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
      }

      try {
        const result = await sql`
          UPDATE team_members SET role = ${newRole}
          WHERE id = ${memberId} AND owner_id = ${userId}
          RETURNING *
        `;

        if (result.length === 0) {
          return res.status(404).json({ error: 'Team member not found' });
        }

        return res.status(200).json({ success: true, member: result[0] });
      } catch (error) {
        console.error('Error updating team member:', error);
        return res.status(500).json({ error: 'Failed to update team member' });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const result = await sql`
          DELETE FROM team_members
          WHERE id = ${memberId} AND owner_id = ${userId}
          RETURNING *
        `;

        if (result.length === 0) {
          return res.status(404).json({ error: 'Team member not found' });
        }

        return res.status(200).json({ success: true, message: 'Team member removed' });
      } catch (error) {
        console.error('Error removing team member:', error);
        return res.status(500).json({ error: 'Failed to remove team member' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- List all members ---
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const members = await sql`
      SELECT tm.id, u.username, tm.role, tm.invited_at, tm.accepted_at
      FROM team_members tm
      JOIN users u ON u.id = tm.member_user_id
      WHERE tm.owner_id = ${userId}
      ORDER BY tm.invited_at DESC
    `;

    const result = members.map(m => ({
      id: m.id,
      username: m.username,
      role: m.role,
      invitedAt: m.invited_at,
      acceptedAt: m.accepted_at,
    }));

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching team members:', error);
    return res.status(500).json({ error: 'Failed to fetch team members' });
  }
}

// --- Router ---
export default async function handler(req, res) {
  const action = req.query.action;

  switch (action) {
    case 'invite':
      return handleInvite(req, res);
    case 'accept':
      return handleAccept(req, res);
    case 'members':
      return handleMembers(req, res);
    default:
      return res.status(400).json({ error: `Unknown team action: ${action}` });
  }
}

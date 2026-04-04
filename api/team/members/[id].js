import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId, checkPermission } from '../../_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  if (!checkPermission(role, 'admin')) {
    return res.status(403).json({ error: 'Only account owners can manage team members' });
  }

  const memberId = req.query.id;
  const sql = neon(process.env.DATABASE_URL);

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

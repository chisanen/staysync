import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId, checkPermission } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  if (!checkPermission(role, 'admin')) {
    return res.status(403).json({ error: 'Only account owners can view team members' });
  }

  const sql = neon(process.env.DATABASE_URL);

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

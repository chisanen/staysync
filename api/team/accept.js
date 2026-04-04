import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser } from '../_lib/auth.js';

export default async function handler(req, res) {
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

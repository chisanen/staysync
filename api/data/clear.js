import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  if (role !== 'owner') return res.status(403).json({ error: 'Only the account owner can clear data' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Delete in dependency order (children first)
    await sql`DELETE FROM message_history WHERE user_id = ${userId}`;
    await sql`DELETE FROM activity_log WHERE user_id = ${userId}`;
    await sql`DELETE FROM property_landlords WHERE property_id IN (SELECT id FROM properties WHERE user_id = ${userId})`;
    await sql`DELETE FROM bookings WHERE user_id = ${userId}`;
    await sql`DELETE FROM guests WHERE user_id = ${userId}`;
    await sql`DELETE FROM properties WHERE user_id = ${userId}`;
    await sql`DELETE FROM landlords WHERE user_id = ${userId}`;
    await sql`DELETE FROM settings WHERE user_id = ${userId}`;
    await sql`DELETE FROM team_members WHERE owner_id = ${userId}`;

    return res.status(200).json({ success: true, message: 'All data cleared' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to clear data', message: error.message });
  }
}

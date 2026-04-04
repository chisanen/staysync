import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const activities = await sql(
        `SELECT * FROM activity WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId]
      );
      return res.status(200).json(activities);
    } catch (error) {
      console.error('Error fetching activity:', error);
      return res.status(500).json({ error: 'Failed to fetch activity' });
    }
  }

  if (req.method === 'POST') {
    const { type, description, related_id } = req.body;

    try {
      const result = await sql(
        `INSERT INTO activity (user_id, type, description, related_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [userId, type, description, related_id]
      );
      return res.status(201).json(result[0]);
    } catch (error) {
      console.error('Error creating activity:', error);
      return res.status(500).json({ error: 'Failed to create activity' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

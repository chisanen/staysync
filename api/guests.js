import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const guests = await sql(
        `SELECT * FROM guests WHERE user_id = $1 ORDER BY name ASC`,
        [userId]
      );
      return res.status(200).json(guests);
    } catch (error) {
      console.error('Error fetching guests:', error);
      return res.status(500).json({ error: 'Failed to fetch guests' });
    }
  }

  if (req.method === 'POST') {
    const {
      name,
      phone,
      email,
      nationality,
      id_type,
      id_number,
      notes,
      rating,
      is_flagged,
      is_favorite,
    } = req.body;

    try {
      const result = await sql(
        `INSERT INTO guests (
          user_id, name, phone, email, nationality, id_type, id_number,
          notes, rating, is_flagged, is_favorite
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11
        ) RETURNING *`,
        [
          userId, name, phone, email, nationality, id_type, id_number,
          notes, rating, is_flagged, is_favorite,
        ]
      );
      return res.status(201).json(result[0]);
    } catch (error) {
      console.error('Error creating guest:', error);
      return res.status(500).json({ error: 'Failed to create guest' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

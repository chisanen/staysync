import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from '../_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);
  const { id } = req.query;

  if (req.method === 'GET') {
    try {
      const result = await sql(
        `SELECT * FROM guests WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (result.length === 0) {
        return res.status(404).json({ error: 'Guest not found' });
      }
      return res.status(200).json(result[0]);
    } catch (error) {
      console.error('Error fetching guest:', error);
      return res.status(500).json({ error: 'Failed to fetch guest' });
    }
  }

  if (req.method === 'PUT') {
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
        `UPDATE guests SET
          name = $1, phone = $2, email = $3, nationality = $4,
          id_type = $5, id_number = $6, notes = $7, rating = $8,
          is_flagged = $9, is_favorite = $10, updated_at = NOW()
        WHERE id = $11 AND user_id = $12
        RETURNING *`,
        [
          name, phone, email, nationality,
          id_type, id_number, notes, rating,
          is_flagged, is_favorite, id, userId,
        ]
      );
      if (result.length === 0) {
        return res.status(404).json({ error: 'Guest not found' });
      }
      return res.status(200).json(result[0]);
    } catch (error) {
      console.error('Error updating guest:', error);
      return res.status(500).json({ error: 'Failed to update guest' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const result = await sql(
        `DELETE FROM guests WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId]
      );
      if (result.length === 0) {
        return res.status(404).json({ error: 'Guest not found' });
      }
      return res.status(200).json({ message: 'Guest deleted' });
    } catch (error) {
      console.error('Error deleting guest:', error);
      return res.status(500).json({ error: 'Failed to delete guest' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

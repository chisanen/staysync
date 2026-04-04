import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from '../_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);
  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      const result = await sql`
        SELECT * FROM landlords
        WHERE id = ${id} AND user_id = ${userId}
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Landlord not found' });
      }
      return res.status(200).json(result[0]);
    }

    if (req.method === 'PUT') {
      const { name, email, phone, company, notes, portal_token } = req.body;

      const result = await sql`
        UPDATE landlords
        SET name = ${name}, email = ${email || null}, phone = ${phone || null},
            company = ${company || null}, notes = ${notes || null},
            portal_token = ${portal_token || null}, updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Landlord not found' });
      }
      return res.status(200).json(result[0]);
    }

    if (req.method === 'DELETE') {
      const result = await sql`
        DELETE FROM landlords WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Landlord not found' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}

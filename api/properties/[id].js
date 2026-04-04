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
        SELECT p.*, array_agg(pl.landlord_id) as landlord_ids
        FROM properties p
        LEFT JOIN property_landlords pl ON p.id = pl.property_id
        WHERE p.id = ${id} AND p.user_id = ${userId}
        GROUP BY p.id
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Property not found' });
      }
      return res.status(200).json(result[0]);
    }

    if (req.method === 'PUT') {
      const { name, address, type, units, notes, landlordIds } = req.body;

      const result = await sql`
        UPDATE properties
        SET name = ${name}, address = ${address}, type = ${type},
            units = ${units || null}, notes = ${notes || null},
            updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Property not found' });
      }

      // Delete existing landlord associations and re-insert
      await sql`DELETE FROM property_landlords WHERE property_id = ${id}`;

      if (landlordIds && landlordIds.length > 0) {
        for (const landlordId of landlordIds) {
          await sql`
            INSERT INTO property_landlords (property_id, landlord_id)
            VALUES (${id}, ${landlordId})
          `;
        }
      }

      return res.status(200).json(result[0]);
    }

    if (req.method === 'DELETE') {
      const result = await sql`
        DELETE FROM properties WHERE id = ${id} AND user_id = ${userId}
        RETURNING id
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Property not found' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}

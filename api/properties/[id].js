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
        SELECT p.*, array_agg(pl.landlord_id) FILTER (WHERE pl.landlord_id IS NOT NULL) as landlord_ids
        FROM properties p
        LEFT JOIN property_landlords pl ON p.id = pl.property_id
        WHERE p.id = ${id} AND p.user_id = ${userId}
        GROUP BY p.id
      `;
      if (result.length === 0) return res.status(404).json({ error: 'Property not found' });
      return res.status(200).json(result[0]);
    }

    if (req.method === 'PUT') {
      const b = req.body;
      const result = await sql`
        UPDATE properties SET
          name = ${b.name}, type = ${b.type || 'Other'},
          street = ${b.street || b.address?.street || null},
          city = ${b.city || b.address?.city || null},
          state = ${b.state || b.address?.state || null},
          zip = ${b.zip || b.address?.zip || null},
          bedrooms = ${b.bedrooms || 1}, bathrooms = ${b.bathrooms || 1},
          max_guests = ${b.max_guests || 2},
          nightly_rate = ${b.nightly_rate || 0}, cleaning_fee = ${b.cleaning_fee || 0},
          status = ${b.status || 'Active'},
          check_in_time = ${b.check_in_time || '14:00'}, check_out_time = ${b.check_out_time || '11:00'},
          notes = ${b.notes || null}, image_url = ${b.image_url || b.image || null},
          color = ${b.color || null}, updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      `;
      if (result.length === 0) return res.status(404).json({ error: 'Property not found' });

      // Re-sync landlord associations
      await sql`DELETE FROM property_landlords WHERE property_id = ${id}`;
      const landlordIds = b.landlord_ids || b.landlordIds || [];
      for (const lid of landlordIds) {
        if (lid) await sql`INSERT INTO property_landlords (property_id, landlord_id) VALUES (${id}, ${lid}) ON CONFLICT DO NOTHING`;
      }

      return res.status(200).json(result[0]);
    }

    if (req.method === 'DELETE') {
      const result = await sql`DELETE FROM properties WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
      if (result.length === 0) return res.status(404).json({ error: 'Property not found' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}

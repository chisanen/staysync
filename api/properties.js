import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      const properties = await sql`
        SELECT p.*, array_agg(pl.landlord_id) FILTER (WHERE pl.landlord_id IS NOT NULL) as landlord_ids
        FROM properties p
        LEFT JOIN property_landlords pl ON p.id = pl.property_id
        WHERE p.user_id = ${userId}
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
      return res.status(200).json(properties);
    }

    if (req.method === 'POST') {
      const b = req.body;
      const result = await sql`
        INSERT INTO properties (user_id, name, type, street, city, state, zip,
          bedrooms, bathrooms, max_guests, nightly_rate, cleaning_fee,
          status, check_in_time, check_out_time, notes, image_url, color)
        VALUES (${userId}, ${b.name}, ${b.type || 'Other'},
          ${b.street || b.address?.street || null}, ${b.city || b.address?.city || null},
          ${b.state || b.address?.state || null}, ${b.zip || b.address?.zip || null},
          ${b.bedrooms || 1}, ${b.bathrooms || 1}, ${b.max_guests || 2},
          ${b.nightly_rate || 0}, ${b.cleaning_fee || 0},
          ${b.status || 'Active'}, ${b.check_in_time || '14:00'}, ${b.check_out_time || '11:00'},
          ${b.notes || null}, ${b.image_url || b.image || null}, ${b.color || null})
        RETURNING *
      `;
      const property = result[0];

      const landlordIds = b.landlord_ids || b.landlordIds || [];
      for (const lid of landlordIds) {
        if (lid) await sql`INSERT INTO property_landlords (property_id, landlord_id) VALUES (${property.id}, ${lid}) ON CONFLICT DO NOTHING`;
      }

      return res.status(201).json(property);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}

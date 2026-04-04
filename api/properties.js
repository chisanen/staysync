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
        SELECT p.*, array_agg(pl.landlord_id) as landlord_ids
        FROM properties p
        LEFT JOIN property_landlords pl ON p.id = pl.property_id
        WHERE p.user_id = ${userId}
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
      return res.status(200).json(properties);
    }

    if (req.method === 'POST') {
      const { name, address, type, units, notes, landlordIds } = req.body;

      const result = await sql`
        INSERT INTO properties (user_id, name, address, type, units, notes)
        VALUES (${userId}, ${name}, ${address}, ${type}, ${units || null}, ${notes || null})
        RETURNING *
      `;
      const property = result[0];

      if (landlordIds && landlordIds.length > 0) {
        for (const landlordId of landlordIds) {
          await sql`
            INSERT INTO property_landlords (property_id, landlord_id)
            VALUES (${property.id}, ${landlordId})
          `;
        }
      }

      return res.status(201).json(property);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}

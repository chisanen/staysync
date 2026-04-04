import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);
  const id = req.query.id;

  try {
    // --- Single resource operations (when id is provided) ---
    if (id) {
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
    }

    // --- Collection operations (no id) ---
    if (req.method === 'GET') {
      const landlords = await sql`
        SELECT * FROM landlords
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      return res.status(200).json(landlords);
    }

    if (req.method === 'POST') {
      const { name, email, phone, company, notes, portal_token } = req.body;

      const result = await sql`
        INSERT INTO landlords (user_id, name, email, phone, company, notes, portal_token)
        VALUES (${userId}, ${name}, ${email || null}, ${phone || null},
                ${company || null}, ${notes || null}, ${portal_token || null})
        RETURNING *
      `;
      return res.status(201).json(result[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}

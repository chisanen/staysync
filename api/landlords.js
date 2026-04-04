import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  try {
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

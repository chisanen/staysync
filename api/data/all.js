import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  try {
    // Run all queries in parallel for fast initial load
    const [
      properties,
      landlords,
      bookings,
      guests,
      activity,
      messages,
      settingsRows,
      propertyLandlords,
    ] = await Promise.all([
      sql(
        `SELECT p.*, array_agg(pl.landlord_id) AS landlord_ids
         FROM properties p
         LEFT JOIN property_landlords pl ON p.id = pl.property_id
         WHERE p.user_id = $1
         GROUP BY p.id
         ORDER BY p.created_at DESC`,
        [userId]
      ),
      sql(
        `SELECT * FROM landlords WHERE user_id = $1 ORDER BY name ASC`,
        [userId]
      ),
      sql(
        `SELECT * FROM bookings WHERE user_id = $1 ORDER BY check_in DESC`,
        [userId]
      ),
      sql(
        `SELECT * FROM guests WHERE user_id = $1 ORDER BY name ASC`,
        [userId]
      ),
      sql(
        `SELECT * FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId]
      ),
      sql(
        `SELECT * FROM message_history WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 50`,
        [userId]
      ),
      sql(
        `SELECT * FROM settings WHERE user_id = $1`,
        [userId]
      ),
      sql(
        `SELECT pl.*
         FROM property_landlords pl
         JOIN properties p ON p.id = pl.property_id
         WHERE p.user_id = $1`,
        [userId]
      ),
    ]);

    return res.status(200).json({
      properties,
      landlords,
      bookings,
      guests,
      activity,
      messages,
      settings: settingsRows[0] || null,
      propertyLandlords,
      user: { id: user.id, username: user.username, role },
    });
  } catch (error) {
    console.error('Error fetching all data:', error);
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
}

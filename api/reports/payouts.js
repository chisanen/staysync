import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = req.query.month || defaultMonth;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
  }

  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const endDate = `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  try {
    const payouts = await sql(
      `SELECT
        l.name AS landlord_name,
        l.id AS landlord_id,
        COALESCE(SUM(b.landlord_payout), 0)::int AS total_payout,
        COALESCE(SUM(b.management_fee), 0)::int AS management_fee,
        COUNT(b.id)::int AS booking_count
      FROM landlords l
      JOIN property_landlords pl ON pl.landlord_id = l.id
      JOIN properties p ON p.id = pl.property_id AND p.user_id = $1
      LEFT JOIN bookings b ON b.property_id = p.id
        AND b.check_in < $3
        AND b.check_out > $2
        AND b.status != 'Cancelled'
      WHERE l.user_id = $1
      GROUP BY l.id, l.name
      ORDER BY total_payout DESC`,
      [userId, startDate, endDate]
    );
    return res.status(200).json(payouts);
  } catch (error) {
    console.error('Error fetching payouts report:', error);
    return res.status(500).json({ error: 'Failed to fetch payouts report' });
  }
}

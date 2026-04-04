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

  // Default to current month
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = req.query.month || defaultMonth;

  // Validate month format
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
  }

  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const endDate = `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  try {
    const revenue = await sql(
      `SELECT
        p.name AS property_name,
        p.id AS property_id,
        COALESCE(SUM(b.check_out::date - b.check_in::date), 0)::int AS total_nights,
        COALESCE(SUM(b.total_revenue), 0)::int AS total_revenue,
        COUNT(b.id)::int AS booking_count
      FROM properties p
      LEFT JOIN bookings b ON b.property_id = p.id
        AND b.check_in < $3
        AND b.check_out > $2
        AND b.status != 'Cancelled'
      WHERE p.user_id = $1
      GROUP BY p.id, p.name
      ORDER BY total_revenue DESC`,
      [userId, startDate, endDate]
    );
    return res.status(200).json(revenue);
  } catch (error) {
    console.error('Error fetching revenue report:', error);
    return res.status(500).json({ error: 'Failed to fetch revenue report' });
  }
}

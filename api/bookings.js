import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const bookings = await sql(
        `SELECT * FROM bookings WHERE user_id = $1 ORDER BY check_in DESC`,
        [userId]
      );
      return res.status(200).json(bookings);
    } catch (error) {
      console.error('Error fetching bookings:', error);
      return res.status(500).json({ error: 'Failed to fetch bookings' });
    }
  }

  if (req.method === 'POST') {
    const {
      property_id,
      guest_name,
      guest_email,
      guest_phone,
      guest_count,
      check_in,
      check_out,
      nightly_rate,
      cleaning_fee,
      service_fee,
      tax_amount,
      total_revenue,
      landlord_payout,
      management_fee,
      status,
      notes,
    } = req.body;

    try {
      const result = await sql(
        `INSERT INTO bookings (
          user_id, property_id, guest_name, guest_email, guest_phone, guest_count,
          check_in, check_out, nightly_rate, cleaning_fee, service_fee, tax_amount,
          total_revenue, landlord_payout, management_fee, status, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17
        ) RETURNING *`,
        [
          userId, property_id, guest_name, guest_email, guest_phone, guest_count,
          check_in, check_out, nightly_rate, cleaning_fee, service_fee, tax_amount,
          total_revenue, landlord_payout, management_fee, status, notes,
        ]
      );
      return res.status(201).json(result[0]);
    } catch (error) {
      if (error.code === '23P01') {
        return res.status(409).json({ error: 'Booking dates conflict with an existing booking' });
      }
      console.error('Error creating booking:', error);
      return res.status(500).json({ error: 'Failed to create booking' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

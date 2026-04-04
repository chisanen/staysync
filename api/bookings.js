import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);
  const id = req.query.id;

  // --- Single resource operations (when id is provided) ---
  if (id) {
    if (req.method === 'GET') {
      try {
        const result = await sql(
          `SELECT * FROM bookings WHERE id = $1 AND user_id = $2`,
          [id, userId]
        );
        if (result.length === 0) {
          return res.status(404).json({ error: 'Booking not found' });
        }
        return res.status(200).json(result[0]);
      } catch (error) {
        console.error('Error fetching booking:', error);
        return res.status(500).json({ error: 'Failed to fetch booking' });
      }
    }

    if (req.method === 'PUT') {
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
          `UPDATE bookings SET
            property_id = $1, guest_name = $2, guest_email = $3, guest_phone = $4,
            guest_count = $5, check_in = $6, check_out = $7, nightly_rate = $8,
            cleaning_fee = $9, service_fee = $10, tax_amount = $11, total_revenue = $12,
            landlord_payout = $13, management_fee = $14, status = $15, notes = $16,
            updated_at = NOW()
          WHERE id = $17 AND user_id = $18
          RETURNING *`,
          [
            property_id, guest_name, guest_email, guest_phone,
            guest_count, check_in, check_out, nightly_rate,
            cleaning_fee, service_fee, tax_amount, total_revenue,
            landlord_payout, management_fee, status, notes,
            id, userId,
          ]
        );
        if (result.length === 0) {
          return res.status(404).json({ error: 'Booking not found' });
        }
        return res.status(200).json(result[0]);
      } catch (error) {
        if (error.code === '23P01') {
          return res.status(409).json({ error: 'Booking dates conflict with an existing booking' });
        }
        console.error('Error updating booking:', error);
        return res.status(500).json({ error: 'Failed to update booking' });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const result = await sql(
          `DELETE FROM bookings WHERE id = $1 AND user_id = $2 RETURNING *`,
          [id, userId]
        );
        if (result.length === 0) {
          return res.status(404).json({ error: 'Booking not found' });
        }
        return res.status(200).json({ message: 'Booking deleted' });
      } catch (error) {
        console.error('Error deleting booking:', error);
        return res.status(500).json({ error: 'Failed to delete booking' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Collection operations (no id) ---
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

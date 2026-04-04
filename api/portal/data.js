import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Missing required query param: token' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Look up landlord by portal_token
    const landlords = await sql(
      `SELECT * FROM landlords WHERE portal_token = $1`,
      [token]
    );

    if (landlords.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired portal token' });
    }

    const landlord = landlords[0];

    // Fetch properties linked to this landlord
    const properties = await sql(
      `SELECT p.*
       FROM properties p
       JOIN property_landlords pl ON pl.property_id = p.id
       WHERE pl.landlord_id = $1
       ORDER BY p.name ASC`,
      [landlord.id]
    );

    const propertyIds = properties.map(p => p.id);

    // Fetch bookings for those properties
    let bookings = [];
    if (propertyIds.length > 0) {
      bookings = await sql(
        `SELECT b.*, p.name AS property_name
         FROM bookings b
         JOIN properties p ON p.id = b.property_id
         WHERE b.property_id = ANY($1)
         ORDER BY b.check_in DESC`,
        [propertyIds]
      );
    }

    // Revenue summary
    const totalRevenue = bookings.reduce((sum, b) => sum + Number(b.total_revenue || 0), 0);
    const totalPayout = bookings.reduce((sum, b) => sum + Number(b.landlord_payout || 0), 0);
    const totalManagementFee = bookings.reduce((sum, b) => sum + Number(b.management_fee || 0), 0);
    const activeBookings = bookings.filter(b => b.status !== 'Cancelled').length;

    // Strip sensitive fields from landlord
    const { portal_token, user_id, ...landlordInfo } = landlord;

    return res.status(200).json({
      landlord: landlordInfo,
      properties,
      bookings,
      summary: {
        total_revenue: totalRevenue,
        total_payout: totalPayout,
        total_management_fee: totalManagementFee,
        total_bookings: bookings.length,
        active_bookings: activeBookings,
      },
    });
  } catch (error) {
    console.error('Error fetching portal data:', error);
    return res.status(500).json({ error: 'Failed to fetch portal data' });
  }
}

import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';
import crypto from 'crypto';

// --- action: data ---
async function handleData(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Missing required query param: token' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    const landlords = await sql(
      `SELECT * FROM landlords WHERE portal_token = $1`,
      [token]
    );

    if (landlords.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired portal token' });
    }

    const landlord = landlords[0];

    const properties = await sql(
      `SELECT p.*
       FROM properties p
       JOIN property_landlords pl ON pl.property_id = p.id
       WHERE pl.landlord_id = $1
       ORDER BY p.name ASC`,
      [landlord.id]
    );

    const propertyIds = properties.map(p => p.id);

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

    const totalRevenue = bookings.reduce((sum, b) => sum + Number(b.total_revenue || 0), 0);
    const totalPayout = bookings.reduce((sum, b) => sum + Number(b.landlord_payout || 0), 0);
    const totalManagementFee = bookings.reduce((sum, b) => sum + Number(b.management_fee || 0), 0);
    const activeBookings = bookings.filter(b => b.status !== 'Cancelled').length;

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

// --- action: generate ---
async function handleGenerate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  const { landlordId } = req.body;
  if (!landlordId) {
    return res.status(400).json({ error: 'Missing required field: landlordId' });
  }

  try {
    const landlords = await sql(
      `SELECT id FROM landlords WHERE id = $1 AND user_id = $2`,
      [landlordId, userId]
    );

    if (landlords.length === 0) {
      return res.status(404).json({ error: 'Landlord not found' });
    }

    const portalToken = crypto.randomUUID();

    await sql(
      `UPDATE landlords SET portal_token = $1, updated_at = NOW() WHERE id = $2`,
      [portalToken, landlordId]
    );

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `${protocol}://${host}/portal.html?token=${portalToken}`;

    return res.status(200).json({ token: portalToken, url });
  } catch (error) {
    console.error('Error generating portal token:', error);
    return res.status(500).json({ error: 'Failed to generate portal token' });
  }
}

// --- Router ---
export default async function handler(req, res) {
  const action = req.query.action;

  switch (action) {
    case 'data':
      return handleData(req, res);
    case 'generate':
      return handleGenerate(req, res);
    default:
      return res.status(400).json({ error: `Unknown portal action: ${action}` });
  }
}

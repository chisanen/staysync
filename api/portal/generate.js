import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from '../_lib/auth.js';
import crypto from 'crypto';

export default async function handler(req, res) {
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
    // Verify landlord belongs to this user
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

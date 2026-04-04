import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Missing required fields: endpoint, keys.p256dh, keys.auth' });
  }

  try {
    await sql(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint)
       DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, created_at = NOW()`,
      [user.id, endpoint, keys.p256dh, keys.auth]
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return res.status(500).json({ error: 'Failed to save push subscription' });
  }
}

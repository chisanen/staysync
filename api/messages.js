import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const messages = await sql`
        SELECT * FROM message_history
        WHERE user_id = ${userId}
        ORDER BY sent_at DESC
      `;
      return res.status(200).json(messages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
  }

  if (req.method === 'POST') {
    const { recipient, recipient_email, subject, body, status } = req.body;

    if (!recipient || !subject) {
      return res.status(400).json({ error: 'Missing required fields: recipient, subject' });
    }

    try {
      const result = await sql`
        INSERT INTO message_history (user_id, recipient, recipient_email, subject, body, status)
        VALUES (${userId}, ${recipient}, ${recipient_email || null}, ${subject}, ${body || null}, ${status || 'sent'})
        RETURNING *
      `;
      return res.status(201).json(result[0]);
    } catch (error) {
      console.error('Error creating message:', error);
      return res.status(500).json({ error: 'Failed to create message' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

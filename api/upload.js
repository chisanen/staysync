import { put } from '@vercel/blob';
import { getAuthenticatedUser } from './_lib/auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const filename = req.query.filename;
  if (!filename) {
    return res.status(400).json({ error: 'filename query parameter is required' });
  }

  try {
    // Read the raw body as a buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const blob = await put(filename, buffer, {
      access: 'public',
    });

    return res.status(200).json({ url: blob.url });
  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).json({ error: 'Failed to upload file' });
  }
}

import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

const DEFAULT_SETTINGS = {
  company_name: '',
  company_email: '',
  company_phone: '',
  company_address: '',
  currency: 'EUR',
  date_format: 'DD/MM/YYYY',
  timezone: 'Europe/London',
  invoice_prefix: 'INV-',
  invoice_next_number: 1,
  invoice_notes: '',
  invoice_due_days: 30
};

export default async function handler(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      const result = await sql`
        SELECT * FROM settings WHERE user_id = ${userId}
      `;
      if (result.length === 0) {
        return res.status(200).json({ user_id: userId, ...DEFAULT_SETTINGS });
      }
      return res.status(200).json(result[0]);
    }

    if (req.method === 'PUT') {
      const {
        company_name, company_email, company_phone, company_address,
        currency, date_format, timezone,
        invoice_prefix, invoice_next_number, invoice_notes, invoice_due_days
      } = req.body;

      const result = await sql`
        INSERT INTO settings (
          user_id, company_name, company_email, company_phone, company_address,
          currency, date_format, timezone,
          invoice_prefix, invoice_next_number, invoice_notes, invoice_due_days
        ) VALUES (
          ${userId}, ${company_name || ''}, ${company_email || ''}, ${company_phone || ''},
          ${company_address || ''}, ${currency || 'EUR'}, ${date_format || 'DD/MM/YYYY'},
          ${timezone || 'Europe/London'}, ${invoice_prefix || 'INV-'},
          ${invoice_next_number || 1}, ${invoice_notes || ''}, ${invoice_due_days || 30}
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
          company_name = EXCLUDED.company_name,
          company_email = EXCLUDED.company_email,
          company_phone = EXCLUDED.company_phone,
          company_address = EXCLUDED.company_address,
          currency = EXCLUDED.currency,
          date_format = EXCLUDED.date_format,
          timezone = EXCLUDED.timezone,
          invoice_prefix = EXCLUDED.invoice_prefix,
          invoice_next_number = EXCLUDED.invoice_next_number,
          invoice_notes = EXCLUDED.invoice_notes,
          invoice_due_days = EXCLUDED.invoice_due_days,
          updated_at = NOW()
        RETURNING *
      `;
      return res.status(200).json(result[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}

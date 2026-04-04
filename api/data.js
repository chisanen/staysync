import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId, checkPermission } from './_lib/auth.js';

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

// --- action: all ---
async function handleAll(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  try {
    const [
      properties,
      landlords,
      bookings,
      guests,
      activity,
      messages,
      settingsRows,
      propertyLandlords,
    ] = await Promise.all([
      sql(
        `SELECT p.*, array_agg(pl.landlord_id) AS landlord_ids
         FROM properties p
         LEFT JOIN property_landlords pl ON p.id = pl.property_id
         WHERE p.user_id = $1
         GROUP BY p.id
         ORDER BY p.created_at DESC`,
        [userId]
      ),
      sql(
        `SELECT * FROM landlords WHERE user_id = $1 ORDER BY name ASC`,
        [userId]
      ),
      sql(
        `SELECT * FROM bookings WHERE user_id = $1 ORDER BY check_in DESC`,
        [userId]
      ),
      sql(
        `SELECT * FROM guests WHERE user_id = $1 ORDER BY name ASC`,
        [userId]
      ),
      sql(
        `SELECT * FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId]
      ),
      sql(
        `SELECT * FROM message_history WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 50`,
        [userId]
      ),
      sql(
        `SELECT * FROM settings WHERE user_id = $1`,
        [userId]
      ),
      sql(
        `SELECT pl.*
         FROM property_landlords pl
         JOIN properties p ON p.id = pl.property_id
         WHERE p.user_id = $1`,
        [userId]
      ),
    ]);

    return res.status(200).json({
      properties,
      landlords,
      bookings,
      guests,
      activity,
      messages,
      settings: settingsRows[0] || null,
      propertyLandlords,
      user: { id: user.id, username: user.username, role },
    });
  } catch (error) {
    console.error('Error fetching all data:', error);
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
}

// --- action: clear ---
async function handleClear(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = await getEffectiveUserId(user.id);
  if (role !== 'owner') return res.status(403).json({ error: 'Only the account owner can clear data' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`DELETE FROM message_history WHERE user_id = ${userId}`;
    await sql`DELETE FROM activity_log WHERE user_id = ${userId}`;
    await sql`DELETE FROM property_landlords WHERE property_id IN (SELECT id FROM properties WHERE user_id = ${userId})`;
    await sql`DELETE FROM bookings WHERE user_id = ${userId}`;
    await sql`DELETE FROM guests WHERE user_id = ${userId}`;
    await sql`DELETE FROM properties WHERE user_id = ${userId}`;
    await sql`DELETE FROM landlords WHERE user_id = ${userId}`;
    await sql`DELETE FROM settings WHERE user_id = ${userId}`;
    await sql`DELETE FROM team_members WHERE owner_id = ${userId}`;

    return res.status(200).json({ success: true, message: 'All data cleared' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to clear data', message: error.message });
  }
}

// --- action: setup (db tables) ---
async function handleSetup(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT DEFAULT 'owner',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;

    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'owner'`;

    await sql`
      CREATE TABLE IF NOT EXISTS properties (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        street TEXT,
        city TEXT,
        state TEXT,
        zip TEXT,
        bedrooms INTEGER DEFAULT 1,
        bathrooms NUMERIC(3,1) DEFAULT 1,
        max_guests INTEGER DEFAULT 2,
        nightly_rate INTEGER NOT NULL,
        cleaning_fee INTEGER DEFAULT 0,
        status TEXT DEFAULT 'Active',
        check_in_time TEXT DEFAULT '14:00',
        check_out_time TEXT DEFAULT '11:00',
        notes TEXT,
        image_url TEXT,
        color TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS landlords (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company TEXT,
        payout_percent INTEGER DEFAULT 100,
        notes TEXT,
        portal_token TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS property_landlords (
        property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        landlord_id UUID NOT NULL REFERENCES landlords(id) ON DELETE CASCADE,
        PRIMARY KEY (property_id, landlord_id)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS guests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        nationality TEXT,
        id_type TEXT,
        id_number TEXT,
        notes TEXT,
        rating INTEGER,
        is_flagged BOOLEAN DEFAULT false,
        is_favorite BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        guest_name TEXT NOT NULL,
        guest_email TEXT,
        guest_phone TEXT,
        guest_count INTEGER DEFAULT 1,
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        nightly_rate INTEGER NOT NULL,
        cleaning_fee INTEGER DEFAULT 0,
        service_fee INTEGER DEFAULT 0,
        tax_amount INTEGER DEFAULT 0,
        total_revenue INTEGER NOT NULL,
        landlord_payout INTEGER DEFAULT 0,
        management_fee INTEGER DEFAULT 0,
        status TEXT DEFAULT 'Confirmed',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    try {
      await sql`
        ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
        EXCLUDE USING gist (
          property_id WITH =,
          daterange(check_in, check_out) WITH &&
        ) WHERE (status != 'Cancelled')
      `;
    } catch (e) {
      // Constraint may already exist
    }

    await sql`
      CREATE TABLE IF NOT EXISTS activity_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        related_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS message_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient TEXT NOT NULL,
        recipient_email TEXT,
        subject TEXT NOT NULL,
        body TEXT,
        status TEXT DEFAULT 'sent',
        sent_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        manager_name TEXT,
        manager_email TEXT,
        manager_phone TEXT,
        resend_api_key TEXT,
        from_email TEXT,
        email_signature TEXT,
        default_check_in TEXT DEFAULT '14:00',
        default_check_out TEXT DEFAULT '11:00',
        currency TEXT DEFAULT 'NGN',
        theme TEXT DEFAULT 'auto',
        whatsapp_enabled BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        member_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'staff',
        invited_at TIMESTAMPTZ DEFAULT NOW(),
        accepted_at TIMESTAMPTZ,
        UNIQUE(owner_id, member_user_id)
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_properties_user ON properties(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_landlords_user ON landlords(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_guests_user ON guests(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bookings_property ON bookings(property_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_landlords_portal ON landlords(portal_token)`;

    return res.status(200).json({ success: true, message: 'All tables created' });
  } catch (error) {
    return res.status(500).json({ error: 'Setup failed', message: error.message });
  }
}

// --- action: migrate ---
async function handleMigrate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  const userId = user.id;

  const {
    properties,
    landlords,
    bookings,
    guests,
    activity,
    messageHistory,
    settings,
    propertyLandlords,
  } = req.body;

  const counts = {
    properties: 0,
    landlords: 0,
    bookings: 0,
    guests: 0,
    activity: 0,
    messageHistory: 0,
    settings: 0,
    propertyLandlords: 0,
  };

  try {
    if (properties) {
      for (const [id, p] of Object.entries(properties)) {
        try {
          await sql`
            INSERT INTO properties (
              id, user_id, name, type, street, city, state, zip,
              bedrooms, bathrooms, max_guests, nightly_rate, cleaning_fee,
              status, check_in_time, check_out_time, notes, image_url, color,
              created_at, updated_at
            ) VALUES (
              ${id}, ${userId}, ${p.name}, ${p.type}, ${p.street || null}, ${p.city || null},
              ${p.state || null}, ${p.zip || null}, ${p.bedrooms || 1}, ${p.bathrooms || 1},
              ${p.maxGuests || p.max_guests || 2}, ${p.nightlyRate || p.nightly_rate || 0},
              ${p.cleaningFee || p.cleaning_fee || 0}, ${p.status || 'Active'},
              ${p.checkInTime || p.check_in_time || '14:00'}, ${p.checkOutTime || p.check_out_time || '11:00'},
              ${p.notes || null}, ${p.imageUrl || p.image_url || null}, ${p.color || null},
              ${p.createdAt || p.created_at || new Date().toISOString()},
              ${p.updatedAt || p.updated_at || new Date().toISOString()}
            )
            ON CONFLICT (id) DO NOTHING
          `;
          counts.properties++;

          const landlordIds = p.landlordIds || p.landlord_ids || [];
          for (const landlordId of landlordIds) {
            try {
              await sql`
                INSERT INTO property_landlords (property_id, landlord_id)
                VALUES (${id}, ${landlordId})
                ON CONFLICT (property_id, landlord_id) DO NOTHING
              `;
            } catch (e) {
              // Skip if landlord doesn't exist yet
            }
          }
        } catch (e) {
          console.error(`Error migrating property ${id}:`, e.message);
        }
      }
    }

    if (landlords) {
      for (const [id, l] of Object.entries(landlords)) {
        try {
          await sql`
            INSERT INTO landlords (
              id, user_id, name, email, phone, company, payout_percent, notes,
              created_at, updated_at
            ) VALUES (
              ${id}, ${userId}, ${l.name}, ${l.email}, ${l.phone || null},
              ${l.company || null}, ${l.payoutPercent || l.payout_percent || 100},
              ${l.notes || null},
              ${l.createdAt || l.created_at || new Date().toISOString()},
              ${l.updatedAt || l.updated_at || new Date().toISOString()}
            )
            ON CONFLICT (id) DO NOTHING
          `;
          counts.landlords++;
        } catch (e) {
          console.error(`Error migrating landlord ${id}:`, e.message);
        }
      }
    }

    if (guests) {
      for (const [id, g] of Object.entries(guests)) {
        try {
          await sql`
            INSERT INTO guests (
              id, user_id, name, phone, email, nationality, id_type, id_number,
              notes, rating, is_flagged, is_favorite, created_at, updated_at
            ) VALUES (
              ${id}, ${userId}, ${g.name}, ${g.phone || null}, ${g.email || null},
              ${g.nationality || null}, ${g.idType || g.id_type || null},
              ${g.idNumber || g.id_number || null}, ${g.notes || null},
              ${g.rating || null}, ${g.isFlagged || g.is_flagged || false},
              ${g.isFavorite || g.is_favorite || false},
              ${g.createdAt || g.created_at || new Date().toISOString()},
              ${g.updatedAt || g.updated_at || new Date().toISOString()}
            )
            ON CONFLICT (id) DO NOTHING
          `;
          counts.guests++;
        } catch (e) {
          console.error(`Error migrating guest ${id}:`, e.message);
        }
      }
    }

    if (bookings) {
      for (const [id, b] of Object.entries(bookings)) {
        try {
          await sql`
            INSERT INTO bookings (
              id, user_id, property_id, guest_name, guest_email, guest_phone, guest_count,
              check_in, check_out, nightly_rate, cleaning_fee, service_fee, tax_amount,
              total_revenue, landlord_payout, management_fee, status, notes,
              created_at, updated_at
            ) VALUES (
              ${id}, ${userId},
              ${b.propertyId || b.property_id},
              ${b.guestName || b.guest_name},
              ${b.guestEmail || b.guest_email || null},
              ${b.guestPhone || b.guest_phone || null},
              ${b.guestCount || b.guest_count || 1},
              ${b.checkIn || b.check_in},
              ${b.checkOut || b.check_out},
              ${b.nightlyRate || b.nightly_rate || 0},
              ${b.cleaningFee || b.cleaning_fee || 0},
              ${b.serviceFee || b.service_fee || 0},
              ${b.taxAmount || b.tax_amount || 0},
              ${b.totalRevenue || b.total_revenue || 0},
              ${b.landlordPayout || b.landlord_payout || 0},
              ${b.managementFee || b.management_fee || 0},
              ${b.status || 'Confirmed'},
              ${b.notes || null},
              ${b.createdAt || b.created_at || new Date().toISOString()},
              ${b.updatedAt || b.updated_at || new Date().toISOString()}
            )
            ON CONFLICT (id) DO NOTHING
          `;
          counts.bookings++;
        } catch (e) {
          console.error(`Error migrating booking ${id}:`, e.message);
        }
      }
    }

    if (activity) {
      for (const [id, a] of Object.entries(activity)) {
        try {
          await sql`
            INSERT INTO activity_log (id, user_id, type, description, related_id, created_at)
            VALUES (
              ${id}, ${userId}, ${a.type}, ${a.description},
              ${a.relatedId || a.related_id || null},
              ${a.createdAt || a.created_at || new Date().toISOString()}
            )
            ON CONFLICT (id) DO NOTHING
          `;
          counts.activity++;
        } catch (e) {
          console.error(`Error migrating activity ${id}:`, e.message);
        }
      }
    }

    if (messageHistory) {
      for (const [id, m] of Object.entries(messageHistory)) {
        try {
          await sql`
            INSERT INTO message_history (
              id, user_id, recipient, recipient_email, subject, body, status, sent_at
            ) VALUES (
              ${id}, ${userId}, ${m.recipient}, ${m.recipientEmail || m.recipient_email || null},
              ${m.subject}, ${m.body || null}, ${m.status || 'sent'},
              ${m.sentAt || m.sent_at || new Date().toISOString()}
            )
            ON CONFLICT (id) DO NOTHING
          `;
          counts.messageHistory++;
        } catch (e) {
          console.error(`Error migrating message ${id}:`, e.message);
        }
      }
    }

    if (settings) {
      const s = typeof settings === 'object' && !Array.isArray(settings)
        ? (Object.keys(settings).length > 0 ? Object.values(settings)[0] || settings : settings)
        : settings;

      try {
        await sql`
          INSERT INTO settings (
            user_id, manager_name, manager_email, manager_phone,
            resend_api_key, from_email, email_signature,
            default_check_in, default_check_out, currency, theme, whatsapp_enabled
          ) VALUES (
            ${userId},
            ${s.managerName || s.manager_name || null},
            ${s.managerEmail || s.manager_email || null},
            ${s.managerPhone || s.manager_phone || null},
            ${s.resendApiKey || s.resend_api_key || null},
            ${s.fromEmail || s.from_email || null},
            ${s.emailSignature || s.email_signature || null},
            ${s.defaultCheckIn || s.default_check_in || '14:00'},
            ${s.defaultCheckOut || s.default_check_out || '11:00'},
            ${s.currency || 'NGN'},
            ${s.theme || 'auto'},
            ${s.whatsappEnabled || s.whatsapp_enabled || false}
          )
          ON CONFLICT (user_id) DO NOTHING
        `;
        counts.settings++;
      } catch (e) {
        console.error('Error migrating settings:', e.message);
      }
    }

    if (propertyLandlords) {
      for (const [key, pl] of Object.entries(propertyLandlords)) {
        try {
          const propertyId = pl.propertyId || pl.property_id || key.split('_')[0];
          const landlordId = pl.landlordId || pl.landlord_id || key.split('_')[1];
          await sql`
            INSERT INTO property_landlords (property_id, landlord_id)
            VALUES (${propertyId}, ${landlordId})
            ON CONFLICT (property_id, landlord_id) DO NOTHING
          `;
          counts.propertyLandlords++;
        } catch (e) {
          console.error(`Error migrating property-landlord ${key}:`, e.message);
        }
      }
    }

    return res.status(200).json({ success: true, counts });
  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({ error: 'Migration failed', message: error.message });
  }
}

// --- action: settings ---
async function handleSettings(req, res) {
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

// --- action: activity ---
async function handleActivity(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const activities = await sql(
        `SELECT * FROM activity WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId]
      );
      return res.status(200).json(activities);
    } catch (error) {
      console.error('Error fetching activity:', error);
      return res.status(500).json({ error: 'Failed to fetch activity' });
    }
  }

  if (req.method === 'POST') {
    const { type, description, related_id } = req.body;

    try {
      const result = await sql(
        `INSERT INTO activity (user_id, type, description, related_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [userId, type, description, related_id]
      );
      return res.status(201).json(result[0]);
    } catch (error) {
      console.error('Error creating activity:', error);
      return res.status(500).json({ error: 'Failed to create activity' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// --- Router ---
export default async function handler(req, res) {
  const action = req.query.action;

  switch (action) {
    case 'all':
      return handleAll(req, res);
    case 'clear':
      return handleClear(req, res);
    case 'setup':
      return handleSetup(req, res);
    case 'migrate':
      return handleMigrate(req, res);
    case 'settings':
      return handleSettings(req, res);
    case 'activity':
      return handleActivity(req, res);
    default:
      return res.status(400).json({ error: `Unknown data action: ${action}` });
  }
}

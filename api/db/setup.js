import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Enable btree_gist for booking conflict prevention
    await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;

    // Users + sessions (already exist from auth setup)
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

    // Add role column if missing
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
        email TEXT NOT NULL,
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

    // Booking conflict exclusion constraint
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

    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Indexes
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

import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser } from '../_lib/auth.js';

export default async function handler(req, res) {
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
    // --- Properties ---
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

          // Handle landlordIds for this property
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

    // --- Landlords ---
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

    // --- Guests ---
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

    // --- Bookings ---
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

    // --- Activity Log ---
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

    // --- Message History ---
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

    // --- Settings ---
    if (settings) {
      // Settings is typically a single object, not keyed by UUID
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

    // --- Property-Landlord mappings (separate from inline landlordIds) ---
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

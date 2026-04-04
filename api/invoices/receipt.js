import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  const { bookingId } = req.query;
  if (!bookingId) {
    return res.status(400).json({ error: 'Missing required query param: bookingId' });
  }

  try {
    const rows = await sql(
      `SELECT b.*, p.name AS property_name, p.street, p.city, p.state, p.zip,
              p.type AS property_type, p.check_in_time, p.check_out_time
       FROM bookings b
       JOIN properties p ON p.id = b.property_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const b = rows[0];
    const nights = Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / (1000 * 60 * 60 * 24));
    const checkIn = new Date(b.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const checkOut = new Date(b.check_out).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const issuedDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const formatCurrency = (amount) => `₦${Number(amount || 0).toLocaleString()}`;

    const address = [b.street, b.city, b.state, b.zip].filter(Boolean).join(', ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Receipt - ${b.id.slice(0, 8)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
    .receipt { max-width: 700px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: #fff; padding: 30px; text-align: center; }
    .header h1 { font-size: 24px; margin-bottom: 4px; }
    .header p { opacity: 0.8; font-size: 14px; }
    .badge { display: inline-block; background: ${b.status === 'Confirmed' ? '#22c55e' : b.status === 'Cancelled' ? '#ef4444' : '#f59e0b'}; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px; }
    .body { padding: 30px; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 13px; color: #666; }
    .section { margin-bottom: 24px; }
    .section h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .info-item label { display: block; font-size: 11px; color: #999; text-transform: uppercase; }
    .info-item span { font-size: 15px; font-weight: 500; }
    .line-items { width: 100%; border-collapse: collapse; }
    .line-items th { text-align: left; font-size: 12px; color: #888; text-transform: uppercase; padding: 8px 0; border-bottom: 2px solid #eee; }
    .line-items td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .line-items td:last-child, .line-items th:last-child { text-align: right; }
    .total-row td { font-weight: 700; font-size: 16px; border-bottom: none; border-top: 2px solid #333; padding-top: 14px; }
    .footer { text-align: center; padding: 20px 30px 30px; color: #999; font-size: 12px; border-top: 1px solid #eee; }
    .print-btn { display: block; margin: 20px auto; padding: 10px 30px; background: #1a1a2e; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
    .print-btn:hover { background: #16213e; }
    @media print {
      body { background: #fff; padding: 0; }
      .receipt { box-shadow: none; border-radius: 0; }
      .print-btn { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>Phiyalistings</h1>
      <p>Booking Receipt</p>
      <div class="badge">${b.status}</div>
    </div>
    <div class="body">
      <div class="meta">
        <span>Receipt #${b.id.slice(0, 8).toUpperCase()}</span>
        <span>Issued: ${issuedDate}</span>
      </div>

      <div class="section">
        <h3>Property</h3>
        <div class="info-grid">
          <div class="info-item"><label>Name</label><span>${b.property_name}</span></div>
          <div class="info-item"><label>Type</label><span>${b.property_type || 'N/A'}</span></div>
          <div class="info-item"><label>Address</label><span>${address || 'N/A'}</span></div>
          <div class="info-item"><label>Check-in / Check-out Time</label><span>${b.check_in_time || '14:00'} / ${b.check_out_time || '11:00'}</span></div>
        </div>
      </div>

      <div class="section">
        <h3>Guest Information</h3>
        <div class="info-grid">
          <div class="info-item"><label>Guest Name</label><span>${b.guest_name}</span></div>
          <div class="info-item"><label>Email</label><span>${b.guest_email || 'N/A'}</span></div>
          <div class="info-item"><label>Phone</label><span>${b.guest_phone || 'N/A'}</span></div>
          <div class="info-item"><label>Guests</label><span>${b.guest_count || 1}</span></div>
        </div>
      </div>

      <div class="section">
        <h3>Stay Details</h3>
        <div class="info-grid">
          <div class="info-item"><label>Check-in</label><span>${checkIn}</span></div>
          <div class="info-item"><label>Check-out</label><span>${checkOut}</span></div>
          <div class="info-item"><label>Nights</label><span>${nights}</span></div>
        </div>
      </div>

      <div class="section">
        <h3>Financial Breakdown</h3>
        <table class="line-items">
          <thead>
            <tr><th>Item</th><th>Amount</th></tr>
          </thead>
          <tbody>
            <tr><td>Nightly Rate (${nights} night${nights !== 1 ? 's' : ''} x ${formatCurrency(b.nightly_rate)})</td><td>${formatCurrency(b.nightly_rate * nights)}</td></tr>
            <tr><td>Cleaning Fee</td><td>${formatCurrency(b.cleaning_fee)}</td></tr>
            <tr><td>Service Fee</td><td>${formatCurrency(b.service_fee)}</td></tr>
            <tr><td>Tax</td><td>${formatCurrency(b.tax_amount)}</td></tr>
            <tr class="total-row"><td>Total</td><td>${formatCurrency(b.total_revenue)}</td></tr>
          </tbody>
        </table>
      </div>

      ${b.notes ? `<div class="section"><h3>Notes</h3><p style="font-size:14px;color:#555;">${b.notes}</p></div>` : ''}
    </div>
    <div class="footer">
      <p>Thank you for booking with Phiyalistings.</p>
      <p style="margin-top:4px;">This receipt was generated on ${issuedDate}.</p>
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">Print Receipt</button>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Error generating receipt:', error);
    return res.status(500).json({ error: 'Failed to generate receipt' });
  }
}

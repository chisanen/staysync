import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser, getEffectiveUserId } from './_lib/auth.js';

// --- type: revenue ---
async function handleRevenue(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = req.query.month || defaultMonth;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
  }

  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const endDate = `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  try {
    const revenue = await sql(
      `SELECT
        p.name AS property_name,
        p.id AS property_id,
        COALESCE(SUM(b.check_out::date - b.check_in::date), 0)::int AS total_nights,
        COALESCE(SUM(b.total_revenue), 0)::int AS total_revenue,
        COUNT(b.id)::int AS booking_count
      FROM properties p
      LEFT JOIN bookings b ON b.property_id = p.id
        AND b.check_in < $3
        AND b.check_out > $2
        AND b.status != 'Cancelled'
      WHERE p.user_id = $1
      GROUP BY p.id, p.name
      ORDER BY total_revenue DESC`,
      [userId, startDate, endDate]
    );
    return res.status(200).json(revenue);
  } catch (error) {
    console.error('Error fetching revenue report:', error);
    return res.status(500).json({ error: 'Failed to fetch revenue report' });
  }
}

// --- type: payouts ---
async function handlePayouts(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = req.query.month || defaultMonth;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
  }

  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const endDate = `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  try {
    const payouts = await sql(
      `SELECT
        l.name AS landlord_name,
        l.id AS landlord_id,
        COALESCE(SUM(b.landlord_payout), 0)::int AS total_payout,
        COALESCE(SUM(b.management_fee), 0)::int AS management_fee,
        COUNT(b.id)::int AS booking_count
      FROM landlords l
      JOIN property_landlords pl ON pl.landlord_id = l.id
      JOIN properties p ON p.id = pl.property_id AND p.user_id = $1
      LEFT JOIN bookings b ON b.property_id = p.id
        AND b.check_in < $3
        AND b.check_out > $2
        AND b.status != 'Cancelled'
      WHERE l.user_id = $1
      GROUP BY l.id, l.name
      ORDER BY total_payout DESC`,
      [userId, startDate, endDate]
    );
    return res.status(200).json(payouts);
  } catch (error) {
    console.error('Error fetching payouts report:', error);
    return res.status(500).json({ error: 'Failed to fetch payouts report' });
  }
}

// --- type: receipt ---
async function handleReceipt(req, res) {
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

    const formatCurrency = (amount) => `\u20A6${Number(amount || 0).toLocaleString()}`;

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

// --- type: payout ---
async function handlePayout(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId } = await getEffectiveUserId(user.id);
  const sql = neon(process.env.DATABASE_URL);

  const { landlordId, month } = req.query;
  if (!landlordId || !month) {
    return res.status(400).json({ error: 'Missing required query params: landlordId, month' });
  }

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
  }

  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const endDate = `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  try {
    const landlords = await sql(
      `SELECT * FROM landlords WHERE id = $1 AND user_id = $2`,
      [landlordId, userId]
    );

    if (landlords.length === 0) {
      return res.status(404).json({ error: 'Landlord not found' });
    }

    const landlord = landlords[0];

    const bookings = await sql(
      `SELECT b.*, p.name AS property_name
       FROM bookings b
       JOIN properties p ON p.id = b.property_id
       JOIN property_landlords pl ON pl.property_id = p.id AND pl.landlord_id = $1
       WHERE b.user_id = $2
         AND b.check_in < $4
         AND b.check_out > $3
         AND b.status != 'Cancelled'
       ORDER BY b.check_in ASC`,
      [landlordId, userId, startDate, endDate]
    );

    const totalPayout = bookings.reduce((sum, b) => sum + Number(b.landlord_payout || 0), 0);
    const totalManagementFee = bookings.reduce((sum, b) => sum + Number(b.management_fee || 0), 0);
    const totalRevenue = bookings.reduce((sum, b) => sum + Number(b.total_revenue || 0), 0);

    const monthLabel = new Date(`${month}-15`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const issuedDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const formatCurrency = (amount) => `\u20A6${Number(amount || 0).toLocaleString()}`;

    const bookingRows = bookings.map(b => {
      const checkIn = new Date(b.check_in).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const checkOut = new Date(b.check_out).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const nights = Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / (1000 * 60 * 60 * 24));
      return `<tr>
        <td>${b.property_name}</td>
        <td>${b.guest_name}</td>
        <td>${checkIn} \u2013 ${checkOut}</td>
        <td>${nights}</td>
        <td>${formatCurrency(b.total_revenue)}</td>
        <td>${formatCurrency(b.management_fee)}</td>
        <td style="font-weight:600;">${formatCurrency(b.landlord_payout)}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payout Statement - ${landlord.name} - ${monthLabel}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
    .statement { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: #fff; padding: 30px; display: flex; justify-content: space-between; align-items: center; }
    .header-left h1 { font-size: 24px; margin-bottom: 4px; }
    .header-left p { opacity: 0.8; font-size: 14px; }
    .header-right { text-align: right; font-size: 13px; opacity: 0.85; }
    .body { padding: 30px; }
    .landlord-info { display: flex; justify-content: space-between; margin-bottom: 24px; padding: 16px; background: #f8f9fa; border-radius: 8px; }
    .landlord-info .label { font-size: 11px; color: #999; text-transform: uppercase; }
    .landlord-info .value { font-size: 15px; font-weight: 500; margin-top: 2px; }
    .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .card { padding: 16px; border-radius: 8px; text-align: center; }
    .card.revenue { background: #eff6ff; }
    .card.fee { background: #fef3c7; }
    .card.payout { background: #ecfdf5; }
    .card .card-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .card .card-value { font-size: 22px; font-weight: 700; margin-top: 4px; }
    .card.revenue .card-value { color: #1d4ed8; }
    .card.fee .card-value { color: #b45309; }
    .card.payout .card-value { color: #059669; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; color: #888; text-transform: uppercase; padding: 10px 8px; border-bottom: 2px solid #eee; }
    td { padding: 10px 8px; border-bottom: 1px solid #f0f0f0; }
    th:last-child, td:last-child { text-align: right; }
    .footer { text-align: center; padding: 20px 30px 30px; color: #999; font-size: 12px; border-top: 1px solid #eee; }
    .print-btn { display: block; margin: 20px auto; padding: 10px 30px; background: #1a1a2e; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
    .print-btn:hover { background: #16213e; }
    .no-bookings { text-align: center; padding: 40px; color: #999; }
    @media print {
      body { background: #fff; padding: 0; }
      .statement { box-shadow: none; border-radius: 0; }
      .print-btn { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="statement">
    <div class="header">
      <div class="header-left">
        <h1>Phiyalistings</h1>
        <p>Payout Statement</p>
      </div>
      <div class="header-right">
        <div>${monthLabel}</div>
        <div>Issued: ${issuedDate}</div>
      </div>
    </div>
    <div class="body">
      <div class="landlord-info">
        <div><div class="label">Landlord</div><div class="value">${landlord.name}</div></div>
        <div><div class="label">Email</div><div class="value">${landlord.email}</div></div>
        <div><div class="label">Company</div><div class="value">${landlord.company || 'N/A'}</div></div>
        <div><div class="label">Payout Rate</div><div class="value">${landlord.payout_percent || 100}%</div></div>
      </div>

      <div class="summary-cards">
        <div class="card revenue"><div class="card-label">Total Revenue</div><div class="card-value">${formatCurrency(totalRevenue)}</div></div>
        <div class="card fee"><div class="card-label">Management Fee</div><div class="card-value">${formatCurrency(totalManagementFee)}</div></div>
        <div class="card payout"><div class="card-label">Net Payout</div><div class="card-value">${formatCurrency(totalPayout)}</div></div>
      </div>

      ${bookings.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Guest</th>
            <th>Dates</th>
            <th>Nights</th>
            <th>Revenue</th>
            <th>Mgmt Fee</th>
            <th>Payout</th>
          </tr>
        </thead>
        <tbody>
          ${bookingRows}
        </tbody>
      </table>` : '<div class="no-bookings">No bookings found for this period.</div>'}
    </div>
    <div class="footer">
      <p>This payout statement was generated by Phiyalistings on ${issuedDate}.</p>
      <p style="margin-top:4px;">For questions, contact your property manager.</p>
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">Print Statement</button>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Error generating payout statement:', error);
    return res.status(500).json({ error: 'Failed to generate payout statement' });
  }
}

// --- Router ---
export default async function handler(req, res) {
  const type = req.query.type;

  switch (type) {
    case 'revenue':
      return handleRevenue(req, res);
    case 'payouts':
      return handlePayouts(req, res);
    case 'receipt':
      return handleReceipt(req, res);
    case 'payout':
      return handlePayout(req, res);
    default:
      return res.status(400).json({ error: `Unknown report type: ${type}` });
  }
}

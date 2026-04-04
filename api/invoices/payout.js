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
    // Fetch landlord info
    const landlords = await sql(
      `SELECT * FROM landlords WHERE id = $1 AND user_id = $2`,
      [landlordId, userId]
    );

    if (landlords.length === 0) {
      return res.status(404).json({ error: 'Landlord not found' });
    }

    const landlord = landlords[0];

    // Fetch bookings for this landlord's properties in the given month
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
    const formatCurrency = (amount) => `₦${Number(amount || 0).toLocaleString()}`;

    const bookingRows = bookings.map(b => {
      const checkIn = new Date(b.check_in).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const checkOut = new Date(b.check_out).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const nights = Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / (1000 * 60 * 60 * 24));
      return `<tr>
        <td>${b.property_name}</td>
        <td>${b.guest_name}</td>
        <td>${checkIn} – ${checkOut}</td>
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

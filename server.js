// server.js — Chrono x Resend x PostgreSQL
// npm install express resend node-cron pg

const express = require('express');
const { Resend } = require('resend');
const cron = require('node-cron');
const path = require('path');
const { Pool } = require('pg');

const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table if it doesn't exist
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGINT PRIMARY KEY,
      title TEXT NOT NULL,
      datetime TEXT NOT NULL,
      reminder_hours INTEGER DEFAULT 24,
      notes TEXT DEFAULT '',
      color TEXT DEFAULT '#c17f3e',
      reminded BOOLEAN DEFAULT false
    )
  `);
  console.log('✅ Database ready');
}

// REST endpoints
app.get('/events', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM events ORDER BY datetime ASC');
    res.json(result.rows.map(row => ({
      id: row.id,
      title: row.title,
      datetime: row.datetime,
      reminderHours: row.reminder_hours,
      notes: row.notes,
      color: row.color,
      reminded: row.reminded
    })));
  } catch(e) {
    console.error('GET /events error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/events', async (req, res) => {
  try {
    const { title, datetime, reminderHours, notes, color } = req.body;
    const id = Date.now();
    await pool.query(
      'INSERT INTO events (id, title, datetime, reminder_hours, notes, color, reminded) VALUES ($1,$2,$3,$4,$5,$6,false)',
      [id, title, datetime, reminderHours || 24, notes || '', color || '#c17f3e']
    );
    res.json({ id, title, datetime, reminderHours, notes, color, reminded: false });
  } catch(e) {
    console.error('POST /events error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/events/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    console.error('DELETE /events error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Runs every hour — checks for events needing a reminder
cron.schedule('0 * * * *', async () => {
  console.log('⏰ Cron running at', new Date().toISOString());
  try {
    const result = await pool.query('SELECT * FROM events WHERE reminded = false');
    const now = new Date();

    for (const row of result.rows) {
      const hoursLeft = (new Date(row.datetime) - now) / 3_600_000;
      console.log(`Event "${row.title}": ${hoursLeft.toFixed(2)}h left, window: ${row.reminder_hours}h`);

      if (hoursLeft > 0 && hoursLeft <= row.reminder_hours) {
        const emailResult = await resend.emails.send({
          from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
          to: [process.env.TO_EMAIL],
          subject: `⏰ ${row.title} — coming up soon`,
          html: buildEmail(row),
          tags: [{ name: 'category', value: 'reminder' }],
        });
        console.log('📧 Email sent:', emailResult);
        await pool.query('UPDATE events SET reminded = true WHERE id = $1', [row.id]);
        console.log(`✓ Reminded: ${row.title}`);
      }
    }
  } catch(e) {
    console.error('Cron error:', e.message);
  }
});

function buildEmail(ev) {
  const dt = new Date(ev.datetime).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
    <div style="background:#0c0c0e;padding:28px;border-radius:12px">
      <p style="color:#00e5a0;font-size:11px;letter-spacing:.12em;margin:0 0 14px">CHRONO REMINDER</p>
      <h1 style="color:#f0efe8;font-size:22px;margin:0 0 8px">⏰ ${ev.title}</h1>
      <p style="color:#666672;font-size:14px;margin:0 0 20px">${dt}</p>
      ${ev.notes ? `<p style="color:#c0bfb8;font-size:14px;border-left:2px solid #00e5a0;padding-left:12px">${ev.notes}</p>` : ''}
    </div>
    <p style="font-size:11px;color:#888;text-align:center;margin-top:16px">
      Sent by Chrono · <a href="#" style="color:#888">Unsubscribe</a>
    </p>
  </div>`;
}

// Update package.json to include pg
initDB().then(() => {
  app.listen(process.env.PORT || 3000, () =>
    console.log('🟢 Chrono running on port ' + (process.env.PORT || 3000)));
});

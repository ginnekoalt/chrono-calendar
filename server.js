// server.js — Chrono x Resend x PostgreSQL

const express = require('express');
const { Resend } = require('resend');
const path = require('path');
const { Pool } = require('pg');

const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

// Send email with retries
async function sendReminderEmail(ev, attempt = 1) {
  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY_MS = 60_000; // retry every 60s if it fails

  try {
    await resend.emails.send({
      from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
      to: [process.env.TO_EMAIL],
      subject: `⏰ ${ev.title} — coming up soon`,
      html: buildEmail(ev),
      tags: [{ name: 'category', value: 'reminder' }],
    });
    await pool.query('UPDATE events SET reminded = true WHERE id = $1', [ev.id]);
    console.log(`✅ Reminder sent for "${ev.title}"`);
  } catch (e) {
    console.error(`❌ Attempt ${attempt}/${MAX_ATTEMPTS} failed for "${ev.title}": ${e.message}`);
    if (attempt < MAX_ATTEMPTS) {
      console.log(`🔁 Retrying in 60s...`);
      setTimeout(() => sendReminderEmail(ev, attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error(`🚫 Gave up sending reminder for "${ev.title}" after ${MAX_ATTEMPTS} attempts`);
    }
  }
}

// Schedule a reminder for an event — fires exactly (reminder_hours) before event time
// If that moment is already past, fires immediately
function scheduleReminder(ev) {
  const sendAt = new Date(ev.datetime).getTime() - ev.reminder_hours * 3_600_000;
  const now = Date.now();
  const delay = Math.max(0, sendAt - now); // 0 = fire immediately if past due

  if (delay === 0) {
    console.log(`⚡ Reminder for "${ev.title}" is overdue — sending now`);
  } else {
    const mins = Math.round(delay / 60000);
    console.log(`⏰ Reminder for "${ev.title}" fires in ${mins} minute(s)`);
  }

  setTimeout(() => sendReminderEmail(ev), delay);
}

// On startup, reschedule all unreminded events
async function scheduleAllPending() {
  const { rows } = await pool.query('SELECT * FROM events WHERE reminded = false');
  rows.forEach(scheduleReminder);
  console.log(`📅 Rescheduled ${rows.length} pending reminder(s)`);
}

// REST endpoints
app.get('/events', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM events ORDER BY datetime ASC');
    res.json(rows.map(r => ({
      id: r.id, title: r.title, datetime: r.datetime,
      reminderHours: r.reminder_hours, notes: r.notes,
      color: r.color, reminded: r.reminded
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/events', async (req, res) => {
  try {
    const { title, datetime, reminderHours, notes, color } = req.body;
    const id = Date.now();
    const rh = reminderHours || 24;
    await pool.query(
      'INSERT INTO events (id, title, datetime, reminder_hours, notes, color, reminded) VALUES ($1,$2,$3,$4,$5,$6,false)',
      [id, title, datetime, rh, notes || '', color || '#c17f3e']
    );
    const ev = { id, title, datetime, reminder_hours: rh, notes, color };
    scheduleReminder(ev);
    res.json({ id, title, datetime, reminderHours: rh, notes, color, reminded: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/events/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

initDB()
  .then(scheduleAllPending)
  .then(() => {
    app.listen(process.env.PORT || 3000, () =>
      console.log('🟢 Chrono running on port ' + (process.env.PORT || 3000)));
  });

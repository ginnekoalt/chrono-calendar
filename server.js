// server.js — Chrono x Resend
// npm install express resend node-cron

const express = require('express');
const { Resend } = require('resend');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Load events from file
let events = [];
try {
  events = JSON.parse(fs.readFileSync('events.json', 'utf8'));
} catch (e) { events = []; }

const save = () =>
  fs.writeFileSync('events.json', JSON.stringify(events, null, 2));

// REST endpoints
app.get('/events', (_req, res) => res.json(events));

app.post('/events', (req, res) => {
  const ev = { ...req.body, id: Date.now(), reminded: false };
  events.push(ev);
  save();
  res.json(ev);
});

app.delete('/events/:id', (req, res) => {
  events = events.filter(e => e.id != req.params.id);
  save();
  res.json({ ok: true });
});

// Runs every hour — checks for events needing a reminder
cron.schedule('0 * * * *', async () => {
  const now = new Date();
  let changed = false;

  for (const ev of events) {
    if (ev.reminded) continue;
    const hoursLeft = (new Date(ev.datetime) - now) / 3_600_000;

    if (hoursLeft > 0 && hoursLeft <= ev.reminderHours) {
      await resend.emails.send({
        from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
        to: [process.env.TO_EMAIL],
        subject: `⏰ ${ev.title} — coming up soon`,
        html: buildEmail(ev),
        tags: [{ name: 'category', value: 'reminder' }],
      });
      ev.reminded = true;
      changed = true;
      console.log(`✓ Reminded: ${ev.title}`);
    }
  }
  if (changed) save();
});

function buildEmail(ev) {
  const dt = new Date(ev.datetime).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
    <div style="background:#0c0c0e;padding:28px;border-radius:12px">
      <p style="color:#00e5a0;font-size:11px;letter-spacing:.12em;margin:0 0 14px">
        CHRONO REMINDER</p>
      <h1 style="color:#f0efe8;font-size:22px;margin:0 0 8px">
        ⏰ ${ev.title}</h1>
      <p style="color:#666672;font-size:14px;margin:0 0 20px">${dt}</p>
      ${ev.notes
        ? `<p style="color:#c0bfb8;font-size:14px;border-left:2px solid #00e5a0;padding-left:12px">${ev.notes}</p>`
        : ''}
    </div>
    <p style="font-size:11px;color:#888;text-align:center;margin-top:16px">
      Sent by Chrono · <a href="#" style="color:#888">Unsubscribe</a>
    </p>
  </div>`;
}

app.listen(process.env.PORT || 3000, () =>
  console.log('🟢 Chrono running on port ' + (process.env.PORT || 3000)));

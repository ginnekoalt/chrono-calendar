# Chrono Backend — Resend Edition

## Deploy to Railway (5 min)

1. Go to https://railway.app and sign up with GitHub
2. Click "New Project" → "Empty Project"
3. Click "Add a Service" → "GitHub Repo"
4. Upload this folder to a new GitHub repo, then connect it
5. Go to your service → "Variables" tab → add these:

| Variable | Value |
|---|---|
| RESEND_API_KEY | re_your_key_here |
| TO_EMAIL | your@gmail.com |
| FROM_EMAIL | onboarding@resend.dev |
| FROM_NAME | My Calendar |

6. Railway auto-deploys. Your backend is live!

## How it works
- Cron job runs every hour
- Checks if any event is within its reminder window
- Sends an email via Resend if so
- Marks the event as reminded so it doesn't send twice

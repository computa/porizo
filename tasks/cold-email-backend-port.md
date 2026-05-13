# Cold-Email Daily Send — Port to Porizo Backend

**Goal:** Replace the macOS launchd job + Python script with a Node.js job inside the Porizo backend so the campaign survives laptop sleep, Mac restarts, and Full Disk Access permission drift.

## Current shape (what we replace)

- `~/Library/LaunchAgents/co.porizo.cold-daily-send.plist` — fires 09:00 local
- `marketing/email/cold-daily-send.py` — Python script
- `marketing/email/.state/cold-send-state.json` — campaign progress (next_index, totals)
- `marketing/email/.state/cold-list.tsv` — 4400 recipients (gitignored)
- `security` keychain entry `resend-cli` — Resend sending API key
- Run logs in `marketing/email/.state/runs/`

## Target shape

- Postgres tables `cold_email_campaigns` (1 row) + `cold_email_recipients` (4400 rows)
- `src/jobs/cold-email-daily.js` — polls every 5 min, fires once per UTC day after 09:00
- `src/services/cold-email-service.js` — pure data layer + Resend submission
- `RESEND_API_KEY` env var on Railway
- One-shot import script `scripts/import-cold-email-list.js` (run locally, writes to Railway DB)
- Admin endpoint `POST /admin/dashboard/cold-email/trigger` for manual fire + observability
- Templates stay in `marketing/email/cold-intro.{html,txt}` (already committed)

## Schema (migration 106)

```sql
CREATE TABLE cold_email_campaigns (
  id TEXT PRIMARY KEY,
  campaign_tag TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_html_path TEXT NOT NULL,
  template_text_path TEXT NOT NULL,
  per_day INTEGER NOT NULL,
  schedule_pace_seconds INTEGER NOT NULL,
  schedule_offset_minutes INTEGER NOT NULL,
  earliest_run_date_utc TEXT,
  fire_after_utc_hour INTEGER NOT NULL DEFAULT 9,
  active INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  last_run_at TEXT,
  last_run_date_utc TEXT,
  last_batch_size INTEGER,
  total_queued INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cold_email_recipients (
  campaign_id TEXT NOT NULL,
  index_pos INTEGER NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  sent_at TEXT,
  resend_email_id TEXT,
  scheduled_at TEXT,
  PRIMARY KEY (campaign_id, index_pos)
);

CREATE INDEX cold_email_recipients_pending_idx
  ON cold_email_recipients(campaign_id, index_pos)
  WHERE sent_at IS NULL;
```

## Idempotency rules

The job runs in a 5-min poll loop and fires at most **once per UTC date**. Decision:

- if `campaign.active = 0` → skip
- if today_utc < `earliest_run_date_utc` → skip
- if `last_run_date_utc` == today_utc → already ran today, skip
- if now_utc.hour < `fire_after_utc_hour` → too early, skip
- if `total pending = 0` → campaign done, set active = 0
- otherwise → fire

Concurrency safety: server-restart shouldn't double-send. Two guards:

1. `last_run_date_utc` is set BEFORE Resend submission (then rolled back on hard failure). Cheap and effective.
2. Each recipient row has its own `sent_at` — Resend submit marks each row sent. Re-running would skip already-sent rows.

## Pure functions (testable)

```ts
selectPendingBatch(rows, perDay): row[]
buildResendPayload(rows, template, scheduleStart, paceSeconds): payload[]
shouldFireToday(state, now): boolean
```

These three are pure, deterministic, easy to test. The Resend HTTP call is isolated.

## Files

```
migrations/106_cold_email.sql
migrations/pg/106_cold_email.sql
scripts/import-cold-email-list.js          # one-shot TSV → DB import
src/services/cold-email-service.js         # data + Resend submit + templating
src/jobs/cold-email-daily.js               # poll loop + fire decision
src/server.js                              # register the job (~3 line edit)
src/routes/admin.js                        # POST /admin/dashboard/cold-email/trigger
test/services/cold-email-service.test.js   # pure-function tests
test/jobs/cold-email-daily.test.js         # shouldFireToday + integration
```

## TDD plan

Tests first:

1. `shouldFireToday()` — every gate (active off, before earliest, before hour, already ran, no pending → false; all clear → true)
2. `selectPendingBatch()` — returns only sent_at = null rows, ordered by index_pos, capped at per_day
3. `buildResendPayload()` — correct scheduled_at spacing, template variable substitution, tags
4. `recordBatchResult()` — only updates rows with returned IDs; rolls back state on Resend failure

## Migration steps to land safely

1. Build + test locally
2. Apply migration to Railway: `cat migrations/pg/106_cold_email.sql | railway connect postgres`
3. Set `RESEND_API_KEY` in Railway env vars
4. Locally run `node scripts/import-cold-email-list.js --campaign mothers-day-2026` — connects to Railway DB, populates recipients table with the local TSV. **Marks rows 0–339 as already-sent** so backend doesn't re-send.
5. Deploy backend. Job auto-starts in `server.js`.
6. Verify in admin: hit `GET /admin/dashboard/cold-email/state`. Should show 340 already sent, 4060 pending.
7. Disable the launchd agent: `launchctl bootout gui/$UID/co.porizo.cold-daily-send`
8. Tomorrow at 09:00 UTC: backend job fires its first batch.

## Out of scope

- Switching from Resend to another provider
- Multi-tenant cold campaigns (one campaign for now, but the schema supports more)
- Real-time delivery webhooks (`resend:webhook` is a separate concern)
- Email content editing UI (admin can SQL-edit subject/template paths for now)

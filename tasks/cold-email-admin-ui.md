# Cold-Email Admin UI — Plan

**Goal:** Surface the cold-email system in the admin Marketing tab — extend Template Previews to include cold-intro templates, and add a Cold Email tab with R/U + trigger + pause/resume.

## Backend changes (`src/routes/admin.js`)

1. **Extend `GET /admin/dashboard/marketing/email-templates`** — add a second section reading from `marketing/email/`. Return shape:

   ```json
   {
     "templates": [...nurture...],
     "cold_email_templates": [
       { "id": "cold-intro", "file": "cold-intro.html", "subject": "A song from one memory", "label": "Cold Intro", "html": "..." },
       { "id": "completed-before", "file": "completed-before.html", "subject": "...", "label": "Completed Before", "html": "..." },
       { "id": "no-song", "file": "no-song.html", "subject": "...", "label": "No Song", "html": "..." }
     ]
   }
   ```

   Backward-compatible: existing consumers ignore the new key.

2. **Add `PATCH /admin/dashboard/marketing/cold-email/:id`** — superadmin-gated partial update of editable fields:
   - `subject` (string, ≤200 chars)
   - `campaign_tag` (string, ≤80 chars)
   - `per_day` (int, 1–100; Resend batch limit)
   - `schedule_pace_seconds` (int, 30–3600)
   - `schedule_offset_minutes` (int, 0–600; refuse > 600 to avoid day-boundary attack)
   - `fire_after_utc_hour` (int, 0–23)
   - `earliest_run_date_utc` (YYYY-MM-DD string or null)
   - `from_address` (string)
   - `reply_to` (string)
   - `active` (0 or 1)
     Refuse other fields. Returns updated row. 400 on validation failure. 409 if campaign not found.

3. **Existing endpoints stay as-is:**
   - `GET /admin/dashboard/marketing/cold-email` — list with pending counts
   - `POST /admin/dashboard/marketing/cold-email/:id/trigger` — manual fire

No new DELETE / CREATE endpoints — out of scope.

## Frontend changes

1. **New file `admin/src/pages/marketing/ColdEmailTab.tsx`** — table of campaigns + per-row edit modal + per-row trigger button + active toggle. Columns:
   - id, subject, status (active badge), per_day, fire_after, pending / total, last_run_at, actions
2. **Edit modal** — form bound to the PATCH endpoint. Inline validation matching backend constraints. Confirmation prompt for `active=0` and any change to `per_day`.
3. **Trigger button** — POST /trigger, surface the response: 200 fired:true → "Fired N emails", 409 → "Gated: {reason}".
4. **Extend `EmailTemplatesTab.tsx`** — render two sections: "Nurture Sequence" (existing) and "Cold Email Templates" (new) using the new response shape.
5. **Wire into `Marketing.tsx`** — add tab `{ id: 'cold-email', label: 'Cold Email', icon: Send }` between Campaigns and Quick Links.

## Validation strategy

- Frontend: native HTML5 + onSubmit pre-check; show inline errors.
- Backend: authoritative; mirrors service-level constraints (per_day ≤ 100, offset_minutes ≤ 600).
- Trigger button: refuses click while a request is in flight.

## Out of scope

- Template editing (write to disk would diverge from git; revisit when templates move to DB).
- Campaign creation via UI (the import script's recipient-TSV flow doesn't fit a form).
- Recipient list management (pause individual recipients, etc.).
- Per-recipient delivery status / Resend analytics passthrough.

## Tests

- New backend route gets a route test confirming auth gating + validation + happy-path PATCH.
- No new service-layer tests needed — PATCH is a thin SQL UPDATE with input validation.
- No frontend unit tests yet (admin doesn't have a frontend test suite); manual verification.

## Ship steps

1. Apply backend changes locally; lint + test.
2. Build admin frontend (`cd admin && npm run build`).
3. Commit + push + `railway up` to deploy backend + admin static assets.
4. Verify in admin UI at https://api.porizo.co/admin/dashboard?tab=cold-email.

# Share Email Follow-up Sequence — Design + Integration Plan

Owner: TBD · Created 2026-05-22 · Status: scheduling logic shipped; integration pending

## Goal

Drive return engagement and rating velocity by reaching back to senders
after they create a share link. Three-stage sequence: re-engagement at 24h,
rating ask at 72h, reactivation at 7d.

## What's already shipped (this session)

| Artifact                                              | Path                                     |
| ----------------------------------------------------- | ---------------------------------------- |
| Pure scheduling module                                | `src/services/share-followup-service.js` |
| Stage copy registry (subject + headline + body + CTA) | same file                                |
| Unit tests (9 tests, 100% pass)                       | `test/share-followup-service.test.js`    |

The shipped module has **no DB dependency** and is testable in isolation.
It exposes:

- `computeFollowupSchedule(shareCreatedAt, { skipStages? })` — returns the
  ordered list of stage records with computed `sendAt` Dates and copy.
- `pickDueFollowups(scheduled, now?)` — filters to entries currently due.
- `getStageCopy(stage)` — single-stage copy lookup.
- `FOLLOWUP_STAGES` — frozen source-of-truth constant.

## What's NOT shipped — integration work this doc unblocks

1. **DB migration** — persistence so the job runner can find due rows.
2. **Email templates** in `email-service.js` (one per stage).
3. **Job runner** in `src/jobs/` for periodic dispatch.
4. **Wire-in** at share creation in `server.js`.

## Stage schedule + copy (source: `share-followup-service.js`)

| Stage        | Offset | Subject                   | Primary CTA                          |
| ------------ | ------ | ------------------------- | ------------------------------------ |
| `sender_24h` | +24h   | How did they react?       | Make another song                    |
| `sender_72h` | +72h   | A favor (and a quick one) | Rate Porizo (write-review deep link) |
| `sender_7d`  | +7d    | Someone is owed a song    | Start a song                         |

Each entry carries `subject`, `headline`, `body`, `cta`, `ctaPath` — enough
to drive a single-column transactional email template without further
copywriting work. Tweak by editing `FOLLOWUP_STAGES` in the service file;
the lookup table re-freezes automatically.

## DB schema

```sql
-- migrations/114_share_followups.sql
CREATE TABLE IF NOT EXISTS share_followups (
  id TEXT PRIMARY KEY,
  share_token_id TEXT NOT NULL REFERENCES share_tokens(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,                  -- 'sender_24h' | 'sender_72h' | 'sender_7d'
  send_at TEXT NOT NULL,                -- ISO-8601, when the email becomes due
  sent_at TEXT,                         -- NULL until dispatched
  resend_email_id TEXT,                 -- response id from Resend for traceability
  skip_reason TEXT,                     -- e.g. 'unsubscribed', 'duplicate', 'rate_limited'
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (share_token_id, stage)        -- one row per (share, stage), idempotent inserts
);

CREATE INDEX IF NOT EXISTS share_followups_pending_idx
  ON share_followups(send_at)
  WHERE sent_at IS NULL AND skip_reason IS NULL;
```

`UNIQUE (share_token_id, stage)` enables `INSERT ... ON CONFLICT DO NOTHING`
so the wire-in point at share creation can be naive — re-running the
schedule for an already-scheduled share is a no-op.

## Email templates

Add three new functions in `src/services/email-service.js`:

```js
async function sendShareFollowup24h(payload) {
  /* uses getStageCopy('sender_24h') */
}
async function sendShareFollowup72h(payload) {
  /* uses getStageCopy('sender_72h') */
}
async function sendShareFollowup7d(payload) {
  /* uses getStageCopy('sender_7d') */
}
```

Where `payload = { email, name, shareUrl, trackTitle, recipientName }`.

Use the same `Resend` client + escapeHtml + style baseline as
`sendGiftDeliveryEmail`. Each template should:

1. Address the sender by first name when known.
2. Echo the recipient name + track title so the email feels specific.
3. Carry the stage CTA button linking to `ctaPath` (relative paths get
   prefixed with `publicBaseUrl`).
4. Include a one-line unsubscribe footer pointing at the standard
   `/settings/notifications` deep link.

## Job runner

New file `src/jobs/share-followups-daily.js` modeled on
`src/jobs/cold-email-daily.js`. Pseudo-code:

```js
async function dispatchDueShareFollowups({ db, emailService }) {
  const due = await db.all(
    `SELECT * FROM share_followups
       WHERE sent_at IS NULL AND skip_reason IS NULL AND send_at <= ?
       ORDER BY send_at ASC LIMIT 200`,
    [new Date().toISOString()],
  );

  for (const row of due) {
    const sender = await loadSenderById(db, row.sender_user_id);
    if (!sender?.email) {
      await markSkipped(db, row.id, 'no_sender_email');
      continue;
    }
    if (sender.unsubscribed_at) {
      await markSkipped(db, row.id, 'unsubscribed');
      continue;
    }
    const sendFn = TEMPLATE_BY_STAGE[row.stage]; // sendShareFollowup24h etc.
    const resendId = await sendFn({
      email: sender.email,
      name: sender.first_name,
      shareUrl: buildShareUrl(row.share_token_id),
      trackTitle: ...,
      recipientName: ...,
    });
    await markSent(db, row.id, resendId);
  }
}
```

Wire into `src/server.js` near the other periodic jobs:

```js
const FOLLOWUP_TICK_MS = 5 * 60 * 1000;
setInterval(
  () => dispatchDueShareFollowups({ db, emailService }),
  FOLLOWUP_TICK_MS,
);
```

## Wire-in at share creation

In `src/server.js` around line 2118 (the `INSERT INTO share_tokens` call):

```js
const scheduled = computeFollowupSchedule(now);
for (const entry of scheduled) {
  await db.run(
    `INSERT INTO share_followups (id, share_token_id, sender_user_id, stage, send_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (share_token_id, stage) DO NOTHING`,
    [
      randomUUID(),
      shareTokenId,
      senderUserId,
      entry.stage,
      entry.sendAt.toISOString(),
    ],
  );
}
```

That's the only line that needs to change at the share-creation site —
re-running it is safe because of the UNIQUE constraint.

## Unsubscribe handling

Reuse the existing `users.unsubscribed_at` column if present, or add one
in the same migration. The job runner skips users with a non-NULL value
and writes `skip_reason='unsubscribed'`. Surface a one-click unsubscribe
link in every template footer.

## Suppression rules

- A user creates 10 shares in a day → still get one followup PER share at
  each stage. Risk: spam. **Mitigation:** add a rate-limit guard that
  collapses multiple shares-per-sender into a single followup per stage
  per 24h window. Skipped rows write `skip_reason='rate_limited'`.
- A recipient unbinds / a share is revoked before send → followup should
  not fire. The `ON DELETE CASCADE` on `share_token_id` ensures rows
  disappear with the share, so revocation deletes-then-recreates won't
  re-fire. For revoked-but-not-deleted shares, add a JOIN guard:
  `... AND st.status NOT IN ('revoked', 'expired')`.

## A/B variants (future)

Stage copy is locked into a frozen constant for v1. To A/B copy variants
later, lift `FOLLOWUP_STAGES` to a function that returns the variant for a
given user ID (consistent-hash assignment). Track variant in the
`share_followups` row so analytics can attribute opens/clicks back.

## Acceptance criteria (for the integration session)

1. New share creation inserts 3 `share_followups` rows.
2. Job tick at +24h dispatches the first row, marks `sent_at`.
3. Resending the job within the next minute is a no-op (sent rows skipped).
4. Revoking a share before +72h removes the un-sent rows (cascade verified).
5. Setting `users.unsubscribed_at` blocks downstream sends with
   `skip_reason='unsubscribed'`.
6. One end-to-end manual: create a share, fast-forward `send_at` to NOW,
   tick the job, confirm email arrives in Resend dashboard.

## Risks + open questions

- **Should recipients also receive followups?** Currently scoped to
  senders only (we don't have a reliable recipient email at share-creation
  time). Could add a `recipient_24h` stage gated on receiver-save-email
  capture. Decision: defer to v2.
- **Sender = no email on file?** Account creation flows that don't capture
  email (e.g., Sign-in-with-Apple with private-relay hidden mail) will
  short-circuit. The skip_reason='no_sender_email' path handles this
  cleanly; analytics will show how big the gap is.
- **Resend cost?** At 3 emails per share, 1000 shares/month → 3000 emails.
  Within Resend free tier. No cost concern at current volume.

## What to do next

1. Add migration 114_share_followups.sql per schema above.
2. Add three email templates in `email-service.js` consuming `getStageCopy`.
3. Build job runner per pseudo-code.
4. Wire-in at share creation per snippet above.
5. Manual end-to-end + add an integration test that exercises the
   migration + job + email-stubbed Resend client.

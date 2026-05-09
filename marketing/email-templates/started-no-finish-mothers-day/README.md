# Started-but-Didn't-Finish Mother's Day Campaign

**Cohort:** App users with valid email who started a track but never reached a `ready` or `preview_ready` state.

**Why this cohort matters:** Highest-conversion segment of the Mother's Day push. They've already shown intent (started a track) — friction stopped them, not lack of desire. Two-tap CTA reduces re-entry friction.

**SQL definition (read-only preview):**

```sql
-- Users with at least one in-progress track but no completed/preview-ready output
SELECT DISTINCT
  u.id AS user_id,
  LOWER(TRIM(u.email)) AS email,
  COALESCE(u.display_name, '') AS first_name
FROM users u
JOIN tracks t ON t.user_id = u.id
LEFT JOIN track_versions tv ON tv.track_id = t.id
WHERE u.email IS NOT NULL
  AND u.email LIKE '%@%'
  AND u.deleted_at IS NULL
  AND u.email NOT IN (SELECT email FROM email_unsubscribes)
  AND NOT EXISTS (
    SELECT 1 FROM tracks t2
    WHERE t2.user_id = u.id
      AND t2.status IN ('ready', 'preview_ready')
  )
  AND NOT EXISTS (
    SELECT 1 FROM track_versions tv2
    JOIN tracks t3 ON t3.id = tv2.track_id
    WHERE t3.user_id = u.id
      AND tv2.status IN ('full_ready', 'preview_ready', 'ready')
  )
  AND EXISTS (
    SELECT 1 FROM tracks t4
    WHERE t4.user_id = u.id
      AND t4.status NOT IN ('ready', 'preview_ready')
  )
GROUP BY u.id, u.email, u.display_name;
```

**Subject:** `Your song is two taps away`
**Preview:** `You started a song. Mother's Day is tomorrow. Two taps to finish.`
**CTA:** `Finish your song`
**CTA URL:** `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028`

**Send window:** 2026-05-09 afternoon/evening US time
**Sender:** `Ambrose from Porizo <support@porizo.co>`
**Reply-to:** `support@porizo.co`

## Send flow

1. Run the cohort query against production (read-only). Confirm count is sane (expect 50–500).
2. Export recipient list to `/tmp/started-no-finish-mothers-day-2026-05-09.json` for Resend batch.
3. Send one test to `abcobimma@gmail.com` first — verify rendering, link clicks resolve, plain-text fallback present.
4. Review Resend deliverability insights. Resolve all `Needs attention` items.
5. After explicit approval, batch-send via `resend emails batch --file ...` or Resend MCP.
6. Capture batch ID, monitor delivery rate for 2 hours, log to `marketing/emails/sent/2026-05-09-started-no-finish.log`.

# Completed-Song Mother's Day Campaign

**Cohort:** App users with valid email who have created at least one completed song (`tracks.status IN ('ready', 'preview_ready')` OR `track_versions.status IN ('full_ready', 'preview_ready', 'ready')`).

**Why this cohort matters:** Warmest segment — they've experienced the product. Repurchase / re-engagement intent. Different recipient angle (grandma, aunt, mother-in-law, mom-figures) avoids fatigue if they already made one for their mum.

**SQL definition (read-only preview):**

```sql
SELECT DISTINCT
  u.id AS user_id,
  LOWER(TRIM(u.email)) AS email,
  COALESCE(u.display_name, '') AS first_name
FROM users u
WHERE u.email IS NOT NULL
  AND u.email LIKE '%@%'
  AND u.deleted_at IS NULL
  AND u.email NOT IN (SELECT email FROM email_unsubscribes)
  AND (
    EXISTS (
      SELECT 1 FROM tracks t
      WHERE t.user_id = u.id
        AND t.status IN ('ready', 'preview_ready')
    )
    OR EXISTS (
      SELECT 1 FROM track_versions tv
      JOIN tracks t2 ON t2.id = tv.track_id
      WHERE t2.user_id = u.id
        AND tv.status IN ('full_ready', 'preview_ready', 'ready')
    )
  )
GROUP BY u.id, u.email, u.display_name;
```

**Subject:** `Make her one too`
**Preview:** `You already know how a Porizo song lands. Mother's Day is tomorrow.`
**CTA:** `Make her one too`
**CTA URL:** `https://apps.apple.com/us/app/porizo-song-gift-maker/id6758205028`

**Send window:** 2026-05-09 afternoon/evening US time
**Sender:** `Ambrose from Porizo <support@porizo.co>`
**Reply-to:** `support@porizo.co`

## Send flow

1. Run cohort query against production. Confirm count is sane.
2. Export to `/tmp/completed-song-mothers-day-2026-05-09.json`.
3. Send one test to `abcobimma@gmail.com` first.
4. Review Resend deliverability insights — verify audio embed renders cleanly in test.
5. After explicit approval, batch-send via Resend MCP/CLI.
6. Capture batch ID, log to `marketing/emails/sent/2026-05-09-completed-song.log`.

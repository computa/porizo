# Porizo Cohort SQL Reference

Use these snippets as starting points. Confirm the live schema before running:

```bash
railway run node - <<'JS'
const { createDatabase } = require('./src/database');
(async () => {
  const db = await createDatabase();
  const result = await db.query("SELECT NOW() AS now");
  console.log(result.rows);
  await db.close?.();
})().catch((err) => { console.error(err); process.exit(1); });
JS
```

## Core Tables

- `users`: `id`, `email`, `email_verified`, `display_name`, `created_at`, `country`, `locale`, `risk_level`, `locked_until`, plus attribution columns in newer migrations.
- `tracks`: song creation state; join on `tracks.user_id = users.id`.
- `track_versions`: generated versions; join through `tracks.id`.
- `voice_profiles`: original enrollment profile; completed/active status means local enrollment completed.
- `voice_provider_profiles`: Suno persona/provider profile; `provider='suno'`, `status='completed'` means provider persona ready.
- `subscriptions`: paid/free status and tier if present.
- `marketing_contacts`: imported D2C/lead contacts; use `status IN ('active')` and exclude `bounced/unsubscribed`.
- `marketing_engagements`: per-campaign open/click/reply/bounce/unsubscribe tracking.

## Base Eligible User CTE

Use this base CTE for app-user cohorts:

```sql
WITH eligible_users AS (
  SELECT
    u.id AS user_id,
    LOWER(TRIM(u.email)) AS email,
    NULLIF(TRIM(u.display_name), '') AS display_name,
    u.created_at,
    u.country,
    u.locale,
    u.risk_level,
    COUNT(DISTINCT t.id) AS track_count,
    MAX(t.created_at) AS last_track_at
  FROM users u
  LEFT JOIN tracks t ON t.user_id = u.id
  WHERE u.email IS NOT NULL
    AND TRIM(u.email) <> ''
    AND u.email NOT ILIKE '%@porizo.co'
    AND u.email NOT ILIKE '%reviewer%'
    AND COALESCE(u.risk_level, 'low') <> 'blocked'
    AND (u.locked_until IS NULL OR u.locked_until < NOW())
  GROUP BY u.id, u.email, u.display_name, u.created_at, u.country, u.locale, u.risk_level
)
SELECT *
FROM eligible_users
ORDER BY created_at DESC
LIMIT 25;
```

If `users.deleted_at` exists in live schema, add `AND u.deleted_at IS NULL`.

## Common Cohorts

Recent signups:

```sql
WITH eligible_users AS (...)
SELECT * FROM eligible_users
WHERE created_at >= NOW() - INTERVAL '7 days';
```

Signed up but no song:

```sql
WITH eligible_users AS (...)
SELECT * FROM eligible_users
WHERE track_count = 0
  AND created_at >= NOW() - INTERVAL '30 days';
```

Created exactly one song:

```sql
WITH eligible_users AS (...)
SELECT * FROM eligible_users
WHERE track_count = 1;
```

Voice enrolled locally but Suno persona not ready:

```sql
WITH eligible_users AS (...)
SELECT eu.*
FROM eligible_users eu
JOIN voice_profiles vp
  ON vp.user_id = eu.user_id
 AND vp.deleted_at IS NULL
 AND vp.status IN ('completed', 'active')
LEFT JOIN voice_provider_profiles vpp
  ON vpp.user_id = eu.user_id
 AND vpp.provider = 'suno'
 AND vpp.deleted_at IS NULL
 AND vpp.status = 'completed'
WHERE vpp.id IS NULL;
```

Has completed Suno voice persona:

```sql
WITH eligible_users AS (...)
SELECT DISTINCT eu.*
FROM eligible_users eu
JOIN voice_provider_profiles vpp
  ON vpp.user_id = eu.user_id
 AND vpp.provider = 'suno'
 AND vpp.status = 'completed'
 AND vpp.deleted_at IS NULL;
```

Apple Ads signups:

```sql
WITH eligible_users AS (...)
SELECT eu.*
FROM eligible_users eu
WHERE eu.user_id IN (
  SELECT user_id
  FROM apple_ads_attribution
  WHERE status = 'resolved'
);
```

## Redaction Helper

When reporting samples in chat, redact emails:

```js
function redactEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "(invalid)";
  return `${local.slice(0, 1)}***@${domain}`;
}
```

## Export Discipline

For sending, write a temporary JSON file under `/tmp`, for example:

```json
[
  {
    "from": "Ambrose from Porizo <support@porizo.co>",
    "to": ["user@example.com"],
    "subject": "How was your Porizo song?",
    "text": "Plain text body",
    "html": "<html>...</html>",
    "reply_to": ["support@porizo.co"]
  }
]
```

Do not persist raw recipient exports in the repo.

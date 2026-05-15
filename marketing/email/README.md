# Mother's Day 2026 Email Campaign

**Send date:** 2026-05-09 (Saturday afternoon US time)
**Mother's Day:** 2026-05-10 (Sunday)
**Visual system:** Approved variant A — "Gift Card" (warm parchment, gold ribbons, italic-lead opener, gift-card audio frame)
**Approval record:** `~/.gstack/projects/computa-porizo/designs/mothers-day-email-20260509/approved.json`

---

## Templates

Each cohort gets its own HTML + matching plain-text fallback. All four share the same visual system. The differences are content (opener, body copy, CTA verb) and personalization (`{{first_name}}` substitution required before send).

| File | Cohort | Subject | CTA | Sender |
|---|---|---|---|---|
| `no-song.html` | App users with no completed song | `Make a free Mother's Day song` | `Create a free song ›` | `Ambrose from Porizo <support@porizo.co>` |
| `started-no-finish.html` | App users with in-progress tracks but no completion | `Your song is two taps away` | `Finish your song ›` | same |
| `completed-before.html` | App users who've shipped at least one song | `Make her one too` | `Make her one too ›` | same |
| `cold-intro.html` | External early-list (not yet Porizo users) | `The card she'll keep forever` | `Make her song free ›` | same |

Reply-to: `support@porizo.co`. Never `noreply`.

---

## Variable substitution

Templates use `{{first_name}}` — Resend's `send-email` MCP/CLI does NOT substitute these automatically. Substitution must happen per-recipient before the API call.

**Fallback when `display_name` is null:**
```sql
COALESCE(NULLIF(SPLIT_PART(display_name, ' ', 1), ''), SPLIT_PART(LOWER(email), '@', 1))
```

Test send: send each template to `abcobimma@gmail.com` with `first_name="Ambrose"` substituted, verify in Resend dashboard the rendered HTML has no `{{...}}` tokens.

---

## Audio embed

All templates point at `https://porizo.co/audio/sample-mothers-day-2026.mp3` (21s, 448KB, deployed to Railway 2026-05-09).

Cross-client behavior:
- **Apple Mail (iOS/macOS):** native HTML5 `<audio>` plays inline
- **Gmail web:** native `<audio>` plays inline
- **Gmail mobile, Outlook, Yahoo:** `<audio>` is stripped → users see the fallback link `▶ Tap if the player above doesn't show` opening the .mp3 in a browser tab

---

## Send schedule (recommended throttle)

All UTC. Today is Saturday 2026-05-09. Mother's Day is tomorrow.

| Order | Cohort | Window (UTC) | EST equivalent | Throttle |
|---|---|---|---|---|
| 1 | `no-song` | 19:00–19:45 | 3:00–3:45 PM | mild stagger over 45 min |
| 2 | `started-no-finish` | 19:30–20:15 | 3:30–4:15 PM | mild stagger over 45 min |
| 3 | `completed-before` | 20:00–20:45 | 4:00–4:45 PM | mild stagger over 45 min (optional — user may skip this cohort) |
| 4 | `cold-intro` | 20:30 onward | 4:30 PM onward | **17 emails/min** (≈ 1 every 3.5 sec) for deliverability |

For cohort 4 (cold-intro), use Resend's `scheduled_at` parameter to stagger across the window.

---

## Pre-send checklist

1. ☐ Audio URL returns 200: `curl -sI https://porizo.co/audio/sample-mothers-day-2026.mp3` (verified 2026-05-09 14:30 UTC)
2. ☐ Run cohort SQL queries against production DB (read-only)
3. ☐ Confirm recipient counts are sane (50–5000 per cohort)
4. ☐ Send 4 test emails to `abcobimma@gmail.com` (one per cohort), verify rendering
5. ☐ Check Resend deliverability insights — fix all `Needs attention` items
6. ☐ Get explicit Ambrose approval on cohort name + count + subject
7. ☐ For cohort 4 (cold-intro): pilot 50 recipients first, watch open rate 30 min, then send rest

---

## Cohort SQL — read-only previews

### Cohort 1 (no-song)
```sql
SELECT DISTINCT
  u.id AS user_id,
  LOWER(TRIM(u.email)) AS email,
  COALESCE(NULLIF(SPLIT_PART(u.display_name, ' ', 1), ''), SPLIT_PART(LOWER(TRIM(u.email)), '@', 1)) AS first_name
FROM users u
WHERE u.email IS NOT NULL AND u.email LIKE '%@%'
  AND u.email NOT ILIKE '%test%' AND u.email NOT ILIKE '%example.com%'
  AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.user_id = u.id AND t.status IN ('ready','preview_ready'))
  AND NOT EXISTS (
    SELECT 1 FROM track_versions tv JOIN tracks t2 ON t2.id = tv.track_id
    WHERE t2.user_id = u.id AND tv.status IN ('full_ready','preview_ready','ready')
  );
```

### Cohort 2 (started-no-finish)
Same as cohort 1 BUT also requires `EXISTS (SELECT 1 FROM tracks WHERE user_id = u.id AND status NOT IN ('ready','preview_ready'))`.

### Cohort 3 (completed-before)
```sql
SELECT DISTINCT
  u.id AS user_id,
  LOWER(TRIM(u.email)) AS email,
  COALESCE(NULLIF(SPLIT_PART(u.display_name, ' ', 1), ''), SPLIT_PART(LOWER(TRIM(u.email)), '@', 1)) AS first_name
FROM users u
WHERE u.email IS NOT NULL AND u.email LIKE '%@%'
  AND u.email NOT ILIKE '%test%' AND u.email NOT ILIKE '%example.com%'
  AND (
    EXISTS (SELECT 1 FROM tracks t WHERE t.user_id = u.id AND t.status IN ('ready','preview_ready'))
    OR EXISTS (
      SELECT 1 FROM track_versions tv JOIN tracks t2 ON t2.id = tv.track_id
      WHERE t2.user_id = u.id AND tv.status IN ('full_ready','preview_ready','ready')
    )
  );
```

### Cohort 4 (cold-intro)
External list — not from production DB. Source TBD (early-list signups, prior outreach, etc.). Always dedupe against existing Porizo users before sending.

---

## After-send tracking

Capture for each cohort: Resend batch ID, recipient count, scheduled start/end, 24h open/click/reply rates, 7d unsubscribe count. Log to `marketing/emails/sent/2026-05-09-<cohort>.log`.

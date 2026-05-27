# In-App Event — Father's Day Song for Dad (2026)

Created 2026-05-24. Source strategy: `organic-demand-discovery-2026-05-24.md` (Set 3 seasonal_sprint).

**Why this event:** Porizo ranks **#116** for `father's day song` and **#85** for `father's day song for dad` despite high relevance and live web pages. The keyword field can't move a seasonal term this far; an indexed in-app event can. US Father's Day 2026 = **Sunday, June 21**.

**Target keywords** (all indexed via the event copy below):
`father's day song`, `father's day song for dad`, `song gift for dad`, `custom song for dad`, `make a song for dad`.

---

## Copy (within Apple App Store Connect limits)

| Field                      | Limit | Value                                                                                                            | Used |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- | ---- |
| Reference name (internal)  | 64    | `Fathers Day 2026 — Song for Dad`                                                                                | 31   |
| **Event name** (displayed) | 30    | `Father's Day Song for Dad`                                                                                      | 25   |
| **Short description**      | 50    | `A custom song gift for Dad, from one memory`                                                                    | 43   |
| **Long description**       | 120   | `Make Dad a custom song from one real memory. Preview it free, finish in minutes, and gift it for Father's Day.` | 109  |

**Keyword coverage check** (Apple combines tokens across name + short + long; stop-words like "for"/"a" ignored):

- `father's day song` ✓ — event name
- `father's day song for dad` ✓ — event name
- `song gift for dad` ✓ — short desc (`song gift … for Dad`)
- `custom song for dad` ✓ — long desc (`custom song … Dad`)
- `make a song for dad` ✓ — long desc (`Make Dad a … song`)

**Emotional-lead alternative for short description** (if conversion > keyword density is preferred):
`One memory becomes a song he'll keep forever` (44 chars)

---

## Event configuration

| Setting             | Value                      | Notes                                                |
| ------------------- | -------------------------- | ---------------------------------------------------- |
| Badge               | **Special Event**          | Seasonal promo; not Live/Premiere/Challenge.         |
| Associated category | Music                      | Matches app category.                                |
| Event start         | **2026-06-06**             | ~2 weeks before Father's Day; lets it surface early. |
| Event end           | **2026-06-21 23:59** local | Father's Day.                                        |
| Time zone           | Device/local               | So "ends Father's Day" is true everywhere.           |
| Purchase required   | No                         | First song is free — lead with that.                 |
| Eligibility         | New **and** existing users | Existing users can gift again.                       |
| Priority            | High                       | Only seasonal event in window.                       |

**Deep link** — leave **blank** (event opens the App Store product page).

VERIFIED 2026-05-27: the app's `apple-app-site-association` only claims
`/play/*`, `/s/*`, `/poem/*` as universal links (`src/server.js:514`). There is
**no `/app` route and no `?occasion=` handler**, so a "pre-select the Father's Day
flow" deep link is not possible today — it would 404 on the web and the app would
not intercept it. Do **not** set a custom event deep link; an unsupported one
either dead-ends or fails ASC validation.

To deep-link an IAE straight into a Father's Day create flow later, the app needs
(1) a universal-link path that carries the occasion (add it to the AASA `paths`
list + ship an app build that handles it) and (2) the matching in-app router case.
That's an app release, tracked as a future enhancement — not a blocker for this
event. The event's pull comes from the copy + the free-first-song promise; users
land on the product page and create a Dad song in-app.

---

## Asset required (not yet produced)

- **Event card image**: 1920×1080 (16:9), no text baked in that duplicates the displayed copy, on-brand Warm Canvas palette. PNG/JPG, no alpha.
- Optional event card video: 16:9, 6–30s.

---

## Publishing timeline

- IAEs require App Store review (typically reviewed alongside or independent of a build).
- Can be **published up to 14 days before** the start date and surface on the product page immediately.
- **Action:** submit by ~2026-06-01 to guarantee it's live for the full pre-Father's-Day window.

## Measurement (per discovery doc, weekly)

- Rank movement for `father's day song` (#116 → target top 50), `father's day song for dad` (#85).
- Event impressions, product-page views, first-time downloads attributable to the event.
- `/download` events with `utm_campaign=fathers-day-2026`.

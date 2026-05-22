# Organic Growth Loop — 2026-05-22

Goal: increase organic App Store search visibility and web-to-app traffic for
Porizo by making the product legible as a personalized song gift, then stealing
traffic from apps that already rank for adjacent intent.

## Positioning Decision

Primary lane: personalized song gifts by occasion and relationship.

Support lane: AI song generation only where it has gift intent, such as
`ai song for dad`, `ai song for mom`, and `personalized ai song`.

Avoid: fighting head-on for broad `ai song generator` and `custom song` until
Porizo has materially more ratings and review proof.

## Live Baseline

Captured 2026-05-22 with Kickstart and OpenASO.

| Query | US rank | Interpretation |
| --- | ---: | --- |
| `personalized song gift` | 1 | Defend. High relevance, high entry barrier behind us. |
| `birthday song gift` | 1 | Defend. Good core lane. |
| `anniversary song gift` | 1 | Defend. Good core lane. |
| `song gift for dad` | 1 | Defend. Low entry barrier, high relevance. |
| `song gift for mom` | 1 | Defend. High relevance. |
| `custom song gift` | 2 | Attack #1. GiftSong is beatable. |
| `song gift` | 4 | Attack #1. WishAI/GiftSong own the exact phrase. |
| `gift song` | 8 | Attack #1. Low entry barrier; should move with metadata/reviews. |
| `personalized song` | 13 | Attack #2. AI-generator apps dominate. |
| `birthday song` | 25 | Attack #2. Birthday-song/card apps dominate. |
| `custom song` | 89 | Do not chase as primary. Suno/Muzio/Zona own it. |
| `father's day song for dad` | 77 | Seasonal P1. Needs IAE + metadata + web page. |
| `father's day song` | 106 | Seasonal P1. Top result has 0 ratings; opportunity is real. |
| `mother's day song` | 147 | Seasonal, out-of-window in US but still weak. |
| `birthday gift ideas` | not top 173 | Web-only capture, not App Store metadata. |
| `ai song generator` | not top 192 | Support only; too competitive for current proof level. |

## Competitor Sets

### Direct gift-song apps

Use these to steal exact gift/song traffic.

| App | App Store ID | Why it matters |
| --- | ---: | --- |
| WishAI:Gift Song & Music Maker | 6756296198 | #1 for `song gift`; only 3 ratings. |
| GiftSong: AI Song Maker | 6759814466 | #1 for `custom song gift`; only 2 ratings. |
| GiftSong | 6761984057 | #1 for `gift song`; only 2 ratings. |
| WishSong: Gift Song | 6766134624 | Appears across gift-song exact phrases. |
| SONGYFT | 1552364144 | Older direct song-gift brand with 29 ratings. |
| Songly: AI Songs & Greetings | 6747972309 | Direct gifting angle, but weak rating proof. |

Action: beat these with clearer title/subtitle, better screenshots, Father’s
Day event coverage, and review velocity.

### AI-generator apps

Use these to understand creative/keyword trends, not as the main promise.

| App | App Store ID | Why it matters |
| --- | ---: | --- |
| Suno - AI Songs & Music | 6480136315 | Owns broad `custom song` and `ai song generator`. |
| Muzio | 6502530415 | Owns `personalized song`. |
| MyTunes | 6447001239 | Ranks inside gift-song and custom-song results. |
| Zona | 6499261254 | Strong in `custom song`. |
| Mozart | 6502656704 | Ranks in gift and AI lanes. |
| Donna | 6482289804 | Very high review count in AI song lane. |

Action: use their AI keywords as discovery/supporting metadata and web bridge
pages only. Do not let them define Porizo’s main App Store promise.

### General gift/card apps

Use these for web content strategy, not App Store metadata.

Giftful, Zazzle, Givingli, TouchNote, FreePrints Gifts, Ink Cards, Giftster,
GoWish, Birthday Countdown, and birthday/mother/father card apps own broad gift
queries with thousands of ratings.

Action: capture `birthday gift song idea`, `unique gift for dad song`,
`personalized anniversary gift song`, and similar long-tail searches through
Google-visible pages, not broad App Store keyword stuffing.

## Implemented Controls

- Kickstart now tracks 16 US competitor keywords covering defend, attack,
  seasonal, and AI-support lanes.
- OpenASO now tracks the expanded portfolio across US, GB, AU, and CA.
- Fastlane metadata source is pivoted to:
  - Name: `Porizo: Song Gift Maker`
  - Subtitle: `Birthday, Love & Wedding`
  - Keywords: family, seasonal, relationship, voice, and `ai` as support.
- Web graph now has a `/gifts/` index target for all gift-page breadcrumbs.
- Homepage, blog, and programmatic gift pages now expose Smart App Banner
  metadata and attributed `/download` links.

## Weekly Checkback Protocol

Run this every Friday.

1. Kickstart: refresh tracked keywords and record rank deltas for the 16 terms.
2. OpenASO: score keywords for US, GB, AU, CA and list new competitors.
3. Web: check Google/Bing for `site:porizo.co/gifts` coverage and generic
   queries like `father's day song gift`, `birthday song gift`, and
   `personalized song gift`.
4. App Store Connect: record App Store Search impressions, product page views,
   first-time downloads, and conversion rate.
5. Backend: record `/download` events by `utm_medium` and `utm_campaign`.
6. Decide one next action:
   - move rank 4-20 terms into title/subtitle/keyword rotation,
   - create a web page for a competitor/query gap,
   - update screenshots for the term that is getting impressions but no taps,
   - or push review-generation work if ranking improves but conversion does not.

## One-Week Success Criteria

- `gift song`: improve from #8 toward top 5.
- `song gift`: improve from #4 toward top 3.
- `father's day song`: move from #106 into top 50 after event/metadata is live.
- `/gifts/` returns 200 in production and appears in sitemap.
- Organic web `/download` events are attributable by homepage, blog, and
  programmatic page campaigns.
- App Store Search impressions increase week over week.

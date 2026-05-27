# Custom Product Page — `dad-song-gift`

Created 2026-05-27. Purpose: a Father's-Day / song-for-Dad conversion surface for
**routed traffic** (Apple Search Ads, the cold-email Father's Day CTA, paid social,
and the `/download` Father's-Day links). Pairs with the Father's Day in-app event.

## What a CPP is (and is not)

A Custom Product Page changes **only** three things vs the default listing, for
visitors who arrive via the CPP's unique URL:

1. **Screenshots** (and optional app preview videos)
2. **Promotional text** (170 chars)
3. (optional) **App preview video**

It does **NOT** change the app **name, subtitle, keyword field, or description** —
those stay global. A CPP also **does not affect organic Search ranking**; it only
changes the _first impression_ for traffic you point at it. You get up to 35 CPPs;
each has a unique URL (`…?ppid=<id>`). Route Father's-Day ad/email/web traffic to
that URL so dad-intent visitors see a dad-specific story instead of the generic one.

> Important: the in-app **event** deep link cannot point at a CPP. CPPs are for
> **Apple Search Ads, web/email, and paid social** destinations. The IAE and the
> CPP are complementary, not linked.

## CPP metadata

| Field                     | Value                                                                                                                                                     | Limit            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Reference name (internal) | `Dad Song Gift — Father's Day`                                                                                                                            | 64               |
| **Promotional text**      | `This Father's Day, turn one real memory of Dad into a song he'll keep. Tell the story, pick the sound, preview it free — finish and gift it in minutes.` | 170 (this = 152) |

Promo text alt (shorter, punchier):
`A song for Dad from one real memory. Tell it, hear it, gift it — first song free, ready in minutes for Father's Day.` (115)

## Screenshot plan — 5 slides (Dad narrative)

Mirrors the existing Warm Canvas arc (`hero → tell → pick → hear → share`) but
reframed entirely around Dad + Father's Day. Same visual system: warm cream/beige
background (`#F5F0EB`), Georgia/serif headline, gold accent (`#B0763F`), device
frame, one short headline per slide (overlay text — keep ≤ ~6 words so it reads at
thumbnail size in Search).

| #        | Headline (overlay)                  | Subcopy (optional, small)                | App screen to capture                                           | Capture fixture                                            |
| -------- | ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| 1 — Hero | **A song for Dad, from one memory** | First song free                          | Reveal/now-playing with occasion artwork, recipient = Dad       | `--fixture-reveal-ready --bypass-auth`                     |
| 2 — Tell | **Tell it one memory of Dad**       | The fishing trip. His advice. His laugh. | Story/seed input screen, recipient = Dad, Father's Day occasion | `--fixture-creating --bypass-auth` (or seed recipient=Dad) |
| 3 — Pick | **Pick how it should sound**        | Any genre, your voice optional           | Style / voice picker screen                                     | `--bypass-auth` → navigate to style step                   |
| 4 — Hear | **Hear Dad's song in minutes**      | 45–90 sec, made just for him             | Player full view with waveform + artwork                        | `--fixture-reveal-ready --bypass-auth`                     |
| 5 — Gift | **Send a gift he'll replay**        | He can play it without the app           | Share screen (recipient = Dad)                                  | `--fixture-reveal-ready --bypass-auth` → Share             |

Narrative logic: **emotional hook → how easy the input is → control/personalization
→ the payoff → the giftable outcome.** Slide 1 leads with the emotional promise
(not the mechanic) because dad-gift searchers are buying a feeling; slide 5 closes
on "giftable, plays without the app" — the differentiator vs a generic song maker.

### Recipient/occasion seeding

For authenticity, slides 2/5 should show **recipient "Dad"** and the **Father's Day**
occasion. If the fixture flags don't seed recipient text, either (a) extend the
fixture seeding in `ShareController.swift` (the `seed deterministic share state`
path) to accept a recipient name, or (b) drive the flow manually with `--bypass-auth`
and type "Dad" before capturing. Generic screens with Dad-framed overlay copy still
work if seeding is out of scope.

## Sizes & specs

- **Required:** 6.9" iPhone — **1290 × 2796** px, RGB, no alpha, ≤ 10 slides.
- Optional (Apple down-scales 6.9" if omitted): 6.5" (1242 × 2688), 6.1", iPad 13".
- Match the existing frame template used for `current/6.9/porizo-*.png` so the CPP
  set is visually consistent with the default listing.

## Production (reuse the existing pipeline)

1. Build/run on the 6.9" simulator (iPhone 16 Pro Max), launching with the fixture
   flags above (`--bypass-auth` to skip login per the project's screenshot flow).
2. Capture each raw screen → `marketing/appstore/screenshots/cpp-dad/raw/`.
3. Frame + add overlay headlines with the Warm Canvas template (same tool that
   produced `current/6.9/porizo-*.png`) → `marketing/appstore/screenshots/cpp-dad/6.9/`.
4. Name them `01-hero … 05-gift` to preserve slide order on upload.

## Submit & route

1. ASC → app → **(Custom Product Pages) → Create** → reference name `Dad Song Gift — Father's Day`.
2. Upload the 5 Dad screenshots (6.9" required) + set the promotional text above.
3. Submit the CPP (reviewed with the next app version or standalone).
4. Copy the CPP URL (`…?ppid=<id>`) and use it as the destination for:
   - the Father's Day **Apple Search Ads** ad group(s) (`father's day song`, `song gift for dad`, `custom song for dad`),
   - the **cold-email** Father's Day CTA (`utm_campaign=fathers-day-2026`),
   - any paid social / `/download?...&ppid=<id>` Father's-Day links.

## Measurement (weekly, per discovery doc)

- CPP **product-page views → conversion rate → first-time downloads** (ASC, segment by CPP).
- Compare CPP conversion vs the default page for the same Father's-Day ad traffic.
- `/download` + ASA installs attributed to the Father's-Day campaign.
- Target: CPP conversion **> default page** for dad-intent traffic (the whole reason it exists).

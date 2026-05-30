# Custom Product Page — `dad-song-gift`

Created 2026-05-27. Purpose: a Father's-Day / song-for-Dad conversion surface for
**routed organic and owned traffic** (web SEO pages, cold-email Father's Day
CTAs, creator/partner links, and the `/download` Father's-Day links). Pairs with
the Father's Day in-app event.

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
> **web/email, creator, partner, and organic landing-page** destinations. The IAE and the
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

## Sizes & specs

- **Required:** 6.9" iPhone — the generator outputs **1320 × 2868** px (Apple
  accepts the 6.9" range); RGB, no alpha, ≤ 10 slides.
- Also generated: 6.5" (1284 × 2778), 6.3" (1206 × 2622), 6.1" (1125 × 2436).
- Visually consistent with the default listing because it's the same generator.

## Production (web generator, NOT the simulator)

The App Store screenshots are **not** captured from the iOS simulator. They are
rendered by a Vite + React design system at
`marketing/appstore/screenshots/generator-designed/` (device frame + headline +
in-app mockup as HTML/CSS), screenshotted by puppeteer, and resized by sharp.

A `variant` mechanism drives per-CPP sets:

1. `Generator.tsx` — `HEADLINES.dad` holds the 5 Father's-Day headlines, and
   module-level `RECIPIENT`/`OCCASION_LABEL`/`OCCASION_EMOJI` (read from
   `?variant=`) swap the in-phone mockup copy to "Dad / Happy Father's Day".
2. Run the generator:
   ```bash
   cd marketing/appstore/screenshots/generator-designed
   node_modules/.bin/vite --port 5174 &           # dev server
   VARIANT=dad PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     node capture.mjs
   ```
   (Puppeteer's bundled Chrome wasn't installed, so point it at the system Chrome.)
3. Output lands in `generator-designed/exports-dad/<size>/porizo-<slide>.png`.
   The committed/tracked copy is mirrored to `cpp-dad/6.9/` — note the whole
   `marketing/appstore/screenshots/` tree is gitignored, so the generator + outputs
   are a **local tool**, not version-controlled. Regenerate with the command above.
4. Slide order for upload: hero → pick → tell → hear → share.

To spin up another CPP (e.g. Mom, anniversary), add a variant to `HEADLINES` +
extend the `RECIPIENT`/`OCCASION` ternaries, then `VARIANT=<name> node capture.mjs`.

## Submit & route

1. ASC → app → **(Custom Product Pages) → Create** → reference name `Dad Song Gift — Father's Day`.
2. Upload the 5 Dad screenshots (6.9" required) + set the promotional text above.
3. Submit the CPP (reviewed with the next app version or standalone).
4. Copy the CPP URL (`…?ppid=<id>`) and use it as the destination for:
   - the **cold-email** Father's Day CTA (`utm_campaign=fathers-day-2026`),
   - creator/partner Father's-Day links,
   - web SEO landing-page CTAs that already qualify dad-song intent,
   - any `/download?...&ppid=<id>` Father's-Day links.

## Measurement (weekly, per discovery doc)

- CPP **product-page views → conversion rate → first-time downloads** (ASC, segment by CPP).
- Compare CPP conversion vs the default page for the same Father's-Day web/email/creator traffic.
- `/download` events and first-time downloads attributed to the Father's-Day campaign.
- Target: CPP conversion **> default page** for dad-intent traffic (the whole reason it exists).

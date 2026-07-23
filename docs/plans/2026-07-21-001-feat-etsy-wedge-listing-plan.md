---
title: "feat: Etsy wedge listing — pre-listing work plan"
date: 2026-07-21
type: feat
origin: docs/plans/2026-07-14-001-feat-web-first-pivot-execution-plan.md (WS-A.1)
depth: deep
status: ready-to-execute
---

# Etsy Wedge Listing — Pre-Listing Work Plan

> **Superseded fulfilment detail (2026-07-23):** the launch architecture is
> Option 2.5 in
> `docs/plans/2026-07-23-002-fix-etsy-code-wedge-mode-plan.md`. Launch uses a
> made-to-order/manual SLA, one audited code per paid receipt, generic
> `/etsy/code` entry, and verified-account ownership. References below to
> instant delivery, guest redemption, generic batches, or `?code=` URLs are
> retained as historical rationale and are not implementation instructions.

Operationalizes **WS-A.1** of the web-first pivot: list "Personalized Song Gift" at
**$19.99**, fulfil manually, and read a real willingness-to-pay signal before spending
a dollar on paid traffic.

**What changed since WS-A was written:** the web funnel shipped. Etsy is no longer the
only way to take money — so its job narrows to one thing it still does better than we
can: **borrowed demand**. Etsy already aggregates people actively shopping for a custom
song gift. We are renting that intent for ~12% of revenue.

---

## 0. Verified facts this plan rests on

Everything below was read from Etsy's own policy pages on 2026-07-21, or from this
repo's source. Practitioner/blog claims are marked. Anything unconfirmed says so.

### Unit economics — VERIFIED

Rates: listing **$0.20** · transaction **6.5%** · AU payment processing **3% + A$0.25**
domestic / **4% + A$0.25** international ([fees](https://www.etsy.com/legal/fees/),
[AU payments](https://www.etsy.com/au/payments)).

| Scenario               | Fees  | Net        | Etsy take |
| ---------------------- | ----- | ---------- | --------- |
| AU domestic buyer      | $2.35 | **$17.64** | 11.8%     |
| International buyer    | $2.55 | **$17.44** | 12.8%     |
| Intl + Offsite Ads 15% | $5.55 | **$14.44** | 27.8%     |

- After ~$0.25 render COGS: **~$17.39/sale, ~87% margin**. Gate A (10 sales) ≈ **$174 net**.
- **Offsite Ads are optional for us.** Mandatory only above **US$10,000** trailing sales.
- **Regulatory Operating Fee does NOT apply to Australia** — VERIFIED against the
  country table (Canada, France, Hungary, Italy, India, Spain, Türkiye, UK, Vietnam only).
  [Source](https://help.etsy.com/hc/en-us/articles/1500011073202-What-is-a-Regulatory-Operating-Fee)
- Etsy's take is ~12% vs Apple's 30%. Etsy economics are **better than our App Store IAP**.

### Policy — VERIFIED

**AI songs are explicitly allowed, with mandatory disclosure.**
[Creativity Standards](https://www.etsy.com/legal/creativity/) permit _"Seller-prompted
AI creations: Creations that were generated using AI tools… based on a seller's original
prompts. Sellers must disclose within their listing description if an item is created
with the use of AI."_ We sit in **"Designed by a seller" → digital downloads of original
designs**, which names **audio** outright.

**Off-platform rules target transactions, not delivery.**
[Policy](https://www.etsy.com/legal/policy/off-platform-transactions/1254654515806)
(updated 09 Jun 2026) prohibits: offers to buy/sell outside Etsy · encouraging purchase
through another venue · **"Using a QR code to direct users off of the Etsy platform"** ·
completing an Etsy-initiated transaction off Etsy (elaborated entirely as _extra payment
after checkout_).

> **Correction to prior research.** An earlier brief quoted a prohibition on exchanging
> _"external URLs… for this purpose"_ and built an AMBIGUOUS verdict on that qualifier.
> **That text does not appear in the live policy.** The real rule is narrower and
> transaction-scoped — which lowers link risk — but it **explicitly names QR codes**,
> which kills any scannable-plaque/QR creative direction. Do not reintroduce QR.

**Consequence for the test design:** a playback link that delivers an already-paid-for
product solicits no off-platform transaction. Risk is lower than previously briefed but
not zero (enforcement is automated). Phasing below reflects that.

### Creative specs — VERIFIED

**Images** ([source](https://help.etsy.com/hc/en-us/articles/115015663347-Requirements-and-Best-Practices-for-Images-in-Your-Etsy-Shop), fetched verbatim 2026-07-21):

| Spec             | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Recommended      | **≥2000px width AND height**                             |
| Minimum, image 1 | **635×635** — below this you "show up lower in searches" |
| File size        | **>1MB "may not finish uploading"**                      |
| File types       | `.jpg .gif .png .svg .heic` only                         |
| **Transparency** | **NOT supported — transparent PNG areas render BLACK**   |
| Animated GIF     | Not supported                                            |
| Max images       | 10                                                       |

- **Image 1's shape dictates the shape of every following photo** — decide once, apply to all 10.
- A main image that is "too dark, blurry, or part of a photo-collage" ranks lower.
  **→ no collage in slot 1.**
- Etsy contradicts itself on orientation on the same page: _"The first photo should be
  horizontal (landscape) or square"_ vs _"Avoid square crops. Upload horizontal or
  landscape images."_

**⚠️ THE CROP RULE — the most important creative constraint.** Etsy crops image 1 into
**three different shapes**. Verbatim: _"Make sure that your thumbnail images have enough
of a border that they can be cropped to **square, portrait, and landscape** thumbnails
without losing some of the product… Position your image so your subject is clear in
**all 3 views**."_

> **Correction to this plan's first draft.** It said the grid crops to "~570×456 (5:4),
> keep subject in the middle 70%" — sourced from a third-party blog. **That was wrong:**
> it describes one of three crops. A parallel measurement of live Etsy assets found the
> search grid serving `il_255x319` / `il_510x638` / `il_765x956` — all **4:5 portrait** —
> with the listing page rendering square. I could **not independently reproduce** that
> measurement (Etsy 403s automated fetches), so **"the grid is exactly 4:5" stays
> UNVERIFIED**. It does not change the work: designing for _all three crops_ is correct
> under either answer, and Etsy's own text mandates it.

**Design rule (safe under every crop):**

- **Upload 2000×2000 square, JPEG, sRGB, <1MB.** Square matches the listing-page render
  and crops cleanly to both portrait and landscape.
- **Safe zone = the central 4:5 region** (middle ~80% of width, full height). All meaning
  — recipient name, headline, faces, player UI — lives inside it.
- **Treat the outer left/right margins and the top/bottom strips as dead.** Corner-anchored
  badges get clipped; a live competitor listing was observed with a "SHIP IN 2 DAYS" badge
  visibly cut off by exactly this crop.
- Use Etsy's **Adjust Thumbnail** tool on every listing and check all 3 previews.

**Video** ([source](https://help.etsy.com/hc/en-us/articles/360053206073-How-to-Add-Listing-Videos)):
**3–15s** · ≤**100MB** · min 500px, **≥1080px ideal** · **2 per listing** ·
MP4/MOV/FLV/AAC/AVI/3GP/MPEG · **"will not contain any audio once uploaded."**

Observed on a live listing (⚠️ single-source, not independently reproduced): Etsy
transcodes with `ac_none` (audio removed) and `du_15` (15s cap) baked into the asset URL;
the player renders **`muted:true, autoplay:false, loop:false, controls:false`** and sits in
**slot 2**, immediately after image 1. A square video was accepted in practice despite the
docs suggesting 2:1.

> **The defining constraint of this listing.** We sell audio on a surface that **mutes our
> product, does not autoplay it, and hides the controls.** The buyer will never hear the
> song before paying. Every creative decision follows from this: the listing must convey
> _the feeling of receiving a song_ entirely through images and burned-in text.

### Repo assets — VERIFIED by reading source

| Asset                   | Location                                     | State                                                                                                  |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Cover/artwork generator | `src/services/cover-generator.js`            | 15 occasion themes, 5-tier name typography (`fitName`), `by {sender}`, Fraunces font, 3000×3000 master |
| Aspect-ratio map        | `cover-generator.js:501` `TARGET_DIMENSIONS` | `9:16`, `1.91:1`, `1:1` — **no Etsy ratio yet**                                                        |
| AI artwork + library    | `song-artwork.js`, `artwork-prompts.js`      | Working, content-hashed                                                                                |
| Video pipeline          | `marketing/remotion/`                        | 25+ comps, `PhoneMockup`, `ProductDemo`, `EndCard`                                                     |
| Demo footage            | `marketing/product demo/`                    | "Thank you mom" lyric-reveal — **legible silent**                                                      |
| Preview MP3             | `server.js:2391` `/preview/:id.mp3`          | Serves `audio/mpeg`                                                                                    |
| Full song               | `server.js` `GET /full/:trackVersionId.m4a`  | **`.m4a` only — no `.mp3` route**                                                                      |

> **⚠️ CORRECTED 2026-07-23 (route build surfaced this; verified against
> `runner.js:855-880`).** This section previously said _"MP3 is pipeline-native — no
> transcoding work is required."_ That was **wrong at the final-artifact layer**: the
> `.mp3` files in the pipeline are _intermediates_ (instrumentals, guide vocals, provider
> output). The finished master is uploaded to storage **only as `full.m4a`**
> (`contentType: audio/mp4`), and preview only as `preview.m4a`. The `/preview/:id.mp3`
> and new `/full/:id.mp3` routes are correct code pointing at **objects that do not exist
> in prod storage** — they will 404/502 until the render pipeline transcodes and uploads
> the `.mp3` variants. That is **Task 3b (blocking before launch)**: Etsy buyers download
> MP3. This is the byte-flow-contract lesson again — a verified endpoint is not a
> verified artifact.

### Still UNVERIFIED — do not treat as known

- ~~Competitor titles, prices, turnaround benchmarks.~~ **✅ RESOLVED — see §0.6 below.**
- **Etsy's mobile share.** ✓ Etsy's FY2025 10-K states **45% of GMS via the Etsy app**
  (up from 42%) — app alone, so mobile+app is a clear majority. The higher "60–68%"
  figures circulating are third-party, not Etsy-stated. Design for the phone regardless.
- **Enforcement statistics for AI disclosure** ("12,000 listings removed Q1 2026", "8,500
  warnings", "enforcement began Jan 14 2026") — these appear only on SEO-marketing blogs,
  each citing different numbers, with **no Etsy source**. **Treat as fabricated.** The
  disclosure _requirement_ is real and verified; the enforcement stats are not.
- **VAT/GST on manually-delivered digital goods.** Etsy's VAT collection is worded around
  _automatic downloads_; ours is made-to-order. Unresolved → Task 12.
- **Etsy Ads CPC** in this category. No budget committed until organic baseline exists.
- Whether AI tools count as "production partners" (my read: no — AI is handled via
  description disclosure — but unconfirmed).
- **Complaint themes.** ✗ Not properly verified — Etsy defaults to "Suggested" reviews
  (selection-biased toward positives) and worst-first sorting needs per-listing
  pagination. Treat §0.6's failure-mode read as a strong signal, not a finding.
- **Tags.** ✗ Not obtainable — Etsy does not render listing tags publicly. Needs an
  API v3 key.

### 0.6 MARKET TRUTH — ✓ VERIFIED live 2026-07-21 (Task 1 complete)

Method: Etsy hard-blocks non-browser fetches (DataDome — my own `fetch` got 403, and the
browser-harness Etsy skill documents this). All data below is from live pages rendered in
real Chrome via CDP. **n = 119 unique song-service listings** (from 748 search cards across
12 queries, physical merch filtered out), plus 20 shop pages. I independently reproduced
the price distribution on a 28-listing digital-only slice (median $19.74) and spot-verified
the review ceiling myself.

**⚠️ CORRECTION THAT REFRAMES THE WHOLE WEDGE — there is no incumbent.**
The July repositioning doc's "top AI-song shops have 13.2K and 6.1K reviews at $19.99"
is **✗ NOT VERIFIED and appears to be a conflation.** Those are _shop-lifetime sales
across all products_ (generalist digital-download stores that bolted on one song listing),
not song-listing reviews. **The deepest review moat on any custom-song listing in the
category is 136** (Edibellas) — I re-checked this myself: 136 reviews, 5.0 stars;
next is jewgotitart at 44. Most listings have 0–5. **This category has no incumbent to
displace.**

**Price (n=119):** min $6.99 · p25 $17.72 · **median $23.93** · p75 $38.41 · max $199.
Distribution: `<$15: 14 · $15–24: 34 · $25–39: 23 · $40–59: 13 · $60+: 6`.
→ **$19.99 sits mid-market — competitive, not cheap.** Hold it, but see the anchor note.

**Category grammar: permanent fake discounts.** ~60% of listings run an always-on
struck-through anchor ($23.75 from $95; $14.25 from $40.73). Real product-variation
upgrade ladders barely exist. → List **$19.99–24.99 against a ~$39–49 anchor**.

**Turnaround — our edge is real but narrower than assumed.** Unique-listing counts:
`within 24h ×11 · 24h ×8 · 12h ×5 · 48h ×6 · instant ×3 · same day ×3 · 1 hour ×2`.
**24-hour is table stakes**, sold in titles _and_ at headline scale in hero images.
Only ~2 listings mention minutes. The slow/expensive human end ($99, 7 days) has
**zero sales** — the market voted cheap-and-fast.
→ **Do NOT lead on "same-day"** — that's the crowded lane. Lead on **instant + self-serve**.

**🎯 THE STRUCTURAL ADVANTAGE — nobody on Etsy can let a buyer hear the product.**
66% of listings have video, but every one is transcoded `ac_none,du_15,q_auto:good` —
**audio stripped server-side.** Their videos are animated posters (filenames expose Canva
exports), not audio demos. This is platform-structural, not a seller choice.
**Our free web preview is uncopyable on Etsy.** It is also the strongest argument for
resolving the Phase-2 link question.

**⚠️ THE MECHANISM CAVEAT — this gates the speed claim (blocking).**
Competitors' "24 hours" is really a promise about _a human's DM response time_. Verified
intake patterns: post-purchase Etsy DM free-text (most common) · emailed questionnaire ·
**a PDF emailed off-platform** (3 manual steps before work starts) · external AI chat.
Almost nobody uses Etsy's structured personalization field for the story.
→ **"Ready in minutes" is only true if we capture the full brief at checkout with no DM
round-trip.** If the buyer must message us the name and story after paying, our real
turnaround is our reply latency and the claim is false — a conversion _and_ review risk.
**This is now Task 5's acceptance criterion, and it gates the slot-1 headline.**

**AI disclosure — required, and a differentiator.** Only **~25% (30/119) disclose**;
~75% appear non-compliant with a mandatory rule. Buyers leave 5 stars on openly
AI-disclosed listings. Best-performing wording pattern (used by the two most-reviewed
authentic shops) is **human-first, AI demoted to production**:

> _"If I use AI tools as part of the production, it's only to enhance the backing track —
> every song is personally customized with my own lyrics"_ (birthflowertattoos, 47 reviews)

Also common and worth copying if we use AI stock imagery in slots 3–10:
`*Listing images may feature AI-generated human models`.
→ Disclose **plainly and confidently**. The category's anxious hedging is a weakness we
can simply not have.

**Verbatim title patterns** (pipe/comma keyword stuffing; front-load "Custom/Personalized
Song", then occasion, then format):

> `Personalized Song for Dad, Custom Father's Day Gift, MP3 Audio (Digital Download)`
> `Create a Custom Song | Personalized Song | Custom Lyrics | ... | MP3 | Digital Download` (136 reviews — most-reviewed AND most stuffed)
> `Personalized Song Music Gift, Custom Song From Your Story, 24 Hrs Delivery, Custom Lyrics MP3+Printable Lyric Art, Birthday Anniversary Gift`

Recurring high-value tokens: **"From Your Story"**, "24 Hour Delivery", "Digital Download",
"MP3", "Last Minute", "Made Just for You", occasion lists.

**The canonical failure mode to design against: name mispronunciation.** The one complaint
that leaked past review selection-bias. Corroborating signal — the _entire_ category
advertises "lyrics approval before production" + "1–2 free revisions." They have all
learned a one-shot song fails often enough to need a human checkpoint. Praise clusters on
emotional accuracy ("made me cry"), speed, and seller responsiveness.

**Shop benchmark** (shop sales are all-products; song-listing reviews are the real signal):

| Shop                                    | Shop sales | Song-listing reviews   | Price  |
| --------------------------------------- | ---------- | ---------------------- | ------ |
| CMTImpressions                          | 118.6K     | 0                      | $21.75 |
| Edibellas                               | 17,868     | **136** ← category max | $10.00 |
| birthflowertattoos                      | 3,193      | 47                     | $18.00 |
| jewgotitart                             | 10,261     | 44                     | $44.91 |
| YourSongStory                           | 391        | 32                     | $26.58 |
| SongsWithJustin ($99, human-credential) | 0          | 0                      | $99    |

→ **Gate A's 10 sales is a realistic bar**, not a fantasy — but note even the volume
leader has 0 reviews on its song listing.

---

## 0.7 INTEGRATION & INPUT MODEL — ✓ VERIFIED by running the code

Answers the three questions that decide the whole build: **how much integration, does the
buyer flow through our pipeline, and what input do we actually need?**

### 0.7.1 What the pipeline genuinely requires — tested, not assumed

I ran `assessSongReadiness()` (`src/writer/song-readiness.js` — the real pre-flight gate)
against three input shapes:

| Input                                                                            | Result                           |
| -------------------------------------------------------------------------------- | -------------------------------- |
| **A.** recipient name + occasion only                                            | ❌ **BLOCKED** — `missing_story` |
| **B.** name + occasion + **one memory sentence**                                 | ✅ **READY**                     |
| **C.** name + occasion + relationship + style + memory + what-makes-them-special | ✅ **READY**                     |

**The gate is exactly one thing: usable story prose.** `hasStoryText` accepts any of
`completed_story_package.prose` · `narrative` · `message` · `specific_memory`
(`song-readiness.js:43-48`). A single plain-text sentence satisfies it. Name + occasion
alone does **not** — metadata is not a story.

**Therefore: the minimum viable Etsy brief is 4 fields + 1 story box.**

| Field                            | Required?                         | Maps to                          |
| -------------------------------- | --------------------------------- | -------------------------------- |
| Recipient name                   | ✅ yes                            | `recipient_name`                 |
| Occasion                         | ✅ yes (canonical key, not label) | `occasion`                       |
| **One memory / why this person** | ✅ **yes — this is the gate**     | `specific_memory`                |
| Relationship                     | recommended                       | `storyContext.relationship_type` |
| Style/genre                      | optional                          | `style`                          |
| **Name pronunciation**           | recommended                       | new — see Task 5b                |

Everything else `POST /tracks` accepts (`years_known`, `special_phrases`,
`what_makes_them_special`, `memory_answers`) is **optional enrichment** — it improves the
song, it does not gate it.

> **✅ THIS RESOLVES THE BLOCKING QUESTION.** Etsy allows **5 personalization fields
> (~256 chars each)**. Name + occasion + relationship + a 256-char memory fits with room
> to spare. **"Ready in minutes" is technically achievable with zero post-purchase DM.**
> The mechanism caveat in §0.6 is answerable — we just have to actually build it that way.

### 0.7.2 Does the buyer flow through our pipeline? — three options

**Etsy has no API for reading personalization on a paid order without an app + OAuth.**
Order data lives in Shop Manager. So the integration question is really: _who transcribes
the buyer's brief into our system, and when?_

|                   | **Option 1 — Manual (recommended for launch)**                                                                                    | **Option 2 — Redirect to our web funnel**                                                                            | **Option 3 — Etsy API app**                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Flow**          | Buyer fills Etsy personalization → we read it in Shop Manager → paste into admin/web form → render → upload MP3 to the Etsy order | Buyer buys on Etsy → delivered file contains a link to a Porizo intake page → they fill the real quiz → auto-renders | Etsy app + OAuth reads paid orders via API → auto-creates track → auto-renders |
| **Integration**   | **ZERO code**                                                                                                                     | Low — a token-gated intake page                                                                                      | High — OAuth app, Etsy review, webhooks, token refresh                         |
| **Buyer effort**  | Lowest — one form at checkout                                                                                                     | Two steps, post-purchase friction                                                                                    | Lowest                                                                         |
| **Turnaround**    | Minutes (our render is ~90s) **if we're at the keyboard**                                                                         | Minutes, fully self-serve                                                                                            | Minutes, fully self-serve                                                      |
| **Story quality** | Fixed 256-char fields                                                                                                             | **Best** — full conversational v3 writer                                                                             | Fixed fields                                                                   |
| **Risk**          | Doesn't scale past ~10/day; our reply latency is the real clock                                                                   | ⚠️ **Off-platform — gated on the Phase-2 question**                                                                  | Etsy app approval; heavy for a 3-week test                                     |

### ✅ DECIDED: Option 2 — redeem-code into the real funnel

**Owner's call (2026-07-21):** _"option 2 is better. we need a good first experience and
see if etsy works."_ Rationale accepted and it is the stronger test: Option 1 validates
only price, and does so behind a human bottleneck that would misrepresent our product.
Option 2 tests **the actual product experience** — the conversational writer, the free
preview, the delivery — which is what "does Etsy work for us" really asks.

**Do not build Option 3 before Gate A passes.** OAuth app + Etsy review is disproportionate
to a 3-week price test, and Option 2 already delivers the self-serve experience.

### 0.7.5 Option 2 architecture — ✓ VERIFIED, mostly already built

**The payment-free redemption path already exists.** `POST /web/orders`
(`src/routes/web-checkout.js:366`) accepts `payment_method: "gift_credit"` and creates a
**`status: "paid"`** order with `amountCents: 0`, `paymentSource: "gift_wallet"`,
`fundingModel: "gift_reservation_v1"` — funded by a gift credit instead of Stripe, then
handed to the **same orchestrator the Stripe path uses** (paid → rendering → delivered).
It is idempotent (`Idempotency-Key` required), reservation-backed
(`giftReservationService.reserveGiftCredit` + `adoptTrack` + `attachContent`), and
transactional.

**So the Etsy buyer does not need a new funnel, a new order type, or an entitlement
bypass.** They need one gift credit granted against a redemption code, then they walk the
existing production-proven funnel — the same path verified end-to-end with a real purchase
earlier this session.

**Flow:**

1. Buyer purchases on Etsy ($19.99).
2. We deliver (via Etsy's own file delivery) a small PDF/text containing a
   **one-time redemption code** + the link `porizo.co/etsy?code=XXXX`.
3. Code page validates the code → grants **1 gift credit** to a guest session → drops the
   buyer into the **existing `/create` quiz**, with the full conversational writer and the
   free preview.
4. At the offer step, the code path replaces Stripe checkout with
   `POST /web/orders {payment_method:"gift_credit"}` → existing orchestrator → delivered.
5. Code is burned on redemption (single use, idempotent).

**Build (small, because the hard parts exist):**

- **Redemption code table + mint/validate/burn** — single-use, one credit each. Generate a
  batch, paste one per Etsy order. _(This is the only genuinely new component.)_
- **`/etsy?code=` landing** → validate → grant credit → hand off to `/create`.
- **Offer-step branch** — when the session holds a redeemed credit, call the existing
  `gift_credit` order path instead of Stripe.
- Reuse everything else unchanged.

**⚠️ Compliance constraints on this design (non-negotiable — see §0.5 Policy):**

- The landing page at `porizo.co/etsy?code=` **must be a pure fulfilment surface**: no
  pricing, no "buy another", no storefront nav, no upsell. Etsy prohibits _"encouraging
  buyers to purchase an item in your Etsy shop through another venue"_ — a commerce-bearing
  landing page converts delivery into diversion. Delivery of an already-paid order is not
  prohibited; **selling is.**
- **No QR codes** — explicitly named in the off-platform policy. Plain URL + code only.
- Keep the code **redeemable without an account** (guest session), so the buyer is never
  forced into a signup wall to receive what they paid for.

> **This makes the Etsy support question (Task 2a) higher-value, not blocking.** Our read
> of the live policy is that fulfilment links are permitted; the written answer converts a
> reasoned position into a documented one. Launch on the reasoned position with a pure
> fulfilment page; escalate if Etsy says otherwise.

**✓ PRECEDENT — competitors already run Option 2 (verified live 2026-07-21):**

- **song2u** — verbatim from its live listing description:
  _"After you purchase, you'll receive a message with a link to start your story session
  with Bert, our AI song guide."_ Purchase on Etsy → link → intake on the seller's own
  site → delivered by email. **This is exactly our design.**
- **jewgotitart** (44 reviews) — posts an external `drive.google.com` link in its public
  description. Note what it does alongside: links for _more products_ point **back into
  Etsy** (`etsy.com/shop/jewgotitart`). That is the line, drawn by a seller with traction.
- **DinosDesignsShop** — instructs buyers to email a completed PDF to a personal address,
  then DM via Etsy. A full off-platform round-trip.

Not universal — YourSongStory and Edibellas keep everything on-platform (Edibellas uses a
questionnaire "if necessary"). **Prevalence is not permission**, and we cannot see what
gets quietly removed. But the pattern is category-normal, and **our version is more
conservative than what is live**: a pure fulfilment page with no pricing, no upsell and no
QR, versus a public Google Drive link in a competitor's description.

**The operative distinction, confirmed by both the policy text and seller behaviour:
delivering a paid order off-platform is tolerated; soliciting a sale off-platform is not.**
This is exactly why the pure-fulfilment constraint below is non-negotiable — it is the
thing keeping us on the delivery side of that line.

**Bonus:** Option 2 is the only option that also exercises the **recipient loop** — the
second prize the whole wedge was meant to test.

### 0.7.3 The honest constraint on the speed claim

Our render is fast (~90s preview, and the pipeline is MP3-native), so the bottleneck in
Option 1 is **human availability, not technology** — exactly the weakness we identified in
competitors. Two consequences:

- **On Option 2 the render is genuinely self-serve**, so speed is a property of the system,
  not of our availability. **"Ready in minutes" becomes an honest claim** — and it is
  essentially uncontested (only ~2 of 119 listings claim minutes vs 24+ at 24 hours).
- **The one remaining human dependency is the redemption code** in the delivered file.
  Etsy digital delivery is instant on payment, so this does not reintroduce reply latency —
  **provided codes are pre-minted in a batch, never generated per order on demand.**
  If we ever hand-write a code per sale, the claim silently becomes false again.

### 0.7.4 What we do NOT need to build

- ❌ No Etsy API integration for Gate A.
- ❌ No new render path — `POST /tracks` already accepts every field and derives the title.
- ❌ **No new payment-free order path** — `payment_method: "gift_credit"` already creates a
  `paid` order at `amountCents: 0` and reuses the production orchestrator.
- ❌ No new delivery mechanism — Etsy hosts the file; the recipient link reuses `/play`.
- ⚠️ Genuinely new: **redemption codes** (mint/validate/burn), the `/etsy?code=` landing,
  the offer-step branch, and the full-song `.mp3` route (Task 3).

---

## 1. Strategy — single phase, pure-fulfilment surface

**Superseded (2026-07-21).** The original plan staged this as _Phase 1 MP3-only → Phase 2
add the link_, to keep a policy ambiguity away from the price signal. **Option 2 collapses
that**: the redemption link is the delivery mechanism, so it ships at launch.

This is a deliberate, informed risk trade, and it is defensible because:

1. **Verified policy text targets transactions, not delivery.** The live Off-Platform
   policy (09 Jun 2026) prohibits offers to buy/sell elsewhere, purchasing _"through
   another venue"_, and QR codes. Delivering an already-paid order is none of these.
2. **The exposure is the landing page's behaviour, not the link's existence** — so we
   control it by design (below).
3. Option 1's "safety" was partly illusory: it would have tested a price at the cost of
   misrepresenting the product behind a human bottleneck.

**HARD DESIGN CONSTRAINT — `porizo.co/etsy?code=` is a pure fulfilment surface:**

- ❌ No pricing, no "buy another", no storefront nav, no upsell, no signup wall.
- ❌ No QR codes anywhere (explicitly named in policy).
- ✅ Redeemable as a guest — the buyer never has to create an account to receive what they
  already paid for.
- ✅ Its only job: validate the code, grant the credit, make the song.

**Escalation trigger:** if Etsy's written answer (Task 2a) contradicts this reading, fall
back to Option 1 (manual, MP3-only) rather than argue. The shop is the channel; the link
is an optimisation.

---

## 2. Work list

Ordered by dependency. **S** ≈ under an hour · **M** ≈ half day · **L** ≈ 1–2 days.

### Track A — Blocking research (do first; cheap, changes the rest)

- [ ] **1. Manual competitor browse** _(M)_ — search Etsy for `custom song`,
      `personalized song gift`, `song for mom`. Capture for the top ~10: verbatim title,
      price + upgrade ladder, stated turnaround, image-1 treatment, whether video is used,
      AI-disclosure wording, and the top complaint themes in reviews.
      **Output:** `marketing/channels/etsy/competitor-teardown.md`.
      **Why blocking:** title keywords, price, and turnaround promise all derive from this.
      Our $19.99 anchor is currently an untested assumption.
- [ ] **2. Draft the two Etsy support questions** _(S)_ — (a) playback link inside a
      delivered digital file; (b) VAT/GST on manually-delivered (non-automatic) digital
      items. Send early; replies gate Phase 2 and Task 12. Keep the written reply.

### Track B — Product gaps (small, verified)

- [x] **3. Full-song MP3 route** _(S)_ — DONE 2026-07-23 (opus build agent, TDD).
      `GET /full/:trackVersionId.mp3` in `server.js`, identical owner-gating to `.m4a`,
      `trackMasterKey format:"mp3"`, `contentType: "audio/mpeg"`. Test
      `test/routes/full-song-mp3.test.js` asserts 200 + `audio/mpeg` + body bytes ==
      upstream size (byte-flow), plus 401/403/404. 4/4 green.
- [x] **3b. Render pipeline uploads the `.mp3` master** — DONE 2026-07-23 (opus build
      agent, TDD; opus review: **SHIP IT, no P0/P1**). `uploadTrackMasterMp3` in
      `runner.js` transcodes via new `encodeToMp3` (192k/44.1k/stereo, mirrors
      `encodeToAAC`) and uploads under the exact keys both `.mp3` routes read — tests
      assert route-key == uploaded-key for preview AND full against the real runner fn.
      Idempotent (objectExists check-before-write); **non-fatal by construction** (whole
      body try/caught, awaited, m4a committed first — the Jul-18 unhandled-rejection
      class verified absent); READY barrier cannot be failed by mp3. Full suite 3384/0.
      **Known behavior:** the upload step is S3-gated, so local-fs dev never produces
      `.mp3` artifacts (mp3 routes 404 in local dev) — deliberate, matches the m4a path.
      **Still open before launch: post-deploy prod verification** — HEAD the real mp3
      object key for a fresh render; a verified endpoint is not a verified artifact.
- [ ] **4. Etsy aspect ratio** _(S)_ — add `"4:3": { width: 2700, height: 2025 }` (and/or
      a 2000×2000 `"1:1-etsy"`) to `TARGET_DIMENSIONS` in `cover-generator.js:501`.
      **Test:** `compositeArtworkWithText` at the new aspect emits correct dimensions and
      keeps the name inside the middle 70% (grid-crop safety).
- [ ] **5. Redemption codes — mint / validate / burn** _(M)_ — **the only genuinely new
      backend component** (§0.7.5). Single-use codes, each worth **1 gift credit**.
      Requirements: pre-mint in batches (never per-order on demand — that reintroduces the
      human latency the speed claim depends on avoiding); single-use enforced
      transactionally; idempotent redemption (a double-tap must not burn two codes or grant
      two credits); an admin view of issued/redeemed/unredeemed.
      **TDD:** test double-redemption, unknown code, already-burned code, and concurrent
      redemption of the same code **before** implementing.
- [ ] **5a. `/etsy?code=` landing + funnel handoff** _(M)_ — validate code → grant 1 gift
      credit to a **guest session** (no signup wall) → hand off to the existing `/create`
      quiz.
      **HARD CONSTRAINT (§1):** pure fulfilment surface — **no pricing, no "buy another",
      no storefront nav, no upsell, no QR.** A commerce-bearing page converts delivery into
      the prohibited "purchase through another venue."
      Invalid/burned code must fail into a human-friendly "contact us via Etsy" state, not
      a stack trace — this is a paying customer's first impression.
- [ ] **5c. Offer-step branch → `gift_credit` order** _(S)_ — when the session holds a
      redeemed credit, call the existing
      `POST /web/orders {payment_method:"gift_credit"}` (`web-checkout.js:366`) instead of
      Stripe. **Reuses the verified paid→rendering→delivered orchestrator — no new render
      or payment path.** Requires an `Idempotency-Key`.
      **Map the occasion to a canonical key** (`thank_you`), never the display label — this
      broke artwork once already (`tasks/lessons.md`, 2026-07-17).
      **Reuse the impersonation-pattern filter** on buyer text so "sound like [artist]"
      never reaches a prompt (IP exposure).
- [ ] **5b. Name-pronunciation capture + lyrics checkpoint** _(M)_ — the canonical failure
      mode in this category is **mispronounced names**, and the entire competitive set
      ships a "lyrics approval before production" checkpoint to absorb it. Add a
      pronunciation hint field to intake, and decide explicitly whether we ship an
      approval step or absorb the risk via fast free redos (Task 10's refund stance).
      Do not discover this on order #1.

### Track C — Listing creative (the design work)

**The visual grammar for selling audio** (from a live teardown of two ranking custom-song
listings, 21 Jul 2026 — ⚠️ single-source observation, treat as strong prior not fact):

Both top listings independently converge on the same device: **an emotional human photo
with generic music-player chrome overlaid.** The player UI (progress bar, ⏯, ♥) does the
semantic work — it says "this is a song" in ~200ms with zero reading. It is the closest
thing audio has to a product photo.

Ranked by observed persuasiveness:

1. **"Now playing" card over a human moment** — the category's strongest asset
2. **The listening REACTION shot** — a real person hearing their song. Shows the emotional
   payload rather than the deliverable; the single most persuasive image observed
3. **Phone-in-hand mockup** — proves tangibility
4. **Lyric sheet / lyric wall art** — gives audio a physical, giftable form
5. **Waveform art** — reads as "audio" but generic alone; use as texture inside a player
   card, weak as a hero
6. ~~Scannable code plaques / QR~~ — **prohibited** (off-platform policy) **and**
   trademark-exposed. Do not use.

**✓ VERIFIED anatomy of the category's best-performing slot 1** (CMTImpressions, 118.6K
shop sales — read pixel-by-pixel). Slot 1 is **never a product shot; it is a poster** —
an MP3 has nothing to photograph:

> golden-hour photo of a dad hugging his daughter, overlaid with —
> kicker `FOR THE MAN WHO TAUGHT ME EVERYTHING` / huge gold script **`A Song For Dad`** /
> `A PERSONALIZED SONG MADE FROM YOUR STORY` / three bullets (`100% PERSONAL` ·
> `WRITTEN AND PRODUCED WITHIN 24 HOURS` · `A GIFT THAT LASTS Forever`) /
> `TELL US YOUR STORY. We'll turn it into a song.` / **waveform + ▶ play button** /
> `YOUR STORY. YOUR SONG. HIS FOREVER.`

Near-universal category conventions: **warm amber/gold/brown palette**, gold script +
white sans, occasion named in the headline, **waveform + ▶ to signal "this is audio"**,
and **turnaround rendered at headline scale** (RamixMusic runs `DELIVERED IN 24 HOURS`
as the second-largest element on the frame).

> **⚠️ The turnaround line — say only what the mechanism supports (see §0.7.3).**
> "Ready in minutes, not days" is essentially uncontested (only ~2 of 119 listings mention
> minutes, vs 24+ competing on 24 hours), and §0.7 confirms intake _can_ complete at
> checkout. **But on Option 1 the bottleneck is a human at a keyboard, not the render.**
>
> - **Launch claim (Option 1, honest):** "Same day — usually within the hour", with
>   working hours stated in the description.
> - **"Ready in minutes" is earned on Option 2/3 only**, when fulfilment is genuinely
>   self-serve. Do not ship it before then — overclaiming turns our real advantage into a
>   review-risk liability, and reviews are the category's scarcest asset (max 136).

**Reads as cheap** (all observed on live competitor listings): grey stock DJ mixers and
studio desks (reads "gig service", not "gift") · walls of body copy unreadable on a phone ·
review screenshots pasted small with text truncated mid-sentence · clip-art music notes as
the main idea · obvious AI-stock couples.

> **Our unfair advantage: every competitor's slot 1 is stock imagery.** A real, named,
> finished song card — "For Mum, from Ella · 1:32" — is simultaneously more compelling
> **and** what Etsy policy requires (see Task 6). Our `cover-generator.js` already
> produces exactly this artifact.

- [ ] **6. Ten listing images** _(L)_ — composed from `cover-generator.js` output, not
      hand-designed. **All 10 square 2000×2000** (image 1 dictates the rest); every one
      obeys the central-4:5 safe zone.

      | # | Content | Why |
                                                                          | --- | --- | --- |
                                                                          | **1** | **Reaction/emotion shot + minimal player UI + ≤4 words**, showing a REAL named song | Carries ~90% of click decision; must survive the crop at ~177×221px. **Etsy policy: image 1 for a personalized item must show a finished, customized item — never a blank template or "Your Text Here" mockup** |
                                                                          | 2 | _(video occupies this slot automatically)_ | Silent, no autoplay |
                                                                          | 3 | **Deliverable made tangible** — phone-in-hand, lyric card | Answers audio's #1 objection: "what do I actually receive?" |
                                                                          | 4 | **How it works — 3 steps max, ≤6 words each, icons** | Both competitors drown this in text; brevity is our opening |
                                                                          | 5 | **ONE review, huge type, 5 stars** _(hold until real reviews exist — never fake)_ | A single blown-up review outperformed a six-review grid |
                                                                          | 6 | **What's included / format** — MP3, length, artwork, lyric sheet | Replaces "size guide" for a digital item |
                                                                          | 7 | **Speed** — "ready in minutes" | Our wedge vs 24h+ human songwriters |
                                                                          | 8 | **Occasion grid** — birthday / anniversary / wedding / Mother's Day | Serves browse intent; uses existing themes |
                                                                          | 9 | **Gift-presentation shot** | Makes the intangible feel like a gift, not a file |
                                                                          | 10 | **Guarantee / revisions** | Closes risk |

                                                                          ⚠️ UNVERIFIED: the widely-repeated "listings with 7+ photos rank better" claim has
                                                                          **no Etsy source**. Fill all 10 for objection-handling, not for a ranking signal.

                                                                          **Typography floor** (judged at ~177×221px, an ~11× downscale from 2000px):
                                                                          headline cap-height **≥160px (~8% of height), ≤4 words**; sub-line ≥100px, ≤6 words;
                                                                          anything under ~100px turns to mush. White type on a darkened photo with a scrim.

- [ ] **7. Silent listing video** _(M)_ — **3–15s**, 1080×1080 square, MP4, <100MB, recut
      from the "Thank you mom" lyric-reveal. **Must be fully legible with zero sound and
      no autoplay** — burn in lyrics/captions; assume the buyer taps it deliberately or
      never sees it. Verify the export against the spec table before upload.
- [ ] **8. Listing copy** _(M)_ — title/tags informed by Task 1. **Mandatory AI
      disclosure in the description**, high in the first screenful, e.g.: > _How it's made: I write the song brief and lyrics from your story, then use AI > music tools to compose and produce the track, and personally review, edit and > master every song before delivery._
      **Never** "handmade" / "hand-recorded" / implied human vocalist. No artist names —
      genre/mood only ("upbeat pop", "90s R&B slow jam"). State plainly: AI-produced
      vocals, length, MP3 format, delivery time. Description accuracy **is** our dispute
      defense (see Task 10).

### Track D — Shop setup & ops

- [ ] **9. Open the shop** _(M)_ — name ≤20 chars, no spaces. Identity verification via
      Persona: **photo ID name must match the bank account name**. AU bank requires a
      **residential address — PO boxes are rejected**. Enable 2FA.
      **Run all Etsy activity with the VPN OFF, one device, consistent IP.** VPN use reads
      as multi-country fraud and is a known new-shop suspension trigger.
- [ ] **10. Policies & refund stance** _(S)_ — **digital listings cannot set a return
      policy**; the physical "custom/personalized — no returns" option does not apply.
      Purchase Protection refunds items _not matching the description_; accurately
      described items that merely disappoint are ineligible. At ~$0.25 COGS, **refund
      fast and without argument** — a case damages the metrics that get new shops
      suspended, and costs more than the refund.
- [ ] **11. Fulfilment runbook** _(S)_ — order → intake → generate → review → deliver,
      with the same-day promise as the clock. Write down who checks quality before send.
      **Output:** `marketing/channels/etsy/fulfilment-runbook.md`.
- [ ] **11b. Brand-safety pass on all creative** _(S)_ — before upload, confirm no asset
      contains: **Spotify UI, Spotify green, or a Spotify Code** (their Design & Branding
      Guidelines prohibit incorporating their marks — a competitor was observed ranking
      with a Spotify-style code plaque; **they are exposed, do not copy them**) · Apple
      Music UI · any artist name · any Etsy-style badge that could read as real Etsy UI
      ("Best Seller"). **Use only generic, unbranded player chrome**: plain circle ⏯,
      plain progress bar, no wordmark, no green. Neutral self-evident badges
      ("Ready in minutes") are fine.
- [ ] **12. Tax** _(M)_ — on Etsy's reply (Task 2b), confirm with an AU accountant: GST
      registration (A$75k threshold) and cross-border digital-services treatment.
      **Silent liability accrual if wrong** — resolve before volume, not after.

### Track E — Launch & measure

- [ ] **13. Publish + first-order dry run** _(S)_ — buy our own listing once end-to-end.
      Verifies intake, delivery, and the buyer's actual received experience.
- [ ] **14. Instrument Gate A** _(S)_ — log views/favourites/sales to
      `marketing/CHANNELS.md` weekly, per the channels rule.

---

## 3. Gate A (unchanged from WS-A, now with real numbers)

**Pass:** ≥10 sales **or** ≥$100 revenue in 3 weeks at $19.99 → price validated;
web funnel prices at $19.99. *(10 sales ≈ $174 net.)*

**Fail:** 0 sales at $19.99 **and** at a $14.99 retest, with ≥200 listing visits →
willingness-to-pay thesis fails. **Stop before WS-D spends anything.**

**Ambiguous:** traffic but no conversion → a listing-quality problem, not a price problem.
Fix creative (Track C) before touching price.

---

## 4. What this plan deliberately does NOT do

- No QR codes anywhere — **explicitly prohibited** by the off-platform policy.
- No playback link at launch (Phase 2, gated on Etsy's written answer).
- No Etsy Ads spend until an organic baseline exists.
- No second marketplace until Etsy's signal is read.
- No fabricated social proof — slot 9 stays empty until real reviews exist.
- No physical add-ons (plaques, prints) — they'd add fulfilment cost and shipping
  policy to a test whose only job is reading price signal.

---

## 5. Open risks

| Risk                                                | Mitigation                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| $19.99 anchor untested by fresh research            | Task 1 before publishing                                                                                                                                                                                                                   |
| New-shop suspension (VPN / ID-bank mismatch)        | Task 9 discipline; docs name-matched                                                                                                                                                                                                       |
| "Not as described" disputes on a subjective product | Task 8 specificity + Task 10 fast refunds                                                                                                                                                                                                  |
| VAT/GST liability accruing silently                 | Tasks 2b + 12 before volume                                                                                                                                                                                                                |
| Provider commercial-use terms for selling AI music  | **Read current provider terms — our right to sell is contractual, independent of copyright.** US Copyright Office (29 Jan 2025) holds prompts alone don't confer authorship; grant buyers **personal use**, never claim copyright transfer |

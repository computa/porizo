# Artwork Generator Redesign — Design Spec

**Date:** 2026-05-18
**Author:** Ambrose + Claude (brainstormed via `superpowers:brainstorming`)
**Status:** Awaiting user review → then `superpowers:writing-plans`

---

## 1. Problem

Current artwork (15 occasions × 3 styles, `gpt-image-2` at $0.21/render) consistently
reads as AI-generated even when rendered in the `paper-art` style:

- Petals are uniformly symmetric.
- Every dusty-miller leaf curls the same way.
- Paper texture is uniform across the whole sculpture.
- The bottom 25% is reserved for composited text, constraining composition.
- Free-tier users see one of 15 fixed library JPEGs forever.
- Three styles (`paper-art`, `watercolor`, `photographic`) are randomly assigned
  per-track via `pickStyleVariant(hash(userId:trackId))`, so a single user's
  three tracks can each render in a different aesthetic.

Evidence: rendered "Mother's Day for Chioma" shows competent paper-craft
composition that still passes the "is this AI?" test in under a second.

## 2. Goal

Output that reads as **a real photograph of real flowers or trees** — across
Reveal, NowPlaying, the web player letterbox, and exported social shares.
Photoreal enough that a recipient cannot distinguish it from a National
Geographic / Kinfolk / Cup of Jo botanical photograph at glance.

## 3. Non-goals (V1)

- No multi-aspect generation. One square 2048² gen per track; surfaces adapt locally.
- No backfill of historical tracks. New artwork applies forward from the cutover.
- No new image providers beyond Flux (primary) + OpenAI gpt-image-2 (typed fallback).
- No user-overrideable variables. The slot picker is system-driven only.

## 4. Art direction principles

These are contract — every output must satisfy all seven.

1. **Subject is flora only.** Flowers and trees. No vases, ribbons, surfaces,
   hands, objects, or non-natural staging. Natural-world elements (soil, grass,
   water, sky, bare earth) are permitted as environmental context.
2. **Photoreal, never stylized.** The current `paper-art` and `watercolor`
   styles are deleted. There is one aesthetic: editorial documentary botanical
   photography. `pickStyleVariant` is removed.
3. **Real-world botanical color.** Prompts name the species AND the actual
   hex/Pantone range of that species at peak bloom. No "vibrant," no
   "saturated," no "magical" — those tokens push diffusion models toward
   AI-saturated palettes.
4. **Imperfection over polish.** Prompts include named asymmetries:
   "one outer petal slightly bruised," "single dewdrop at 2 o'clock,"
   "left edge slightly out of focus." This is the single biggest prompt
   lever for escaping the AI-render look.
5. **Specific camera language, not adjectives.** "Fuji X-T5, 90mm macro,
   f/2.8, ISO 200, 1/250s, soft north-facing window light, 3pm late autumn"
   — not "beautiful, professional, high-quality." Diffusion models respond
   to gear/lighting tokens far better than to quality adjectives.
6. **One subject, generous negative space.** A single bloom or small cluster.
   No frame-filling explosions of flora — the artwork must read at NowPlaying
   thumbnail size _and_ hold its own letterboxed on a 16:9 web player.
7. **Lyrics-aware bounded-vocab prompting.** After lyrics finalize, a Haiku
   call reads them and picks slot values from a curated menu. The LLM does
   not compose the prompt; it picks slot values from a known menu. Any
   invalid slot value falls back to the occasion default.

## 5. Prompt template

```
[species_phrase] in [density_phrase] composition, [lighting_phrase],
[palette_phrase]. Photographed on Fuji X-T5 with 90mm macro at f/2.8,
ISO 200, 1/250s. Natural asymmetry: [imperfection_phrase]. [backdrop_phrase].
Composition: subject occupies upper 65% of frame, lower 30% reserved as
soft out-of-focus negative space.

Negative prompt: no text, no letters, no numbers, no handwriting, no people,
no faces, no hands, no human-made objects, no vases, no ribbons, no
surfaces, no tools, no signage, no watermarks. No oversaturated colors,
no plastic finish, no symmetrical perfection, no AI-render gloss, no
duplicated petals, no impossible shadows.
```

`prompt_template_version` is stored alongside each render so we can iterate
the template without orphaning hashes.

## 6. Slot vocabulary

Six slots, each with a curated menu. Total combinations per occasion ≈ 7,776
(6 species × 6 lighting × 6 palette × 3 density × 4 imperfection × 3 backdrop)
— more than enough emotional differentiation while every output stays inside
the visual brand.

### 6.1 Lighting (6 options, occasion-agnostic)

| Key                   | Phrase                                                         |
| --------------------- | -------------------------------------------------------------- |
| `morning_window`      | soft north-facing window light at 9am, gentle diffuse fall     |
| `golden_hour`         | warm low-angle golden-hour sun, 6pm late summer, long shadows  |
| `overcast_soft`       | overcast diffuse light, no direct sun, even tonal range        |
| `late_afternoon_warm` | warm late afternoon light, 4pm autumn, amber cast              |
| `blue_hour_cool`      | cool blue-hour light, 7am pre-dawn, restrained and quiet       |
| `midday_clean`        | clean midday sun through a sheer linen curtain, sharp but soft |

### 6.2 Palette (6 options)

| Key              | Range                                                 |
| ---------------- | ----------------------------------------------------- |
| `warm_cream`     | `#F5E6D3` cream, `#E8C9A8` peach, `#C99970` clay      |
| `dusty_rose`     | `#F2D7D5` blush, `#D49A99` rose, `#8B5F5F` mauve      |
| `sage_ivory`     | `#F4EDDE` ivory, `#B8C5A6` sage, `#7A8A6E` olive      |
| `bruised_gold`   | `#F0D89E` straw, `#C99A4F` gold, `#7D5A2A` amber      |
| `cool_grey_blue` | `#E8E8EA` paper, `#A6B0BA` cool grey, `#5C6A7A` slate |
| `sun_bleached`   | `#FAF3E6` bone, `#E5D3BD` parchment, `#C9B594` linen  |

### 6.3 Density (3 options)

| Key                | Phrase                                             |
| ------------------ | -------------------------------------------------- |
| `single_bloom`     | a single isolated stem, intimate scale             |
| `intimate_cluster` | a small loose cluster of 3-5 stems, hand-gathered  |
| `full_bouquet`     | a generous bouquet, multiple stems flowing outward |

### 6.4 Imperfection (4 options — Haiku picks one)

- one outer petal slightly bruised at the tip
- a single dewdrop visible at 2 o'clock on the largest petal
- left edge of the composition slightly out of focus
- one stem subtly shorter than the others, breaking the symmetry

### 6.5 Backdrop (3 options)

| Key               | Phrase                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `cream_cloud`     | soft cream cloud backdrop with subtle warm falloff at the edges   |
| `garden_bokeh`    | natural garden background blurred to a soft green-and-cream bokeh |
| `bare_wood_grain` | weathered pale-oak wood plane in shallow focus, no objects on it  |

`bare_wood_grain` is the only "surface" allowed and only when explicitly
selected; it photographs as natural wood, not a styled surface.

### 6.6 Species — per occasion

Each occasion has 4-6 candidate species. Haiku picks one (or a paired set for
`anniversary` / `friendship`) based on the lyrics. The species menu **defines
the floral substitute for the 5 currently non-floral occasions** (thank_you,
friendship, get_well, advice, celebration).

| Occasion        | Species options                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `birthday`      | peony, ranunculus, garden rose, dahlia, English rose, lisianthus                                                                |
| `mothers_day`   | ranunculus, peony, garden rose, camellia, magnolia, sunflower                                                                   |
| `anniversary`   | garden rose pair, peony, magnolia, dogwood branch, cherry blossom, gardenia                                                     |
| `thank_you`     | eucalyptus stems, sage, lavender, chamomile, forget-me-nots, sweet peas                                                         |
| `i_love_you`    | red garden rose, peony, dahlia, ranunculus, anemone, single rose stem                                                           |
| `wedding`       | garden rose, ranunculus, peony, lily of the valley, gardenia, anemone                                                           |
| `graduation`    | sunflower, daisy, dahlia, magnolia, olive branch, laurel sprig                                                                  |
| `celebration`   | dahlia, daisy, wildflower mix, sunflower, gerbera, peony                                                                        |
| `apology`       | white tulip, white anemone, lily of the valley, gardenia, white peony, baby's breath                                            |
| `encouragement` | sunflower, yellow tulip, daffodil, daisy, iris, magnolia                                                                        |
| `advice`        | ancient oak branch, olive branch, sage plant, rosemary stem, laurel, ginkgo branch                                              |
| `bereavement`   | white calla lily, white anemone, white peony, lily of the valley, baby's breath, gardenia                                       |
| `friendship`    | two cherry blossom branches, two dogwood branches, sweet pea pair, two sunflowers, mixed wildflower bunch, lavender + sage pair |
| `get_well`      | chamomile, lavender stems, yellow tulip, daisy, lily of the valley, eucalyptus                                                  |
| `custom`        | peony, ranunculus, garden rose, sunflower, magnolia, sweet peas                                                                 |

### 6.7 Per-occasion defaults (used when Haiku returns invalid or fails)

| Occasion      | Default species     | Default lighting    | Default palette | Default density  | Default backdrop |
| ------------- | ------------------- | ------------------- | --------------- | ---------------- | ---------------- |
| birthday      | ranunculus          | morning_window      | warm_cream      | intimate_cluster | cream_cloud      |
| mothers_day   | ranunculus          | morning_window      | dusty_rose      | intimate_cluster | cream_cloud      |
| anniversary   | garden rose pair    | golden_hour         | warm_cream      | intimate_cluster | cream_cloud      |
| thank_you     | eucalyptus          | morning_window      | sage_ivory      | intimate_cluster | cream_cloud      |
| i_love_you    | red garden rose     | golden_hour         | dusty_rose      | single_bloom     | cream_cloud      |
| wedding       | garden rose         | morning_window      | sage_ivory      | full_bouquet     | cream_cloud      |
| graduation    | olive branch        | golden_hour         | bruised_gold    | single_bloom     | cream_cloud      |
| celebration   | dahlia              | golden_hour         | bruised_gold    | full_bouquet     | cream_cloud      |
| apology       | white tulip         | overcast_soft       | cool_grey_blue  | single_bloom     | cream_cloud      |
| encouragement | sunflower           | morning_window      | bruised_gold    | single_bloom     | cream_cloud      |
| advice        | olive branch        | late_afternoon_warm | sage_ivory      | single_bloom     | bare_wood_grain  |
| bereavement   | white calla lily    | overcast_soft       | cool_grey_blue  | single_bloom     | cream_cloud      |
| friendship    | cherry blossom pair | morning_window      | warm_cream      | intimate_cluster | cream_cloud      |
| get_well      | chamomile           | morning_window      | sage_ivory      | intimate_cluster | cream_cloud      |
| custom        | peony               | morning_window      | warm_cream      | intimate_cluster | cream_cloud      |

## 7. Provider configuration

| Role     | Provider          | Model              | Endpoint       | Cost/img | Native size |
| -------- | ----------------- | ------------------ | -------------- | -------- | ----------- |
| Primary  | Replicate         | flux-1.1-pro-ultra | replicate.com  | ~$0.06   | 2048×2048   |
| Fallback | OpenAI (existing) | gpt-image-2        | api.openai.com | $0.211   | 1024×1024   |

Both providers conform to the existing `getImageProvider` shape in
`src/services/image-providers/index.js`. New adapter file:
`src/services/image-providers/flux-image.js`. Switch via env var
`IMAGE_PROVIDER=flux|openai`. Default in prod: `flux`.

**Replicate is already integrated** in `src/providers/replicate.js` (used for
voice conversion). The new `flux-image.js` adapter reuses the same HTTP client
and auth pattern.

### 7.1 Fallback chain (per render)

1. Try Flux (typed retry: 1s, 2s, 4s).
2. On Flux moderation refusal → typed `ModerationRefusalError` → free-tier library fallback (no retry to OpenAI; same prompt would refuse).
3. On Flux infra failure → typed `ImageGenerationError` → retry once on OpenAI gpt-image-2.
4. On OpenAI failure → free-tier library fallback. Render still completes.

## 8. Variety strategy

- **Paid tracks (Plus, Pro):** every track gets a fresh Flux generation.
  `params_hash` includes occasion + artwork_vars + prompt_template_version,
  so a deterministic re-render (e.g., reroll with same vars) hits cache.
  A reroll with `forceRegenerate: true` always generates fresh.
- **Free tracks:** library of **5 photoreal variants per occasion** generated
  once via bootstrap script. Deterministic pick = `hash(userId:trackId) mod 5`.
  Library lives at `storage/artwork-library/v2/{occasion}/{n}.jpg` (note the
  `v2/` segment — leaves v1 in place during transition).

Bootstrap cost: 15 occasions × 5 variants × $0.06 = **$4.50 one-time**.

## 9. Asset shape & surface adaptation

**Canonical asset:** 1 file per track. JPEG, 2048×2048 (square), quality 92,
mozjpeg, progressive. Stored at `storage/tracks/{userId}/{trackId}/v{n}/artwork.jpg`.

**No text composited at generation time.** The bottom-30% negative space exists
for atmospheric breathing room, not for text. Text is added at the surface
layer in every consuming context.

### 9.1 iOS Reveal (portrait)

Blur-backdrop ZStack (Spotify / Apple Music pattern):

```swift
ZStack {
    // Backdrop layer: same artwork, blurred and dimmed
    Image(artwork)
        .resizable()
        .scaledToFill()
        .blur(radius: 50)
        .overlay(Color.black.opacity(0.30))
        .ignoresSafeArea()

    // Foreground layer: unmodified square artwork
    Image(artwork)
        .resizable()
        .scaledToFit()
        .padding(.horizontal, 24)
        .padding(.bottom, 200) // leaves room for title overlay

    // Title overlay layer with bottom scrim
    VStack {
        Spacer()
        LinearGradient(
            colors: [.clear, .black.opacity(0.65)],
            startPoint: .top,
            endPoint: .bottom
        ).frame(height: 240)
        .overlay(alignment: .bottom) {
            VStack(spacing: 6) {
                Text("For \(recipientName)")
                Text("\(occasionLabel) Song · by \(senderFirstName)")
            }
            .padding(.bottom, 48)
        }
    }
}
```

### 9.2 iOS NowPlaying (square)

Set the full 2048² square via `MPNowPlayingInfoPropertyArtwork`. Apple's
system chrome handles title text. No code change beyond ensuring the new
artwork URL is consumed.

### 9.3 Web player (already-shipped letterbox)

No change. The artwork is already consumed as a background image; the new
asset has no baked-in text, which removes the contrast bug seen in the
Chioma example.

### 9.4 Social share / export

`compositeArtworkWithText` in `cover-generator.js` already exists. Move its
invocation from gen-time to **export-time** (triggered by share button).
Output is a portrait 9:16 composite for IG Story or square 1:1 for IG feed,
chosen at export. This decouples the canonical asset from any baked text.

## 10. Workflow changes

New workflow step inserted after lyrics finalization:

```
R1 LYRICS  →  R1.5 ARTWORK_VARS  →  R2 MUSIC_PLAN  →  ...  →  R8 ARTWORK  →  R9 READY
```

- **R1.5 ARTWORK_VARS** — Haiku call.
  - Input: finalized lyrics text, occasion
  - Output: `{ species, lighting, palette, density, imperfection, backdrop, picked_by, picked_at }`
  - Stored in: `track_versions.artwork_vars_json`
  - Provider: `claude-haiku-4-5`
  - Timeout: 8s
  - Fallback: occasion defaults (table in §6.7)
- **R8 ARTWORK** — Flux generation.
  - Input: `artwork_vars_json`, `prompt_template_version`, tier
  - Reads vars, assembles prompt via template (§5), calls Flux
  - Output: 2048² JPEG at canonical path

R1.5 must complete before R8. R1.5 runs in parallel with R2 MUSIC_PLAN to
preserve preview latency budget (p95 < 90s).

## 11. Database schema changes

```sql
-- Migration: 0XXX_artwork_redesign.sql

ALTER TABLE track_versions
  ADD COLUMN artwork_vars_json JSONB,
  ADD COLUMN artwork_provider TEXT,
  ADD COLUMN artwork_prompt_version TEXT;

-- tracks.artwork_content_hash semantics shift:
-- Now hashes (occasion || artwork_vars_json || prompt_template_version)
-- rather than (recipient_name || occasion || style).
-- recipient_name no longer participates (it's never in the prompt anyway).

-- Old style column on track_versions is now ignored. Keep for one release
-- to avoid breaking deserialization of historical rows. Drop in next migration.
```

Indexes added: none (the JSON column is small, queried only by row PK).

## 12. Migration & rollout

### Phase 0 — Spec approved, plan written, feature branch created.

### Phase 1 — Build & test (estimated 2-3 days)

- Implement `flux-image.js` adapter.
- Implement `artwork-vars-extractor.js` (Haiku call).
- Implement new prompt template engine in `artwork-prompts.js` (replacing current).
- Add migration `0XXX_artwork_redesign.sql`.
- Golden tests (§14).
- Behind a feature flag `ARTWORK_V2_ENABLED` (default `false`).

### Phase 2 — Bootstrap free-tier library v2

- `scripts/build-artwork-library-v2.mjs` — generates 5 Flux variants × 15
  occasions = 75 images. Manual eyeball QA before commit. Bad outputs
  re-rolled. Total cost ~$4.50 + manual time.
- Library committed to `storage/artwork-library/v2/`. Old `v1/` left in place.

### Phase 3 — Production cutover

- Set `IMAGE_PROVIDER=flux` in Railway env.
- Flip `ARTWORK_V2_ENABLED=true` for paid users first (cohort flag).
- Monitor for 48h: Flux failure rate, Haiku invalid-slot rate, moderation refusals.
- Flip for free users.

### Phase 4 — Cleanup (after 1 week of clean V1 telemetry)

- Drop `track_versions.style` column.
- Remove `pickStyleVariant` and `VALID_STYLES` from `artwork-prompts.js`.
- Mark `storage/artwork-library/v1/` as deprecated.

### What happens to existing tracks

- No backfill. Existing tracks keep their `v1` artwork. If a user rerolls
  a v1 track, the reroll picks up the new pipeline and regenerates v2.
- `track_versions.artwork_provider` will be `null` for pre-v2 rows; queries
  treat null as "v1 legacy."

## 13. Failure modes & telemetry

| Failure                    | Behavior                                     | Alert threshold |
| -------------------------- | -------------------------------------------- | --------------- |
| Haiku timeout / network    | Fall back to occasion defaults               | >5% / hour      |
| Haiku returns invalid slot | Fall back to occasion defaults; log slot     | >2% / hour      |
| Flux moderation refusal    | Library fallback (no retry to OpenAI)        | >1% / day       |
| Flux infra failure         | Retry once on OpenAI; if that fails, library | >5% / hour      |
| OpenAI fallback fails too  | Library fallback                             | >0.5% / day     |
| Storage upload (S3) fails  | Keep local copy; warn; cross-instance 404s   | any             |

Logged fields per render: `provider`, `prompt_template_version`,
`artwork_vars_json`, `latency_ms`, `moderation_passed`, `source`.

## 14. Testing strategy

### 14.1 Unit tests

- `artwork-prompts.assemblePrompt(vars)` — given known vars, returns expected
  prompt string. 6 representative cases.
- `artwork-vars-extractor.parse(haikuResponse)` — validates slot values
  against menus, rejects out-of-vocab values.
- `flux-image.generate()` — stubbed HTTP; verifies request body shape,
  error class mapping (moderation vs infra).

### 14.2 Golden tests (15 — one per occasion)

- Fixed lyrics fixture per occasion (committed under `test/fixtures/lyrics/`).
- Stub Haiku to return a fixed pick.
- Assert the assembled prompt matches the expected string byte-for-byte.

### 14.3 Integration test

- Stub Flux to return a fixture JPEG. Verify end-to-end: lyrics → vars →
  prompt → Flux call → artwork.jpg written → DB columns populated.

### 14.4 Manual QA gate (Phase 3 pre-flip)

- Generate one image per occasion via the real Flux pipeline.
- Founder eyeball test: does it pass the "is this AI?" test in under one
  second? Any "yes that's AI" output blocks the flip until prompt is tuned.
- 15 manual approvals × ~30s each = 8 minutes of human time.

### 14.5 Production canary

- 10% of paid renders get V2 for first 24h. Monitor metrics from §13.

## 15. Open questions / Phase 2 candidates

Deferred. Listed here so we don't lose the thread:

- **Imagen 3 as third provider** — lower cost (~$0.04) once a Google Cloud
  dependency is acceptable.
- **Multi-aspect generation** — portrait + square + landscape per track if
  Reveal-specific composition becomes a felt need.
- **Animated artwork on Reveal** — short looping video instead of still.
- **User-overrideable slot values** — let paid users pick the species/palette
  themselves before render.
- **Lyrics → custom species** — let LLM pick from full botanical catalog
  rather than the curated 6 per occasion.
- **Voice-of-recipient artwork** — generate artwork that subtly reflects the
  _recipient's_ attributes (their favorite color, season they were born) if
  the sender provides those at create-time.

## 16. Files touched (high-level inventory)

New:

- `src/services/image-providers/flux-image.js` — Flux adapter
- `src/services/artwork-vars-extractor.js` — Haiku call + validation
- `src/services/artwork-vocab.js` — the slot menus & per-occasion defaults
- `scripts/build-artwork-library-v2.mjs` — library bootstrap
- `migrations/0XXX_artwork_redesign.sql` + `migrations/pg/0XXX_…`
- `test/fixtures/lyrics/*.txt` — 15 golden lyrics fixtures

Modified:

- `src/services/artwork-prompts.js` — template engine replaces current builder
- `src/services/song-artwork.js` — read `artwork_vars_json`, drop `pickStyleVariant`
- `src/services/image-providers/index.js` — register flux adapter
- `src/jobs/artwork-job.js` — depend on R1.5 completion, read new columns
- `src/workflows/runner.js` — insert R1.5 step ordering
- `PorizoApp/PorizoApp/Flows/RevealBloomView.swift` — blur-backdrop ZStack on song-reveal surface
- `PorizoApp/PorizoApp/Components/SongCoverView.swift` — confirm 2048² consumption at thumbnail and full sizes
- `PorizoApp/PorizoApp/NowPlayingView.swift` — confirm artwork URL flows through `MPNowPlayingInfoPropertyArtwork`
- `PorizoApp/PorizoApp/Flows/SharePostcardView.swift` — invokes `compositeArtworkWithText` at export-time (already exists; just shifts timing)
- `PorizoApp/PorizoApp/Services/NowPlayingManager.swift` — verify artwork pull on track change
- `web-player/player.js` — no change expected; verify on QA

Deleted (Phase 4):

- `pickStyleVariant`, `VALID_STYLES`, `STYLES` const in `artwork-prompts.js`
- `storage/artwork-library/v1/`
- `track_versions.style` column

---

## Brainstorm decision log

| #   | Question               | Decision                                                                   |
| --- | ---------------------- | -------------------------------------------------------------------------- |
| Q1  | Dominant failure mode? | A — output reads as AI-generated                                           |
| Q2  | Constraint frontier?   | A — flora only (flowers + trees), photoreal, real colors, no humans        |
| Q3  | Image model?           | Flux 1.1 Pro Ultra primary, gpt-image-2 fallback                           |
| Q4  | Variety strategy?      | C for paid (per-track gen), B for free (5-variant library)                 |
| Q5  | Surfaces?              | Single square 2048², runtime text overlay everywhere, blur-backdrop Reveal |
| Q6  | Lyrics-aware in V1?    | Yes — bounded-vocab slot picker via Haiku                                  |

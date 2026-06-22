# Feature Audit: Poems / Blog / Artwork / OG / Cover Generation

**Date:** 2026-06-22
**Scope:** `src/routes/poems.js`, `src/routes/blog.js`, `src/routes/artwork.js`, `src/services/poem-generator.js`, `src/services/poem-og-*.js`, `src/services/blog-*.js`, `src/services/cover-generator.js`, `src/services/song-artwork.js`, `src/services/song-og-*.js`, `src/services/artwork-*.js`, `src/services/og-text-utils.js`, `src/services/image-providers/**`, `src/services/fonts/**`, relevant `migrations/pg/*.sql`
**Status:** Discovery pass only — no code modified.

---

### 1. Poem Generation (LLM)

**feature:** Generate poem verses via LLM on demand.

**user_story:** User creates a poem for an occasion; taps Generate; verses appear.

**expected_behavior:** `POST /poems` creates a `poems` record (status=`draft`). `POST /poems/:id/generate` is rate-limited at 20/hr via `rate_limits` table. Calls `generatePoem()` → `generatePoemWithLLM()` via `llm-provider.js` (taskType=`lyrics`, model=Sonnet 4, temp=0.8, responseMimeType=`application/json`). LLM must return `{ verses: [{name, lines[]}], title? }`. Status FSM: `draft → generating → generated | generation_failed`. No credit/entitlement consumed — rate-limit only.

**status:** implemented — endpoint, service, LLM call, status FSM all VERIFIED in `poem-generator.js` and `routes/poems.js`.

**gaps:**

- No entitlement/credit gate: songs consume credits; poems are gated only by rate-limit (20/hr). A free user can generate unlimited poems within rate window.
- No generation retry: unparseable LLM JSON throws `POEM_GENERATION_FAILED` immediately with no retry attempt.
- Status stuck at `generating` if server crashes mid-flight — no watchdog or timeout recovery to flip to `generation_failed`.

**key_files:**

- `src/routes/poems.js`
- `src/services/poem-generator.js`
- `src/services/llm-provider.js`

**db_tables:** `poems`, `poem_library_entries`, `rate_limits`, `audit_logs`

---

### 2. Poem CRUD & Library

**feature:** Create, read, update, soft-delete poems in user's personal library.

**user_story:** User manages their poem collection — views, edits drafts, removes old ones.

**expected_behavior:** `GET /poems` lists library (via `poem_library_entries`). `GET /poems/:id` returns single poem. `PATCH /poems/:id` updates fields; status validated against whitelist (`draft|generating|generated|generation_failed|published|archived`). `DELETE /poems/:id` sets `poem_library_entries.removed_at` (soft delete). All mutations emit audit log entries.

**status:** implemented — all CRUD operations, status whitelist, soft-delete, audit log VERIFIED.

**gaps:**

- `PATCH` allows client to set `status=published` directly with no guard that `verses` is non-empty — a poem with no verses could be published.
- `GET /poems` has no pagination — full library fetched in one query; could be slow at scale.

**key_files:**

- `src/routes/poems.js`

**db_tables:** `poems`, `poem_library_entries`, `audit_logs`

---

### 3. Poem Share Token & Web Viewer

**feature:** Share a poem via link; recipient opens a web viewer page.

**user_story:** User taps Share on a poem; receives a link; recipient opens it in browser and reads the poem.

**expected_behavior:** `POST /poems/:id/share` creates `poem_share_tokens` record (`share_type=lifetime`, `expires_at=9999-12-31`). `GET /poem/:shareId` serves HTML viewer page: validates share, calls `healAndCheckShare()` for legacy token auto-upgrade, calls `ensurePoemShareIsReady()` to gate on poem readiness, then logs `web_viewer_opened` to `poem_share_access_log`. Revoked shares return 404 HTML.

**status:** implemented — share creation, viewer HTML, access logging, status gating all VERIFIED in `routes/sharing.js`.

**gaps:**

- `ensurePoemShareIsReady()` behavior when `poem.status=generation_failed` is not clearly documented — unclear whether viewer gets a 503 (pending) or a 404 (not found).
- Poem shares have no app-wall / deep-link handoff; unlike song shares (which have full OneLink + custom scheme flow), poem shares are web-only — no CTA to claim in app.

**key_files:**

- `src/routes/poems.js`
- `src/routes/sharing.js`

**db_tables:** `poem_share_tokens`, `poems`, `poem_share_access_log`

---

### 4. Poem OG Image (Social Share Card)

**feature:** Generate a 1200×630 social preview card for a shared poem.

**user_story:** When WhatsApp/iMessage/Twitter unfurls a poem share link, it shows a branded card with poem text.

**expected_behavior:** `GET /poem/:shareId/og-image.png` validates share, reads `poem.og_variant`, dispatches to `generatePoemOgImage()` or variant generators (`poem-og-variants.js`). Poem text overlaid as SVG on gradient background. Result disk-cached per `shareId`. Returns `image/jpeg`.

**status:** implemented — generation, disk cache, variant dispatch all VERIFIED in `poem-og-generator.js` and `poem-og-variants.js`.

**gaps:**

- Disk cache keyed on `shareId` not on content hash — if poem verses are edited after share creation, the cached (stale) OG image continues to be served indefinitely.
- `og_variant` column NULL behavior: if never set at poem creation, the fallback variant selection is undocumented in code comments.
- No cache TTL or invalidation mechanism; stale images survive until manual purge.

**key_files:**

- `src/routes/sharing.js`
- `src/services/poem-og-generator.js`
- `src/services/poem-og-variants.js`

**db_tables:** `poem_share_tokens`, `poems`

---

### 5. Blog Post Generation (Autofill)

**feature:** LLM-populate a blog post draft from title + target query + keyword.

**user_story:** Operator seeds a blog post with title and keyword; autofill writes body, excerpt, answer_summary, tags.

**expected_behavior:** `blog-autofill-service.js` sends structured prompt to LLM (provider chain: gemini → anthropic → openai; taskType=`simple`, temp=0.3). Returns `body_markdown`, `excerpt`, `answer_summary`, `tags_json`. `inferBlogDraftFields()` derives missing fields from body. `autoFormatArticleMarkdown()` normalizes headings, lists, spacing.

**status:** implemented — LLM call, schema validation, field inference, formatting all VERIFIED.

**gaps:**

- Re-running autofill on an existing post silently overwrites manual edits with no diff/merge or confirmation.
- Multi-provider fallback chain (gemini → anthropic → openai) has no cost logging per call — expensive at content-at-scale production use.

**key_files:**

- `src/services/blog-autofill-service.js`
- `src/services/blog-format-service.js`

**db_tables:** `blog_posts`

---

### 6. Blog Deterministic SEO/GEO/AEO Review Gate

**feature:** Automated scoring gate that blocks publication unless post meets SEO/GEO/AEO thresholds.

**user_story:** Operator triggers review; system scores keyword density, heading structure, internal links, answer summary, excerpt length; approves or rejects.

**expected_behavior:** `blog-review-service.js` computes `seoScore`, `geoScore`, `aeoScore`, `overallScore`; emits `decision` (`approve|reject`) and `blockers[]`. Sets `review_status` on `blog_posts`. Publication requires `review_status=approved`. `review_report_json` stores full report. Schema: `migrations/pg/077_blog_cms.sql`.

**status:** implemented — scoring, decision, DB update all VERIFIED.

**gaps:**

- No admin override / force-publish endpoint visible in `routes/blog.js` (file is 1.5KB, likely incomplete); unknown if override exists elsewhere.
- Score thresholds are hardcoded constants — cannot be tuned via env or DB config without a code deploy.

**key_files:**

- `src/services/blog-review-service.js`
- `src/routes/blog.js`

**db_tables:** `blog_posts`

---

### 7. Blog LLM Editorial Review

**feature:** LLM provides editorial feedback on citation potential and answer-engine clarity, separate from the deterministic gate.

**user_story:** After deterministic review passes, operator sees an AI editorial assessment with verdict and specific improvement suggestions.

**expected_behavior:** `blog-editorial-review-service.js` calls LLM (provider chain: gemini → anthropic → openai; maxTokens=900, temp=0.2, responseSchema=`EDITORIAL_REVIEW_SCHEMA`). Returns `verdict` (one of: `publish_as_is|publish_after_light_edits|revise_before_publishing|rewrite_substantially`), `citationPotential` (0–10), `aeoStrength` (0–10), `frameworkAlignment` (0–10), `blockers[]` (≤3), `improvements[]` (≤5). Gracefully degrades to `buildUnavailableEditorialReview()` if LLM unavailable or in test mode.

**status:** implemented — LLM call, graceful degradation, schema normalization all VERIFIED.

**gaps:**

- Editorial verdict is purely advisory — no code path blocks publication on `rewrite_substantially` verdict.
- Editorial review result persistence is unclear: `review_report_json` column appears to store the deterministic report; whether editorial result is also persisted or only returned in API response is not surfaced in `routes/blog.js`.

**key_files:**

- `src/services/blog-editorial-review-service.js`

**db_tables:** `blog_posts`

---

### 8. Blog Format & Repair

**feature:** Normalize post markdown formatting and auto-repair common structural deficiencies flagged by review.

**user_story:** After autofill or manual edit, the system normalizes heading levels and fixes missing internal links, answer summary alignment, and hero image before re-review.

**expected_behavior:** `blog-format-service.js`: `autoFormatArticleMarkdown()` normalizes heading hierarchy, list formatting, whitespace. `blog-repair-service.js`: `repairBlogDraft()` conditionally runs `ensureAnswerSummaryAlignment()`, `ensureInternalLinks()` (only if report flags `missing_internal_links`), `ensureHeroImage()`, then re-runs `autoFormatArticleMarkdown()`.

**status:** implemented — format normalization and conditional repair all VERIFIED.

**gaps:**

- `ensureInternalLinks()` is conditioned on the review report already flagging the issue — circular: repair logically precedes review, but this repair step requires review output to trigger.
- `ensureHeroImage()` behavior is ambiguous: it is unclear whether it generates/selects a hero image or only injects a placeholder/flag in the draft.

**key_files:**

- `src/services/blog-format-service.js`
- `src/services/blog-repair-service.js`

**db_tables:** `blog_posts`

---

### 9. Blog Render (HTML Page + JSON-LD SEO)

**feature:** Render published blog posts as full SEO-optimized HTML pages with structured data.

**user_story:** Visitors browse to `/blog/:slug`; page loads with article body, table of contents, reading time, and rich search result eligibility.

**expected_behavior:** `blog-render-service.js` `renderBlogPostPage()`: converts `body_markdown` → HTML, builds `Article` JSON-LD, `FAQPage` JSON-LD (if ≥2 Q&A pairs extracted), `BreadcrumbList` JSON-LD. Renders ToC from headings. Computes reading time. Applies `CANONICAL_OVERRIDES` map for slug redirects. `hero_image_url` used as OG image in `<meta property="og:image">`.

**status:** implemented — structured data, ToC, reading time, canonical overrides all VERIFIED.

**gaps:**

- `FAQPage` JSON-LD only emitted when ≥2 Q&A pairs are found — a post with a single FAQ gets no FAQ schema, with no warning surfaced to the author in the review report.
- `hero_image_url` is user-supplied and only passes `safeUrl()` sanitization — no dimension validation; an image not meeting OG spec (1200×630) will produce degraded social previews.
- `CANONICAL_OVERRIDES` is a hardcoded in-memory JS object — slug redirects require a code deploy; no DB-backed redirect management.

**key_files:**

- `src/services/blog-render-service.js`

**db_tables:** `blog_posts`

---

### 10. Blog Publish / Archive

**feature:** Operator publishes or archives a blog post.

**user_story:** After review passes, operator clicks Publish; post appears on `/blog/:slug`.

**expected_behavior:** Status transitions: `draft → published` (requires `review_status=approved`) or `draft|published → archived`. `published_at` stamped on publish. `GET /blog` lists published posts. `GET /blog/:slug` renders via `renderBlogPostPage()`.

**status:** partial — render endpoint VERIFIED; explicit create/update/publish/archive admin API is NOT present in `routes/blog.js` (file is only 1.5KB with ~3 endpoints). Admin operations may live in an admin route file not enumerated in this audit scope.

**gaps:**

- `routes/blog.js` is undersized for a full CMS — create, update, publish, unpublish, archive endpoints are missing or live in an out-of-scope admin route.
- No scheduled publish (`publish_at`) handling visible in any blog service.
- `blog_post_revisions` table referenced in schema but no revision service surfaced in scope files.

**key_files:**

- `src/routes/blog.js`
- `src/services/blog-service.js`

**db_tables:** `blog_posts`

---

### 11. Song Artwork Generation

**feature:** AI-generated per-song artwork image for paid users; curated library variant for free users.

**user_story:** Paid user's song gets a unique AI-generated image composited with recipient name + occasion text. Free user gets a deterministic library image.

**expected_behavior:** `song-artwork.js` `generateSongArtwork()`: (1) extracts vars via `artwork-vars-extractor.js` (Haiku 4.5, 400ms timeout, defaults on failure); (2) assembles prompt via `artwork-prompts.js`; (3) calls `tryProviderChain()` (Flux primary → OpenAI gpt-image-2 fallback); (4) normalizes to 2048×2048 via sharp; (5) composites recipient name + occasion text via `compositeArtworkWithText()` (3 aspect ratios: 9:16, 1.91:1, 1:1; Fraunces font). Content hash (`sha1` of occasion+vars+promptVersion, excluding recipient_name) gates regeneration — skipped if unchanged. Free users: `pickLibraryVariant()` selects 1-of-5 by `sha1(userId:trackId)` from pre-seeded `artwork-library/v2/{occasion}/`.

**status:** implemented — full pipeline, fallback chain, hash cache, library path, compositing all VERIFIED.

**gaps:**

- `artwork-vars-extractor` timeout is 400ms hardcoded with no env override — high false-timeout rate on LLM cold starts, silently degrading to generic default vars.
- Library fallback images (`artwork-library/v2/{occasion}/{0-4}.jpg`) must be pre-seeded on disk; if missing, free-tier artwork fails with no graceful error.
- Content hash is track-vars-level, not per-track — two tracks with identical vars (same occasion/vars/promptVersion) share the same cached base image on disk. No per-track forced invalidation path.

**key_files:**

- `src/services/song-artwork.js`
- `src/services/artwork-vars-extractor.js`
- `src/services/artwork-prompts.js`
- `src/services/artwork-vocab.js`
- `src/services/cover-generator.js`

**db_tables:** `tracks`, `track_versions`

---

### 12. Artwork Moderation

**feature:** Pre-flight and output-side moderation of AI image generation prompts and results.

**user_story:** Prompts that could produce unsafe content are caught before or during generation; the track falls back to a curated library image.

**expected_behavior:** Two layers: (1) OpenAI `moderationCheck()` (pre-flight, 10s timeout) is called before the **fallback** (OpenAI) generation only. (2) Flux (primary) surfaces moderation as a `ModerationRefusalError` via `prediction.error` during polling. On either refusal: `moderationPassed=false` on the track record, falls through to library variant. `moderationCheck()` fails-open on network error (`{flagged: false, skipped: true}`).

**status:** implemented — dual-layer moderation, typed errors, library fallback on refusal all VERIFIED.

**gaps:**

- Flux (primary) path has **no pre-flight moderation** — prompt is sent to Replicate without any prior check; only discovered at generation time.
- `moderationPassed=false` is written to the track record and logged, but no operator alert or async review queue is triggered.
- Fails-open on moderation network error is intentional per code comment but creates an undocumented risk surface.

**key_files:**

- `src/services/song-artwork.js`
- `src/services/image-providers/openai-image.js`
- `src/services/image-providers/flux-image.js`

**db_tables:** `tracks`

---

### 13. Cover Image Generation (SVG-based, legacy + V2 compositor)

**feature:** Generate track cover art: SVG gradient covers (legacy/free) and SVG text compositing on AI base images (V2/paid).

**user_story:** Every track gets a cover image — either gradient-based or AI-artwork-based with typography overlay.

**expected_behavior:** `cover-generator.js` has two distinct functions: (1) `generateCover()` — legacy SVG gradient pipeline: generates 3000×3000 source, downsampled to 1024 and 256 via sharp, stores to `versionDir`. (2) `compositeArtworkWithText()` — V2 overlay: loads AI base image, resizes/letterboxes/crops to target aspect ratio (9:16, 1.91:1, 1:1), composites SVG text layer (Fraunces font, recipient name + occasion + sender attribution) via sharp. Called from `song-artwork.js`.

**status:** implemented — both pipelines, sharp operations, multi-size output all VERIFIED.

**gaps:**

- `generateCover()` and `compositeArtworkWithText()` coexist in the same file with no clear deprecation comment on the former — maintainers must read `song-artwork.js` to understand which path is active per tier.
- `sharp` loaded lazily in `generateCover()`; missing sharp causes `return null` with only a `console.warn` — caller receives null silently; no error thrown to surface in job tracking.

**key_files:**

- `src/services/cover-generator.js`

**db_tables:** `track_versions`

---

### 14. Song OG Image (Social Share Card)

**feature:** Generate a 1200×630 (landscape) and 1200×1200 (square) social preview card for a song share.

**user_story:** When someone shares a song link on WhatsApp, Facebook, or iMessage, the unfurl shows the artwork with song title and recipient name.

**expected_behavior:** `song-og-generator.js`: `generateSongOgImage()` (1200×630) composites gradient SVG + artwork (resized, rounded) + text SVG overlay via sharp. `generateSongOgImageSquare()` (1200×1200, optimized for WhatsApp letterboxing). `generateSongArtworkPreviewImage()` crops/scales the cover image directly as OG (default for current shares — artwork-first design). Placeholder music-note SVG used if cover missing.

**status:** implemented — both orientations, artwork-first design, placeholder fallback all VERIFIED.

**gaps:**

- Song OG images are **generated on every request** with no disk cache — unlike poem OG images (which are disk-cached per shareId). Under viral load a single popular share link would generate a sharp pipeline call on every social crawler refetch.
- `Cache-Control: no-store` is explicitly set on the OG image endpoint — prevents CDN caching; every refetch hits the Node process.

**key_files:**

- `src/services/song-og-generator.js`
- `src/routes/sharing.js`

**db_tables:** `share_tokens`, `tracks`

---

### 15. Song OG Image Variants (A/B Design Selection)

**feature:** Three alternative OG card designs available for visual comparison before production selection.

**user_story:** Designer previews three card styles (Spotlight, Gilt Envelope, Greeting Card) for a specific song share before choosing one for production.

**expected_behavior:** `song-og-variants.js` implements Variants A, B, C — each a different SVG composition style. `GET /share/:shareId/og-preview/:variant` dispatches to `generateSongOgPreview(variant, ...)`. All three use `OCCASION_COLORS` from `cover-generator.js`. Not currently wired to production OG serving path.

**status:** implemented as debug/preview tool only — not wired to production OG serving. VERIFIED.

**gaps:**

- No feature flag or user-/share-level routing to serve a non-default variant in production.
- No automated visual regression tests for any variant — rendering correctness relies on manual preview.

**key_files:**

- `src/services/song-og-variants.js`
- `src/routes/sharing.js`

**db_tables:** _(none)_

---

### 16. Poem OG Image Variants (A/B Design Selection)

**feature:** Three alternative OG card designs for poem share images, with per-poem variant selection.

**user_story:** Poem OG image design can be selected per poem via `og_variant` field; variants available for preview.

**expected_behavior:** `poem-og-variants.js` provides three designs. `poem.og_variant` column selects which is rendered. `poem-og-generator.js` dispatches to variant or default generator. Disk-cached per shareId.

**status:** implemented — variant dispatch, disk cache, og_variant column all VERIFIED.

**gaps:**

- `og_variant` is not set at poem creation — NULL handling (which variant is the default) is not documented in code or comments.

**key_files:**

- `src/services/poem-og-variants.js`
- `src/services/poem-og-generator.js`

**db_tables:** `poems`

---

### 17. Image Providers (Flux + OpenAI)

**feature:** Pluggable image generation backend registry; Flux (Replicate) as primary, OpenAI gpt-image-2 as fallback.

**user_story:** Backend selects image provider via `IMAGE_PROVIDER` env var; adapters are swappable without caller changes.

**expected_behavior:** `image-providers/index.js`: `getImageProvider(name)` returns provider by name. `flux-image.js`: creates Replicate prediction, polls until `succeeded` or deadline. `openai-image.js`: POSTs to OpenAI images API, 180s timeout (configurable via `OPENAI_IMAGE_TIMEOUT_MS`), pre-flight `moderationCheck()`. Both export `{name, generate(), dataHandling}`. `ModerationRefusalError` and `ImageGenerationError` typed. Code explicitly documents that `instanceof ModerationRefusalError` is unreliable cross-adapter; duck-type (`err.name`) required.

**status:** implemented — both adapters, typed errors, timeout handling, data handling metadata all VERIFIED.

**gaps:**

- `ModerationRefusalError` cross-adapter `instanceof` unreliability is documented but is a latent bug for any new consumer that doesn't read the comment.
- Flux polling uses a single wall-clock deadline for the entire prediction — a single slow poll step can silently consume most of the budget before error surfacing.

**key_files:**

- `src/services/image-providers/index.js`
- `src/services/image-providers/openai-image.js`
- `src/services/image-providers/flux-image.js`

**db_tables:** _(none)_

---

### 18. Artwork Variables Extractor (LLM Slot-Filler)

**feature:** LLM classifies lyrics + occasion into bounded vocabulary slots (species, lighting, palette, density, imperfection, backdrop) to drive image prompt assembly.

**user_story:** Before artwork generation, the render pipeline extracts emotional/visual attributes from lyrics so the image prompt is grounded in the song's content.

**expected_behavior:** `artwork-vars-extractor.js` calls Haiku 4.5 via `llm-provider.js` (taskType=`vars_extractor`, temp=0.4, maxTokens=400, responseMimeType=`application/json`). Hard 400ms timeout via `Promise.race`. On timeout or error: returns `getDefault(occasion)` from `artwork-vocab.js`. Runs in parallel with `MUSIC_PLAN` step for latency budget.

**status:** implemented — LLM call, timeout, defaults fallback, parallel execution all VERIFIED.

**gaps:**

- 400ms timeout has no env override — production tuning requires a code deploy.
- Default fallback vars are static per-occasion entries in `artwork-vocab.js` — timeout silently produces lower-quality, generic artwork with no visibility to user or operator.

**key_files:**

- `src/services/artwork-vars-extractor.js`
- `src/services/artwork-vocab.js`

**db_tables:** _(none)_

---

### 19. Artwork Prompt Assembly

**feature:** Structured artwork variables assembled into a final image generation prompt string.

**user_story:** Artwork vars slots are combined with occasion-specific phrasing and a negative prompt to drive the image model.

**expected_behavior:** `artwork-prompts.js`: `assemblePrompt({occasion, vars})` builds deterministic prompt string from `PROMPT_TEMPLATE_VERSION` constant + vocab slots. `assembleNegativePrompt()` provides static negative terms. `PROMPT_TEMPLATE_VERSION` is included in the content hash in `song-artwork.js`, enabling cache busting when prompt templates change.

**status:** implemented — assembly, versioning, negative prompt all VERIFIED.

**gaps:**

- Single prompt template per occasion — no tone/style variation within an occasion (e.g., a "funny" birthday poem drives the same image prompt as a "heartfelt" one).

**key_files:**

- `src/services/artwork-prompts.js`

**db_tables:** _(none)_

---

### 20. OG Text Utilities

**feature:** Shared text helpers used by all OG image SVG composition services.

**user_story:** Song and poem OG images render text consistently — truncation, XML-safe escaping, word-wrap, occasion label formatting.

**expected_behavior:** `og-text-utils.js`: `escapeXml()` (XML entity escaping), `truncateWithEllipsis(str, maxLen)`, `wrapText(str, maxCharsPerLine, maxLines)` (word-wrap), `formatOccasion(key)` (slug → display label). Used by `song-og-generator.js`, `poem-og-generator.js`, `song-og-variants.js`, `poem-og-variants.js`.

**status:** implemented — all helpers VERIFIED in use across OG services.

**gaps:**

- `wrapText()` uses character count not pixel/em width — font metrics not considered. Long words in a narrow SVG viewport can overflow without truncation or hyphenation.

**key_files:**

- `src/services/og-text-utils.js`

**db_tables:** _(none)_

---

## Summary

| #   | Feature                                             | Status                   |
| --- | --------------------------------------------------- | ------------------------ |
| 1   | Poem Generation (LLM)                               | implemented              |
| 2   | Poem CRUD & Library                                 | implemented              |
| 3   | Poem Share Token & Web Viewer                       | implemented              |
| 4   | Poem OG Image (Social Share Card)                   | implemented              |
| 5   | Blog Post Generation (Autofill)                     | implemented              |
| 6   | Blog Deterministic SEO/GEO/AEO Review Gate          | implemented              |
| 7   | Blog LLM Editorial Review                           | implemented              |
| 8   | Blog Format & Repair                                | implemented              |
| 9   | Blog Render (HTML + JSON-LD SEO)                    | implemented              |
| 10  | Blog Publish / Archive                              | **partial**              |
| 11  | Song Artwork Generation                             | implemented              |
| 12  | Artwork Moderation                                  | implemented              |
| 13  | Cover Image Generation (SVG legacy + V2 compositor) | implemented              |
| 14  | Song OG Image (Social Share Card)                   | implemented              |
| 15  | Song OG Image Variants (A/B preview)                | implemented (debug only) |
| 16  | Poem OG Image Variants (A/B selection)              | implemented              |
| 17  | Image Providers (Flux + OpenAI)                     | implemented              |
| 18  | Artwork Variables Extractor (LLM)                   | implemented              |
| 19  | Artwork Prompt Assembly                             | implemented              |
| 20  | OG Text Utilities                                   | implemented              |

## Top 5 Robustness Gaps

1. **Song OG images not cached** (`song-og-generator.js`) — generated on every social crawler request with `Cache-Control: no-store`; a viral share link will hammer the sharp pipeline on every unfurl.
2. **Poem OG cache never invalidated on edit** (`poem-og-generator.js`) — disk cache is keyed on `shareId`, not content hash; editing poem verses after sharing permanently serves stale OG cards.
3. **Flux has no pre-flight moderation** (`song-artwork.js` / `flux-image.js`) — the OpenAI `moderationCheck()` only runs on the fallback path; the primary Flux provider sends prompts to Replicate without any prior screening.
4. **Artwork vars extractor 400ms timeout is fixed** (`artwork-vars-extractor.js`) — no env override; cold-start Haiku responses routinely exceed this, silently degrading to static default vocab and producing generic artwork with no operator visibility.
5. **Blog publish/archive admin API is missing or out of scope** (`routes/blog.js` is 1.5KB) — no create/update/publish/force-publish endpoint visible; the blog CMS is effectively read-only from the audited route surface.

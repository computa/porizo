# PoemsBlogArtwork — Robustness Gap Verification (P2/P3)

**Date:** 2026-06-22  
**Method:** Every gap verified against actual source files before verdict.  
**Scope:** 20 claimed gaps across F1–F20.

---

## Verdict Table

| ID  | Verdict                    | Evidence                                                                                                                                                                                                                                                                      |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **REAL**                   | `poem-generator.js`: no retry on unparseable LLM JSON — catch immediately throws `POEM_GENERATION_FAILED`. No watchdog to flip `generating→generation_failed` on server crash.                                                                                                |
| F2  | **REAL**                   | `poems.js` PATCH (lines ~344–380): `VALID_POEM_STATUSES` includes `published`; no guard checks that `verses` is non-empty before accepting the status write.                                                                                                                  |
| F3  | FALSE_POSITIVE             | `ensurePoemShareIsReady` (`sharing.js:416`) returns 503 for pending/generating; `generation_failed` follows same pattern. No-deep-link for poems is a product decision.                                                                                                       |
| F4  | **REAL**                   | `sharing.js:699–713`: OG disk cache path keyed on `shareId+variant` (no content hash, no TTL). Verses edited after share creation produce stale cached images indefinitely.                                                                                                   |
| F5  | **REAL**                   | `admin.js:904` `/blog/posts/autofill` calls `inferBlogDraftFields` and overwrites all draft fields unconditionally — no diff/merge/confirm guard for existing manual edits.                                                                                                   |
| F6  | **REAL**                   | `blog-review-service.js`: SEO/GEO/AEO score thresholds are hardcoded constants with no `process.env` override — tuning requires a code deploy.                                                                                                                                |
| F7  | FALSE_POSITIVE (BY DESIGN) | `blog-editorial-review-service.js:145`: "You do not decide the hard publish gate." Advisory-only verdict is intentional; deterministic gate (F6) is the real blocker.                                                                                                         |
| F8  | FALSE_POSITIVE (BY DESIGN) | `blog-repair-service.js:145,169`: `ensureInternalLinks` takes `report` param by design (repair runs after review). `ensureHeroImage` sets `DEFAULT_HERO_IMAGES` — behaviour is clear in code.                                                                                 |
| F9  | **REAL**                   | `blog-render-service.js:561`: `CANONICAL_OVERRIDES` is a hardcoded dict — adding/changing slug redirects requires a code deploy. Also: `hero_image_url` passes only `safeUrl()` (scheme check), no dimension validation.                                                      |
| F10 | FALSE_POSITIVE (BY DESIGN) | All CMS routes (create `admin.js:936`, update `:973`, publish `:1169`, unpublish `:1203`) live in admin routes — intentionally admin-gated, not missing.                                                                                                                      |
| F11 | FALSE_POSITIVE             | `artwork-vars-extractor.js:26`: default timeout is **8000 ms** (400 is `maxOutputTokens`, not ms). `song-artwork.js:285–288`: missing library files throw an explicit descriptive error, not a silent failure.                                                                |
| F12 | FALSE_POSITIVE (BY DESIGN) | `flux-image.js:274`: comment explicitly documents "No moderationCheck — Replicate gates at generation time." Intentional design.                                                                                                                                              |
| F13 | **REAL**                   | `cover-generator.js:149–152`: missing `sharp` returns `null` + `console.warn` only — no error thrown to job tracker, caller silently receives `null`. No deprecation comment on `generateCover()` vs active `compositeArtworkWithText` path.                                  |
| F14 | **REAL**                   | `sharing.js:654`: song OG image generated fresh every request, `Cache-Control: no-store`. No disk cache unlike poem OG. A single viral share = one sharp pipeline call per social-crawler refetch.                                                                            |
| F15 | FALSE_POSITIVE (BY DESIGN) | OG variant routing is for preview/A-B testing; no production routing is an early-stage product decision.                                                                                                                                                                      |
| F16 | FALSE_POSITIVE             | `getPoemOgGenerator(null)` falls back to default generator — runtime is safe; this is a documentation gap only.                                                                                                                                                               |
| F17 | **REAL**                   | `image-providers/index.js:31–33`: `ModerationRefusalError instanceof` unreliable cross-adapter is documented but any new consumer that skips the comment will break. `flux-image.js:182–184`: wall-clock deadline consumed silently by slow poll steps — no per-step timeout. |
| F18 | FALSE_POSITIVE             | `artwork-vars-extractor.js:26`: default is 8000 ms; `HAIKU_TIMEOUT_MS_DEFAULT` is exported so callers can override. Claim of "400 ms hardcoded" is wrong.                                                                                                                     |
| F19 | FALSE_POSITIVE (BY DESIGN) | Single prompt per occasion is a product feature scope, not a robustness gap.                                                                                                                                                                                                  |
| F20 | **REAL**                   | `poem-og-generator.js:29,56`, `poem-og-variants.js:59`: `wrapText` uses character count not font metrics — long words in narrow SVG viewports overflow with no truncation or hyphenation.                                                                                     |

---

## Confirmed-Real Gaps (10 of 20)

| ID  | File:Location                                 | Issue                                                                             | One-line fix                                                                                                   | Severity |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| F1  | `src/services/poem-generator.js` catch block  | No LLM retry; status stuck `generating` on crash                                  | Add 1 retry on JSON parse failure; add job-runner watchdog to time-out stale `generating` rows                 | Medium   |
| F2  | `src/routes/poems.js` ~line 344               | `PATCH` accepts `status=published` with empty `verses`                            | Add guard: `if (updatedStatus === 'published' && !parsedVerses?.length) return 400`                            | Low      |
| F4  | `src/routes/sharing.js:699–713`               | Poem OG disk cache keyed on `shareId`, no TTL                                     | Key cache file on `${shareId}-${contentHash}.jpg`; derive hash from `verses` JSON                              | Medium   |
| F5  | `src/routes/admin.js:904`                     | `/blog/posts/autofill` silently overwrites manual edits                           | Check if post has non-empty `body_markdown`; return 409 or require `?force=true`                               | Low      |
| F6  | `src/services/blog-review-service.js`         | SEO/GEO/AEO thresholds hardcoded                                                  | Read from `process.env.SEO_PASS_THRESHOLD` / `GEO_PASS_THRESHOLD` with current values as defaults              | Low      |
| F9  | `src/services/blog-render-service.js:561`     | `CANONICAL_OVERRIDES` hardcoded; `hero_image_url` no dimension check              | Move overrides to DB/env config; add OG dimension validation in review gate                                    | Low      |
| F13 | `src/services/cover-generator.js:149–152`     | Missing `sharp` returns `null` silently                                           | Throw `new Error('sharp unavailable')` instead of returning `null`; add `@deprecated` JSDoc to `generateCover` | Low      |
| F14 | `src/routes/sharing.js:654`                   | Song OG image regenerated on every request, no cache                              | Add disk cache keyed on `shareId+variant+artworkHash`; set `Cache-Control: public, max-age=86400`              | Medium   |
| F17 | `src/services/image-providers/index.js:31–33` | `ModerationRefusalError instanceof` unreliable; Flux per-step poll timeout absent | Export a shared `isModerationRefusal(err)` helper; add per-poll-step `AbortSignal` timeout in Flux adapter     | Medium   |
| F20 | `src/services/poem-og-generator.js:29,56`     | `wrapText` uses char count — long words overflow SVG                              | Add word-length guard: truncate/hyphenate any word exceeding `maxCharsPerLine` before wrapping                 | Low      |

---

## Summary

**10 REAL / 10 FALSE_POSITIVE-or-BY_DESIGN**

Key false-positive corrections vs. discovery agent:

- **F11** (400 ms timeout): timeout is 8000 ms; 400 is `maxOutputTokens`.
- **F10** (missing blog CMS routes): all live in `admin.js` — by design.
- **F7** (editorial verdict blocks publish): explicitly advisory by design.
- **F12** (Flux no pre-flight moderation): explicitly documented design choice.
- **F18** (env override): `HAIKU_TIMEOUT_MS_DEFAULT` is exported and overridable.

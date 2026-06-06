# Artwork Generator Redesign — Session Handoff (final)

**Updated:** 2026-05-19 ~02:50 GMT+8
**Branch:** `feature/artwork-v2`
**HEAD:** `00deaed`
**Progress:** 15 of 16 tasks complete; Task 12 deferred by design (see below); Task 16 is operator-only.

## Cross-cutting review findings — fixed in `00deaed`

A 4-agent PR review (code-reviewer + silent-failure-hunter + test-analyst + comment-analyst) ran against the whole branch and surfaced two critical bugs that the per-task cycle missed because each lived across two task boundaries:

- **C1: OpenAI fallback unreachable.** `MIN_PROVIDER_IMAGE_WIDTH/HEIGHT = 1280` in `song-artwork.js` rejected the OpenAI fallback's `size: "1024x1024"` output 100% of the time, sending every Flux infra failure straight to the library and skipping OpenAI entirely. Lowered the floor to 1024 + added a regression test.
- **C2: Haiku extractor fed a JSON blob instead of lyrics.** `resolveArtworkVars` did `parsed.text || parsed.lyrics || JSON.stringify(parsed)` but `buildLyrics` (in `src/writer/songwriter.js`) actually emits `{sections:[{name,lines:[]}], title, style, anchor_line}` — neither `.text` nor `.lyrics` exists. Every Haiku call was getting a structured JSON dump, defeating the Task 4 lyrics-aware feature in production. Now flattens `sections[].lines[]` to newline-joined text + regression test.

Both fixes landed in commit `00deaed` (4 files, +109/-3, 84/84 tests pass).

## Status at a glance

| #   | Task                                                   | State       | Commit                |
| --- | ------------------------------------------------------ | ----------- | --------------------- |
| 1   | DB migration 113                                       | ✅ done     | `3fffe1d`             |
| 2   | `artwork-vocab.js`                                     | ✅ done     | `c2d1985`             |
| 3   | `artwork-prompts.js` template assembler                | ✅ done     | `21e6a6a`             |
| 4   | `artwork-vars-extractor.js` (Haiku 4.5)                | ✅ done     | `6156ead`             |
| 5   | Flux 1.1 Pro Ultra adapter                             | ✅ done     | `e182020`             |
| 6   | Register Flux in provider registry                     | ✅ done     | `1728c54`             |
| 7   | `song-artwork.js` rewire (vars-based + provider chain) | ✅ done     | `d902526`             |
| 8   | `artwork-job.js` vars extraction + persistence         | ✅ done     | `67b08dd`             |
| 9   | 15 lyrics fixture files                                | ✅ done     | `291623b`             |
| 10  | End-to-end integration test                            | ✅ done     | `b2cf815`             |
| 11  | iOS `BlurBackdropArtwork` component                    | ✅ done     | `64ed1cd`             |
| 12  | Adopt `BlurBackdropArtwork` in RevealBloomView         | ⏸ deferred  | `7b611d6` (note only) |
| 13  | Audit artwork URL wiring (read-only)                   | ✅ done     | no commit             |
| 14  | Library v2 bootstrap script                            | ✅ done     | `11b2f97`             |
| 15  | `ARTWORK_V2_ENABLED` feature flag                      | ✅ done     | `62decab`             |
| 16  | Manual QA + cutover                                    | ⏳ operator | n/a                   |

Plus one parallel commit from Codex:

- `6ec6057 Add living artwork motion to web player` — unrelated web-player enhancement that landed on this branch. Includes a 2-line TypeScript cleanup to `flux-image.js` (renames `size`/`quality` to `_size`/`_quality` to silence TS6133). Benign; leave intact.

## Task 12 — deferred and why

The plan's Task 12 targets `PorizoApp/PorizoApp/Flows/RevealBloomView.swift`, but that view doesn't render artwork — it's the coral-gradient bloom + checkmark + play CTA moment. Applying the plan's code literally would delete the play button, share button, waveform, and tertiary links — a major UX regression.

The actual artwork-rendering surfaces are `SharePostcardView.swift` and `WarmCanvasFlowView.swift` (and `NowPlayingView`/`NowPlayingManager`/`SongCoverView` for active-playback contexts). The `BlurBackdropArtwork` component is built and reusable; which surface adopts it is a design decision that should happen during Task 16's manual QA when a real Flux-generated image is in hand. Full reasoning lives in `docs/superpowers/plans/2026-05-18-artwork-generator-redesign-TASK-12-NOTE.md`.

## Task 16 — what the operator needs to do

This is the manual gate before flipping `ARTWORK_V2_ENABLED=true` in prod:

1. **Bootstrap the library** (Task 14 produces the script; it hasn't been run yet — costs ~$4.50):
   ```bash
   REPLICATE_API_TOKEN=$REPLICATE_API_TOKEN node scripts/build-artwork-library-v2.mjs
   ```
2. **QA every image** per `scripts/build-artwork-library-v2.README.md`. Delete + `--occasions=` re-roll any that fail the "is this AI?" test in <1 second.
3. **Commit the library** (storage paths are gitignored by default — check `.gitignore` before assuming `git add storage/artwork-library/v2/` works).
4. **Decide which iOS surface adopts `BlurBackdropArtwork`** (see Task 12 deferral note).
5. **Generate one full-pipeline render per occasion** end-to-end (real Flux, real Haiku) and eyeball each.
6. **Flip `ARTWORK_V2_ENABLED=true`** for paid users first; observe for 24-48 hours; then enable for free tier.
7. **Kill-switch ready:** `ARTWORK_V2_ENABLED=false` reverts every paid user to the library path with no code deploy.

## Outstanding non-blocking items (technical debt log)

These were flagged by code reviewers during Tasks 5-8 and are non-blocking but worth a follow-up commit before merge:

1. **`flux-image.js` `DEFAULT_TIMEOUT_MS` missing `Number.isFinite` guard** — mirror the validation pattern in `openai-image.js:27-31` to prevent a malformed `FLUX_TIMEOUT_MS` env from making the polling loop exit immediately with "timed out after NaNms". 4-line copy.
2. **`flux-image.js` no per-fetch AbortController** — the polling-loop timeout doesn't bound the bracketing POST/poll/download fetches. Currently relies on platform fetch defaults. Add `AbortController` per fetch for proper timeout discipline.
3. **`song-artwork.js:187` dead `source = "fallback"` default** — unconditionally overwritten by both branches; initialize as `let source;` to avoid misleading initial state.
4. **`song-artwork.js` `pickLibraryVariant`-then-`libraryPathFn` duplication** — paid-fallback (line 224) and free-tier (line 228) compute the same `libraryPathFn(occasion, pickLibraryVariant({userId, trackId}))`. Extract a one-line helper.
5. **`song-artwork.js` asymmetric `moderationCheck`** — OpenAI fallback runs a pre-flight `moderationCheck` but Flux primary doesn't. Add a one-line comment explaining the intent (Flux is cheap, so we let it gate at generation; OpenAI is expensive, so we pre-check). No behavior change.
6. **`artwork-job.js` `fallback_extractor_error` sentinel too broad** — fires for actual extractor throws AND for DB-read failures AND for empty lyrics. Consider splitting into more specific sentinels matching the `artwork-vars-extractor.js` family (`fallback_parse_error`, `fallback_empty_lyrics`, etc.) so observability can distinguish failure modes.
7. **`image-providers/index.js:33` "likely via" → "via"** — the comment predicted Task 7 would use `err.name` duck-typing. Task 7 did. Tighten the comment now that the contract is satisfied.
8. **`MODELS.anthropic.simple` still points to Haiku 3** in `src/services/llm-provider.js:39`. Spec says vars extractor should use Haiku 4.5. Currently routed through the `simple` lane which points to `claude-3-haiku-20240307`. Bumping this affects every other `simple`-lane caller (`memory-questions`, `blog-editorial-review`, v3 writer fallback) — file as a separate ticket and weigh blast radius before flipping.
9. **Spec doc §6.7 abbreviated species names** — `"eucalyptus"`, `"cherry blossom pair"` in the defaults table don't match the §6.6 species menus. Code uses the canonical menu entries (`"eucalyptus stems"`, `"two cherry blossom branches"`). Patch the spec doc to remove the discrepancy.

## Resume command

Most work is done. To continue (post-Task-12 design decision + Task 16 manual QA):

```
The artwork-v2 branch is feature-complete except for Task 12 (deferred — see
docs/superpowers/plans/2026-05-18-artwork-generator-redesign-TASK-12-NOTE.md)
and Task 16 (operator manual QA). HEAD is 62decab on feature/artwork-v2.

Next steps require human decisions:
1. Which iOS surface(s) adopt BlurBackdropArtwork? (Task 12)
2. Bootstrap and QA the photoreal library (Task 16 step 1-3)
3. Optionally fold in the 9 polish-pass items from the handoff doc
```

## Branch summary

```
$ git log --oneline ec54112..HEAD
62decab feat(artwork): ARTWORK_V2_ENABLED feature flag
11b2f97 feat(artwork): library v2 bootstrap script
7b611d6 docs(artwork): defer Task 12 — RevealBloomView has no artwork rendering
64ed1cd feat(ios): BlurBackdropArtwork SwiftUI component
b2cf815 test(artwork): end-to-end stubbed pipeline integration
291623b test(artwork): golden lyrics fixtures for all 15 occasions
6ec6057 Add living artwork motion to web player          ← Codex parallel work
67b08dd feat(artwork): job extracts lyrics→vars before generation
d902526 feat(artwork): vars-based pipeline, flux primary + openai fallback
1728c54 feat(images): register flux in provider registry
e182020 feat(images): flux 1.1 pro ultra adapter via replicate
518bbaf docs(artwork): session handoff at 4/16 tasks complete
10fa049 fix(artwork): route vars extractor to Haiku lane, not Sonnet 4
b0dae46 chore(artwork): collapse test IIFE in artwork-vars-extractor
6156ead feat(artwork): lyrics → bounded-vocab vars extractor (Haiku 4.5)
dfb3443 chore(artwork): drop unused IMPERFECTION import in artwork-prompts
21e6a6a feat(artwork): replace prompt builder with template assembler
23b16c2 test(artwork): lock the defaults-validity invariant
c2d1985 feat(artwork): curated slot vocabulary for lyrics-aware prompting
3fffe1d feat(db): migration 113 — add artwork vars/provider/prompt_version columns
```

All 19 commits attributed correctly (`Co-authored by Ambrose Obimma`, no Claude footers — except Codex's `6ec6057` which uses Codex attribution).

## Working tree noise

Unchanged from session start: many unrelated modified/untracked files (marketing/, scripts/aso/, PorizoApp Xcode user state, etc.). All 11 new commits this session used surgical `git add <path>` to keep scope clean. Continue this pattern.

## Lessons saved to memory this session

- `feedback_porizo_amend_hook_hijack.md` — Porizo workflow hook auto-stages unrelated files on bare `git commit --amend --no-edit`. Always use `--only <paths>`.

# Artwork Generator Redesign — Session Handoff

**Paused:** 2026-05-18 ~17:00 GMT+8
**Branch:** `feature/artwork-v2`
**HEAD:** `10fa049`
**Progress:** 4 of 16 tasks complete

## Resume command

In a fresh session, run this single line:

```
/superpowers:subagent-driven-development
```

Then paste the args block below.

```
Plan: docs/superpowers/plans/2026-05-18-artwork-generator-redesign.md
Spec: docs/superpowers/specs/2026-05-18-artwork-generator-redesign-design.md (committed as ec54112)
Handoff doc: docs/superpowers/plans/2026-05-18-artwork-generator-redesign-HANDOFF.md

Resume at Task 5 (Flux 1.1 Pro Ultra adapter). Tasks 1-4 already shipped on branch feature/artwork-v2 (HEAD: 10fa049). Continue the same flow — per-task implementer subagent + spec compliance reviewer + code quality reviewer + commit. Commit attribution: "Co-authored by Ambrose Obimma" (NO Claude footer).
```

## What's done

| #   | Task                                                                                       | Commits                                                         |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1   | DB migration 113 (artwork_vars_json / artwork_provider / artwork_prompt_version)           | `3fffe1d`                                                       |
| 2   | `artwork-vocab.js` — slot menus, per-occasion defaults, lookup helpers                     | `c2d1985`, `23b16c2` (defaults-invariant test)                  |
| 3   | `artwork-prompts.js` — template assembler, replaces old paper-art/watercolor builder       | `21e6a6a`, `dfb3443` (unused-import cleanup)                    |
| 4   | `artwork-vars-extractor.js` — Haiku lyrics→vars picker with bounded vocab + fallback chain | `6156ead`, `b0dae46` (test cleanup), `10fa049` (Haiku-lane fix) |

## What's pending (Tasks 5-16)

Source-of-truth is the plan file at `docs/superpowers/plans/2026-05-18-artwork-generator-redesign.md`. Tight list below:

5. **Flux 1.1 Pro Ultra adapter** — `src/services/image-providers/flux-image.js`, Replicate API, 6 tests
6. **Provider registry** — Register `flux` in `src/services/image-providers/index.js`, 4 tests
7. **`song-artwork.js` rewire** — vars-based pipeline + `tryProviderChain` (Flux primary, OpenAI fallback on infra failure, library fallback on moderation refusal); drop `pickStyleVariant`. 3 new tests + remove obsolete style-variant tests.
8. **`artwork-job.js`** — extract vars before generation, persist `artwork_vars_json` + `artwork_provider` + `artwork_prompt_version`. Stay inside the job; do NOT add an R1.5 step to `workflows/runner.js`.
9. **15 lyrics fixture files** — `test/fixtures/lyrics/{occasion}.txt`, verbatim content in plan
10. **End-to-end integration test** — `test/services/artwork-pipeline.integration.test.js`, stubbed all the way through
11. **`BlurBackdropArtwork.swift`** — reusable iOS component, ZStack with blurred backdrop + scaledToFit foreground
12. **`RevealBloomView.swift`** — adopt `BlurBackdropArtwork` + gradient-scrim title overlay
13. **URL wiring audit** — read-only confirm `NowPlayingView`, `NowPlayingManager`, `SongCoverView`, `SharePostcardView` consume the new canonical asset URL
14. **Library v2 bootstrap script** — `scripts/build-artwork-library-v2.mjs` (don't run it; operator does)
15. **`ARTWORK_V2_ENABLED` feature flag** — in `song-artwork.js`
16. **Manual QA + cutover** — operator step (not done by subagents)

## Real bugs surfaced by the review cycle so far

Both are worth knowing about when continuing:

1. **Spec §6.7 abbreviated species names** — `"eucalyptus"`, `"cherry blossom pair"` in the defaults table didn't exist in the §6.6 species menus. Implementer (Task 2) substituted the canonical menu entries (`"eucalyptus stems"`, `"two cherry blossom branches"`). The committed code is correct; the spec doc still has the bad abbreviations. **Doc-hygiene followup** — patch spec §6.7 to use canonical menu entries.

2. **Wrong Anthropic model in the plan-as-written** — Plan/code routed `taskType: "lyrics"` which maps to `claude-sonnet-4-20250514` in `llm-provider.js`, violating the spec's mandate of `claude-haiku-4-5`. Fixed in `10fa049` by switching to `taskType: "simple"`. **Open issue:** `MODELS.anthropic.simple` in `src/services/llm-provider.js:39` currently points to `claude-3-haiku-20240307` (Haiku 3). To fully honor spec the constant should bump to Haiku 4.5, but that change affects every other simple-lane caller in the codebase (memory-questions, blog-editorial-review, v3 writer fallback). **File as separate ticket** before launch.

## Branch state

```
$ git log --oneline ec54112..HEAD
10fa049 fix(artwork): route vars extractor to Haiku lane, not Sonnet 4
b0dae46 chore(artwork): collapse test IIFE in artwork-vars-extractor
6156ead feat(artwork): lyrics → bounded-vocab vars extractor (Haiku 4.5)
dfb3443 chore(artwork): drop unused IMPERFECTION import in artwork-prompts
21e6a6a feat(artwork): replace prompt builder with template assembler
23b16c2 test(artwork): lock the defaults-validity invariant
c2d1985 feat(artwork): curated slot vocabulary for lyrics-aware prompting
3fffe1d feat(db): migration 113 — add artwork vars/provider/prompt_version columns
```

All 8 commits attributed correctly (`Co-authored by Ambrose Obimma`, no Claude footers).

## Known broken state

The plan explicitly accepted this: Task 3 deleted the old `artwork-prompts.js` exports (`VALID_OCCASIONS`, `VALID_STYLES`, `buildPrompt`, etc.) without rewiring downstream consumers. **`src/services/song-artwork.js` imports the now-deleted symbols and will fail to load until Task 7 ships.** Other tests that exercise the old pipeline may also fail. This is intentional; do NOT patch song-artwork.js outside Task 7.

To verify the scope of breakage in the new session:

```bash
node -e "require('./src/services/song-artwork')" 2>&1 | head -5
node --test test/services/song-artwork.test.js 2>&1 | tail -20
```

Expected: errors about missing exports from `artwork-prompts.js`. Task 7 fixes them.

## Cleanup before next session

Optional — the brainstorming visual-companion server may still be running. To stop it:

```bash
/Users/ao/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/brainstorming/scripts/stop-server.sh /Users/ao/Documents/projects/porizo/.superpowers/brainstorm/40836-1779094755
```

The `.superpowers/` directory is already gitignored — you can leave it or delete it.

## Working tree noise

The working tree has many unrelated modified/untracked files from the prior session (marketing/, scripts/aso/, etc.). All 8 commits on this branch used surgical `git add <path>` to avoid contaminating commits with those changes. Continue this pattern.

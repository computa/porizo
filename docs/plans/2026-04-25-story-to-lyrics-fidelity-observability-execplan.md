# Harden story-to-lyrics observability and fidelity diagnostics

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows the global ExecPlan standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Ambrose needs the next live song-generation test to answer concrete questions instead of producing more guesswork. After this change, a fresh production render will tell us which large language model handled each stage, how much story detail survived into the songwriter prompt, whether prompt compaction removed important content, whether lyrics were regenerated or reused from cache, and how much detail fidelity the resulting lyrics retained. The user-visible result is better diagnostics, not different lyrics yet.

## Progress

- [x] (2026-04-25 14:35 AWST) Audited the current story-to-lyrics pipeline and identified the key blind spots: memoized lyric skips, weak songwriter input/output summaries, and ambiguous LLM logs for story stages.
- [ ] Implement observability helpers for story packaging, prompt budgeting, lyric output summaries, and fidelity summaries.
- [ ] Persist the most useful lyric-generation metadata into provenance so cached lyrics can still be inspected later.
- [ ] Add targeted tests covering the new helpers and logging-adjacent behavior.
- [ ] Run validation (`npm test`, `npm run lint`) and update this plan with outcomes.

## Surprises & Discoveries

- Observation: the writer already computes most of the fidelity signals we need, including retained detail counts, missing required details, coverage stats, song-map structure, and judge feedback; most of it simply never reaches live render logs.
  Evidence: `src/routes/story.js` serializes `completed_story_package` with `retained_details`, `detail_coverage_stats`, `missing_required`, `detail_budget_warning`, and `llm_rewrite_applied`, while `src/workflows/runner.js` currently logs none of it during lyric generation.

- Observation: the V3 structured reasoner currently calls the shared LLM layer with `taskType: "lyrics"` for JSON parsing stages, which makes LLM logs ambiguous even when the request is really story reasoning.
  Evidence: `src/writer/v3/reasoner.js` `attemptStructuredResponse()` passes `taskType: "lyrics"` into `generateText()`.

## Decision Log

- Decision: keep this pass focused on observability and provenance, not lyric-behavior changes.
  Rationale: changing lyric-writing behavior and logging at the same time would make it harder to attribute improvements or regressions.
  Date/Author: 2026-04-25 / Codex

- Decision: add a log label separate from `taskType` in the shared LLM service instead of changing the V3 reasoner model-selection path immediately.
  Rationale: we need truthful logs now, but changing `taskType` could silently change model selection and destabilize story generation.
  Date/Author: 2026-04-25 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

The lyric-generation path spans four main files. `src/workflows/runner.js` owns the render pipeline and decides whether lyrics are generated or skipped from cache. `src/writer/lyrics-context.js` rebuilds the full songwriter context from a persisted track. `src/writer/songwriter.js` turns that context into a songwriter prompt, applies prompt-budget trimming, generates lyrics, and runs the fidelity judge. `src/services/llm-provider.js` is the shared LLM wrapper that logs provider/model attempts and fallbacks.

The term “completed story package” means the authoritative story representation produced by the V3 story engine. It already includes the refined prose, a retained-detail inventory, a coverage map showing which details are preserved or missing, and optional warnings when the story is too large. The term “provenance” means the JSON metadata persisted on a track version so later steps can explain how the artifact was produced.

Today’s failure mode is not that the system lacks fidelity information. It is that the information is fragmented. Some of it is emitted during confirmation, some of it is returned from the lyric generator, and almost none of it is logged in the live render path when Ambrose actually tests a song.

## Plan of Work

First, extend `src/services/llm-provider.js` so each call can carry a human-readable log label and prompt token estimate without changing model-selection behavior. This will let story stages log as story stages even when they intentionally reuse the “lyrics” model profile.

Second, add pure summarizer helpers in `src/writer/songwriter.js` and `src/writer/lyrics-context.js` for the exact story packaging diagnostics we care about: narrative length, retained-detail counts, missing-required previews, song-map section counts, memory-answer counts, and lyric output summaries. Use those helpers in both the live lyric-generation path and the memoized skip path in `src/workflows/runner.js`.

Third, persist the most useful lyric-generation metadata in `provenance_json` so a cached run still shows the provider, model, quality score, fidelity score, prompt-budget compactions, and packaging summary. This keeps later inspections from depending on ephemeral Railway logs alone.

Fourth, add focused tests in `test/lyrics.test.js` to lock down the new summary helpers and the prompt-budget reporting path. The tests should prove we do not break lyric generation while adding observability.

## Concrete Steps

Work from the repository root:

  cd /Users/ao/Documents/projects/porizo

Inspect the relevant files before editing:

  sed -n '2060,2205p' src/workflows/runner.js
  sed -n '1,260p' src/writer/lyrics-context.js
  sed -n '1830,2555p' src/writer/songwriter.js
  sed -n '1,760p' src/services/llm-provider.js

After edits, run:

  npm test
  npm run lint

Expected acceptance evidence includes:

  - `npm test` finishes with zero failures.
  - `npm run lint` finishes without new lint errors.
  - a fresh production render logs the lyric input summary, compaction summary, candidate lyric summary, fidelity summary, and Suno model.
  - a cached render logs that lyrics were skipped and includes the stored provider/model/quality/fidelity metadata rather than staying silent.

## Validation and Acceptance

Acceptance is not “logs exist somewhere.” Acceptance means the next fresh story render answers these questions directly from live logs or persisted provenance:

1. Which LLM provider and model handled story reasoning, lyric generation, and the fidelity judge?
2. How large was the story package before lyric generation, including retained details and missing required details?
3. Did prompt compaction remove narrative text, supporting context, or key details?
4. Were lyrics freshly generated or memoized from a prior run?
5. What fidelity score did the lyrics achieve, and what specific story beats or details were still missing?

## Idempotence and Recovery

These changes are safe to re-run. The plan adds logging and provenance fields but does not change the database schema. If a deployment needs to be retried, the only persistent effect is richer provenance data on new lyric generations. Existing tracks remain readable because the provenance merge is additive.

## Artifacts and Notes

The key evidence to preserve after implementation is one representative live log sequence showing:

  [JobRunner] Lyrics context summary=...
  [Songwriter] Prompt input summary=...
  [Songwriter] Prompt compaction summary=...
  [Songwriter] Candidate lyrics summary=...
  [Songwriter] Fidelity summary=...
  [Suno] Submitting ... model=V5_5 ...

## Interfaces and Dependencies

The shared LLM layer in `src/services/llm-provider.js` will gain an optional `logLabel` string. Callers may provide it, but existing callers must continue working without changes. The songwriter module will expose pure summary helpers for tests. `src/workflows/runner.js` will continue to call `generateLyrics()` the same way, but it will log and persist additional metadata returned from the songwriter result.

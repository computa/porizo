# Story V3 Gap-Driven Questioning and Robust Orchestration

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own `PLANS.MD`, so this plan follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Users currently receive generic follow-up questions during story collection, which produces weak story context and inconsistent output quality. This plan introduces deterministic, gap-driven questioning on top of the existing V2 pipeline so each turn asks one high-value question tied to a specific missing slot. Users should see concrete, targeted prompts and transparent progress metadata (`target_slot`, `missing_slots`, `readiness_score`) before story confirmation.

## Progress

- [x] (2026-02-10 18:26Z) Read constraints and architecture context (`CLAUDE.md`, `specs/personalized-song-platform-spec.md`, `docs/architecture-and-flows.md`, `~/.codex/PLANS.MD`).
- [x] (2026-02-10 18:31Z) Wrote detailed V3 specification at `docs/newStory/specv3.md`.
- [x] (2026-02-10 19:22Z) Implemented deterministic slot coverage + gap analysis helpers in `src/writer/v2/quality.js`.
- [x] (2026-02-10 19:24Z) Integrated deterministic question override, confirm gating, and gap telemetry in `src/writer/v2/index.js`.
- [x] (2026-02-10 19:25Z) Surfaced metadata through `src/writer/index.js` and `src/routes/story.js` responses.
- [x] (2026-02-10 19:26Z) Added/adjusted tests in `test/writer/v2/quality.test.js`, `test/writer/v2/orchestration.test.js`, and `test/writer/v2/api-integration.test.js`.
- [x] (2026-02-10 19:27Z) Ran `npm run lint` and `npm test` successfully.
- [x] (2026-02-10 19:58Z) Added deterministic fallback extractor (`atoms`/`primitives`/`facts`) and repeat-slot escape rule; validated progression via manual API run.
- [x] (2026-02-10 20:03Z) Implemented phase-2 orchestration modules (`contracts`, `http-debugger`, `repo-patterns`, orchestration `index`) with tests.
- [x] (2026-02-10 20:06Z) Wired phase-2 orchestration routes behind `ENABLE_V3_ORCHESTRATION_ROUTES`, added safe in-process debug-loop execution via `app.inject`, and added route coverage tests.
- [x] (2026-02-10 11:47Z) Enforced admin-only auth for all `/story/v3/orchestration/*` routes and added concrete backend task execution route (`/story/v3/orchestration/backend-task/execute`) with repository scan + pattern/trajectory outputs.
- [x] (2026-02-10 11:59Z) Added persistent orchestration execution records (DB migration + list/get/replay endpoints) for admin replay/audit.
- [x] (2026-02-10 11:59Z) Wired external coding-agent runtime mode via `ORCHESTRATION_EXECUTOR_MODE=external` + `ORCHESTRATION_EXTERNAL_COMMAND_JSON` with strict JSON I/O and timeout handling.

## Surprises & Discoveries

- Observation: Prior external proposal package (`porizo-story-engine.zip`) fails TypeScript build and cannot compile as-is.
  Evidence: `tsc` failure: `Property 'partial' does not exist on type 'T'`.
- Observation: Current V2 already has rich fallback and grounding behavior; replacement would regress resilience.
  Evidence: multi-tier fallback in `src/writer/v2/reasoner.js` and grounding enforcement in `src/writer/v2/engine.js`.
- Observation: Current route contract allows backward-compatible metadata extension without breaking existing shape.
  Evidence: `src/routes/story.js` sends permissive JSON payloads and does not enforce rigid response schema.

## Decision Log

- Decision: Evolve V2 with deterministic gap logic rather than replacing with external proposal library.
  Rationale: lower production risk and faster path to quality gains while retaining retry/fallback/moderation guarantees.
  Date/Author: 2026-02-10 / Codex

- Decision: Implement slot coverage logic in `quality.js` and apply deterministic question override in `v2/index.js`.
  Rationale: keeps orchestration centralized and minimizes module churn.
  Date/Author: 2026-02-10 / Codex

- Decision: Keep LangGraph as optional future enhancement, not immediate dependency.
  Rationale: current architecture already supports deterministic loop semantics without framework migration risk.
  Date/Author: 2026-02-10 / Codex

## Outcomes & Retrospective

Phase 1 delivered without introducing new dependencies:

1. deterministic slot-gap analysis and a canonical question priority model,
2. deterministic next-question selection with quick-reply suggestions,
3. premature confirm guard when readiness gates fail,
4. response metadata (`target_slot`, `gap_reason`, `missing_slots`, `weak_slots`, `readiness_score`, `is_story_ready`) exposed through writer + routes,
5. green validation (`npm run lint`, `npm test`).

Remaining work for full V3:

1. add dedicated admin UI pages for orchestration execution browsing/replay controls,
2. define external executor contract versioning and signed artifact verification,
3. tune slot heuristics using production conversation telemetry.

## Context and Orientation

The story backend entrypoint is `src/routes/story.js`, which calls `src/writer/index.js`, which delegates to `src/writer/v2/index.js`. V2 currently uses LLM reasoning (`src/writer/v2/reasoner.js`) and merges updates into state (`src/writer/v2/engine.js`). Quality helpers in `src/writer/v2/quality.js` currently operate mainly on beats and holistic readiness. The missing capability is deterministic slot-gap targeting for the next question.

The implementation adds a deterministic layer after each turn update:

1. inspect state coverage of canonical slots,
2. compute `missing` and `weak` slots,
3. select the next question from a fixed priority order,
4. override generic question text when action is ASK/CLARIFY,
5. emit metadata for client and analytics.

## Plan of Work

First, extend quality helpers with slot-specific scoring and deterministic question selection, including quick-reply sets. Second, wire those helpers into `startStoryV2` and `continueStoryV2` so responses use deterministic gap questions when appropriate and include metadata fields. Third, propagate metadata through writer and route layers. Finally, add focused tests for slot ordering/readiness gates and run lint/tests.

## Concrete Steps

From repository root `/Users/ao/Documents/projects/porizo`:

1. Implement helper APIs in `src/writer/v2/quality.js`:
   - `computeStoryGapAnalysis(state)`
   - `pickDeterministicGapQuestion(gapAnalysis, state)`

2. Integrate in `src/writer/v2/index.js`:
   - after state update, compute gap analysis,
   - if response action is ASK/CLARIFY and a gap question exists, override `response.question`,
   - attach `targetSlot`, `gapReason`, `missingSlots`, `weakSlots`, `readinessScore`, `isStoryReady`.

3. Propagate mapping in `src/writer/index.js` and `src/routes/story.js`:
   - include optional metadata in start/continue responses.

4. Add tests:
   - new/updated tests under `test/writer/v2/quality.test.js`, `test/writer/v2/orchestration.test.js`.

5. Validate:
   - `npm run lint`
   - `npm test`

Expected acceptance snippets:

    POST /story/start response includes target_slot and readiness_score.
    POST /story/:id/continue response includes target_slot for incomplete flows.

## Validation and Acceptance

Behavioral acceptance checks:

1. Starting a story returns one targeted question with `target_slot` and `missing_slots`.
2. Continuing a story advances slot coverage and shifts `target_slot` deterministically.
3. `is_story_ready` remains false when blocker/stakes are missing.
4. Existing conversation/fallback behavior remains functional.

Command acceptance:

- Run `npm run lint` and expect exit code 0.
- Run `npm test` and expect full suite pass (or explicit listing of pre-existing unrelated failures if encountered).

## Idempotence and Recovery

These changes are source-only and idempotent. Re-running tests is safe. If a new deterministic override causes regressions, disable via targeted rollback of `v2/index.js` integration while retaining helper functions and tests for incremental re-enable.

## Artifacts and Notes

Primary artifacts:

- `docs/newStory/specv3.md`
- `docs/newStory/planv3.md`
- code diffs under `src/writer/v2/*`, `src/writer/index.js`, `src/routes/story.js`
- test diffs under `test/writer/v2/*`

## Interfaces and Dependencies

No new external runtime dependencies are required for phase 1. Implementation uses existing Node.js modules and existing moderation/reasoning infrastructure.

New internal function interfaces:

- `computeStoryGapAnalysis(state) -> { slots, missingSlots, weakSlots, readinessScore, isStoryReady, gates }`
- `pickDeterministicGapQuestion(gapAnalysis, state) -> { targetSlot, prompt, quickReplies, reason, inputMode } | null`

Plan revision note:

- 2026-02-10: initial plan created after V3 spec drafting; implementation steps pending execution.
- 2026-02-10: phase-1 deterministic gap questioning implemented and validated; remaining multi-agent orchestration remains future work.
- 2026-02-10: fallback extractor + repeat-slot escape implemented; phase-2 orchestration foundations implemented as tested modules.

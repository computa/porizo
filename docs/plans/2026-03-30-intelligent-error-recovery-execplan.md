# Tighten Error Recovery Without Breaking Story or Render Flows

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Reviewed:** 2026-03-30 by correctness, reliability, API contract, and implementation reviewers (21 findings incorporated)

## Purpose / Big Picture

Users should stop hitting vague dead-end errors such as "Failed to confirm story" when the system already knows what went wrong. After this work, story flow failures that genuinely need user input will return a structured, inline guidance response instead of a generic modal.

The visible proof is simple: a missing-detail confirmation failure should come back as a guided follow-up question that the current conversation UI can display — not a modal error dialog.

## Progress

- [x] (2026-03-30 12:10 AWST) Reviewed old design doc against codebase; confirmed partially stale
- [x] (2026-03-30 12:10 AWST) Verified render pipeline already has shared step-aware classification
- [x] (2026-03-30 12:10 AWST) Verified story APIs do not yet support structured 422 recovery contract
- [x] (2026-03-30 12:10 AWST) Authored tighter replacement plan
- [x] (2026-03-30 13:30 AWST) Specialist review: correctness, reliability, API contract (13 findings)
- [x] (2026-03-30 14:20 AWST) Senior implementation review: state-machine, idempotency, and stale-guidance risks folded back into plan
- [ ] Implement Phase 1 server: structured guidance from confirmStoryV3
- [ ] Implement Phase 1 server: route contract changes in story.js
- [ ] Implement Phase 1 iOS: APIClient + V2StoryEngine guidance handling
- [ ] Add server + client tests
- [ ] Decide Phase 2 async recovery scope after measurement

## Surprises & Discoveries

- The `can_confirm === false` check at v3/index.js:2351 fires BEFORE `ensureCompletedStoryPackage` at line 2363. This means coverage stats are NOT available at the throw point. But `buildSemanticClarificationPrompt(v2State)` IS available and defensively returns a string.

- The existing poem 422 pattern (`APIClient+Story.swift:380-422`) is the exact model to follow. It uses `allowedStatusCodes: Set([422])`, branches on `httpResponse.statusCode`, and decodes a different model per status code.

- `continueStoryV3` does NOT check session status — it doesn't reject calls when session is `ready_for_confirm`. This means after confirm returns guidance, the user's answer via `/continue` will process normally. BUT the session stays in `ready_for_confirm` state unless explicitly reset.

- `TrackCreationController.createTrack` (line 84) and `PoemCreatingView.createPoem` (line 123) both call `confirmStoryV2` as step 1 of a multi-step pipeline. A guidance result must abort the pipeline and return the user to the story conversation screen.

- User story content IS persisted before confirm (by the previous `/continue` call). Additional notes ARE persisted (via revise before confirm). Only confirmation status and LLM narrative enhancement are lost on failure — both regenerated on retry. Safe to say "Your story is saved."

- `session_version` is only useful if the follow-up submission path actually checks it. Merely returning the version in 422 is not enough to prevent stale guidance from being answered against newer session state.

- `confirmStory(storyId, additionalNotes)` is not obviously idempotent when `additional_notes` are present because notes are first applied as a `final_notes` revision and then confirmation runs. A generic "please try again" retry message is too broad until this is addressed.

## Decision Log

- Decision: Split story recovery from render recovery.
  Rationale: Story path has the user-visible generic modal. Render path already has classification. Don't mix blast radii.
  Date/Author: 2026-03-30 / Codex

- Decision: Do not introduce a generic `handleWithRecovery` wrapper.
  Rationale: Story routes have explicit ownership/moderation/rate-limit/version-conflict guards that must stay explicit.
  Date/Author: 2026-03-30 / Codex

- Decision: Use HTTP 422 for guidance responses.
  Rationale: Old iOS decodes 422 body as `APIError` (shows `message` as toast — degraded but functional). New iOS opts in via `allowedStatusCodes` and decodes `StoryGuidanceResponse`. Semantically correct ("understood but need more input").
  Date/Author: 2026-03-30 / API contract review

- Decision: Put guidance data in a top-level `recovery` key, NOT in `details`.
  Rationale: `APIError.details` is typed `[String: String]?` — nested objects would cause decoding failures on old iOS.
  Date/Author: 2026-03-30 / API contract review

- Decision: Include `session_version` in the guidance response.
  Rationale: Guidance can go stale if session is modified concurrently. But the version is only meaningful if the answer submission path also carries an expected version or forces a refresh on mismatch.
  Date/Author: 2026-03-30 / Correctness review

- Decision: Record semantic ask in confirm path, not just continue path.
  Rationale: `MAX_REPEAT_SEMANTIC_ASKS` exhaustion override only fires during `continueStoryV3`. If user retries confirm without going through continue, the same guidance loops indefinitely. Record into `semantic_history`; do NOT mutate `semantic_override` directly.
  Date/Author: 2026-03-30 / Reliability review

- Decision: No global retry budget schema in Phase 1.
  Rationale: Story flows don't use jobs. Budget per-surface only when each surface's persistence scope is clear.
  Date/Author: 2026-03-30 / Codex

- Decision: Wrap guidance construction in its own try/catch with fallback to minimal guidance.
  Rationale: If building structured guidance throws (missingBlocks undefined, prompt builder error), must not fall through to generic "Failed to confirm" — degrade to `buildSemanticClarificationPrompt(v2State)` which is guaranteed to return a string.
  Date/Author: 2026-03-30 / Reliability review

- Decision: Phase 1 stays confirm-only at the transport layer.
  Rationale: `/continue` does not need a new 422 contract for the initial rollout. Adding `StoryContinueResult` "for future-proofing" expands blast radius without a concrete producer in scope.
  Date/Author: 2026-03-30 / Implementation review

- Decision: Use a typed thrown guidance error from `confirmStoryV3`, not a success-like guidance return.
  Rationale: The current writer/route stack already treats confirmation as success-or-throw. A typed error is the smallest compatible change and keeps normal confirm result shapes untouched.
  Date/Author: 2026-03-30 / Implementation review

- Decision: Top-level 422 `message` must itself be actionable.
  Rationale: Old clients only read `error` + `message`. The remedy cannot live only under `recovery.question`.
  Date/Author: 2026-03-30 / Implementation review

- Decision: Navigation rollback belongs to top-level flow owners, not helper controllers.
  Rationale: `UnifiedCreateFlowView` owns `phase`, `songProgress`, and `storyEngine`. Lower layers should return typed results; they should not own screen transitions.
  Date/Author: 2026-03-30 / Implementation review

- Decision: Do not promise generic retry safety for confirm-with-notes until idempotency is addressed.
  Rationale: `confirmStory()` first applies `confirm_notes` revision, then confirms. A retry after partial success can duplicate note application.
  Date/Author: 2026-03-30 / Implementation review

## Context and Orientation

Porizo has two very different error surfaces that should not be planned as one system.

**Story flow** (the problem): Routes in `src/routes/story.js`. Main user-visible issue is `POST /story/:story_id/confirm`, where the catch block falls to `sendError(..., "STORY_CONFIRM_FAILED", "Failed to confirm story.")`. The story engine in `src/writer/v3/index.js` already knows when confirmation is blocked (missing detail, semantic integrity) but surfaces this as a bare string throw. iOS client in `APIClient+Story.swift`; conversation engine in `V2StoryEngine.swift`.

**Render pipeline** (already handled): Worker in `src/workflows/runner.js`. Classification in `src/utils/step-classification.js`. Server mapping in `src/server.js`. iOS copy in `RenderController.swift`. Already has retries, DLQ, step history, checkpoints, and differentiated messaging. Do not rebuild.

## Plan of Work

### Phase 1: Story Guidance Contract (server + iOS)

**Server engine change** (`src/writer/v3/index.js`):
- `confirmStoryV3` at line 2351: instead of `throw new Error("Story still needs one more detail...")`, throw a typed guidance error
- The error must carry `.code = "STORY_NEEDS_INPUT"` so the route can distinguish it from generic failures
- Include on the error object: `question` from `buildSemanticClarificationPrompt(v2State)`, `missing_blocks` from `v2State.semantic_story.missing_narrative_blocks`, `session_version` from session object
- Coverage stats are NOT available at this point (package not yet assembled) — don't try to include them
- Wrap guidance construction in try/catch: on failure, fall back to a minimal typed error whose question is `buildSemanticClarificationPrompt(v2State)` (guaranteed to return a string)
- Record the semantic ask in session state by appending to `semantic_history`, so `MAX_REPEAT_SEMANTIC_ASKS` exhaustion override works on confirm path, not just continue path
- Do NOT return a success-shaped guidance payload from the engine; keep success path and guidance path distinct

**Server route change** (`src/routes/story.js`):
- `/confirm` catch block: detect `err.code === "STORY_NEEDS_INPUT"` and return HTTP 422 with:
  ```json
  {
    "error": "STORY_NEEDS_INPUT",
    "message": "Before I lock this in, tell me one line about how this changed them or how you saw them grow.",
    "recovery": {
      "question": "What changed in your relationship after this moment?",
      "suggestions": ["Everything shifted", "It brought us closer"],
      "missing_blocks": ["transformation"],
      "session_version": 5
    }
  }
  ```
- Keep ALL existing explicit guards unchanged: ownership (line 1978), moderation (1982-1997), version conflict (2023), revision clarify (2028)
- Upgrade the catch-all at line 2034: change to HTTP 500 with a saved-progress message, but do NOT blanket-mark it retryable when `additional_notes` were supplied unless confirm-with-notes is made idempotent
- Keep the status reset behavior inside the writer engine / session update path, not in the route wrapper
- If `session_version` is returned in 422, add matching support for `expected_session_version` on the follow-up submission path or explicitly require client refresh before using stale guidance

**iOS client change** (`APIClient+Story.swift`):
- `confirmStoryV2`: add `allowedStatusCodes: Set([422])`, capture `response` (currently discarded with `_`), branch on 422 to decode `StoryGuidanceResponse`
- Return `StoryConfirmResult` enum: `.confirmed(ConfirmStoryV2Response)` or `.guidance(StoryGuidanceResponse)`
- Keep `continueStoryV2` unchanged in Phase 1 unless the server actually adds a continue-specific recovery contract
- If stale-guidance protection is implemented, include `expectedSessionVersion` in the continue request body or query and handle 409/version mismatch explicitly

**iOS engine change** (`V2StoryEngine.swift`):
- On `.guidance(...)` result: convert to conversation turn — append assistant message with `question` as content, `suggestions` as chips
- Do NOT set `self.error` — this is not an error, it's a follow-up question
- Do NOT throw — the conversation continues
- Explicitly clear confirmation mode locally: set `isComplete = false` and replace `currentResponse.action` with `.ask`, otherwise the existing guards still block input
- If the returned guidance `session_version` is stale relative to current local/server state, refresh before accepting an answer

**iOS pipeline callers** (`TrackCreationController.swift`, `PoemCreatingView.swift`, owning flow views):
- Both call `confirmStoryV2` as step 1 of multi-step pipeline
- On `.guidance(...)`: abort pipeline, return user to story conversation screen with the guidance question prepopulated
- Lower layers should return typed results upward; top-level flow owners (`UnifiedCreateFlowView` / equivalent) own navigation rollback, `phase`, and `songProgress`
- Avoid burying navigation callbacks inside helper controllers unless they are already UI owners

**Tests:**
- Server: prove `confirmStoryV3` missing-detail returns `STORY_NEEDS_INPUT` code, not bare string
- Server: prove `/confirm` returns 422 with `recovery` object for missing-detail case
- Server: prove `/confirm` returns 500 (not 400) for genuinely unexpected errors
- Server: prove old-client-compatible `error` + `message` fields present in 422 body
- Server: prove semantic ask is recorded in `semantic_history` on confirm path
- Server: prove status resets from `ready_for_confirm` to `active` through engine/session update path when the user continues after guidance
- Server: if `expected_session_version` is added, prove stale follow-up submit gets 409 / mismatch handling
- Server: prove confirm-with-notes does not duplicate note application on retried failure, or explicitly prove the non-idempotent case is blocked from generic retry messaging
- iOS: prove `StoryGuidanceResponse` decodes from 422 body
- iOS: prove old `APIError` also decodes from the same 422 body (backwards compat)
- iOS: prove guidance handling clears confirmation mode and allows immediate answer submission
- iOS: prove track/poem pipeline abort returns control to the owning story conversation flow

### Phase 2: Async Recovery Review (deferred, measurement-driven)

Not implementation by default. Review milestone after Phase 1 ships:
- Is there a real gap in render recovery beyond what step-classification.js already covers?
- Is an LLM-powered post-rejection lyrics rewriter justified by rejection frequency data?
- Does a cross-layer retry budget need implementation?

Do not build until measurements show a missing capability.

## Validation and Acceptance

1. **Story confirmation:** Start a story one detail short → call confirm → get structured guidance response with follow-up question, not "Failed to confirm story." iOS renders it as an inline conversation turn with suggestion chips.

2. **Backward compatibility:** Old iOS receiving 422 decodes `APIError` from top-level `error`+`message`, shows as toast. No crash, no decoding failure.

3. **Staleness handling:** If session is modified between guidance response and user's answer, the follow-up submission path detects it explicitly (either by expected version check or forced refresh) rather than silently applying an answer to stale guidance.

4. **Pipeline abort:** When track or poem creation gets guidance instead of confirmation, pipeline aborts gracefully and the owning flow returns the user to story conversation.

5. **Non-regression:** `npm test` remains green. No changes to `step-classification.js`, `runner.js`, or render status semantics in `server.js`.

6. **Exhaustion override:** After user answers the guidance question once (via `/continue`), subsequent `/confirm` calls succeed via `MAX_REPEAT_SEMANTIC_ASKS` exhaustion override — no infinite 422 loop. This must be driven by `semantic_history`, not direct override mutation.

7. **Retry safety:** Generic retry language is only shown for confirm failures that are actually safe to retry. Confirm-with-notes is either made idempotent or excluded from blanket retry guidance.

## Idempotence and Recovery

Phase 1 is only broadly retry-safe for confirm requests without new `additional_notes`. If the request included `additional_notes`, do not promise generic retry safety until note application is proven idempotent.

If the server ships before iOS update, old clients show guidance `message` as a toast (degraded but better than "Failed to confirm story." only if the top-level message itself is actionable). New clients render inline.

Do not land retry budgeting schema in Phase 1. Do not change render pipeline behavior.

If too invasive, the safe fallback is `/confirm` only first, ship smallest useful improvement.

## Interfaces and Dependencies

**Response shape (HTTP 422):** Must include `error` (String) and `message` (String) at top level for `APIError` backward compat. Guidance data goes in a separate `recovery` key (NOT `details` which is typed `[String: String]?` and can't hold nested objects).

**Engine contract:** `confirmStoryV3` exposes structured guidance via typed thrown error with `.code = "STORY_NEEDS_INPUT"` and properties: `question`, `missingBlocks`, `sessionVersion`. Built with try/catch fallback to `buildSemanticClarificationPrompt` on any construction failure. Guidance persistence updates `semantic_history`; it does not directly mutate `semantic_override`.

**iOS contract:** Follow poem 422 pattern exactly for confirm — `allowedStatusCodes: Set([422])`, branch on `httpResponse.statusCode`, decode per-status-code model. Story uses `StoryGuidanceResponse` (not poem types). Engine converts to conversation turn and clears local confirmation mode. No new navigation abstraction should be introduced in helper controllers; owning flow views handle rollback.

**Staleness contract:** If `session_version` is returned, it must either be enforced by `expected_session_version` on the next answer submission or used to force a refresh before accepting the answer. Returning the version alone is insufficient.

**Retry copy contract:** Top-level `message` must be actionable for old clients. Retry-oriented fallback copy must not claim safety for confirm-with-notes until idempotency is solved.

## Revision Note

This plan supersedes `docs/plans/2026-03-30-intelligent-error-recovery-design.md` as the implementation guide. The earlier document remains useful as product-direction context. This plan was reviewed by 3 specialist agents (correctness, reliability, API contract) with 13 findings incorporated.

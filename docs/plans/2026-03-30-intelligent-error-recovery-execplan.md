# Tighten Error Recovery Without Breaking Story or Render Flows

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Reviewed:** 2026-03-30 by correctness, reliability, and API contract reviewers (13 findings incorporated)

## Purpose / Big Picture

Users should stop hitting vague dead-end errors such as "Failed to confirm story" when the system already knows what went wrong. After this work, story flow failures that genuinely need user input will return a structured, inline guidance response instead of a generic modal.

The visible proof is simple: a missing-detail confirmation failure should come back as a guided follow-up question that the current conversation UI can display — not a modal error dialog.

## Progress

- [x] (2026-03-30 12:10 AWST) Reviewed old design doc against codebase; confirmed partially stale
- [x] (2026-03-30 12:10 AWST) Verified render pipeline already has shared step-aware classification
- [x] (2026-03-30 12:10 AWST) Verified story APIs do not yet support structured 422 recovery contract
- [x] (2026-03-30 12:10 AWST) Authored tighter replacement plan
- [x] (2026-03-30 13:30 AWST) Specialist review: correctness, reliability, API contract (13 findings)
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
  Rationale: Guidance can go stale if session is modified concurrently. iOS needs version to detect staleness and handle 409 on submit gracefully.
  Date/Author: 2026-03-30 / Correctness review

- Decision: Record semantic ask in confirm path, not just continue path.
  Rationale: `MAX_REPEAT_SEMANTIC_ASKS` exhaustion override only fires during `continueStoryV3`. If user retries confirm without going through continue, the same guidance loops indefinitely.
  Date/Author: 2026-03-30 / Reliability review

- Decision: No global retry budget schema in Phase 1.
  Rationale: Story flows don't use jobs. Budget per-surface only when each surface's persistence scope is clear.
  Date/Author: 2026-03-30 / Codex

- Decision: Wrap guidance construction in its own try/catch with fallback to minimal guidance.
  Rationale: If building structured guidance throws (missingBlocks undefined, prompt builder error), must not fall through to generic "Failed to confirm" — degrade to `buildSemanticClarificationPrompt(v2State)` which is guaranteed to return a string.
  Date/Author: 2026-03-30 / Reliability review

## Context and Orientation

Porizo has two very different error surfaces that should not be planned as one system.

**Story flow** (the problem): Routes in `src/routes/story.js`. Main user-visible issue is `POST /story/:story_id/confirm`, where the catch block falls to `sendError(..., "STORY_CONFIRM_FAILED", "Failed to confirm story.")`. The story engine in `src/writer/v3/index.js` already knows when confirmation is blocked (missing detail, semantic integrity) but surfaces this as a bare string throw. iOS client in `APIClient+Story.swift`; conversation engine in `V2StoryEngine.swift`.

**Render pipeline** (already handled): Worker in `src/workflows/runner.js`. Classification in `src/utils/step-classification.js`. Server mapping in `src/server.js`. iOS copy in `RenderController.swift`. Already has retries, DLQ, step history, checkpoints, and differentiated messaging. Do not rebuild.

## Plan of Work

### Phase 1: Story Guidance Contract (server + iOS)

**Server engine change** (`src/writer/v3/index.js`):
- `confirmStoryV3` at line 2351: instead of `throw new Error("Story still needs one more detail...")`, return a structured guidance result
- The error must carry `.code = "STORY_NEEDS_INPUT"` so the route can distinguish it from generic failures
- Include: `question` from `buildSemanticClarificationPrompt(v2State)`, `missing_blocks` from `v2State.semantic_story.missing_narrative_blocks`, `session_version` from session object
- Coverage stats are NOT available at this point (package not yet assembled) — don't try to include them
- Wrap guidance construction in try/catch: on failure, fall back to `{ code: "STORY_NEEDS_INPUT", question: buildSemanticClarificationPrompt(v2State) }` (guaranteed to return a string)
- Record the semantic ask in session state (increment `semantic_override` count) so `MAX_REPEAT_SEMANTIC_ASKS` exhaustion override works on confirm path, not just continue path

**Server route change** (`src/routes/story.js`):
- `/confirm` catch block: detect `err.code === "STORY_NEEDS_INPUT"` and return HTTP 422 with:
  ```json
  {
    "error": "STORY_NEEDS_INPUT",
    "message": "We need one more detail before your story is ready.",
    "recovery": {
      "question": "What changed in your relationship after this moment?",
      "suggestions": ["Everything shifted", "It brought us closer"],
      "missing_blocks": ["transformation"],
      "session_version": 5
    }
  }
  ```
- Keep ALL existing explicit guards unchanged: ownership (line 1978), moderation (1982-1997), version conflict (2023), revision clarify (2028)
- Upgrade the catch-all at line 2034: change to HTTP 500, message "Something went wrong confirming your story. Your story is saved — please try again.", add `retryable: true`
- `/continue` on a `ready_for_confirm` session: reset status to `active` so conversation can meaningfully continue after guidance

**iOS client change** (`APIClient+Story.swift`):
- `confirmStoryV2`: add `allowedStatusCodes: Set([422])`, capture `response` (currently discarded with `_`), branch on 422 to decode `StoryGuidanceResponse`
- Return `StoryConfirmResult` enum: `.confirmed(ConfirmStoryV2Response)` or `.guidance(StoryGuidanceResponse)`
- `continueStoryV2`: same pattern — add 422 handling for future-proofing, return `StoryContinueResult`

**iOS engine change** (`V2StoryEngine.swift`):
- On `.guidance(...)` result: convert to conversation turn — append assistant message with `question` as content, `suggestions` as chips
- Do NOT set `self.error` — this is not an error, it's a follow-up question
- Do NOT throw — the conversation continues

**iOS pipeline callers** (`TrackCreationController.swift`, `PoemCreatingView.swift`):
- Both call `confirmStoryV2` as step 1 of multi-step pipeline
- On `.guidance(...)`: abort pipeline, return user to story conversation screen with the guidance question prepopulated
- Add a callback like `onConfirmGuidance: (StoryGuidanceResponse) -> Void`

**Tests:**
- Server: prove `confirmStoryV3` missing-detail returns `STORY_NEEDS_INPUT` code, not bare string
- Server: prove `/confirm` returns 422 with `recovery` object for missing-detail case
- Server: prove `/confirm` returns 500 (not 400) for genuinely unexpected errors
- Server: prove old-client-compatible `error` + `message` fields present in 422 body
- Server: prove `/continue` resets `ready_for_confirm` status to `active`
- iOS: prove `StoryGuidanceResponse` decodes from 422 body
- iOS: prove old `APIError` also decodes from the same 422 body (backwards compat)

### Phase 2: Async Recovery Review (deferred, measurement-driven)

Not implementation by default. Review milestone after Phase 1 ships:
- Is there a real gap in render recovery beyond what step-classification.js already covers?
- Is an LLM-powered post-rejection lyrics rewriter justified by rejection frequency data?
- Does a cross-layer retry budget need implementation?

Do not build until measurements show a missing capability.

## Validation and Acceptance

1. **Story confirmation:** Start a story one detail short → call confirm → get structured guidance response with follow-up question, not "Failed to confirm story." iOS renders it as an inline conversation turn with suggestion chips.

2. **Backward compatibility:** Old iOS receiving 422 decodes `APIError` from top-level `error`+`message`, shows as toast. No crash, no decoding failure.

3. **Staleness handling:** If session is modified between guidance response and user's answer, `/continue` processes normally (version conflict handled by optimistic locking if session was modified by another writer). Guidance response includes `session_version` for client-side staleness detection.

4. **Pipeline abort:** When `TrackCreationController` or `PoemCreatingView` gets guidance instead of confirmation, pipeline aborts gracefully and returns user to story conversation.

5. **Non-regression:** `npm test` remains green. No changes to `step-classification.js`, `runner.js`, or render status semantics in `server.js`.

6. **Exhaustion override:** After user answers the guidance question once (via `/continue`), subsequent `/confirm` calls succeed via `MAX_REPEAT_SEMANTIC_ASKS` exhaustion override — no infinite 422 loop.

## Idempotence and Recovery

Phase 1 can be retried safely. If the server ships before iOS update, old clients show guidance `message` as a toast (degraded but better than "Failed to confirm story." since the message is now contextual). New clients render inline.

Do not land retry budgeting schema in Phase 1. Do not change render pipeline behavior.

If too invasive, the safe fallback is `/confirm` only first, ship smallest useful improvement.

## Interfaces and Dependencies

**Response shape (HTTP 422):** Must include `error` (String) and `message` (String) at top level for `APIError` backward compat. Guidance data goes in a separate `recovery` key (NOT `details` which is typed `[String: String]?` and can't hold nested objects).

**Engine contract:** `confirmStoryV3` exposes structured guidance via typed error with `.code = "STORY_NEEDS_INPUT"` and properties: `question`, `missingBlocks`, `sessionVersion`. Built with try/catch fallback to `buildSemanticClarificationPrompt` on any construction failure.

**iOS contract:** Follow poem 422 pattern exactly — `allowedStatusCodes: Set([422])`, branch on `httpResponse.statusCode`, decode per-status-code model. Story uses `StoryGuidanceResponse` (not poem types). Engine converts to conversation turn. No new navigation — guidance renders in existing conversation scroll view.

## Revision Note

This plan supersedes `docs/plans/2026-03-30-intelligent-error-recovery-design.md` as the implementation guide. The earlier document remains useful as product-direction context. This plan was reviewed by 3 specialist agents (correctness, reliability, API contract) with 13 findings incorporated.

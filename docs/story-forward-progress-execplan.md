# Restore Story Forward Progress In Multi-Turn Collection

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this change, a user who keeps answering story questions should see the story flow move forward instead of circling the same theme indefinitely. The system should stop re-asking around the same semantic area once it has enough usable detail, should shift to a different unresolved story element when possible, and should allow completion when repetition is the only thing left. Production logs should also expose enough turn-by-turn detail to prove why a question was asked.

## Progress

- [x] (2026-04-06 21:35 AWST) Confirmed the production symptom: answers are being integrated, but question arbitration keeps circling the same semantic cluster and selection repeatedly hits token limits.
- [x] (2026-04-06 21:42 AWST) Confirmed local backend turn logging hooks already exist in `src/writer/v3/index.js`, but production will not show them until the backend is redeployed.
- [x] (2026-04-06 21:58 AWST) Implemented stronger semantic anti-repetition and forward-progress rules in `src/writer/v3/index.js`.
- [x] (2026-04-06 22:00 AWST) Reduced selection-stage prompt load in `src/writer/v3/reasoner.js` by removing transcript replay in compact multi-turn selection.
- [x] (2026-04-06 22:05 AWST) Added and updated tests covering repeated-theme completion escape and compact selection prompts.
- [x] (2026-04-06 22:16 AWST) Ran focused tests, lint, and the full suite successfully.
- [x] (2026-04-06 22:18 AWST) Confirmed that backend redeploy is still needed to make the new turn logs visible in Railway production logs.

## Surprises & Discoveries

- Observation: The code already records assistant question metadata in `story_state.questionsAsked`, but the runtime only uses that information narrowly when choosing a target element.
  Evidence: `src/writer/v3/index.js` defines `getAnsweredQuestionElements(...)`, `selectRuntimeQuestionTarget(...)`, and `extractStoryState(...)`, but `resolveTurnDecision(...)` does not yet enforce forward progress when the same theme keeps resurfacing.

- Observation: The local repo already contains deploy-ready turn logging, but current production logs do not contain `[V3 Turn]` entries.
  Evidence: `src/writer/v3/index.js` defines `logStoryTurnEvent(...)`, `start.request/start.response`, and `continue.request/continue.response`, but the current Railway logs only show older `[V3]` lines.

## Decision Log

- Decision: Implement forward progress in the V3 arbitrator first, before any broader story-model redesign.
  Rationale: The current failure is not missing storage; it is repeated targeting and degraded selection. A surgical arbitrator fix is lower risk than changing the entire story state model.
  Date/Author: 2026-04-06 / Codex

- Decision: Keep the fix local and test-backed before deciding on a Railway deploy.
  Rationale: Production behavior is sensitive. The code needs deterministic coverage before shipping new completion logic.
  Date/Author: 2026-04-06 / Codex

- Decision: Use a conservative confirm escape instead of forcing another question when the same semantic element has already been answered multiple times and the story is materially complete.
  Rationale: The user-visible failure is endless circling. Confirmation is safer than inventing another redundant prompt once readiness, facts, and narrative coverage are already strong.
  Date/Author: 2026-04-06 / Codex

- Decision: Remove transcript replay from compact multi-turn `selection` prompts.
  Rationale: The selector is the stage repeatedly hitting token ceilings in production, and it already receives the canonical story memory plus the latest user input.
  Date/Author: 2026-04-06 / Codex

## Outcomes & Retrospective

The V3 engine now has a deterministic forward-progress escape when multi-turn questioning gets stuck on the same semantic area. It no longer needs to keep asking if the same element has already been answered repeatedly and the story is materially complete. In that case it can now confirm instead of looping. The compact `selection` stage also stops replaying the transcript, which should reduce the `MAX_TOKENS` degradation seen in production.

One important limit remains: the richer turn-by-turn Railway diagnostics are still local code until the backend is redeployed. The local test surface is green, but production logs will not include the newer `[V3 Turn]` fields until that deploy happens.

## Context and Orientation

The repeated-question behavior lives in the V3 story engine under `src/writer/v3/`. The main runtime decision point is `resolveTurnDecision(...)` in `src/writer/v3/index.js`. That function takes the language model response for a story turn and decides whether to trust it, replace it with a fallback question, or confirm the story.

The prompt volume problem lives in `src/writer/v3/reasoner.js` and `src/writer/v3/prompts/builder.js`. The reasoner decides how much context to send to each stage (`selection`, `outline`, `writer`, etc.). The builder expands those limits into actual prompt text, including the transcript history.

The relevant tests live in `test/writer/v3/decision-arbitration.test.js` and `test/writer/v3/reasoner-budget.test.js`.

## Plan of Work

First, extend the V3 arbitrator so it can detect when a new question is semantically too close to recently answered questions. When that happens, the engine should move to a different unresolved Labov element if one exists. If no different unresolved element exists and the story already has enough material to be reviewable, the engine should stop circling and allow completion.

Second, reduce prompt pressure in the `selection` stage by cutting transcript replay in compact multi-turn mode. The model still receives the current user input plus the canonical story memory, but it no longer needs another mini-transcript when the session is already long.

Third, add tests that fail without the new behavior: repeated-theme asks should be redirected to a different target or converted into completion when repetition would otherwise continue, and compact selection prompts should stop replaying the transcript.

## Concrete Steps

Work from the repository root:

  npm run lint
  node --test test/writer/v3/decision-arbitration.test.js test/writer/v3/reasoner-budget.test.js
  npm test

If a change affects production observability, check Railway logs after deploy using the existing `railway logs` workflow.

## Validation and Acceptance

Acceptance is:

1. A repeated question theme no longer keeps the engine on the same semantic area when another unresolved element exists.
2. When the same semantic area has already been answered repeatedly and the story is materially complete, the engine can advance to confirmation instead of asking again.
3. Compact multi-turn selection prompts do not replay the conversation transcript.
4. Focused V3 tests pass, lint passes, and the full test suite remains green.

## Idempotence and Recovery

These code changes are safe to rerun and re-test. If a forward-progress rule proves too aggressive, the rollback path is to remove only the new repeated-theme helpers and leave the existing fallback question path intact.

## Artifacts and Notes

Validation run from the repository root:

  node --test test/writer/v3/decision-arbitration.test.js test/writer/v3/reasoner-budget.test.js
  node --test test/story-start.test.js test/story-confirm-contract.test.js test/writer/v3/question-enforcement.test.js
  npm run lint
  npm test

Observed result:

  343 tests, 336 pass, 0 fail, 7 skipped

## Interfaces and Dependencies

This work stays within the existing V3 interfaces:

- `resolveTurnDecision(response, state, options)` in `src/writer/v3/index.js`
- prompt stage helpers in `src/writer/v3/reasoner.js`
- prompt builders in `src/writer/v3/prompts/builder.js`

No new external service, schema, or API contract is required for this pass.

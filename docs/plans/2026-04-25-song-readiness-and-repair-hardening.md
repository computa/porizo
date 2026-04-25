# Harden song readiness and lyric repair

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows the global ExecPlan standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Users should not be told a story is ready for a song if the backend can already detect that the story-to-lyrics contract will fail. After this change, confirmation runs a song-readiness preflight before exposing the generation path, and final lyric generation keeps the hard required-detail gate with a bounded repair path. A user with a missing or impossible required detail is returned to the story chat with a specific follow-up instead of seeing a late generic error after generation starts.

## Progress

- [x] (2026-04-25T05:30Z) Mapped the story confirmation, lyric generation, and iOS creation flow.
- [x] (2026-04-25T05:48Z) Implemented backend song-readiness preflight and wired it into `writer.confirmStory` for song confirmations.
- [x] (2026-04-25T05:55Z) Hardened targeted lyric repair with invented-detail input, earlier safe repair, repair metrics, and a small fidelity-priority quality margin.
- [x] (2026-04-25T06:02Z) Updated tests for preflight blocking, poem bypass, route contract forwarding, and targeted repair behavior.
- [x] (2026-04-25T06:08Z) Ran focused tests, lint, full backend tests, and iOS build validation.
- [ ] Deploy and record production health evidence.

## Surprises & Discoveries

- Observation: iOS already handles `STORY_NEEDS_INPUT` from `confirmStoryV2` by returning to the conversation. This is the safest first integration point for preflight because it avoids adding a new client flow before the backend contract is stable.
  Evidence: `TrackCreationController.createTrack` switches `.needsInput` before lyrics generation.

- Observation: `getStoryContextV3` can build and persist the completed story package before confirmation, so preflight can evaluate the same canonical story package that final lyrics will use.
  Evidence: `getStoryContextV3` calls `ensureCompletedStoryPackage` and returns `completed_story_package` regardless of confirmed status.

- Observation: the poem flow shares `confirmStoryV2`, so a song-only preflight must be explicitly scoped.
  Evidence: `PoemCreatingView` calls `confirmStoryV2` before poem generation, while `TrackCreationController` calls it before song generation.

- Observation: the readiness path originally reused `buildSongwriterPrompt` in a way that emitted normal generation prompt logs during preflight.
  Evidence: focused tests showed prompt summaries from a confirmation-only readiness check. The implementation now uses `returnMetadata` plus `suppressLogs` for preflight.

## Decision Log

- Decision: Keep the final required-detail fidelity gate hard and repair the lyrics rather than loosening the threshold.
  Rationale: The emotional story details are the product. Accepting 7/8 required details can still drop the most important moment.
  Date/Author: 2026-04-25 / Codex

- Decision: Wire first preflight into backend confirmation before adding new iOS button-state APIs.
  Rationale: The current app already routes `STORY_NEEDS_INPUT` to the story chat, so this catches failures before lyrics/track generation without a risky client redesign. A later pass can call the same readiness result earlier to disable the visible CTA.
  Date/Author: 2026-04-25 / Codex

- Decision: Make song preflight opt-in via `target_content_type: "song"` instead of applying it to every confirmation request.
  Rationale: Older clients and poem creation share the same endpoint. Defaulting unknown clients to song could break poem confirmations and stale app builds. The updated iOS song path opts in explicitly; the poem path opts out explicitly.
  Date/Author: 2026-04-25 / Codex

## Outcomes & Retrospective

Implemented the first defensive layer: song confirmation now runs structural readiness before locking the story and returns `STORY_NEEDS_INPUT` with concrete follow-up guidance when canonical required details are missing or the prompt would need hard truncation. Implemented the second defensive layer: final lyric generation still keeps the hard required-detail gate, but now has one bounded targeted repair path that includes missing required details and unsupported invented details, emits repair metrics, and reruns the fidelity judge before accepting.

Validation passed:

- `node --test test/writer/confirm-story-notes.test.js test/story-confirm-contract.test.js test/writer/songwriter-fidelity.test.js test/lyrics.test.js`
- `npm run lint`
- `npm test` (`351` tests, `345` pass, `6` skipped, `0` failed)
- `xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'generic/platform=iOS' build`

## Context and Orientation

The story flow starts in `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift`. When the user picks a voice, `TrackCreationController.createTrack` calls `confirmStoryV2`, then `generateStoryLyrics`, then `storyToTrack`. If `confirmStoryV2` returns `STORY_NEEDS_INPUT`, the app already returns the user to the conversation with guidance.

The backend route for confirmation is `src/routes/story.js` at `POST /story/:story_id/confirm`. It calls `writer.confirmStory` in `src/writer/index.js`, which delegates to `confirmStoryV3` in `src/writer/v3/index.js`.

The final lyric pipeline is in `src/writer/songwriter.js`. It builds a required story-detail ledger, generates lyrics, asks an LLM fidelity judge, then locally caps the score below the pass threshold if any required detail is missing. Commit `febab06` added a targeted repair call after the final failed attempt.

## Plan of Work

First, add a backend song-readiness function in `src/writer/songwriter.js` that evaluates the same normalized context used for final lyrics. It should return a stable object with `ready`, `blockers`, `warnings`, required-detail counts, prompt-budget summary, and a specific follow-up question. This first implementation is structural and deterministic: it checks missing required details in the completed story package, required-detail budget pressure, prompt hard compaction, and whether the story has a usable narrative or song map. It must not generate full lyrics.

Second, export a wrapper from `src/writer/index.js` and call it inside `confirmStory` before `engineHandler.confirmStory`. If not ready, throw `STORY_NEEDS_INPUT` with a concrete question and suggestions. This prevents the confirmed state from being written when the song contract is already blocked.

Third, tighten the targeted repair in `src/writer/songwriter.js`: list invented details in the repair prompt, log explicit repair metrics, allow targeted repair after attempt 2 only when the failure is clean, and keep re-running the same fidelity judge. Do not bypass the hard gate.

Fourth, add tests that prove confirmation blocks before lyrics generation when the story contract is not ready, and that repair prompts include invented details and emit observable metrics.

## Concrete Steps

Run commands from `/Users/ao/Documents/projects/porizo`.

Use:

    node --test test/writer/songwriter-fidelity.test.js test/story-confirm-contract.test.js test/lyrics.test.js
    npm run lint
    npm test

Deploy with:

    railway up
    curl -s https://api.porizo.co/health

## Validation and Acceptance

Acceptance is met when a story with missing required contract details receives `STORY_NEEDS_INPUT` during confirmation, before `/story/:id/lyrics` is called, and when final lyric generation still repairs missing details instead of accepting incomplete lyrics.

The new tests should fail before the change and pass after it. The full backend test suite must pass before deployment.

## Idempotence and Recovery

The backend changes are code-only and can be redeployed repeatedly with `railway up`. If the preflight is too strict in production, it can be adjusted in one place by changing the song-readiness thresholds without weakening the final lyric gate.

## Artifacts and Notes

Validation output is recorded in Outcomes & Retrospective. Production deploy evidence remains pending until `railway up` and `/health` complete.

## Interfaces and Dependencies

`assessSongReadiness(context)` in `src/writer/songwriter.js` returns a JSON-safe object. `writer.confirmStory` uses that object and throws a `STORY_NEEDS_INPUT` error with `question`, `suggestions`, and `missingBlocks` when `ready` is false.

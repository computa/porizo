# Story-to-Lyrics Pipeline Redesign

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows the global ExecPlan standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Porizo's product value is the user's emotional story and the concrete details that make the gift feel personal. After this change, song lyrics should be generated from a protected story-detail contract rather than from a large prose prompt that can be silently truncated. A user should be able to give a rich story and see the important facts survive into the lyric prompt, fidelity judge, logs, and final acceptance decision.

The intended behavior is visible in tests and logs: the songwriter logs a detail ledger, prompt compaction no longer hard-cuts the song brief before preserving required details, the fidelity judge runs from a compact evidence bundle when needed, and story-backed lyrics are not accepted when the judge is unavailable.

## Progress

- [x] (2026-04-24T21:01:00Z) Inspected current songwriter prompt budgeting, sectioned generation, fidelity judge, and existing regression tests.
- [x] (2026-04-24T21:18:00Z) Added a story detail ledger that extracts required and important story details from completed story packages, facts, song maps, memory answers, and primitives.
- [x] (2026-04-24T21:18:00Z) Made prompt budgeting preserve the detail ledger and section contract before prose.
- [x] (2026-04-24T21:18:00Z) Made the fidelity judge use a compact evidence bundle when the full prompt would exceed the LLM token cap.
- [x] (2026-04-24T21:18:00Z) Failed closed when the story-backed fidelity judge is unavailable instead of accepting quality-only lyrics.
- [x] (2026-04-24T21:18:00Z) Added regression tests for long Chioma-style stories, no hard-cap compaction, compact judge prompts, and judge failure behavior.
- [x] (2026-04-25T15:02:00+08:00) Reduced prompt buildup structurally by preserving canonical story prose up to 12k chars internally, extracting a binding ledger, and putting only a bounded story excerpt in the songwriter prompt.
- [x] (2026-04-25T15:20:00+08:00) Ran an adversarial review pass for hidden caps, prompt bloat, false-positive detail coverage, unrelated detail leakage, and oversized story rewrite prompts.
- [x] (2026-04-25T15:34:00+08:00) Hardened completed-story evidence so retained details, facts, primitives, and song-map support are prose-gated before reaching generation or judge prompts.
- [x] (2026-04-25T15:42:00+08:00) Ran targeted and full validation: focused songwriter tests, e2e story-to-lyrics tests, syntax check, full `npm test`, `npm run lint`, and `git diff --check`.
- [x] (2026-04-25T16:18:00+08:00) Ran a second adversarial pass across story serialization, provider policy sanitation, Suno handoff, and output/token caps.
- [x] (2026-04-25T16:26:00+08:00) Replaced first-12k story serialization with head/tail compaction so late emotional payoff details survive `toTrack`.
- [x] (2026-04-25T16:31:00+08:00) Added post-policy fidelity protection so provider sanitation cannot remove required story details after lyrics have passed the writer judge.
- [x] (2026-04-25T17:08:00+08:00) Replaced blind serialized-array caps with priority selection so required retained details and song-map-cited facts survive before lower-signal material.
- [x] (2026-04-25T17:11:00+08:00) Made `completed_story_package.prose` alone trigger story-backed fidelity checks, even when legacy `narrative` and `facts` are absent.
- [x] (2026-04-25T17:15:00+08:00) Added LLM provider finish-reason handling so max-token output stops retry/fail instead of accepting parseable but truncated lyrics.
- [x] (2026-04-25T17:24:00+08:00) Re-ran full validation: focused pipeline tests, full `npm test`, `npm run lint`, and `git diff --check`.

## Surprises & Discoveries

- Observation: `applySongwriterPromptBudget()` can end with `song_brief_hard_cap`, which cuts the tail of the whole song brief. That can remove exactly the later emotional payoff, gratitude, and transformation details users care about.
  Evidence: `src/writer/songwriter.js` hard-caps the text between `## SONG BRIEF` and `## YOUR TASK`.
- Observation: `generateLyricsFromContext()` accepts quality-passing lyrics when `assessNarrativeFidelity()` throws.
  Evidence: the catch block returns `acceptance_reason: "judge_unavailable_quality_passed"`.
- Observation: Treating every chorus or bridge song-map item as required over-constrains the system because some map entries are structural hints, not product-critical story facts.
  Evidence: focused test logs showed required details sourced from generic song-map entries; requirement status is now reserved for explicit retained details, high-stakes facts, primitives, and hook.
- Observation: The canonical completed story was still vulnerable to an upstream 2,000-character cap before prompt budgeting.
  Evidence: focused regression logs initially showed `narrative_chars:12000` but `story_prose_excerpt.original_chars:2000`; `sanitizeForPrompt()` imposed a short-field cap before excerpting.
- Observation: Prompt growth came from duplicate context channels, not only from prose length.
  Evidence: `buildSongwriterPrompt()` emitted completed prose, retained details, facts, memory answers, and song map guidance in parallel. The new path treats the ledger and song map as primary, with full prose represented by a bounded excerpt.
- Observation: Required-detail coverage could be fooled by repeated generic tokens.
  Evidence: the adversarial test with 50 details like "required family memory number N" initially marked unrelated details as covered from one lyric line. Coverage now uses distinctive per-detail token frequency instead of broad word overlap alone.
- Observation: Raising retained-detail serialization from 40 to 80 exposed unrelated completed-story details that were previously hidden by slicing.
  Evidence: the e2e judge-block test failed when "surfing in Hawaii" survived through retained details. Completed-story ledgers are now gated against the canonical prose, including short details.
- Observation: Song-map ideas and support text were another unbounded prompt-bloat path.
  Evidence: the long-tail judge test produced thousands of repeated "middle ordinary detail" tokens from generated song-map ideas. Song-map prompt formatting now truncates idea/support text before insertion.
- Observation: LLM rewrite of completed stories can become a full-prose rewrite prompt and silently delete story material.
  Evidence: `rewriteNarrativeWithMissingDetails()` accepted arbitrarily long prose and no minimum retention check. It now refuses oversized prose, caps missing-detail payloads, and rejects rewrites that shrink below 85% of source length.
- Observation: Track serialization still used `slice(0, 12000)` for story prose, which preserves the beginning but can drop the late gratitude, transformation, or birthday payoff.
  Evidence: `src/routes/story.js` serialized `narrative` and `completed_story_package.prose` by taking only the prefix. Serialization now compacts the middle and preserves both head and tail.
- Observation: Provider policy sanitation can rewrite lyrics after story fidelity has already passed.
  Evidence: `src/workflows/runner.js` sanitized lyrics before music generation and before provider preflight. It now rechecks required-detail coverage after sanitation and fails if a rewrite newly removes required story detail.
- Observation: Serializer caps can still erase required details even after prose head/tail compaction.
  Evidence: `buildTrackStoryContextPayload()` previously sliced `facts` and `retained_details` by position. Late required details and song-map-cited facts could fall beyond the cap and vanish before the songwriter saw them.
- Observation: A completed story package could be present without legacy `narrative` or `facts`, causing lyrics to be treated as not story-backed.
  Evidence: `generateLyricsFromContext()` used `Boolean(narrative || facts.length)` for `hasStoryContext`. That would skip the strict story-backed fail-closed path for a completed-story-only payload.
- Observation: Provider responses can be syntactically valid while semantically truncated.
  Evidence: Gemini, OpenAI, and Anthropic expose finish reasons. If a model stopped on max tokens after producing parseable JSON, the previous `generateText()` path accepted it as complete output.

## Decision Log

- Decision: Treat required story details as a ledger that must survive prompt budgeting and judge context.
  Rationale: A compact list of required details is more robust than relying on long prose to carry product value through token pressure.
  Date/Author: 2026-04-24 / Codex
- Decision: Fail closed for story-backed lyrics when the fidelity judge cannot run.
  Rationale: Accepting quality-only lyrics is exactly how generic but polished outputs reach users.
  Date/Author: 2026-04-24 / Codex
- Decision: Do not mark every chorus or bridge song-map entry as hard required.
  Rationale: The ledger should be strict about product-critical details without turning every structural hint into a blocker.
  Date/Author: 2026-04-24 / Codex
- Decision: Preserve long story prose during normalization, but do not send the whole prose blob to the lyric model by default.
  Rationale: The app needs the full story available for extraction and judging, while the generation prompt needs a compact, high-signal contract.
  Date/Author: 2026-04-25 / Codex
- Decision: Treat auto-extracted story checkpoints as judge evidence, not hard requirements.
  Rationale: Explicit retained details, facts, primitives, and hook are product commitments; auto checkpoints help coverage but should not over-constrain generation.
  Date/Author: 2026-04-25 / Codex
- Decision: Gate completed-story evidence by overlap with the canonical completed prose.
  Rationale: Once a completed story exists, it is the source of truth. Any retained detail, fact, primitive, or support text that does not trace to that prose should not be allowed to steer lyrics.
  Date/Author: 2026-04-25 / Codex
- Decision: Bound all song-map text before placing it in generation or judge prompts.
  Rationale: Song-map entries can be model-generated and malformed. They should guide section intent, not dominate the prompt budget.
  Date/Author: 2026-04-25 / Codex
- Decision: Compact middle story prose during track serialization instead of prefix-truncating.
  Rationale: In personal gift stories, the ending often contains the user-facing emotional message. Losing the tail is worse than omitting ordinary middle filler already represented by retained details.
  Date/Author: 2026-04-25 / Codex
- Decision: Treat provider policy rewrites as a second fidelity boundary.
  Rationale: Passing writer fidelity is not enough if a later provider-safety rewrite removes a required memory, name, place, or emotional detail before render.
  Date/Author: 2026-04-25 / Codex
- Decision: Prioritize song-map-cited facts, important emotional beats, and required retained details before applying serialization caps.
  Rationale: Caps are necessary for transport and prompt budget, but they must be semantic caps, not array-position caps.
  Date/Author: 2026-04-25 / Codex
- Decision: Treat `completed_story_package.prose` as story context even when no legacy narrative exists.
  Rationale: The completed story is the canonical product artifact. Its presence must force the stricter story fidelity path.
  Date/Author: 2026-04-25 / Codex
- Decision: Treat max-token provider finish reasons as retryable output truncation, not success.
  Rationale: A parseable partial JSON payload is still a broken lyric if the provider stopped early.
  Date/Author: 2026-04-25 / Codex

## Outcomes & Retrospective

Implemented and validated.

The redesigned path now keeps canonical story prose up to 12,000 characters internally instead of silently truncating it at 2,000 characters. The generation prompt receives a binding story-detail ledger, song-map guidance, and a bounded head/tail story excerpt. The Chioma-style regression now logs `narrative_chars:12000`, `story_prose_excerpt.compacted:true`, and no `song_brief_hard_cap`.

The fidelity gate now augments judge scoring with required-detail coverage and fails closed when the judge cannot return valid scores for story-backed lyrics. This is intentionally stricter: polished but generic lyrics should retry or fail rather than ship.

The adversarial pass also closed secondary leakage paths: completed-story ledgers are prose-gated, required-detail coverage resists generic token overlap, song-map prompt text is capped, oversized story rewrite attempts are refused instead of sending the whole story back through an LLM rewrite prompt, serializer caps preserve required/cited details first, completed-story-only payloads force fidelity checks, and provider max-token stops no longer count as successful lyric generation.

Validation:

    node --check src/writer/songwriter.js
    node --check src/writer/v3/index.js
    node --check src/routes/story.js
    node --check src/writer/v3/safety.js
    node --test test/lyrics.test.js test/writer/songwriter-fidelity.test.js
    node --test test/llm-provider.test.js test/writer/e2e-story-to-lyrics.test.js test/writer/songwriter-fidelity.test.js test/lyrics.test.js
    node --test test/writer/e2e-story-to-lyrics.test.js
    npm test
    npm run lint
    git diff --check -- src/writer/story-context-serialization.js src/routes/story.js src/providers/lyrics.js src/workflows/runner.js src/writer/songwriter.js src/services/llm-provider.js test/lyrics.test.js test/writer/e2e-story-to-lyrics.test.js test/writer/songwriter-fidelity.test.js test/llm-provider.test.js docs/plans/2026-04-25-story-to-lyrics-pipeline-redesign-execplan.md

Results:

    focused songwriter tests: 73 pass, 0 fail
    focused pipeline/provider tests: 140 pass, 0 fail
    e2e story-to-lyrics tests: 33 pass, 0 fail
    npm test: 342 pass, 0 fail, 6 skipped
    npm run lint: pass
    git diff --check: pass

## Context and Orientation

The central module is `src/writer/songwriter.js`. It builds lyric prompts in `buildSongwriterPrompt()`, trims prompts in `applySongwriterPromptBudget()`, generates lyrics in `generateLyricsFromContext()`, and scores story fidelity in `assessNarrativeFidelity()`.

The current pipeline already has useful structures: `completed_story_package`, `facts`, and `song_map`. The redesign will standardize those into a compact ledger. A ledger means a normalized list of story details with an id, text, importance, and target song section. It is not a database table; it is a prompt and validation contract built at runtime.

## Plan of Work

First, add helper functions in `src/writer/songwriter.js` to build and summarize a story detail ledger. The ledger will prefer `completed_story_package.retained_details`, then facts, then song map entries and memory answers. It will assign details to sections using existing song map source facts and beat metadata.

Second, insert the ledger into `buildSongwriterPrompt()` before long prose, and update prompt budget metadata so logs show how many details were retained and which were required.

Third, replace destructive hard-capping with protective compaction. The compactor may trim prose and lower-priority supporting sections, but it must preserve the detail ledger, song map, and task instructions.

Fourth, make `assessNarrativeFidelity()` build a compact judge prompt when the full judge prompt is too large. The compact judge prompt will contain the detail ledger, primary song map, and flattened lyrics, not the entire story prose.

Fifth, change `generateLyricsFromContext()` so story-backed judge failures produce a retry and eventually `LYRICS_FIDELITY_LOW` rather than accepting lyrics.

Sixth, add tests in `test/lyrics.test.js` and `test/writer/songwriter-fidelity.test.js`.

## Concrete Steps

Run from `/Users/ao/Documents/projects/porizo`:

    node --test test/lyrics.test.js test/writer/songwriter-fidelity.test.js
    npm test
    npm run lint

## Validation and Acceptance

Acceptance means:

- A long completed story produces a lyric prompt containing a required detail ledger.
- Prompt budgeting can reduce prose but does not report `song_brief_hard_cap` for the rich-story path.
- The fidelity judge prompt stays under the configured LLM input cap by using compact evidence.
- A malformed or unavailable judge does not accept story-backed lyrics as quality-only.
- Full backend tests and lint pass.

## Idempotence and Recovery

The edits are pure application code and tests. Re-running tests is safe. If the redesigned path causes regressions, the quickest rollback is to revert this commit and keep the prior observability-only logging.

## Artifacts and Notes

Targeted validation showed the long-story prompt path preserving 12k internal story chars while sending a compact excerpt plus ledger to the model. Full validation passed with existing skipped integration tests unchanged.

An Oracle review was attempted for an external adversarial pass, but the streaming call exceeded the two-minute client deadline. The implemented review and validation above are from local code inspection and tests.

## Interfaces and Dependencies

No new external dependency is needed. The redesign uses existing `generateText()`, `estimateTokens()` logic local to `songwriter.js`, and existing story context fields.

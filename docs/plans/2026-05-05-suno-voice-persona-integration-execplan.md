# Suno Voice Persona User Voice Integration

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own `PLANS.MD`; maintain this document in accordance with `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Porizo users should be able to choose "My voice" and receive a generated song that uses their Suno voice persona directly inside Suno generation. This replaces the failed historical path where Porizo generated a Suno song, split it with Demucs, converted the vocal with Seed-VC, and remixed it. The new path should conform to SunoAPI's documented persona model: create a persona from an existing SunoAPI task/audio ID, then pass that persona into later Suno generation with `personaModel: "voice_persona"`.

The user-visible success case is: a user completes in-app voice enrollment, Porizo prepares a Suno voice persona, and future `user_voice` renders submit a single Suno v5.5 generation request that includes the resolved Suno `personaId`. The stored music plan carries only a local provider-profile reference. The result is the provider-complete audio from Suno, without Demucs, Seed-VC, vocal polish, or remixing.

## Progress

- [x] (2026-05-05 12:25+08:00) Read current Porizo render-contract, Suno provider, Seed-VC, Demucs, and voice profile code.
- [x] (2026-05-05 12:25+08:00) Verified SunoAPI's documented persona primitives: file upload, upload-cover task, generate-persona task, and `personaModel: "voice_persona"` on generation.
- [x] (2026-05-05 12:25+08:00) Drafted the target architecture and migration plan.
- [x] (2026-05-05 12:33+08:00) Expanded this plan with task IDs, dependencies, validation gates, rollout phases, and a specialist review process.
- [x] (2026-05-05 13:45+08:00) Implemented schema and provider-client changes for local Suno provider profiles and persona API calls.
- [x] (2026-05-05 13:45+08:00) Implemented enrollment-side Suno persona preparation queuing with Suno-specific consent gating.
- [x] (2026-05-05 13:45+08:00) Implemented render path using a local `voice_provider_profile_id` that resolves to the raw Suno persona ID only at provider submission.
- [x] (2026-05-05 12:39+08:00) Completed specialist review and incorporated accepted findings about pre-spend readiness, quality/mix paths, enrollment job design, frozen contracts, deletion ordering, consent, and persona ID redaction.
- [x] (2026-05-05 13:50+08:00) Ran targeted tests for Suno persona provider, persona job service, voice provider profile service, voice enrollment, and lint before specialist review.
- [x] (2026-05-05 15:10+08:00) Completed Phase 2 specialist review, fixed all privacy, lifecycle, and Suno API contract findings, and received reviewer confirmation.
- [x] (2026-05-05 14:35+08:00) Ran live SunoAPI proof with a consented enrolled production voice. Upload-cover completed and returned two audio IDs, but `generate-persona` failed for both candidates, so production traffic remains disabled.
- [x] (2026-05-05 19:12+08:00) Re-ran `tools/suno-persona-probe.js` and replaced the placeholder upload-cover fixture with a redacted live `SUCCESS` response shape. Rotated the Railway callback secret after tightening redaction for JSON-string `param` values.

## Surprises & Discoveries

- Observation: SunoAPI documents `voice_persona` as a generation option, but does not document Suno's consumer "Voices" lifecycle directly.
  Evidence: `Generate Music` and `Upload And Cover Audio` expose `personaId` plus `personaModel: "voice_persona"`; `Generate Persona` creates a persona from an existing task/audio ID, not from a raw voice upload alone.

- Observation: `Generate Persona` requires a `taskId` and `audioId`, so raw enrollment audio must first be turned into a SunoAPI task result.
  Evidence: SunoAPI `Generate Persona` usage guide says task IDs can come from generate, extend, upload-cover, upload-extend, or mashup tasks, and requires an audio ID from that task.

- Observation: Current Porizo `user_voice` routing is locked to a voice conversion concept.
  Evidence: `src/workflows/runner.js` reads `voice_conversion_provider`, defaulting to `seedvc`, and `src/workflows/render-contract.js` maps Suno + `user_voice` to `provider_audio_personalized_convert`.

- Observation: Render readiness must be checked before entitlement or credit consumption.
  Evidence: The specialist review found `render_preview` consumes entitlement before creating the render job, while a worker-level persona missing error would fail after spend. Persona readiness therefore belongs in route-level render preflight or inside the same transaction before consumption.

- Observation: A Suno voice persona provider-complete render still has `voice_mode='user_voice'`, so existing personalized guards, quality scoring, and mix branching will reject or mis-handle it unless updated.
  Evidence: The current personalized guard allows only the old conversion pipelines; the quality gate looks for `user_vocal.wav`; the direct provider-complete mix branch is currently guarded by non-personalized voice mode.

- Observation: Enrollment does not currently have a durable job lane compatible with long-running Suno persona preparation.
  Evidence: Enrollment completion creates the voice profile synchronously and returns a synthetic job ID. The existing job runner is track-version based, so persona preparation needs either a new table/runner or a deliberately extended job model.

- Observation: The live SunoAPI proof did not validate the uploaded-enrollment-audio-to-voice-persona path.
  Evidence: A 65.19 second clean mono WAV was prepared from the enrolled voice for `abcobimma@gmail.com`, uploaded through SunoAPI file upload, and submitted to `upload-cover` with `model: "V5_5"`. The upload-cover task completed with two audio IDs. Calling `generate-persona` with the first ID failed with "Music does not exist"; a controlled manual recovery using the second ID failed with "create persona error". This blocks using SunoAPI persona creation as the current production path for user-owned voices.

- Observation: SunoAPI callback docs do not publish a provider HMAC header contract.
  Evidence: The implementation now treats the callback URL token as the production authentication mechanism and accepts `X-Suno-Signature` only as additive future compatibility if SunoAPI later confirms signed callbacks.

## Decision Log

- Decision: Introduce a new `suno_voice_persona` personalization engine instead of forcing Suno persona into `voice_conversion_provider`.
  Rationale: Suno persona is not a post-processing voice conversion step. It changes the provider generation request itself, so the pipeline should be provider-complete audio, not Demucs/Seed-VC conversion.
  Date/Author: 2026-05-05 / Codex

- Decision: Keep in-app recording, consent, and QC as Porizo's authoritative enrollment front door.
  Rationale: SunoAPI's documented persona path does not include identity verification or consent APIs. Porizo must preserve its own consent and audit controls before sending any voice-derived audio to SunoAPI.
  Date/Author: 2026-05-05 / Codex

- Decision: Create a Suno persona from a controlled enrollment-derived audio task, then reuse that `personaId` for songs.
  Rationale: This matches the documented SunoAPI lifecycle: task/audio ID first, `Generate Persona` second, `personaId` in future generation third.
  Date/Author: 2026-05-05 / Codex

- Decision: Retain the old Seed-VC path behind a disabled-by-default fallback during rollout, but do not use it for the primary `user_voice` path.
  Rationale: The old path already failed product-quality goals. It is useful only as emergency rollback while the Suno persona path is validated.
  Date/Author: 2026-05-05 / Codex

- Decision: Allow users to create and edit drafts with `voice_mode='user_voice'` while the Suno persona is preparing, but block render before entitlement spend until the provider profile is active.
  Rationale: This preserves the songwriting flow without charging or consuming credits for a render that cannot run.
  Date/Author: 2026-05-05 / Codex

- Decision: Store only a local provider-profile row ID in music plans/render contracts; resolve the raw Suno `personaId` only at provider submit time.
  Rationale: Music plans and provenance can be stored, checkpointed, logged, and returned by APIs. Raw provider identifiers should not leak.
  Date/Author: 2026-05-05 / Codex

- Decision: Require new third-party voice processing consent before Suno persona preparation and do not auto-migrate existing voice profiles.
  Rationale: Sending voice-derived audio to SunoAPI is materially different from local enrollment and the old provider path. Existing consent records are not specific enough.
  Date/Author: 2026-05-05 / Codex

## Outcomes & Retrospective

Phase 1 and Phase 2 are implemented behind disabled-by-default flags. Specialist review confirmed the privacy, consent, lifecycle, retry, and Suno request-contract findings are fixed. Local lint, targeted tests, full `npm test`, and iOS `xcodebuild test` pass. The key open risk has moved from "quality unknown" to "provider contract not proven": the live proof could create a Suno upload-cover task from enrolled voice audio, but SunoAPI rejected persona creation from both returned audio IDs. Production rollout must stay blocked until SunoAPI confirms a supported first-class way to create a reusable voice persona from a user's enrolled voice, or the product chooses a different provider path.

## Context and Orientation

Current Porizo song generation uses `src/workflows/runner.js` to move a track version through lyrics, music plan, provider generation, voice handling, mix, watermark, and ready steps.

`src/providers/suno.js` currently submits `POST /api/v1/generate` to SunoAPI and downloads the combined provider audio. It does not send `personaId` or `personaModel`.

`src/workflows/render-contract.js` currently treats Suno + `ai_voice` as `provider_complete_audio`, which skips guide vocal and voice conversion. It treats Suno + `user_voice` as `provider_audio_personalized_convert`, which skips guide vocal but still runs voice conversion.

`src/providers/voice.js`, `src/providers/seedvc.js`, and `src/providers/demucs.js` implement the old `user_voice` path. That path downloads a mixed Suno song, separates vocals and instrumental with Demucs, converts the isolated vocal to the user's enrolled voice with Seed-VC, optionally blends/polishes, then remixes. This plan avoids that path for Suno voice personas.

SunoAPI terms used in this plan:

Persona: A SunoAPI reusable identity created from an existing SunoAPI task audio. A returned `personaId` can be passed into later generation calls.

Voice persona: A persona used with `personaModel: "voice_persona"` so Suno applies voice-focused characteristics.

Bootstrap task: A one-time SunoAPI task created from the user's enrollment audio only to obtain the `taskId` and `audioId` needed to call `Generate Persona`.

## Plan of Work

First, add persistence for provider-specific voice personas. Prefer a new `voice_provider_profiles` table instead of more columns on `voice_profiles`, because Suno persona status, task IDs, audio IDs, provider metadata, and future providers have their own lifecycle. The table should include `id`, `voice_profile_id`, `user_id`, `provider`, `provider_profile_id`, `status`, `source_task_id`, `source_audio_id`, `model`, `metadata_json`, `error_message`, `created_at`, `updated_at`, and `deleted_at`. Add SQLite and PostgreSQL migrations.

Second, add a Suno persona provider module, for example `src/providers/suno-persona.js`. It should expose:

    uploadFileStream({ apiKey, filePath, uploadPath, fileName, timeoutMs })
    submitUploadCoverTask({ baseUrl, apiKey, uploadUrl, model, callbackUrl, timeoutMs, prompt, style, title, audioWeight })
    generatePersona({ baseUrl, apiKey, taskId, audioId, name, description, vocalStart, vocalEnd, style, timeoutMs })

Keep this separate from `src/providers/suno.js` so normal song generation remains understandable.

Third, add an enrollment-side job that runs only after Porizo voice enrollment is active. It should select the best clean sung enrollment segment, normalize it to a short acapella WAV or MP3, upload it through SunoAPI file upload or expose it via Porizo storage, submit an `upload-cover` task with `model: "V5_5"` and high `audioWeight`, poll until `SUCCESS`, select the best returned `audioId`, then call `generate-persona` with a 10-30 second vocal window. Save the returned `personaId` as a `voice_provider_profiles` row with `provider='suno'` and `status='active'`.

Fourth, add a feature flag such as `user_voice_engine` with values `suno_voice_persona`, `seedvc`, and `ai_voice_fallback`. Default it to `suno_voice_persona` only after live proof passes. During development, keep it explicit and environment-controlled.

Fifth, update `buildRenderContract` so Suno + `user_voice` + ready Suno persona becomes a provider-complete pipeline, for example `suno_voice_persona_complete_audio`. This pipeline must skip `guide_vocal`, `guide_vocal_full`, `voice_convert`, and `voice_convert_sections`, exactly like `provider_complete_audio`.

Sixth, update `src/providers/suno.js` so `buildSunoPayload` can accept `personaId`, `personaModel`, and `audioWeight`. When rendering a `user_voice` track with an active Suno persona, send:

    {
      customMode: true,
      instrumental: false,
      model: "V5_5",
      prompt: "<exact lyrics>",
      style: "<style descriptor>",
      title: "<title>",
      personaId: "<resolved Suno persona id from provider profile>",
      personaModel: "voice_persona",
      audioWeight: 0.85
    }

Keep `styleWeight` and `weirdnessConstraint` from existing style support logic. Do not send Seed-VC or Demucs parameters.

Seventh, update track creation and voice mode switching so `user_voice` can be selected when the user has an active Porizo voice profile and valid Suno-processing consent, even if the Suno provider profile is still preparing. Rendering must be blocked before entitlement or billing consumption until the Suno provider profile is active. If a user has a Porizo voice profile but no active Suno persona yet, return a specific "voice is still preparing" response rather than silently falling back to AI voice.

Eighth, update provenance. Every Suno voice-persona render should record `provider: "suno"`, `suno_model: "V5_5"`, `persona_model: "voice_persona"`, a hash or redacted form of the persona ID, `user_voice_engine: "suno_voice_persona"`, and the enrollment consent version.

Ninth, keep deletion and privacy aligned. When a Porizo voice profile is deleted, mark the `voice_provider_profiles` row deleted and stop using its persona ID. SunoAPI does not currently document a delete-persona endpoint in the pages reviewed, so the implementation must record that deletion was requested/locally enforced and avoid implying remote deletion occurred unless SunoAPI exposes it.

## Task Breakdown

Implement the work as small, reversible tasks. Each task should produce either a passing unit test, a migration that can be inspected, or a runtime behavior that can be manually verified.

### Phase 0: Live API Contract Probe

Goal: prove the undocumented edge of the SunoAPI persona flow before changing production behavior.

T0.1 Confirm credentials and base URLs. Read current config in `src/config.js` and admin music provider config code in `src/services/admin-service.js`. Add no code yet. Record whether generation and file upload need separate base URLs.

T0.2 Build a throwaway local script under `tools/` only if needed, for example `tools/suno-persona-probe.js`. It should upload one consented short voice sample, submit `upload-cover`, poll `record-info`, call `generate-persona`, then generate one short song with `personaModel: "voice_persona"`. Do not wire this script into product code.

T0.3 Evaluate output quality using the same consented speaker. Save only non-sensitive observations in this plan: whether the voice is recognizable, whether `V5_5` accepts `voice_persona`, whether `audioWeight` affects strength, and whether SunoAPI returns stable IDs. Do not commit private audio.

Exit criteria: either the probe produces a usable voice-persona song, or the plan is stopped and the product path remains AI voice only.

### Phase 1: Schema and Configuration

Goal: persist Suno voice persona state independently of Porizo's core voice profile.

T1.1 Add SQLite and PostgreSQL migrations for `voice_provider_profiles`. Include a unique active-provider constraint in spirit: one non-deleted active row per `voice_profile_id` and provider. SQLite may need a partial unique index; PostgreSQL can use a partial unique index.

T1.2 Add columns that support resumability: `source_upload_url`, `source_task_id`, `source_audio_id`, `provider_profile_id`, `status`, `metadata_json`, `last_error`, and timestamps. `provider_profile_id` stores the Suno `personaId`. The table must avoid destructive foreign-key cascade from `voice_profiles` because it is the local audit record for a provider-side artifact.

T1.3 Add repository/helper functions near existing voice enrollment data access, or a new `src/services/voice-provider-profile-service.js`, for: create pending row, mark upload-cover submitted, mark persona active, mark failed, find active Suno persona for user, and soft-delete provider profiles for a voice profile.

T1.4 Add feature flags in `src/services/feature-flags.js`: `user_voice_engine`, `suno_voice_persona_enabled`, `suno_voice_persona_audio_weight`, and `suno_voice_persona_model`. Keep defaults conservative until live proof passes. A safe initial default is `user_voice_engine: "ai_voice_fallback"` or feature disabled in production. `suno_voice_persona_model` must allow `V5_5` and `V5`, because SunoAPI documentation mentions `voice_persona` under "V5 model" wording while also listing `V5_5`.

Validation: migration tests should confirm the new table exists in SQLite and PostgreSQL repair coverage, and unit tests should cover helper idempotency.

### Phase 2: Suno Persona Provider Client

Goal: isolate SunoAPI persona mechanics behind a small provider module.

T2.1 Add `src/providers/suno-persona.js`. Implement request builders and exported functions for file-stream upload, upload-cover submission, generate-persona, and polling/reusing `pollSunoTaskOnce` or a shared polling utility.

T2.2 Handle both camelCase and snake_case response shapes. Current Suno code already handles both for audio URLs; reuse that defensive style for `audioId` extraction.

T2.3 Never log full persona IDs, upload URLs, or raw user audio paths. Add a small redaction helper if needed.

T2.4 Add `test/suno-persona-provider.test.js` with mocked `fetch` to assert request bodies, auth headers, response parsing, duplicate/conflict handling, and safe logging behavior.

Validation: `node --test --test-concurrency=1 test/suno-persona-provider.test.js`.

### Phase 3: Persona Preparation Job

Goal: create or resume a Suno voice persona after Porizo enrollment completes.

T3.1 Identify the enrollment completion point in `src/routes/enrollment.js`. Today active voice profiles are inserted there and no durable enrollment job row is created. Hook persona preparation after active profile creation, but do not block the API response on long Suno work.

T3.2 Add a concrete durable lane for `voice_persona_prepare`. Do not assume the existing track-version job runner can handle this unchanged. Either add a small `voice_provider_jobs` table and poller, or deliberately extend `jobs` to support voice-profile-scoped jobs with nullable `track_version_id`. The first implementation should prefer the smaller dedicated table to avoid destabilizing render jobs.

T3.3 Select the source audio. Start with the best sung enrollment sample from existing `findReferenceAudio` logic in `src/providers/voice.js`, but move shared selection logic to a service if needed to avoid importing the old voice conversion provider into the new path. Normalize to a 10-30 second clean mono WAV/MP3 suitable for Suno upload. If existing sung chunks are shorter than 10 seconds, stitch clean sung chunks with short silences and record the source parts in metadata.

T3.3a Add a future enrollment prompt change for new users: one dedicated 15-25 second sung calibration prompt, recorded acapella. This is not optional for production rollout because Suno persona analysis requires a 10-30 second window.

T3.4 Upload source audio through SunoAPI file upload or a short-lived Porizo storage URL. Prefer the SunoAPI file upload endpoint only for the bootstrap file because it returns a temporary public `downloadUrl`.

T3.5 Submit `upload-cover` with `model: "V5_5"`, `customMode: true`, `instrumental: false`, a simple neutral style/title, and high `audioWeight`. Poll until terminal success or failure. Store `source_task_id` immediately after submission.

T3.6 Extract `audioId` from the successful task result, call `generate-persona`, and save `provider_profile_id` with status `active`.

T3.7 Add admin visibility for failed/pending persona preparation in the existing admin voice profile views if implementation scope allows. At minimum, errors must be visible in logs and in the provider profile table.

T3.8 Require consent scope `voice_suno_persona_v1` or a successor before T3.4 uploads anything. Existing voice profiles without this consent must stay eligible for AI voice only until the user re-consents and records or approves a Suno calibration sample.

Validation: unit tests for each resumable state; integration-style test with mocked Suno provider that starts from pending, resumes after upload-cover success, and ends active. Add a test proving no upload happens without the new consent scope.

### Phase 4: Render Contract and Suno Generation

Goal: make `user_voice` with active Suno persona a direct Suno generation, not voice conversion.

T4.1 Extend `src/workflows/render-contract.js` with a new pipeline, `suno_voice_persona_complete_audio`, or make `provider_complete_audio` carry a `user_voice_engine` marker. The pipeline must skip guide vocal and voice conversion and must be allowed by `assertPersonalizedContract`.

T4.2 Update music planning in `src/workflows/runner.js` so `track.voice_mode === "user_voice"` uses a local `voice_provider_profile_id`, not a raw Suno `personaId`, when `user_voice_engine === "suno_voice_persona"`. If missing at worker time, stop with a clear retryable error like `E302_VOICE_PERSONA_PREPARING`; however, route-level preflight in Phase 5 must normally catch this before spend.

T4.3 Thread the active persona into `musicPlan` or `render_contract` as a redacted/reference object containing only local IDs and redacted labels. Do not store raw persona IDs in music plans, checkpoints, provenance, logs, or user-facing JSON responses.

T4.4 Extend `buildSunoPayload` and `submitSunoTask` in `src/providers/suno.js` to include `personaId`, `personaModel: "voice_persona"`, and `audioWeight` when present. Force `instrumental: false` for user voice persona renders.

T4.5 Update provenance in `src/workflows/runner.js` so rendered track versions record the user voice engine, Suno model, persona model, redacted persona ID, and voice profile ID.

T4.6 Ensure `mix` treats this pipeline like provider-complete audio even though `voice_mode === "user_voice"`. The final output should be the downloaded Suno audio converted/encoded through the same path AI voice uses, not remixed vocals. The branch must not enter the personalized Demucs/stems requirement.

T4.7 Update quality scoring for provider-complete persona audio. The current personalized score path expects `user_vocal.wav`; this pipeline should score the downloaded provider audio as the vocal-bearing final source and must not fail because no converted vocal file exists.

T4.8 Define frozen-contract behavior. Existing track versions whose `music_plan_json.render_contract.pipeline` is `provider_audio_personalized_convert` must continue or fail consistently under the old engine; newly created versions after the flag flips should use the new persona pipeline. Do not silently mutate completed versions. For failed/queued personalized versions, add an explicit admin or retry migration path that rebuilds music_plan with the new engine only after persona readiness.

Validation: render-contract tests, Suno payload tests, quality gate tests, runner unit tests where possible, and a mocked workflow test proving `voice_convert` is skipped.

### Phase 5: API and Client Semantics

Goal: make product behavior predictable while a persona is being prepared.

T5.1 Update track creation in `src/routes/tracks.js` and story-to-track creation in `src/routes/story.js` so `user_voice` checks active Porizo voice profile and the new consent scope. It may allow draft creation while Suno persona is pending.

T5.2 Decide product semantics for "voice profile active but Suno persona pending." Preferred behavior: allow track draft creation but block render with `VOICE_PERSONA_PREPARING`, because users can still write/edit lyrics while voice preparation finishes.

T5.3 Update `PATCH /tracks/:id/voice_mode` to return the effective mode plus a readiness reason. Do not silently coerce to AI voice if the user explicitly requested My Voice and preparation is still pending.

T5.4 Update any iOS/backend contract tests that expect silent fallback to AI voice. The new behavior should be explicit.

T5.5 Add render preflight before entitlement or billing consumption in `POST /tracks/:id/versions/:v/render_preview`, full render, retry, and reroll paths. If `voice_mode='user_voice'` and the Suno engine is enabled, an active provider profile must exist before any credit, entitlement, or hold changes.

Validation: route tests for active persona, pending persona, missing persona, disabled feature flag, and pending persona blocking render before entitlement spend.

### Phase 6: Privacy, Deletion, and Compliance

Goal: avoid overstating control over provider-side biometric artifacts.

T6.1 Update deletion in `src/routes/enrollment.js` and `src/services/auth-service.js` so deleting a voice profile also soft-deletes provider profile rows and prevents future use.

T6.2 Add audit log entries for Suno persona preparation submitted, active, failed, and locally deleted. Include provider and redacted IDs only. For account deletion, write/flush the local provider-profile disable/audit record before hard-deleting parent voice profile rows, or avoid hard deletion of provider-profile rows entirely.

T6.3 Review privacy copy and internal docs. Since SunoAPI does not document persona deletion in the reviewed pages, do not claim remote deletion unless a delete endpoint is confirmed and implemented.

T6.4 Ensure temporary bootstrap files are not kept longer than needed. If Porizo storage is used instead of Suno file upload, use short-lived signed URLs and lifecycle cleanup.

Validation: deletion tests confirm `user_voice` render cannot use a soft-deleted persona; audit tests or snapshots confirm redaction.

### Phase 7: Rollout and Observability

Goal: release behind controls and know quickly whether quality or provider behavior fails.

T7.1 Add provider metrics/log events for persona preparation latency, upload-cover failures, generate-persona failures, render failures with persona, and user-visible readiness blocks.

T7.2 Add a feature-flag rollout sequence: internal test users only, then 5%, then 25%, then all users who newly enroll. Existing Seed-VC-era profiles should not be auto-migrated without explicit re-consent.

T7.3 Add a rollback playbook: disable `suno_voice_persona_enabled`, keep existing personas in DB, stop new persona creation, and route `user_voice` requests to a clear unavailable state or AI fallback depending on product decision.

T7.4 Define quality review: each rollout stage samples at least 10 successful renders and rates voice resemblance, lyric adherence, style adherence, and artifact rate.

Validation: production smoke checklist completed and recorded in this plan's Outcomes section.

## Concrete Steps

Run all commands from `/Users/ao/Documents/projects/porizo`.

1. Add migrations:

    migrations/0xx_voice_provider_profiles.sql
    migrations/pg/0xx_voice_provider_profiles.sql

2. Add provider code:

    src/providers/suno-persona.js

3. Add unit tests:

    test/suno-persona-provider.test.js
    test/suno-provider.test.js
    test/workflows/render-contract.test.js

4. Extend `src/providers/suno.js` payload construction and submit logging so it includes persona fields only when present.

5. Extend `src/workflows/render-contract.js` with `suno_voice_persona_complete_audio` and skip voice conversion for that pipeline.

6. Add the dedicated `voice_persona_prepare` job lane. The job must be idempotent: if an active Suno persona row already exists for the voice profile, do nothing.

7. Add render preflight before entitlement and billing changes for preview, full render, retry, and reroll.

8. Run:

    npm test
    npm run lint

9. Run a live proof only with explicit test credentials and consented audio:

    npm run dev

Then enroll a test voice, wait for Suno persona creation, create a `user_voice` track, render preview, and confirm the provider request logs show `model=V5_5 personaModel=voice_persona`.

## Specialist Review Plan

Use one specialist review agent before implementation and one after the first working patch. The reviewer should be explicitly told to challenge assumptions, not just approve the design.

Pre-implementation review:

1. Ask the specialist to inspect this plan, `src/workflows/render-contract.js`, `src/workflows/runner.js`, `src/providers/suno.js`, `src/routes/enrollment.js`, `src/routes/tracks.js`, `src/routes/story.js`, `src/services/feature-flags.js`, and current tests under `test/workflows` and `test/suno-provider.test.js`.
2. Required review questions:
   - Does the plan correctly model Suno voice persona as provider generation instead of post-generation conversion?
   - Are any old Seed-VC/Demucs calls still reachable in the proposed persona pipeline?
   - Are schema fields sufficient to resume after partial SunoAPI success?
   - Are privacy/deletion claims accurate given the documented SunoAPI surface?
   - Which tests are mandatory before live proof?
3. Record accepted findings in the Decision Log or Surprises section before code begins.

Post-implementation review:

1. Ask the specialist to review the final diff and tests before live proof.
2. Required review questions:
   - Can a missing or pending persona silently fall back to AI voice?
   - Are persona IDs, upload URLs, and voice file paths redacted from logs and user responses?
   - Does `voice_convert` skip for the Suno persona pipeline in both preview and full render?
   - Does deletion prevent future use of stored provider personas?
   - Does rollback avoid data deletion and leave a reversible state?
3. Run the review before `npm test` final full-repo validation if the patch is large, then run it again only if the specialist finds architectural issues.

Reviewer output format:

    Findings:
    - [Severity] File/path:line or task ID. Problem and impact.

    Required fixes before implementation:
    - ...

    Optional improvements:
    - ...

    Sign-off criteria:
    - ...

## Validation and Acceptance

Unit acceptance:

`buildSunoPayload` returns `personaId`, `personaModel: "voice_persona"`, and `audioWeight` when a Suno persona is supplied, and omits them for normal AI voice generation.

`resolveRenderContract` maps Suno + `user_voice` + Suno persona engine to a provider-complete pipeline that skips voice conversion.

The persona provider unit tests verify request bodies for file upload, upload-cover task creation, and generate-persona creation without making network calls.

Route tests prove pending persona blocks render before entitlement spend, while still allowing draft creation when that product behavior is selected.

Quality and mix tests prove persona provider-complete audio does not require `user_vocal.wav`, `stems/vocals.wav`, or `stems/instrumental.wav`.

Deletion tests prove soft-deleted provider profiles cannot be used and account deletion preserves or records the local disable/audit state before parent voice rows are removed.

Live acceptance:

A user with an active Suno voice persona can render a preview with `voice_mode: "user_voice"` and the workflow never calls Demucs, Seed-VC, or `voice_convert`.

The final track audio URL is the Suno-generated provider audio from the persona generation request.

The database records a provider voice profile row with `provider='suno'`, an active `provider_profile_id`, and provenance on the track version identifies the Suno voice persona engine.

Negative acceptance:

A user without an active Suno persona cannot start a `user_voice` render. The API returns a clear "voice preparing" or "voice enrollment required" error, not silent AI fallback.

A user without the new Suno persona consent cannot trigger persona upload or render with Suno user voice.

## Idempotence and Recovery

Persona creation must be resumable by storing external task IDs. If upload-cover succeeds but generate-persona fails, retry from the stored task ID and audio ID instead of uploading the same voice sample again. If generate-persona returns a duplicate/conflict for the same audio ID, treat the existing active persona row as authoritative if present; otherwise surface a manual recovery state.

Song render requests should remain idempotent by using the existing track version and params hash. A retry must reuse the same provider profile row and must not create a new persona.

Rollback is straightforward: set `user_voice_engine=seedvc` or disable `my_voice_enabled`. Do not delete provider profile rows during rollback.

Existing frozen render contracts must be treated deliberately. Do not globally reinterpret old `provider_audio_personalized_convert` contracts as Suno persona contracts. New rerolls or explicit retries may rebuild a new version with the new engine after persona readiness.

## Artifacts and Notes

SunoAPI documents the required persona flow as of 2026-05-05:

- File upload returns a temporary `downloadUrl` and uploaded files are deleted after 3 days.
- Upload-cover accepts `uploadUrl`, `model`, `customMode`, `prompt`, `style`, `title`, and optional `audioWeight`; generated files are retained for 15 days.
- Get music generation details returns `sunoData[].id`, which is the audio ID needed by Generate Persona.
- Generate Persona requires `taskId` and `audioId` and returns `personaId`.
- Generate Music accepts `personaId` and `personaModel`; `voice_persona` applies voice-focused persona characteristics.

Specialist review completed on 2026-05-05 found twelve gaps. Accepted fixes are now embedded in this plan: pre-spend render preflight, personalized guard updates, quality/mix changes for provider-complete `user_voice`, a dedicated persona job lane, frozen contract migration semantics, draft-vs-render API semantics, deletion ordering, 10-30 second calibration audio, new consent, raw persona ID redaction, V5/V5.5 model proof, and expanded tests.

The main implementation risk is bootstrap quality. The first prototype must compare at least three bootstrap inputs:

1. Clean acapella sung enrollment only.
2. Clean spoken + sung enrollment stitched together.
3. User sings a simple fixed calibration line with no backing track.

Choose the input that produces the strongest recognizable voice in generated songs while staying simple for users.

## Interfaces and Dependencies

Use the existing Suno API base URL and API key config. Add a separate file upload base URL only if needed, because SunoAPI file upload examples use `https://sunoapiorg.redpandaai.co/api/file-stream-upload` while generation examples use `https://api.sunoapi.org/api/v1`.

Do not pass raw user voice files into Suno during normal song rendering. User voice should only be sent during persona preparation, after Porizo consent and QC.

Do not call `src/providers/voice.js`, `src/providers/seedvc.js`, or `src/providers/demucs.js` in the Suno voice-persona render path.

The song generation interface should remain:

    generateMusicWithSuno({
      baseUrl,
      apiKey,
      sunoModel,
      storageDir,
      track,
      trackVersion,
      lyrics,
      musicPlan,
      timeoutMs,
      kind,
      onTaskId,
    })

Add persona information through `musicPlan.render_contract` or a dedicated `musicPlan.suno_voice_persona` object, not through ad hoc global state.

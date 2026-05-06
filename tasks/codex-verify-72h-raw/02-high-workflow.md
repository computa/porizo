# Verification: HIGH (Workflow + Service Layer, H1-H11)

## H1 — Persona lock global vs per-job

**Status: FIXED**

- Evidence: `src/workflows/runner.js` — `acquireVoiceProviderLock` / `releaseVoiceProviderLock` / `voice_provider_locks` references entirely removed. Concurrency now relies on atomic `markVoiceProviderJobRunning` claim + per-job `heartbeatVoiceProviderJob` at runner.js:5419-5426.

## H2 — Stale-job recovery on every 1s tick

**Status: FIXED**

- Evidence: `src/workflows/runner.js:2069-2087` — `recoverStaleVoiceProviderJobs` is now called inside `performStaleJobRecovery`, scheduled by existing `recoveryTimer` (`recoveryIntervalMs = max(60s, staleJobTimeoutMinutes*30s)`). `tickVoiceProviderJobs` no longer calls it.

## H3 — Duplicate `PERSONALIZED_VOICE_MODES`

**Status: FIXED (within scope)**

- Evidence: `src/workflows/render-contract.js:5,324` defines + exports; `src/workflows/runner.js:96` imports. Local copy gone.
- Gap: A third copy still exists at `src/routes/tracks.js:24` (outside H3 scope but worth flagging).

## H4 — N+1 in tick candidate filter

**Status: FIXED**

- Evidence: `src/workflows/runner.js:5364-5378` — single batched `SELECT tv.id, t.user_id FROM track_versions tv JOIN tracks t ... WHERE tv.id IN (...)` builds `candidateUsersByJobId` Map. Per-candidate sequential reads gone.

## H5 — Voice provider lane disable / concurrency limit untested

**Status: NOT FIXED**

- Evidence: `grep -rn 'MAX_CONCURRENT_VOICE_PROVIDER\|voiceProviderLaneDisabled\|tickVoiceProviderJobs' test/` returns 0 matches. No test creates `MAX_CONCURRENT + 1` queued jobs; no test simulates missing table for lane disable.
- Gap: Both required test cases absent.

## H6 — Upload-success URL dropped

**Status: FIXED**

- Evidence: `src/services/suno-voice-persona-service.js:492,500` — `uploadUrl = upload.downloadUrl;` and `markProviderProfileUploadSubmitted(db, providerProfile.id, { sourceUploadUrl: upload.downloadUrl, … })`. Persisted URL re-read at line 466 on retry.

## H7 — `markProviderProfileManualCleanupRequired` wrong status / drops persona_id

**Status: FIXED**

- Evidence: `src/services/voice-provider-profile-service.js:284-327` — passes `status: STATUS.MANUAL_CLEANUP_REQUIRED` and `includeDeleted: true` to `markProviderProfileFailed`. The latter (line 252-281) honors both via `const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";`. Audit log entry inserted with provider_profile_id captured.

## H8 — `markPersonaGenerationStarted` lost-claim silent failure

**Status: FIXED**

- Evidence: `src/services/suno-voice-persona-service.js:605-615` — calls `markVoiceProviderJobStep(db, job.id, "generate_persona")` returning `result.changes ?? rowCount ?? 0`. Caller throws `E302_SUNO_PERSONA_LOST_CLAIM` BEFORE setting `generatePersonaRequestStarted = true`.

## H9 — Polling loop swallows audio_success without sunoData

**Status: FIXED**

- Evidence: `src/providers/suno-persona.js:411-415` — `if (!result?.done || !result.audioId) throw new Error("E302_SUNO_PERSONA_AUDIO_NOT_READY: …");` after `pollWithBackoff`. Service layer treats as retryable (suno-voice-persona-service.js:748-751), so job rescheduled instead of MANUAL_RECOVERY_REQUIRED.

## H10 — Cancellation does not reach in-flight Suno calls; rate limit on DELETE /voice/profile

**Status: PARTIAL**

- Evidence: `cancellation_requested_at` column added (migrations 097/099). `cancelVoiceProviderJobsForVoiceProfile` sets it. `assertProviderJobReady` checks it.
- Gap (1): NO per-user rate limit on `DELETE /voice/profile` — `enrollment.js:1729-1802` has no `consumeRateLimit` call. Rapid delete+enroll abuse still possible.
- Gap (2): Cancellation check only fires BETWEEN Suno calls via `assertProviderJobStillAllowed`, not mid-call as report recommended. An in-flight `submitUploadCoverTask` or `pollUploadCoverForAudio` runs to completion before cancellation surfaces.

## H11 — `shouldQueueSunoPersona = true` hardcoded

**Status: PARTIAL**

- Evidence: `src/routes/enrollment.js:1204-1210` reads `getFeatureFlags(db, ["suno_voice_persona_enabled", …])` and gates `shouldQueueSunoPersona = sunoPersonaFlags.suno_voice_persona_enabled !== false`. Kill switch works.
- Gap: Default in `src/services/feature-flags.js:85` is `'suno_voice_persona_enabled': true`. Report recommended default OFF for staged rollout. Currently it's opt-out only.

**Tally: 8 FIXED · 2 PARTIAL · 1 NOT_FIXED**

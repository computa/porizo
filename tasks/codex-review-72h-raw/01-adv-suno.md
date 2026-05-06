# Reviewer: adversarial (Suno persona feature)

## Findings (16 total)

### HIGH

1. **[HIGH] src/workflows/runner.js:5390 — Persona lock is global, serializes all persona work to 1 concurrent job**
   - Scenario: Two enrollment-completes for two different users land at the same instant. Runner sees `MAX_CONCURRENT_VOICE_PROVIDER_JOBS > 1` available slots, iterates `eligibleJobs`. `acquireVoiceProviderLock` uses hardcoded `lockId = "suno_voice_persona"`. First job INSERTs row, gets lock; second job's INSERT hits ON CONFLICT, but `WHERE voice_provider_locks.locked_at < ?` fails because lock is fresh, so `result.changes === 0` and second job silently aborts. Worse, `releaseVoiceProviderLock` deletes by `(id, locked_by=runnerId)`, so when first job finishes it deletes the only row even if a second job had concurrently obtained it on same runnerId. Heartbeat updates collide too.
   - Impact: True parallelism silently bounded to 1 — backlog grows, persona jobs queue up to 15-min retries despite spare slots.
   - Fix: Compose lock id with job id (`lockId = \`suno_voice_persona:${job.id}\``) and store/release/heartbeat per-job, OR drop global lock entirely and rely on `markVoiceProviderJobRunning`'s atomic claim.

2. **[HIGH] src/services/suno-voice-persona-service.js:316 — Upload-success URL dropped, every retry re-uploads and re-bills**
   - Scenario: `runSunoVoicePersonaJob` calls `sunoClient.uploadFileUrl(...)` returning `uploaded.downloadUrl`. Next DB write at 316–323 (`markProviderProfileUploadSubmitted`) passes `sourceUploadUrl: null`. If transient error before `markProviderProfileCoverSubmitted` persists (Suno 5xx, network glitch on cover-submit, SIGTERM mid-step), job retryable. On retry, `providerProfile.source_upload_url` is null AND `providerProfile.source_task_id` is null, so the `if (!uploadUrl && !sourceTaskId)` block re-enters and re-uploads from scratch. Up to 3 paid file-url uploads and cover-submits per persona under max_attempts=3.
   - Impact: Cost amplification on every retry. Orphaned upload-cover tasks accumulate at Suno (no cleanup hook).
   - Fix: In `markProviderProfileUploadSubmitted`, persist actual `upload.downloadUrl` instead of `null`. In `markProviderProfileCoverSubmitted`, leave `source_upload_url` intact until persona is active OR store in separate column so retries reuse upload.

3. **[HIGH] src/routes/internal-suno-callback.js:111 — Token in query string + length-check oracle + dead route on misconfig**
   - Scenario: Query token auth uses `timingSafeEqualString` with prior length-check short-circuit (length compare faster than alloc + HMAC alt path) — attacker can probe length via timing. **Token sits in query string, logged by reverse proxies (Nginx, CloudFront), browser referrers — anyone with access logs can replay.** When `SUNO_CALLBACK_URL` resolved by `resolveSunoCallbackUrl` is built from `PUBLIC_BASE_URL` and lacks a `?token=` (resolver does not add one), every Suno-initiated callback fails 401 silently — route is dead unless operator manually appends a token.
   - Impact: Webhook receiver is either inert (when only PUBLIC_BASE_URL configured) so no operational signal, or replayable via captured access logs. HMAC fallback header undocumented at Suno's end so will likely never fire.
   - Fix: Make `resolveSunoCallbackUrl` append `?token=<secret>` when `SUNO_CALLBACK_HMAC_SECRET` set. Refuse query-token auth and require HMAC-of-rawBody only. If Suno doesn't provide signatures, generate per-job opaque path token, store binding in `voice_provider_jobs.callback_token` for one-time match.

4. **[HIGH] src/routes/internal-suno-callback.js:96 — Callback never updates state, so async failures stay stuck "running" until stale-recovery**
   - Scenario: Route documented as stub: "Stub MUST NOT mutate state". Legitimate Suno callback delivering "persona generation failed" arrives → 200 → no DB update. Worker meanwhile blocked in `pollUploadCoverForAudio`. If Suno never updates status (its task silently dropped), worker's `pollWithBackoff` runs to `maxAttempts`, then errors. By then `generatePersonaRequestStarted` may be true so entire job lands in `MANUAL_RECOVERY_REQUIRED`.
   - Impact: Operator burden — every persona that fails callback-side becomes manual-cleanup ticket.
   - Fix: Wire callback to drive state transition keyed off `(taskId, audioId)`: cancel polling for that taskId by writing to `voice_provider_jobs.step_data.callback_terminal_status`; have polling loop short-circuit on it.

5. **[HIGH] src/services/suno-voice-persona-service.js:489-517 — Persona created at Suno after job cancellation is marked failed but persona_id is lost**
   - Scenario: Worker calls `generatePersona` which succeeds at Suno (`persona.personaId` returned). Before local commit at line 454 (`markProviderProfileActive`), `assertProviderJobStillAllowed` runs and throws (e.g., user just deleted their voice profile, triggering `cancelVoiceProviderJobsForVoiceProfile`). Catch at 442 calls `markProviderProfileManualCleanupRequired` with `providerProfileId: persona.personaId`. But that function actually writes status `STATUS.FAILED` (voice-provider-profile-service.js:270), not `manual_cleanup_required`. `softDeleteProviderProfilesForVoiceProfile` already ran during cancellation, set `deleted_at` AND wiped `provider_profile_id` to NULL. Now `markProviderProfileManualCleanupRequired` UPDATE WHERE includes `deleted_at IS NULL` — affects 0 rows. **Remote `personaId` at Suno is silently leaked with no DB record.**
   - Impact: GDPR/data-retention nightmare. When user deletes voice, persona objects continue to exist at Suno with no local pointer to clean up. `tools/cleanup-orphan-persona-jobs.js` won't find them — link is gone.
   - Fix: `markProviderProfileManualCleanupRequired` must (a) write status `'manual_cleanup_required'` not `FAILED`, (b) drop the `deleted_at IS NULL` predicate so terminal cleanup states overwrite even soft-deleted rows. Emit `audit_logs` entry with personaId so cleanup script can find it. **(Overlaps with maint-9 and api-15.)**

6. **[HIGH] migrations/pg/098_enrollment_sessions_consent_scopes.sql:22-34 — Backfill silently grants persona consent to users who never opted in**
   - Scenario: Migration backfills `enrollment_sessions.consent_scopes` from "most recent non-null consent_scope on any voice_provider_profile for that user." But profile consent_scope is stamped only when user explicitly grants. However, an admin or test path that called `createPendingProviderProfile` with non-null scope on behalf of a user (canary testing, manual recovery in `tools/cleanup-orphan-persona-jobs.js`) seeds a scope on the profile. Migration propagates that scope to ALL of that user's enrollment_sessions, including older ones from before persona-feature existed.
   - Impact: Privacy violation — backfilled consent enables later enrollment-session-based persona decisions for historical sessions where user predates consent UX.
   - Fix: Backfill only sessions started AFTER consent UX shipped, AND only when `voice_provider_profiles.created_at` predates session's `started_at`. Better: do not backfill at all — fail-secure default of NULL is correct. **(Overlaps with mig-8.)**

7. **[HIGH] src/services/voice-provider-profile-service.js:497-520 — Cancellation excludes terminal jobs but NOT in-flight cover-submit**
   - Scenario: `cancelVoiceProviderJobsForVoiceProfile` updates jobs `WHERE status IN ('pending', 'running')`. Between route reading `voice_profile.id` and calling cancel, worker can be MID-CALL to Suno (status='running'). Cancel update sets status='cancelled' but worker unaware until next `assertProviderJobStillAllowed`. Heartbeat at runner.js:5419 does `UPDATE ... WHERE id=? AND locked_by=? AND status='running'` — heartbeat stops working post-cancel, worker doesn't know. Attacker spams delete+enroll to keep cancelling jobs after they submit upload-cover tasks at Suno. Each cancelled mid-flight job leaves orphan task billed for cover generation.
   - Impact: Pay-per-call cost amplification via abuse. With max_attempts=3 and ~1min retry backoff, user can trigger up to 3 orphan covers per re-enrollment. **No rate limit on `DELETE /voice/profile` visible in this diff.**
   - Fix: Add per-user rate limit on `DELETE /voice/profile` (1/min) and `POST /voice/enrollment/start`. On cancellation, set `cancellation_requested_at` hint that worker checks before each Suno call (not only between calls).

8. **[HIGH] src/services/suno-voice-persona-service.js:96-99 — `markPersonaGenerationStarted` UPDATE precondition can lose "started" flag silently**
   - Scenario: Updates `step='generate_persona'` only `WHERE id=? AND status='running'`. If heartbeat's atomic claim was overwritten (cancellation, stale-recovery), UPDATE affects 0 rows. Function doesn't check `result.changes`, so `generatePersonaRequestStarted=true` is set in worker even though `step` is still `prepare_persona`. Then `generatePersona` succeeds at Suno, in-flight cancel arrives, `assertProviderJobStillAllowed` throws, catch handler reads `latestProfile.status` to decide. If between persona-create and catch, another worker (or `recoverStaleVoiceProviderJobs`) re-claims this row and tries to advance, **persona might be re-created at Suno on same audioId, multiplying remote personas.**
   - Impact: Duplicate personas at Suno (each billed). Local DB has only the last one. Cleanup script can't see orphans.
   - Fix: Make `markPersonaGenerationStarted` return `result.changes`; on 0, throw `E302_SUNO_PERSONA_LOST_CLAIM` and abort BEFORE `generatePersonaRequestStarted=true`.

9. **[HIGH] src/providers/suno-persona.js:240-332 — Polling loop can never detect "audio_success without sunoData" — provisional path swallows legitimate error**
   - Scenario: `pollUploadCoverForAudio` swallows `E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN` only when `phase === "provisional_success"`. But Suno's `audio_success` for some retry paths reported with empty/null `sunoData` in initial seconds — legit transient. Code throws on shape-unknown when phase is `audio_success`, killing the job. Worse: phase reports `provisional_success` indefinitely (Suno bug we've seen) — `pollWithBackoff` exhausts attempts, returns whatever; `result.audioId` undefined. Caller `runSunoVoicePersonaJob:381` does `sourceAudioId = audio.audioId` — undefined. `markProviderProfilePersonaSubmitted` sets `source_audio_id = NULL`. Then `generatePersona` called with `audioId: undefined`, `requireString` throws — but now in `generatePersonaRequestStarted` block, marked `MANUAL_RECOVERY_REQUIRED`. **False manual ticket.**
   - Impact: Operator-time burn from spurious manual-recovery tickets.
   - Fix: After `pollWithBackoff` returns, assert `result.done && result.audioId` truthy; if not, throw retryable poll-timeout error so `markVoiceProviderJobFailed(retryable=true)` reschedules instead of going manual.

10. **[HIGH] src/routes/enrollment.js:1064 — Feature flag is read but ignored; `shouldQueueSunoPersona = true` is hardcoded**
    - Scenario: `enrollment/complete` reads `getFeatureFlags(db, [...])` for model and audio_weight, but gate `shouldQueueSunoPersona` is hardcoded `true`. No `my_voice_enabled` or `suno_persona_enabled` check before queuing job. **If persona feature has bug in production (Suno's API down), turning the flag off does nothing — every enrollment-complete still queues a paid persona-prep job.**
    - Impact: No operational kill switch. A bad day at Suno → every new enrollment burns API credits with no throttle.
    - Fix: Read a `suno_voice_persona_enabled` boolean flag and gate `shouldQueueSunoPersona` on it. Default OFF in feature_flags DEFAULTS.

### MEDIUM

11. **[MEDIUM] src/routes/enrollment.js:175 — clean.wav token comparison is non-constant-time**
    - Fix: `crypto.timingSafeEqual` after length check (mirroring internal-suno-callback). **(Overlaps sec-1.)**

12. **[MEDIUM] src/services/suno-voice-persona-service.js:294 — PUBLIC_BASE_URL fallback to localhost makes Suno fetch loopback URL**
    - Scenario: `buildEnrollmentCleanAudioUrl({ baseUrl: config.PUBLIC_BASE_URL || config.STREAM_BASE_URL, ... })`. Both default to `http://localhost:${PORT}` if env unset. In production where neither set (deploy misconfig), source URL becomes `http://localhost:8080/enrollment/.../clean.wav?token=...`. Suno fetches from their server, gets connection-refused, fails upload-cover. Code path: throws → retry → each retry consumes paid Suno upload-billing slot. **Worse, if URL accidentally resolves to a different service (dev tunnel), user's voice audio is sent to wrong destination.**
    - Impact: Voice data leakage to unintended recipient + paid retries.
    - Fix: At server start, if `SUNO_CALLBACK_URL` is set or `LIVE_PROVIDERS=true`, validate `PUBLIC_BASE_URL` is HTTPS and not localhost. Fail-fast at boot.

13. **[MEDIUM] src/services/suno-voice-persona-service.js:286-323 — State transition bypasses `upload_submitted` and corrupts unique-active invariant on cleanup race**
    - Scenario: When `providerProfile.source_upload_url` exists but `source_task_id` doesn't (recovered mid-state), the `if (!uploadUrl && !sourceTaskId)` block is skipped, `markProviderProfileUploadSubmitted` is never re-run, BUT next assertion `assertProviderJobStillAllowed` re-fetches the row. If between read at 255 and this assertion, an admin manually corrected `source_upload_url` to NULL via tooling, line 286 now passes empty `uploadUrl` to `submitUploadCoverTask` — `requireString(uploadUrl, "uploadUrl")` throws but wrapped with no clear path attribution. State machine spec (`pending → upload_submitted → cover_submitted → persona_submitted → active`) never validated; current code can write `active` directly from `pending` if worker found `source_upload_url` and `source_task_id` already populated (manual SQL).
    - Impact: State-machine integrity assumed not enforced — manual SQL can short-circuit safety checks.
    - Fix: Add CHECK constraint or trigger preventing transitions other than spec order. In service, validate status in addition to data presence.

14. **[MEDIUM] src/utils/provider-sanitize.js:25 — Sanitizer regex misses key formats; persona/audio IDs leak when not prefix-formatted**
    - Scenario: Sanitizer redacts `\bpersona[_-]...`, `\btask[_-]...`, `\baudio[_-]...`. Suno's actual IDs (`sunoData[0].audioId`) come as bare UUIDs/random strings without prefix — sanitizer doesn't redact. Errors like `"upload-cover failed - audioId 1f7e... not ready"` leak raw ID to logs. Bearer regex `Bearer\s+[A-Za-z0-9._~+/=-]+` doesn't catch Suno's JWT-shaped auth-header echoes if they include `:` or `;`.
    - Impact: PII-adjacent IDs leak to ops logs; over time ops can correlate users → personas without DB access.
    - Fix: Redact all hex-shaped strings ≥16 chars via `/\b[A-Fa-f0-9]{16,}\b/g`, all UUIDs, all bare token-like strings ≥20 chars. **(Overlaps sec-8.)**

15. **[MEDIUM] src/services/voice-provider-profile-service.js:255-278 — `markProviderProfileManualCleanupRequired` writes status `FAILED`, name lies**
    - Scenario: CHECK constraint allows `'manual_cleanup_required'` status. Function sets `STATUS.FAILED` (line 270), not `'manual_cleanup_required'`. Code that filters profiles by `WHERE status = 'manual_cleanup_required'` (e.g., `tools/cleanup-orphan-persona-jobs.js`, ops dashboards) will never find these rows. They get bucketed with normal failures.
    - Fix: Add `STATUS.MANUAL_CLEANUP_REQUIRED = 'manual_cleanup_required'` and use it in this function. **(Overlaps maint-9.)**

16. **[MEDIUM] src/services/suno-voice-persona-service.js:43-66 — Consent parsing accepts permissive/inconsistent matches**
    - Scenario: `hasPersonaConsentScope` lowercases input then JSON.parse, then split fallthrough. Lowercasing entire JSON string before parse mangles capitalized values; `{"scopes":["VOICE_SUNO_PERSONA_V1"]}` becomes lowercased and matches. Inconsistent: scope written by `enrollment.js:497` is `requestedScopes.join(" ")` — preserves case. Reader lowercases. If future writer uses uppercase, behavior diverges silently.
    - Fix: Parse JSON BEFORE lowercasing. Check exact scope match (case-sensitive) since literal is fixed.

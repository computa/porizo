# Codex Fix Report — 72-hour Review of `version3` Branch

**Generated:** 2026-05-06
**Branch:** `version3` at HEAD `c77953c`, 14 commits ahead of `origin/version3` (unpushed)
**Diff scope:** `git diff origin/version3..HEAD` — 65 files, +15,192 / −4,666
**Review run:** 9 parallel reviewers (adversarial, correctness, security, maintainability, testing, migrations, performance, API contract, iOS Swift)
**Raw output:** see `tasks/codex-review-72h-raw/0[1-9]-*.md` for per-reviewer detail

---

## Context for Codex

This review covers the **Suno voice-persona feature** (the dominant change in the diff): a new external-API-driven flow that replaces local Seed-VC voice conversion for "My Voice" renders. The feature spans new providers, services, routes, migrations, workflow runner changes, and a parallel iOS rewrite (`EnrollmentFlowView.swift` replacing `VoiceEnrollmentView.swift`).

**Production constraints:**

- iOS build **110** is in TestFlight; older builds **105–109** are still in the wild and call the same endpoints.
- Backend deploys to Railway (PostgreSQL); test suite runs against in-memory SQLite via sql.js.
- Migrations live in **two parallel directories** (`migrations/` for SQLite, `migrations/pg/` for PG). Both must stay in sync.
- Migrations run on every service boot via `runMigrations()` in `src/database/index.js`.
- Auto-applied + previously-frozen `track_versions.music_plan_json` rows exist in production; deploy can break in-flight jobs.

**The ~80% reformatting in `src/workflows/runner.js`** (Prettier diff) hides ~30 lines of substantive logic change; flagged as PROCESS not code, do not touch unless asked.

**Severity legend:**

- **BLOCKER** — fix before merge/deploy or live users break.
- **HIGH** — fix this PR; will cause user-visible defects, cost amplification, or operator burden in the next ~week.
- **MEDIUM** — fix before next sprint; correctness/security/perf debt that gets harder to fix later.
- **SUGGESTION** — opportunistic improvement; safe to defer.

**Cross-reference notation:** `[adv-N]`, `[corr-N]`, `[sec-N]`, `[maint-N]`, `[test-N]`, `[mig-N]`, `[perf-N]`, `[api-N]`, `[ios-N]` link back to per-reviewer findings.

---

## Recommended Fix Order

1. **Pre-deploy schema/contract fixes** (BLOCKERs) — old iOS compatibility, in-flight job survival, error-code prefix.
2. **Cost amplification + state-corruption fixes** (HIGHs in workflow + service layer) — these silently bill the user / leak Suno personas.
3. **Race / atomicity fixes** in routes (HIGH).
4. **Security defense-in-depth + sanitizer hardening** (MEDIUM).
5. **Maintainability consolidation + dead code removal** (MEDIUM/SUGGESTION).
6. **Performance hot paths** (HIGH/MEDIUM) — ship after correctness is settled to avoid masking bugs with caching.
7. **Test coverage backfill** (HIGH/MEDIUM) — write tests for fixes as you make them; tackle untested branches last.

---

# BLOCKERS (3)

## B1. Old iOS clients (105–108) silently lose My Voice capability

- **Location:** `src/routes/enrollment.js:464-498`
- **Source:** `[api-1]`
- **Problem:** New code requires `consent_scopes: ["voice_suno_persona_v1"]` or `voice_suno_persona_consent: true` in `/voice/enrollment/start` and `/voice/enrollment/complete` request bodies. Old iOS builds (105–108, in the wild) do not send these fields. They enroll voice successfully but never get `my_voice_ready=true`. Subsequent My Voice render attempts get rejected with 422 `SUNO_VOICE_PERSONA_SETUP_REQUIRED` — a code their `ErrorHandler.swift` does not recognize. **Silent feature degradation across live install base.**
- **Fix:** Treat existing `consent_accepted=true` + `consent_version=1.0` (the historical iOS payload) as implicit grant for `voice_suno_persona_v1`. Implementation:
  ```js
  // In /voice/enrollment/start and /voice/enrollment/complete handlers,
  // after parsing body:
  const explicitScopes = Array.isArray(body.consent_scopes)
    ? body.consent_scopes
    : null;
  const implicitGrant =
    body.voice_suno_persona_consent === true ||
    (body.consent_accepted === true && body.consent_version === "1.0");
  const consentScopes =
    explicitScopes ?? (implicitGrant ? ["voice_suno_persona_v1"] : null);
  ```
  Or feature-flag this fallback (`legacy_persona_consent_grant`) so it can be turned off once 100% of users are on build 110+.

## B2. Pre-deploy in-flight My Voice jobs fail terminally on pipeline whitelist change

- **Location:** `src/workflows/render-contract.js:130-132`
- **Source:** `[api-2]`
- **Problem:** `PERSONALIZED_PIPELINES` shrunk from `{provider_audio_personalized_convert, guide_tts_and_voice_convert}` to `{suno_voice_persona_complete_audio}`. `assertPersonalizedContract` throws `E302_PERSONALIZED_DIVERSION` for any `track_versions.music_plan_json` previously frozen with the old pipeline string. **Users lose the song they were generating at deploy boundary.**
- **Fix:** Pre-deploy, run a one-time SQL backfill that nulls `music_plan_json.pipeline` for queued/processing jobs. Sketch:
  ```sql
  -- Cancel in-flight personalized jobs that would terminally fail post-deploy
  UPDATE track_versions
  SET status = 'cancelled', updated_at = NOW()
  WHERE status IN ('queued', 'processing')
    AND music_plan_json::jsonb ->> 'pipeline' IN (
      'provider_audio_personalized_convert',
      'guide_tts_and_voice_convert'
    );
  ```
  Then deploy. Document deploy ordering in the release runbook.
  **Alternative** (riskier): Re-add legacy pipeline strings to `PERSONALIZED_PIPELINES` as deprecated, route them through a guard that fails fast with a user-friendly error.

## B3. iOS error code mismatch for persona-not-ready

- **Location:** `PorizoApp/PorizoApp/Controllers/RenderController.swift:854`
- **Source:** `[api-3]`
- **Problem:** Server emits `error_code = "E302_SUNO_PERSONA_NOT_READY"` (with `E302_` prefix) per `runner.js:1985,1997,2002,2852`. iOS RenderController checks `normalizedCode == "SUNO_PERSONA_NOT_READY"` (no prefix). **Dedicated branch never matches.** When user_voice render fails because Suno persona is still preparing, iOS falls into catch-all `("infra_terminal","retry")` — the exact misclassification the comment claims to fix. Users see "retry" but retry never succeeds while persona is still pending.
- **Fix:** Either (preferred) strip the `E302_` prefix server-side before persisting `error_code` for the render-job persistence path, OR update iOS `RenderController.swift` to compare against the prefixed forms:
  ```swift
  // RenderController.swift
  case "E302_SUNO_PERSONA_NOT_READY", "E302_SUNO_PERSONA_CONSENT_REQUIRED":
      return ("input_missing", "wait_for_persona")
  case "E302_VOICE_PROFILE_REQUIRED":
      return ("input_missing", "enroll_voice")
  case "E302_PERSONALIZED_VOICE_CONVERSION_DISABLED":
      return ("input_missing", "switch_voice_mode")
  ```
  Apply identically for other `E302_*` codes used in renderer paths.

---

# HIGH (28)

Grouped by file area for easier batching.

## H — Workflows & runner

### H1. Persona lock is global, serializes all persona work to 1 concurrent job

- **Location:** `src/workflows/runner.js:5390`
- **Source:** `[adv-1]`
- **Problem:** `acquireVoiceProviderLock` uses hardcoded `lockId = "suno_voice_persona"`. With `MAX_CONCURRENT_VOICE_PROVIDER_JOBS > 1`, the second concurrent job hits ON CONFLICT and silently aborts (`if (!lockAcquired) return;`). `releaseVoiceProviderLock` deletes by `(id, locked_by=runnerId)` so first job's release deletes the only row even if a second job had concurrently obtained it.
- **Fix:** Compose lock id with the job id: `lockId = \`suno_voice_persona:${job.id}\``and store/release/heartbeat per-job. **Or** drop the global lock entirely and rely on`markVoiceProviderJobRunning`'s atomic claim (preferred — the lock is redundant).

### H2. Stale-job recovery runs on every 1s poll tick

- **Location:** `src/workflows/runner.js:5466`
- **Source:** `[perf-1]`
- **Problem:** `recoverStaleVoiceProviderJobs` (2 UPDATE queries) is called inside `tickVoiceProviderJobs` on every 1s tick, regardless of whether stale jobs exist. 7,200 UPDATEs/hour against `voice_provider_jobs` even at zero load. `recoveryTimer` already exists at line 2071 for other queues.
- **Fix:** Move `recoverStaleVoiceProviderJobs` out of `tickVoiceProviderJobs` and onto the existing `recoveryTimer` (every `recoveryIntervalMs`, ~2.5min default).

### H3. Duplicate `PERSONALIZED_VOICE_MODES` definition

- **Location:** `src/workflows/runner.js:120` (and `src/workflows/render-contract.js:5`)
- **Source:** `[maint-3]`
- **Fix:** Export `PERSONALIZED_VOICE_MODES` from `render-contract.js`, import in `runner.js`, delete the local copy.

### H4. N+1 in tick candidate filter when users are blocked

- **Location:** `src/workflows/runner.js:5337-5359`
- **Source:** `[perf-9]`
- **Problem:** Per-candidate `await getTrackVersion.get` + `await getTrack.get` inside the for-loop. With 5 blocked users + 3 slots = 8 candidates × 2 sequential reads = 16 RTT per tick.
- **Fix:** Batch: `SELECT tv.id, t.user_id FROM track_versions tv JOIN tracks t ON t.id = tv.track_id WHERE tv.id IN (?, ?, ...)`. OR denormalize `user_id` onto `jobs`.

### H5. Voice provider lane disable / concurrency limit untested

- **Location:** `src/workflows/runner.js:5556-5628`
- **Source:** `[test-6]`
- **Fix:** Add a test that creates `MAX_CONCURRENT_VOICE_PROVIDER_JOBS + 1` queued jobs, calls `runner.tick()`, asserts only `MAX_CONCURRENT` are claimed, (N+1)th remains pending. Test that an exception inside the polling loop sets `voiceProviderLaneDisabled=true` and subsequent ticks short-circuit.

## H — Suno persona service & provider

### H6. Upload-success URL is dropped, every retry re-uploads and re-bills

- **Location:** `src/services/suno-voice-persona-service.js:316`
- **Source:** `[adv-2]`
- **Problem:** `markProviderProfileUploadSubmitted` passes `sourceUploadUrl: null`. On retry, `provider_profile.source_upload_url` is null AND `source_task_id` is null, so the `if (!uploadUrl && !sourceTaskId)` block re-enters and re-uploads from scratch. Up to 3 paid file-url uploads per persona under `max_attempts=3`.
- **Fix:** In `markProviderProfileUploadSubmitted`, persist actual `upload.downloadUrl`. In `markProviderProfileCoverSubmitted`, leave `source_upload_url` intact until persona is active OR store in a separate column so retries reuse the upload.

### H7. Persona created at Suno after job cancellation is marked failed but persona_id is lost (GDPR)

- **Location:** `src/services/suno-voice-persona-service.js:489-517` + `src/services/voice-provider-profile-service.js:255-278`
- **Source:** `[adv-5, maint-9, sec-7, mig-1]` (cluster of related issues)
- **Problem:** `markProviderProfileManualCleanupRequired` writes status `STATUS.FAILED` (not `'manual_cleanup_required'`) AND has `WHERE deleted_at IS NULL` predicate. After `softDeleteProviderProfilesForVoiceProfile` runs, the cleanup UPDATE affects 0 rows. **Remote `personaId` at Suno is silently leaked with no DB record.** `tools/cleanup-orphan-persona-jobs.js` won't find them.
- **Fix:** Multi-step:
  1. Add `STATUS.MANUAL_CLEANUP_REQUIRED = 'manual_cleanup_required'` to the status enum module.
  2. `markProviderProfileManualCleanupRequired` sets `status = STATUS.MANUAL_CLEANUP_REQUIRED` (not FAILED).
  3. Drop the `deleted_at IS NULL` predicate in this function so terminal cleanup states overwrite even soft-deleted rows.
  4. Emit an `audit_logs` entry with the `personaId` so the cleanup script can find orphans.
  5. Collapse `markProviderProfileManualCleanupRequired` and `markProviderProfileFailed` into one function: `markProviderProfileFailed(db, id, error, { providerProfileId = null, includeDeleted = false, metadata = null, status = STATUS.FAILED })`.

### H8. `markPersonaGenerationStarted` UPDATE precondition can lose "started" flag silently → duplicate Suno personas

- **Location:** `src/services/suno-voice-persona-service.js:96-99`
- **Source:** `[adv-8]`
- **Problem:** Updates `WHERE id=? AND status='running'`. If atomic claim was overwritten (cancellation, stale-recovery), UPDATE affects 0 rows. Function doesn't check `result.changes`, so `generatePersonaRequestStarted=true` is set even though `step` is still `prepare_persona`. Persona may be re-created at Suno on the same audioId — duplicate billed personas, local DB has only the last one.
- **Fix:** Make `markPersonaGenerationStarted` return `result.changes`. On 0, throw `E302_SUNO_PERSONA_LOST_CLAIM` and abort BEFORE setting `generatePersonaRequestStarted=true`.

### H9. Polling loop swallows legitimate "audio_success without sunoData" → false manual tickets

- **Location:** `src/providers/suno-persona.js:240-332`
- **Source:** `[adv-9]`
- **Problem:** After `pollWithBackoff`, `result.audioId` may be `undefined` while phase is `provisional_success`. `runSunoVoicePersonaJob:381` does `sourceAudioId = audio.audioId` — undefined. Then `generatePersona` called with `audioId: undefined`, `requireString` throws inside `generatePersonaRequestStarted` block → marked `MANUAL_RECOVERY_REQUIRED`. False manual ticket.
- **Fix:** After `pollWithBackoff` returns, assert `result.done && result.audioId` truthy. If not, throw a retryable poll-timeout error so `markVoiceProviderJobFailed(retryable=true)` reschedules instead of going manual.

### H10. Cancellation does not reach in-flight Suno calls → cost amplification via abuse

- **Location:** `src/services/voice-provider-profile-service.js:497-520`
- **Source:** `[adv-7]`
- **Problem:** `cancelVoiceProviderJobsForVoiceProfile` updates jobs `WHERE status IN ('pending', 'running')`. Worker is mid-call to Suno; cancel sets status='cancelled' but worker only sees it on next `assertProviderJobStillAllowed`, which may be many seconds away. Attacker spams delete+enroll → 3 orphan covers per re-enrollment. **No rate limit on `DELETE /voice/profile`.**
- **Fix:**
  1. Add per-user rate limit on `DELETE /voice/profile` (1/min) and `POST /voice/enrollment/start` in `src/server.js` rate-limit registry.
  2. Set `cancellation_requested_at` on the job at cancel time. Worker checks this before each Suno call (not only between major steps).

### H11. Feature flag is read but ignored — `shouldQueueSunoPersona = true` is hardcoded

- **Location:** `src/routes/enrollment.js:1064`
- **Source:** `[adv-10, corr-4]`
- **Problem:** No `suno_voice_persona_enabled` check. If feature has bug in production, no kill switch.
- **Fix:** Read `getFeatureFlag(db, 'suno_voice_persona_enabled')` and gate `shouldQueueSunoPersona` on it. Default OFF in `feature_flags.js` DEFAULTS.

## H — Routes / server

### H12. Enrollment-complete transaction has NO atomicity in PostgreSQL

- **Location:** `src/routes/enrollment.js:1245-1366`
- **Source:** `[corr-1]`
- **Problem:** `db.transaction(async () => { ... })` callback **ignores its `query` parameter** and uses raw `db.prepare().run()` plus calls helper functions that hit the connection pool. In PG, the transactional client only sees an empty transaction; every actual write is auto-committed on a separate connection. Failures partway leave inconsistent state.
- **Fix:** Refactor transaction to use the passed `query` function (or a dedicated client). Update voice-provider-profile-service helpers (`createPendingProviderProfile`, `createVoiceProviderJob`, `cancelVoiceProviderJobsForVoiceProfile`, `softDeleteProviderProfilesForVoiceProfile`) to accept a `query` argument and use it for SQL inside the transaction. Mirror the pattern from `src/routes/tracks.js:854-902`.

### H13. `/voice/enrollment/complete` is not idempotent

- **Location:** `src/routes/enrollment.js:874-940`
- **Source:** `[corr-2]`
- **Problem:** Handler does not check `session.status` before processing. Replayed POST while session already `completed` re-runs the entire flow: re-concat audio, re-embed (paying Replicate again), INSERT new `voice_profiles`, queue another persona job, consume voice_provider quota a second time.
- **Fix:**
  1. Add early guard immediately after `expires_at` check:
     ```js
     if (session.status !== "recording" && session.status !== "processing") {
       sendError(
         reply,
         409,
         "SESSION_ALREADY_FINALIZED",
         "enrollment session has already been finalized",
       );
       return;
     }
     ```
  2. Add a SQL unique index covering pending-state profiles (in both `migrations/` and `migrations/pg/`):
     ```sql
     CREATE UNIQUE INDEX idx_voice_provider_profiles_pending_unique
     ON voice_provider_profiles (voice_profile_id, provider)
     WHERE status IN ('pending', 'upload_submitted', 'cover_submitted', 'persona_submitted')
       AND deleted_at IS NULL;
     ```

### H14. Persona preflight runs after the trackVersion existing-job short-circuits

- **Location:** `src/routes/tracks.js:819-833, 1063-1077, 1235-1245`
- **Source:** `[corr-7]`
- **Problem:** In `render_preview`, if `existingJob` is terminal-failed and lyrics haven't changed, handler returns 409 `ALREADY_RENDERING_RECENT_FAILURE` _before_ persona preflight. Users whose persona regressed to `failed` see the stale render error and retry (which can never succeed) instead of being directed to re-enroll.
- **Fix:** Move `preflightUserVoiceReadiness` call ABOVE the `existingJob && isTerminalFailedJobStatus(existingJob.status)` block so persona regressions surface the right error code.

### H15. Inconsistent HTTP status for SAME persona-not-ready condition

- **Location:** `src/routes/tracks.js:822` vs `src/routes/story.js:3081` (and `tracks.js:333`, `tracks.js:591`)
- **Source:** `[api-4, api-11]`
- **Problem:** tracks.js mixes 422 (render endpoints) and 409 (create/voice_mode endpoints); story.js uses 409. iOS retry-policy logic keyed on HTTP status will misclassify across endpoints.
- **Fix:** Pick **422 (Unprocessable Entity for missing precondition)** and apply uniformly across:
  - POST `/tracks` (currently 409)
  - PATCH `/tracks/:id/voice_mode` (currently 409)
  - POST `/tracks/:id/versions/:v/render_preview` (already 422)
  - POST `/render_full` (already 422)
  - POST `/retry`
  - POST `/story/.../lyrics` (currently 409)
    Set the codes `SUNO_VOICE_PERSONA_REQUIRED/FAILED/SETUP_REQUIRED` always to 422.

### H16. New unauthenticated webhook depends on env config — silent dead route on misconfig

- **Location:** `src/routes/internal-suno-callback.js:55-152` + `src/providers/suno.js` (resolveSunoCallbackUrl)
- **Source:** `[api-9, adv-3]`
- **Problem:** `resolveSunoCallbackUrl` builds URL from `PUBLIC_BASE_URL` and does NOT append `?token=` automatically. Operators must manually configure. Without env var, Suno hits 503 forever. The token in query string also lands in webserver access logs.
- **Fix:**
  1. `resolveSunoCallbackUrl`: append `?token=<urlencoded(SUNO_CALLBACK_HMAC_SECRET)>` automatically when the secret is set.
  2. Add startup check in `src/server.js` boot: if `suno_voice_persona_enabled` flag is true (or `LIVE_PROVIDERS=true`) but `SUNO_CALLBACK_HMAC_SECRET` is unset, log a startup warning (do not fail-fast — it's a stub today).
  3. Length-validate the secret: refuse < 32 chars.
  4. Document in route file and in `docs/api/internal-callbacks.md` that this is a **no-op observability hook** and that any future state-mutation **MUST** require HMAC-of-rawBody (not query token) and add timestamp/replay protection.

### H17. New top-level field `user_voice_engine` in render-start response (undocumented)

- **Location:** `src/routes/tracks.js:951,1198`
- **Source:** `[api-5]`
- **Fix:** Document `user_voice_engine` (`"suno_voice_persona" | null`) in API spec / OpenAPI. Confirm no strict-decode in iOS.

### H18. `/voice/profile` response gained 3 new top-level fields, breaks old iOS UX

- **Location:** `src/routes/enrollment.js:1459-1476`
- **Source:** `[api-6]`
- **Problem:** Old iOS uses `status == "active"` for `hasProfile` — sees user as having My Voice ready when persona is still preparing. Picks user_voice → render fails with persona-not-ready (which old build doesn't handle).
- **Fix:** Gate `/voice/profile.status` to NOT return `"active"` until persona is ready when called by old clients. Detection: parse `User-Agent` (now `PorizoApp/X.Y(Z)` per `[api-10]`) — if build < 110, suppress `"active"` and instead return `"preparing"` until persona is `"active"` too. Add `local_voice_ready: bool`, `my_voice_ready: bool` for new clients.

### H19. Enrollment-complete response gained `voice_provider_profile.status` with new statuses

- **Location:** `src/routes/enrollment.js:1394`
- **Source:** `[api-7]`
- **Fix:** Document closed enum of `voice_provider_profile.status` values in API spec. Add explicit "unknown" handling path in iOS `EnrollmentModels.swift` that falls back to the `ready` flag.

### H20. `buildRenderContract` now THROWS for legacy user_voice without persona engine

- **Location:** `src/workflows/render-contract.js:60-65`
- **Source:** `[api-8]`
- **Fix:** Add `E302_SUNO_PERSONA_REQUIRED` to iOS `ErrorHandler.swift` with the same user-facing message as `SUNO_VOICE_PERSONA_SETUP_REQUIRED`. (Do NOT preserve seedvc engine — that flow is being decommissioned.)

### H21. iOS User-Agent format change strips `iOS` token

- **Location:** `PorizoApp/PorizoApp/APIClient.swift:255`
- **Source:** `[api-10]`
- **Fix:** Restore `(build \(build); iOS)` segment, OR document new UA format and update analytics consumers (Datadog, Sentry, Railway logs, CDN routing).

### H22. `resolveSunoPersonaForRender` has 4 untested guard branches

- **Location:** `src/workflows/runner.js:1575-1605`
- **Source:** `[test-5]`
- **Fix:** Add tests for: profile soft-deleted (`deleted_at` set), `user_id` mismatched to track, `status='failed'`, `provider_profile_id=null`, missing consent scope. Each must throw the expected `E302_*` code.

## H — Migrations

### H23. Missing foreign keys → orphan rows + violates song-transfer atomicity

- **Location:** `migrations/pg/097_voice_provider_profiles.sql:1-67` + `migrations/097_voice_provider_profiles.sql`
- **Source:** `[mig-1, sec-7]`
- **Fix:** Add FK constraints in BOTH files:

  ```sql
  -- voice_provider_profiles
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,

  -- voice_provider_jobs
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  voice_provider_profile_id TEXT REFERENCES voice_provider_profiles(id) ON DELETE SET NULL,
  ```

  **Note:** This is a NEW migration (098 is already created). Add as `migration 099` rather than editing 097 (which may already be applied in some environments). Verify with `SELECT * FROM schema_migrations` on Railway prod first.

### H24. `voice_provider_jobs.status` / `step` have no CHECK constraint (drift vs `voice_provider_profiles.status`)

- **Location:** `migrations/pg/097_voice_provider_profiles.sql:42-43`
- **Source:** `[mig-2]`
- **Fix:** As a follow-up migration, ALTER TABLE `voice_provider_jobs` to add CHECK constraints listing allowed `status` and `step` values. Keep identical between SQLite and PG.

### H25. SQLite `ADD COLUMN` is not idempotent on partial-failure replay

- **Location:** `migrations/098_enrollment_sessions_consent_scopes.sql:13`
- **Source:** `[mig-3]`
- **Fix:** Verify `runMigrations()` in `src/database/index.js` wraps each migration in `BEGIN/COMMIT` with rollback on partial failure. If it does NOT, split 098 into two: `098_add_column.sql` (just ALTER) and `099_backfill_consent_scopes.sql` (just UPDATE) so partial state is unambiguous on the next boot.

### H26. Backfill silently grants persona consent retroactively (privacy violation)

- **Location:** `migrations/pg/098_enrollment_sessions_consent_scopes.sql:22-34`
- **Source:** `[mig-8, adv-6]`
- **Problem:** Backfill copies "most recent" `voice_provider_profiles.consent_scope` to ALL of that user's NULL `enrollment_sessions` — including older ones recorded under different consent regime, or seeded by admin/canary tests.
- **Fix:** **Preferred** — leave existing rows NULL and force re-consent (fail-secure, simpler). Edit the migration to remove the UPDATE (or write a follow-up migration that nulls out backfilled values). **Alternate** — backfill only sessions where `enrollment_sessions.created_at >= matching voice_provider_profile.created_at`.

## H — iOS Swift

### H27. EnrollmentFlowView upload Task has no cancellation handle

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:604`
- **Source:** `[ios-1]`
- **Fix:** Store the handle (`uploadTask = Task { ... }`), cancel in `.onDisappear`. Check `Task.isCancelled` before each `MainActor.run` block.

### H28. EnrollmentFlowView blocks MainActor with file I/O

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:606`
- **Source:** `[ios-2]`
- **Fix:**
  ```swift
  let (data, checksum) = try await Task.detached {
      let data = try Data(contentsOf: url)
      let checksum = SHA256.hash(data: data)
      return (data, checksum)
  }.value
  ```

### H29. `pollingTask` reset on completion ignores prior task — race on completion

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:653`
- **Source:** `[ios-3]`
- **Fix:** `pollingTask?.cancel()` before reassigning at line 653.

### H30. Polling timeout dumps user back to `.welcome` (UX regression)

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:691-744`
- **Source:** `[ios-4]`
- **Fix:** Surface "Voice profile is still processing — check back from Settings" message and `dismiss()` the sheet; don't reset to `.welcome`. The parent flow's `waitForMyVoiceReadiness` already handles this state.

---

# MEDIUM (38)

Grouped by file area.

## M — Backend / security defense-in-depth

### M1. clean.wav token comparison is non-constant-time

- **Location:** `src/routes/enrollment.js:175`
- **Source:** `[sec-1, adv-11]`
- **Fix:**
  ```js
  const expected = Buffer.from(session.access_token, "utf8");
  const actual = Buffer.from(token, "utf8");
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    sendError(reply, 401, "INVALID_TOKEN", "invalid token");
    return;
  }
  ```

### M2. clean.wav route does not validate session expiry/status (voice biometric leak window)

- **Location:** `src/routes/enrollment.js:166-200`
- **Source:** `[sec-2]`
- **Fix:** Before serving file:
  ```js
  if (
    session.status === "expired" ||
    (session.expires_at && new Date(session.expires_at) < new Date())
  ) {
    sendError(reply, 403, "SESSION_EXPIRED", "session expired");
    return;
  }
  ```
  Add a hard TTL on `access_token` (e.g., 1 hour from issuance) independent of parent session.

### M3. Voice access_token sent to third party in URL query

- **Location:** `src/services/suno-voice-persona-service.js:293-308`
- **Source:** `[sec-3]`
- **Fix:** Issue a single-use, ~5-minute-scoped token specifically for the Suno fetch, distinct from the long-lived enrollment access_token. Bind to Suno egress IPs if possible. Best-effort revocation already exists on success path; this hardens the failure-window leak.

### M4. PUBLIC_BASE_URL fallback to localhost makes Suno fetch loopback URL

- **Location:** `src/services/suno-voice-persona-service.js:294`
- **Source:** `[adv-12]`
- **Fix:** At server start, if `LIVE_PROVIDERS=true` or `SUNO_CALLBACK_URL` is set, validate `PUBLIC_BASE_URL` is HTTPS and not localhost. Fail-fast at boot:
  ```js
  if (
    config.LIVE_PROVIDERS &&
    !/^https:\/\/(?!localhost|127\.0\.0\.1)/.test(config.PUBLIC_BASE_URL || "")
  ) {
    throw new Error(
      "PUBLIC_BASE_URL must be https and not localhost when LIVE_PROVIDERS=true",
    );
  }
  ```

### M5. Refresh token un-revoke on grace period weakens reuse-attack detection

- **Location:** `src/services/auth-service.js:330-360`
- **Source:** `[sec-6]`
- **Fix:** Require an additional signal (User-Agent / IP / device fingerprint recorded on `token_families`) before un-revoking. At minimum, log a HIGH-severity `audit_event` on the un-revoke path so SOC review is possible.

### M6. Sanitizer regex misses key formats; persona/audio IDs leak when not prefix-formatted

- **Location:** `src/utils/provider-sanitize.js:23-28`
- **Source:** `[adv-14, sec-8]`
- **Fix:** Add patterns:
  ```js
  // After existing patterns, before length cap:
  /\b[A-Fa-f0-9]{32,}\b/g, // UUIDs / hex IDs without prefix
  /\bsk-[A-Za-z0-9_-]{16,}/g, // API keys
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /\b[a-z]+_[A-Za-z0-9]{20,}\b/g, // generic prefixed IDs
  ```

### M7. Per-process random HMAC key in enrollment-session-service is security theatre

- **Location:** `src/services/enrollment-session-service.js:25-26`
- **Source:** `[maint-8]`
- **Fix:** Either (a) require `LOG_ID_HMAC_KEY` to be set, throw at module-load when missing, OR (b) drop HMAC entirely and emit truncated raw IDs (`id.slice(0,4)…id.slice(-4)`) like `redactedId` in `suno-persona.js`.

### M8. Token-only auth on internal-suno-callback bypasses HMAC

- **Location:** `src/routes/internal-suno-callback.js:107-125`
- **Source:** `[corr-6, sec-4]`
- **Fix:** Before allowing the stub to mutate state in any future patch, enforce **HMAC-only** (no token-fallback) and add timestamp/replay protection (`X-Suno-Timestamp` in HMAC payload, reject > 5 min old, dedupe set on `(taskId, status)`). Add a SAFETY-block comment noting this MUST be done before removing the no-op.

### M9. `hasPersonaConsentScope` lower-cases entire string before JSON parsing

- **Location:** `src/services/suno-voice-persona-service.js:43-66`
- **Source:** `[corr-9, adv-16]`
- **Fix:** Parse JSON BEFORE lowercasing. Compare scope literals exactly (case-sensitive); they are fixed strings.

## M — Routes / data correctness

### M10. Reuses prior `session.access_token`; potential token reuse across personas

- **Location:** `src/routes/enrollment.js:1097-1108`
- **Source:** `[corr-3]`
- **Fix:** Always issue fresh access token in complete handler when {shouldEmbed, persona enqueue} is needed. Or revoke prior session's token explicitly before reissuing.

### M11. Persona-status `source_audio_unavailable` is reported but never persisted

- **Location:** `src/routes/enrollment.js:1294-1302`
- **Source:** `[corr-5]`
- **Fix:** Persist a `voice_provider_profile` with `status='failed'` and `last_error='source_audio_unavailable'` in this branch so ops has a row to investigate and `findActiveProviderProfileForUser` returns a meaningful state.

### M12. Late-grant of persona consent silently survives after session expiry check

- **Location:** `src/routes/enrollment.js:897-925`
- **Source:** `[corr-8]`
- **Fix:** Move late-grant block AFTER the `expires_at` check so it only runs on a valid session.

### M13. `voice_mode` preflight on POST `/tracks` returns 409 (vs unified 422)

- **Location:** `src/routes/tracks.js:332-358`
- **Source:** `[api-11]`
- **Fix:** Tracked under `[H15]` — apply unified 422 status here too.

### M14. `/voice/profile.model_version` returns `"embed_stub"` (undocumented)

- **Location:** `src/routes/enrollment.js:1486-1495`
- **Source:** `[api-12]`
- **Fix:** Document the `embed_stub` value in API spec. Add to closed enum.

### M15. `requires_voice_enrollment` field added to error details (inconsistent)

- **Location:** `src/routes/story.js:3066-3082`
- **Source:** `[api-14]`
- **Fix:** Either include `requires_voice_enrollment` on ALL error envelopes implying enrollment recovery (default `false`), OR document it as an optional hint.

### M16. `/voice/enrollment/complete` long function with 8 inline `assertProviderJobStillAllowed` re-fetch blocks

- **Location:** `src/services/suno-voice-persona-service.js:232-532`
- **Source:** `[maint-4]`
- **Fix:** Extract closure `const recheck = () => assertProviderJobStillAllowed({...common args...})` and assign once per step. OR split function into `prepareUpload`, `submitCover`, `resolveAudio`, `generatePersonaStep` orchestrated by `runSunoVoicePersonaJob`.

## M — Maintainability / consolidation

### M17. Phantom config knobs `SUNO_PERSONA_GENERATE_MAX_ATTEMPTS` / `SUNO_PERSONA_GENERATE_RETRY_DELAY_MS`

- **Location:** `src/services/suno-voice-persona-service.js:432-433`
- **Source:** `[maint-2]`
- **Fix:** Either declare both env vars in `src/config.js` and document, OR inline `4` and `5000` and delete the misleading config lookup.

### M18. Suno-persona config fragmented across feature-flags + env-var (3 sources of truth for Suno model)

- **Location:** `src/services/feature-flags.js:83-86` + `src/config.js:74-82`
- **Source:** `[maint-7]`
- **Fix:** Pick one source. If admin runtime tuning needed, drop env-var `SUNO_MODEL` and read everything from feature-flags. Document chosen layer in a header comment of `feature-flags.js`.

### M19. `markPersonaGenerationStarted` leaks `voice_provider_jobs` SQL across domain boundary

- **Location:** `src/services/suno-voice-persona-service.js:99-108`
- **Source:** `[maint-10]`
- **Fix:** Move to `voice-provider-profile-service.js` as `markVoiceProviderJobStep(db, jobId, step)`.

### M20. `sanitizeProviderError` referenced before its `require` (CommonJS hoisting)

- **Location:** `src/providers/suno-persona.js:42-49`
- **Source:** `[maint-6]`
- **Fix:** Move the `require` to the top with other imports (lines 1-8). Delete the explanatory comment.

### M21. `MAX_LENGTH` exported but unused externally

- **Location:** `src/utils/provider-sanitize.js:33`
- **Source:** `[maint-5]`
- **Fix:** Remove from exports (or delete the constant export entirely, inline `1000` into the slice).

### M22. Dead production code `createPersonaFromSourceUrl` in suno-persona provider

- **Location:** `src/providers/suno-persona.js:400-476`
- **Source:** `[maint-1]`
- **Fix:** Delete `createPersonaFromSourceUrl` and its export. Drop corresponding test in `test/suno-persona-provider.test.js` (~lines 200-260).

## M — Performance

### M23. Synchronous `fs.readFileSync` of multi-MB WAV blocks event loop

- **Location:** `src/routes/enrollment.js:97 + 601`
- **Source:** `[perf-4]`
- **Fix:** Switch to `await fs.promises.readFile(...)`. For chunk duration check, stream-parse only the 44-byte RIFF header (no need to load whole buffer).

### M24. R2 audio proxy buffers entire file into memory

- **Location:** `src/server.js:4309`
- **Source:** `[perf-5]`
- **Fix:** Pipe `r2Response.body` directly: `reply.send(r2Response.body)`. Forward Range/Content-Range headers as already done.

### M25. GET /tracks has no pagination or LIMIT

- **Location:** `src/routes/tracks.js:438-463`
- **Source:** `[perf-2]`
- **Fix:** Add `LIMIT 50 OFFSET ?` (or cursor on `added_at`).

### M26. `hydrateTrackCoverImages` selects entire `track_versions` rows

- **Location:** `src/server.js:3814-3829`
- **Source:** `[perf-3]`
- **Fix:**
  ```js
  // Project only cover-image columns; filter to latest version per track
  SELECT track_id, version_num, cover_image_url, cover_image_small_url, cover_image_large_url
  FROM track_versions
  WHERE track_id IN (?, ?, ...) AND version_num = (
    SELECT MAX(version_num) FROM track_versions tv2 WHERE tv2.track_id = track_versions.track_id
  )
  ```

### M27. Binary fetches buffer entire response in `src/providers/http.js`

- **Location:** `src/providers/http.js:75,97,160`
- **Source:** `[perf-6]`
- **Fix:** In `downloadToFile`, pipe `response.body` to `fs.createWriteStream(outputPath)` after validating headers. Replace `fs.writeFileSync`.

### M28. Sequential `getFeatureFlag` calls in voice-conversion path (7 RTT cold cache)

- **Location:** `src/workflows/runner.js:587-596` (and similar at line 522-524)
- **Source:** `[perf-7]`
- **Fix:** Use the existing `getFeatureFlags(db, [...])` batch helper once.

### M29. `assertProviderJobStillAllowed` runs 3 SELECTs, called 6+ times per persona job

- **Location:** `src/services/suno-voice-persona-service.js`
- **Source:** `[perf-8]`
- **Fix:** Combine the 3 lookups into a single JOIN. OR check before each external API call only (3×, not 6×).

## M — Migrations follow-up

### M30. Index direction drift: PG `created_at DESC` vs SQLite default ASC

- **Location:** `migrations/pg/097` vs `migrations/097`
- **Source:** `[mig-4]`
- **Fix:** Add `DESC` to SQLite index (SQLite supports it from 3.3+).

### M31. `voice_provider_jobs` missing index on `(status, next_attempt_at)` for worker poll hot path

- **Location:** `migrations/pg/097_voice_provider_profiles.sql:36-55`
- **Source:** `[mig-5]`
- **Fix:** Add as a follow-up migration:
  ```sql
  CREATE INDEX idx_voice_provider_jobs_poll ON voice_provider_jobs (status, next_attempt_at) WHERE locked_at IS NULL;
  ```

### M32. Unbounded backfill UPDATE on boot (potential lock storm)

- **Location:** `migrations/pg/098_enrollment_sessions_consent_scopes.sql:22-34`
- **Source:** `[mig-6]`
- **Fix:** Confirm `runMigrations` wraps in transaction. Document safe-on-prod size assumption in migration header. If `enrollment_sessions` exceeds ~10k rows, chunk in app code.

### M33. `consent_scopes` nullable TEXT with no default and no CHECK

- **Location:** `migrations/pg/098_enrollment_sessions_consent_scopes.sql:15-16`
- **Source:** `[mig-7]`
- **Fix:** Add CHECK that value is NULL or JSON array string:
  ```sql
  ALTER TABLE enrollment_sessions ADD CONSTRAINT consent_scopes_format
  CHECK (consent_scopes IS NULL OR consent_scopes LIKE '[%]');
  ```

## M — iOS

### M34. Missing upload URL is unrecoverable mid-flow

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:597-601`
- **Source:** `[ios-5]`
- **Fix:** Re-issue `startEnrollment()` to refresh upload URL set, OR consume the `next_upload_url` field from `ChunkUploadResponse` (server already returns it).

### M35. `isVoiceEnrollmentRequired` and `handleVoiceEnrollmentRequiredError` duplicate the same code-list with diverging behavior

- **Location:** `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift:1664-1678`
- **Source:** `[ios-6]`
- **Fix:** Extract single `voiceEnrollmentRequiredCode(from: Error) -> VoiceEnrollmentReason?` and reuse in both call sites.

### M36. `flowTask` reassignment without cancelling prior unstructured Task — races state mutations

- **Location:** `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift:1693-1717`
- **Source:** `[ios-7]`
- **Fix:** Add `guard !Task.isCancelled else { return }` checks before each state mutation in `waitForMyVoiceReadiness` callers, OR use a token/generation counter pattern.

### M37. `pollForVoiceProfile` does not honor `enrollmentResponse.estimatedCompletionSec` hint

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:691`
- **Source:** `[ios-10]`
- **Fix:** Use the hint to bound the loop (`max(60, hint*2/2s_interval)`) or switch to exponential backoff.

### M38. Polling sleep is not cancellation-aware in body

- **Location:** `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift:1731`
- **Source:** `[ios-11]`
- **Fix:** Add `if Task.isCancelled { return nil }` after the sleep.

---

# SUGGESTION (24)

## S — Tests

### S1. `parseJson` test does not test the SUT (tautology)

- **Location:** `test/critical-fixes.test.js:629-642`
- **Source:** `[test-1]`
- **Fix:** Import `parseJson` from `src/utils/common`, assert `required: true` throws on invalid input, `required: false` returns default. Delete the tautological test.

### S2. "AI Voice Model Configuration" is a tautology

- **Location:** `test/critical-fixes.test.js:225-231`
- **Source:** `[test-2]`
- **Fix:** Inject config through `buildServer`, trigger render that reaches voice-conversion, intercept `convertVoice` (or stub Replicate fetch), assert model parameter passed equals configured value.

### S3. Concurrent version increment test passes vacuously

- **Location:** `test/critical-fixes.test.js:259-314`
- **Source:** `[test-3]`
- **Fix:** Assert `successResults.length === 5`, verify `db.query("SELECT COUNT(*) FROM track_versions WHERE track_id = ?")` returns same count, assert `versions.sort()` equals `[1,2,3,4,5]`.

### S4. Rate limit test depends on missing LLM env, leaks 503 path

- **Location:** `test/critical-fixes.test.js:669-723`
- **Source:** `[test-4]`
- **Fix:** Stub LLM provider to return fast 200. Assert first N requests succeeded before rate-limit kicks in, rest are 429.

### S5. Internal-suno-callback "does not mutate state" claim never verified

- **Location:** `test/routes/internal-suno-callback.test.js:106-148`
- **Source:** `[test-7]`
- **Fix:** Wire real DB into test app, assert row counts unchanged after a 200 callback.

### S6. Wrong-length signature test missing edge cases

- **Location:** `test/routes/internal-suno-callback.test.js:151-169`
- **Source:** `[test-8]`
- **Fix:** Add tests for `""`, non-hex, `<correct-length-hex-but-different-bytes>` (the `crypto.timingSafeEqual` equal-length-but-mismatched case).

### S7. Stale-job recovery test does not assert error metadata captured

- **Location:** `test/critical-fixes.test.js:104-146`
- **Source:** `[test-9]`
- **Fix:** Assert `error_code`, `error_message`, `locked_at`, `locked_by` are appropriately reset/preserved per contract.

### S8. Voice-enrollment "queues persona preparation" does not verify job actually runs

- **Location:** `test/voice-enrollment.test.js`
- **Source:** `[test-10]`
- **Fix:** Run `runner.tick()` (or `runSunoVoicePersonaJob` directly with mocked Suno client). Assert profile transitions: `pending` → `upload_submitted` → `cover_submitted` → `persona_submitted` → `active`.

### S9. "active" state transition under-asserts side effects

- **Location:** `test/suno-voice-persona-service.test.js:204-232`
- **Source:** `[test-11]`
- **Fix:** Add assertions on `voice_provider_jobs.attempts`, `locked_at = null`, `next_attempt_at = null`, no orphaned rows.

### S10. Gift-funded render test does not verify gift reservation transitions

- **Location:** `test/render-endpoints.test.js:706-760`
- **Source:** `[test-12]`
- **Fix:** Query `gift_reservations`, assert `status === 'consumed'` and `consumed_at` populated.

### S11. "Default voice mode" assertion does not isolate config

- **Location:** `test/critical-fixes.test.js:343-403`
- **Source:** `[test-13]`
- **Fix:** Split into separate describe blocks with isolated `before/after` lifecycles, OR use unique `userId` per `it`.

### S12. Pre-deploy gate test silently skips on local dev

- **Location:** `test/suno-persona-provider.test.js:174-199`
- **Source:** `[test-14]`
- **Fix:** Use `t.skip("SUNO_PERSONA_PROBE_VERIFIED not set")` (node:test API) so runner records as skipped, not passed.

### S13. Orchestration test mocks too aggressively

- **Location:** `test/suno-persona-provider.test.js:226-275`
- **Source:** `[test-15]`
- **Fix:** Drop brittle order assertion. Add a second test where `pollTaskOnceFn` returns "PENDING" twice before "SUCCESS" to exercise the polling loop.

### S14. provider-sanitize test missing edge cases

- **Location:** `test/utils/provider-sanitize.test.js`
- **Source:** `[test-16]`
- **Fix:** Add boundary tests at `MAX_LENGTH` and `MAX_LENGTH + 1`. Multi-token redaction (`"Bearer a Bearer b"` → both redacted). URL embedding token ID.

## S — Migration polish

### S15. `provider` column has no CHECK enum

- **Location:** `migrations/pg/097_voice_provider_profiles.sql:5`
- **Source:** `[mig-9]`
- **Fix:** `CHECK (provider IN ('suno', 'seedvc', 'replicate'))`. Mirror in SQLite.

### S16. `voice_provider_locks` has no `expires_at` TTL

- **Location:** `migrations/pg/097_voice_provider_profiles.sql:63-67`
- **Source:** `[mig-10]`
- **Fix:** Add `expires_at TIMESTAMPTZ NOT NULL`. Workers `DELETE WHERE expires_at < now()` before acquiring.

### S17. CHECK / UNIQUE constraints are unnamed (hard to drop in future migrations)

- **Source:** `[mig-11]`
- **Fix:** Name constraints explicitly as `voice_provider_profiles_status_check` etc.

## S — Code polish

### S18. Doc comment misplaced for `extractSunoAudioId`

- **Location:** `src/providers/suno-persona.js:65-87`
- **Source:** `[maint-11]`
- **Fix:** Move doc comment immediately above `function extractSunoAudioId(...)`.

### S19. State transition bypasses `upload_submitted` on cleanup race

- **Location:** `src/services/suno-voice-persona-service.js:286-323`
- **Source:** `[adv-13]`
- **Fix:** Add a CHECK constraint or trigger preventing transitions other than the spec's order. In service, validate status in addition to data presence.

### S20. Callback receives no observable state mutation (contract trap)

- **Location:** `src/routes/internal-suno-callback.js:144-148`
- **Source:** `[api-15]`
- **Fix:** Add a clear comment block in the route AND in `docs/api/internal-callbacks.md` stating that this is a no-op observability hook and that any future state transition MUST add CSRF/replay protection.

### S21. `personaVocalWindow` computed twice

- **Location:** `src/routes/enrollment.js:1240-1243`
- **Source:** `[corr-10]`
- **Fix:** Extract `shouldEnqueuePersona = shouldQueueSunoPersona && hasProviderConsent && cleanAudioReady`. Reuse.

### S22. Sitemap lastmod normalization (already done; verify Search Console)

- **Location:** `src/routes/legal.js:115-131`
- **Source:** `[api-13]`
- **Fix:** Monitor Google Search Console for re-crawl spikes.

## S — iOS polish

### S23. Dead state `consentGranted`, `promptSetId`, `recordingSettings`

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:34, 530, 532`
- **Source:** `[ios-9]`
- **Fix:** Remove. If `recordingSettings.sampleRate` should override hardcoded 44100, wire it through.

### S24. `body` switch over `currentStep` produces heavy view-graph dependency

- **Location:** `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift:67`
- **Source:** `[ios-12]`
- **Fix:** Extract each step into its own `View` struct that takes only state it needs. At minimum, move `levelMeter` and `countdownLabel` into separate views so 20Hz audio level updates don't reinvalidate the entire enrollment screen.

---

# Cross-cutting Issues (Codex should resolve as bundles)

## Bundle 1 — `voice_provider_profiles` schema integrity (`H7, H23, H24, M30, M31, S15, S16, S17`)

Single new migration `099_voice_provider_profiles_integrity.sql` (PG + SQLite) that:

1. Adds FK constraints to `voice_provider_profiles` and `voice_provider_jobs`.
2. Adds CHECK constraints on `voice_provider_jobs.status` and `voice_provider_jobs.step`.
3. Adds `(status, next_attempt_at)` worker-poll index.
4. Adds `voice_provider_locks.expires_at` TTL column with default `now() + interval '5 minutes'`.
5. Adds CHECK on `provider` column.
6. Aligns SQLite index direction with PG.
7. Names all constraints explicitly.

## Bundle 2 — Suno provider state-machine integrity (`H6, H7, H8, H9`)

Single PR touching `src/services/suno-voice-persona-service.js` and `src/services/voice-provider-profile-service.js`:

1. Persist `upload.downloadUrl` in `markProviderProfileUploadSubmitted`.
2. Add `STATUS.MANUAL_CLEANUP_REQUIRED` and use it consistently. Drop `deleted_at IS NULL` predicate from cleanup-required updates.
3. Make `markPersonaGenerationStarted` return `result.changes` and throw on 0.
4. After `pollWithBackoff`, assert `result.done && result.audioId` truthy.

## Bundle 3 — API contract unification (`H15, M13`)

Sweep of `src/routes/{tracks,story,enrollment}.js` to use 422 for all four `SUNO_VOICE_PERSONA_*` codes consistently.

## Bundle 4 — Old-iOS compatibility (`B1, B3, H18, H21`)

1. Add legacy consent fallback in enrollment endpoints.
2. Strip `E302_` prefix from error_code (or update iOS to match prefixed form).
3. Suppress `voice_profile.status='active'` for builds < 110 in `/voice/profile`.
4. Restore `(build N; iOS)` segment in User-Agent.

## Bundle 5 — Migrations 097/098 idempotency + privacy (`H25, H26, M32, M33`)

1. Verify `runMigrations` transaction semantics; if missing, split 098 or add transaction wrapping.
2. Edit migration 098 to remove the retroactive consent backfill (or add a new migration that nulls backfilled rows).
3. Add CHECK on `consent_scopes` format.

## Bundle 6 — Performance + memory pressure on the hot path (`M23, M24, M25, M26, M27, M28, M29`)

1. Switch all `fs.readFileSync` to `fs.promises.readFile` or stream-based parsing.
2. Stream R2 audio responses instead of buffering.
3. Add pagination + projected columns to `GET /tracks` + `hydrateTrackCoverImages`.
4. Switch to batched `getFeatureFlags` in workflow runner hot paths.
5. Pipe binary downloads in `src/providers/http.js`.

## Bundle 7 — iOS task hygiene (`H27, H28, H29, H30, M34, M35, M36, M37, M38`)

1. Track all unstructured Tasks; cancel on `.onDisappear`.
2. Move file I/O off MainActor.
3. Replace polling-timeout reset-to-welcome with a "still preparing" UX path.
4. Extract shared error-classification helper.

---

# Process Flags (not code fixes)

## P1. `src/workflows/runner.js` diff is ~80% Prettier reformatting

- **Source:** `[maint-12]`
- **Action for next time:** Do reformatting commits separately (one commit "Run prettier" with no logic change, then commits with new logic). Currently every reviewer has to mentally re-derive what actually changed.

## P2. Test gaps that should land alongside fixes (cross-reference [test-N] when implementing)

- Concurrency cap test for voice provider lane (`H5`).
- Untested guard branches in `resolveSunoPersonaForRender` (`H22`).
- Idempotency test for `/voice/enrollment/complete` already-completed sessions (related to `H13`).
- Postgres transaction rollback test for enrollment-complete (related to `H12`).
- Backfill-correctness regression for migration 098 (`H26`).

---

# Quick Stats

- **9 reviewers** ran in parallel, total findings: **112**
- **Deduped/clustered:** ~88 distinct issues
- **By severity:** 3 BLOCKER · 28 HIGH · 38 MEDIUM · 24 SUGGESTION
- **Total LOC under review:** +15,192 / −4,666 across 65 files
- **Estimated Codex effort:**
  - Bundles 1, 2, 4 (schema, state machine, iOS-compat): ~4–6 hours each
  - Bundle 6 (perf): ~6–8 hours
  - Bundles 3, 5, 7: ~2–3 hours each
  - Total range: **20–35 hours of focused fix work**, including tests

---

**End of report.** Each finding above has a stable cross-reference (e.g., `[adv-1]`, `[mig-3]`) — Codex can use these to look up the per-reviewer rationale in `tasks/codex-review-72h-raw/0[1-9]-*.md` if it needs more context before applying a fix.

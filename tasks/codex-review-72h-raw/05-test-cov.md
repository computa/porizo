# Reviewer: testing (coverage and quality)

## Findings (16 total)

### HIGH

1. **[HIGH] test/critical-fixes.test.js:629-642 — `parseJson` test does not test the SUT**
   - Tests Node.js's native `JSON.parse`, not the runner module's `parseJson` helper. Comment "This will be tested via the runner module / For now, just verify the concept" is a placeholder masquerading as a test.
   - Fix: Import `parseJson` from `src/utils/common` (or wherever the runner's wrapper lives), assert its `required: true` branch throws on invalid input, `required: false` branch returns a default. Delete tautological test.

2. **[HIGH] test/critical-fixes.test.js:225-231 — "AI Voice Model Configuration" is a tautology**
   - Sets `config.DEFAULT_AI_VOICE_MODEL = "custom_model_v1"` then asserts `config.DEFAULT_AI_VOICE_MODEL === "custom_model_v1"`. Asserts what was set up, not what SUT does.
   - Fix: Inject config through `buildServer`/runner, trigger render that reaches voice-conversion, intercept `convertVoice` (or stub Replicate fetch), assert model parameter passed to provider equals configured value.

3. **[HIGH] test/critical-fixes.test.js:259-314 — concurrent version increment test passes vacuously**
   - Asserts `versions.length === uniqueVersions.length` only across `successResults`. If 4 of 5 requests fail, the 1 surviving version_num is trivially unique. No assertion on success count or DB row count.
   - Fix: Assert `successResults.length === 5`, verify `db.query("SELECT COUNT(*) FROM track_versions WHERE track_id = ?")` returns same count, assert `versions.sort()` equals `[1,2,3,4,5]`.

4. **[HIGH] test/critical-fixes.test.js:669-723 — rate limit test depends on missing LLM env, leaks 503 path**
   - Fires 35 lyric-gen requests in `before()` block; doesn't clear `GEMINI_API_KEY`/etc. If rate-limit middleware runs _before_ LLM check, fine; if after, all 35 may return 503 in environments without keys, masking absence of rate limiting. `rateLimited.length > 0` cannot distinguish.
   - Fix: Stub LLM provider to return fast success (200) so 429 is the only deterministic path. Assert first N requests succeeded before rate-limit kicks in, rest are 429.

5. **[HIGH] src/workflows/runner.js:1575-1605 — `resolveSunoPersonaForRender` has 4 untested guard branches**
   - Throws E302_SUNO_PERSONA_NOT_READY for: (a) profile missing, (b) ownership mismatch (`user_id !== track.user_id`), (c) wrong provider, (d) status !== "active", (e) `deleted_at` set, (f) `provider_profile_id` null, (g) E302_SUNO_PERSONA_CONSENT_REQUIRED for missing scope. Route-level tests cover missing/pending/wrong-consent; runner-level branches for soft-deleted, ownership mismatch, inactive-but-existing are unreachable.
   - Fix: Add unit tests around `resolveSunoPersonaForRender` (export from runner or test indirectly via render tick). Insert profiles with `deleted_at`, mismatched user_id, `status='failed'`, `provider_profile_id=null`. Assert each throws expected error code.

6. **[HIGH] src/workflows/runner.js:5556-5628 — voice provider lane disable / concurrency limit untested**
   - New polling: `voiceProviderLaneDisabled` flag, `MAX_CONCURRENT_VOICE_PROVIDER_JOBS` cap, `availableSlots` accounting, three branches that flip lane disabled. No test exercises any path.
   - Fix: Test that creates `MAX_CONCURRENT + 1` queued jobs, calls `runner.tick()`, asserts only `MAX_CONCURRENT` claimed, (N+1)th remains pending. Also test exception inside polling loop sets `voiceProviderLaneDisabled=true`, subsequent ticks short-circuit.

### MEDIUM

7. **[MEDIUM] test/routes/internal-suno-callback.test.js:106-148 — "does not mutate state" claim never verified**
   - Asserts `received: true` but test setup has no DB and no other routes registered. There is literally no state to mutate. Negative assertion structurally unprovable. If U18 adds DB writes, these tests won't catch it.
   - Fix: Wire real DB into test app, assert `voice_provider_jobs`, `voice_provider_profiles`, `enrollment_sessions` row counts/contents are unchanged after a 200 callback.

8. **[MEDIUM] test/routes/internal-suno-callback.test.js:151-169 — wrong-length signature test missing edge cases**
   - Only "abcd" tested. Missing: empty string, non-hex chars, signature header with whitespace, valid-length-hex-but-wrong-bytes (the meaningful timing-attack case where lengths match).
   - Fix: Add tests for `""`, `"zzzz...zzzz"` (non-hex), `<correct-length-hex-but-different-bytes>`. The last is the most important — exercises `crypto.timingSafeEqual` with equal-length but mismatched buffers.

9. **[MEDIUM] test/critical-fixes.test.js:104-146 — stale-job recovery test does not assert error metadata**
   - Asserts `status === 'queued'` and `attempts === 1` after recovery. Doesn't assert `error_code`, `error_message`, or that recovery was logged/audit-tracked. If recovery silently increments attempts but leaves stale error data, test passes.
   - Fix: After recovery, assert `error_code`, `error_message`, `locked_at`, `locked_by` columns are appropriately reset (or preserved) per contract. Verify audit log entry written if recovery contract requires it.

10. **[MEDIUM] test/voice-enrollment.test.js (queues Suno persona preparation) — does not verify job actually runs**
    - Inserts enrollment + asserts `voice_provider_jobs` row exists with `provider_profile_id=null`, `provider_profile.status='pending'`. Never executes job through runner; never asserts `step` field or `step_data` shape.
    - Fix: After enrollment, run `runner.tick()` (or `runSunoVoicePersonaJob` directly with mocked Suno client). Assert profile transitions: `pending` → `upload_submitted` → `cover_submitted` → `persona_submitted` → `active`. Assert `step_data.enrollment_session_id` and `step_data.source_audio_key` are populated.

11. **[MEDIUM] test/suno-voice-persona-service.test.js:204-232 — "active" state transition under-asserts side effects**
    - Only asserts `active.status`, `provider_profile_id`, `source_task_id`, `source_audio_id`, `session.access_token === null`. Doesn't assert `step_data` retains `enrollment_session_id`, `voice_profiles` row unmutated (consent_at, status), or no orphaned `voice_provider_jobs`.
    - Fix: Add assertions on `voice_provider_jobs.attempts`, `locked_at = null`, `next_attempt_at = null`. Check no other voice_provider_jobs rows exist for this user.

12. **[MEDIUM] test/render-endpoints.test.js:706-760 — gift-funded render test does not verify gift reservation transitions**
    - Asserts `spendCalls === 0` and `version.full_job_id` is set. Doesn't check `gift_reservations.status` transitions `reserved` → `consumed`. Gift could remain reserved indefinitely; test passes.
    - Fix: After successful gift-funded render, query `gift_reservations`, assert `status === 'consumed'` (or appropriate terminal state) and `consumed_at` populated.

13. **[MEDIUM] test/critical-fixes.test.js:343-403 — "default voice mode" assertion does not isolate config**
    - `should apply DEFAULT_VOICE_MODE from config when not specified` and `accept user_voice` test share `before()`-built app/db. Second test reuses `userId`, runs `INSERT OR IGNORE INTO voice_profiles`, depends on app state from first test. Test ordering dependency.
    - Fix: Split into separate describe blocks with isolated `before/after` lifecycles, or use unique `userId` per `it`.

14. **[MEDIUM] test/suno-persona-provider.test.js:174-199 — pre-deploy gate test silently skips on local dev**
    - `if (process.env.SUNO_PERSONA_PROBE_VERIFIED !== "true") return` — silent return without logging or marking as skipped. CI and local dev report PASSED. If env var misspelled in CI, gate bypassed silently.
    - Fix: Use `t.skip("SUNO_PERSONA_PROBE_VERIFIED not set")` (node:test API). Better: split into local-placeholder check and explicit deploy-gate test.

15. **[MEDIUM] test/suno-persona-provider.test.js:226-275 — orchestration test mocks too aggressively**
    - `createPersonaFromSourceUrl` test stubs `fetchJsonFn` AND `pollTaskOnceFn`. SUT only orchestrates calls; never exercises real polling/retry/error logic. Order assertion `["uploaded", "cover", "audio"]` is brittle.
    - Fix: Drop order assertion or replace with assertions on observable outcomes (final `result.persona.personaId` correct, all three callbacks invoked exactly once). Add second test where `pollTaskOnceFn` returns "PENDING" twice before "SUCCESS" to exercise polling loop.

### SUGGESTION

16. **[SUGGESTION] test/utils/provider-sanitize.test.js — missing edge cases**
    - No tests for: nested errors, strings with multiple Bearer tokens (only one redacted in many simple regex impls), Unicode/emoji input, exact 1000-char input (boundary of MAX_LENGTH cap), overlapping pattern matches (URL containing `task_xxx` substring).
    - Fix: Add boundary tests at `MAX_LENGTH` and `MAX_LENGTH + 1`. Multi-token redaction (`"Bearer a Bearer b"` → both redacted). URL embedding token id (`https://x/task_abc/audio_xyz`).

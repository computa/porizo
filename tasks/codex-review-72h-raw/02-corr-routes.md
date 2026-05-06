# Reviewer: correctness (routes + server)

## Findings (12 total)

### HIGH

1. **[HIGH] src/routes/enrollment.js:1245-1366 — Enrollment-complete transaction has NO atomicity in PostgreSQL**
   - Issue: The `db.transaction(async () => { ... })` callback **ignores its `query` parameter** and uses raw `db.prepare().run()` plus `createPendingProviderProfile(db, ...)`, `createVoiceProviderJob(db, ...)`, `cancelVoiceProviderJobsForVoiceProfile(db, ...)`, `softDeleteProviderProfilesForVoiceProfile(db, ...)` — all hit the connection pool, NOT the BEGIN/COMMIT-bound client. In production (PG adapter `src/database/postgres.js:116-137`), the transactional client only sees an empty transaction; every actual write is auto-committed on a separate connection. Failures partway leave inconsistent state: session marked completed, voice_profiles row exists, but no persona job → user is stuck. Compare with `src/routes/tracks.js:854-902` which correctly uses `query` inside the same wrapper.
   - Fix: Refactor transaction to use the passed `query` function (or dedicated client). Update voice-provider-profile-service helpers to accept a `query`/client argument and use it for SQL inside the transaction.

2. **[HIGH] src/routes/enrollment.js:874-940 — `/voice/enrollment/complete` is not idempotent — repeats create duplicate voice profiles and persona jobs**
   - Issue: Handler does not check `session.status` before processing. A retried/replayed POST while session already `completed` (or `processing`) re-runs entire flow: re-concat audio, re-embed (paying Replicate again), INSERT new voice_profiles row (status='active'), soft-delete the _just-created_ voice_profile via `existingProfile` branch, queue another persona job, consume voice_provider quota a second time. Migration 097 has no uniqueness preventing multiple `pending` voice_provider_profiles for same voice_profile_id (unique index only covers `status='active' AND deleted_at IS NULL`).
   - Fix: Add early `if (session.status !== 'recording' && session.status !== 'processing') { sendError(reply, 409, 'SESSION_ALREADY_FINALIZED', ...); return; }` guard immediately after expires_at check. Also add unique index on `(voice_profile_id, provider) WHERE status IN ('pending', 'upload_submitted', 'cover_submitted', 'persona_submitted') AND deleted_at IS NULL`.

### MEDIUM

3. **[MEDIUM] src/routes/enrollment.js:1097-1108 — Reuses prior session.access_token; potential token reuse across personas**
   - Issue: On enrollment-complete, `cleanAudioAccessToken = session.access_token || null`. If session row already had an access_token from previous (failed/replayed) complete attempt, same token reused for embedding fetch (Replicate) and audio download URL. Token authorizes `/enrollment/{session_id}/clean.wav` — stale token from old session can grant download access without persona-consent gating logic re-validating. Token bound to enrollment session, not persona.
   - Fix: Always issue fresh access token in complete handler when {shouldEmbed, persona enqueue} is needed, instead of reusing `session.access_token`. Or revoke prior session's token explicitly before reissuing.

4. **[MEDIUM] src/routes/enrollment.js:1064 — `shouldQueueSunoPersona = true` is unconditional — bypasses any feature flag**
   - Issue: Constant disables any future flag-driven rollout: every enrollment-complete attempts to queue a Suno persona job whenever consent is present, regardless of `suno_voice_persona_enabled` or any kill-switch. If Suno persona has outage, no way to stop queueing without code deploy.
   - Fix: Wire to feature flag (`getFeatureFlag(db, 'suno_voice_persona_enabled')`). Add kill-switch. **(Overlaps with adv-10.)**

5. **[MEDIUM] src/routes/enrollment.js:1294-1302 — Persona-status `source_audio_unavailable` is reported but never persisted**
   - Issue: When `cleanAudioReady` is false (concatWavFiles or putFile threw), code creates voice_profile (status='active') but only sets `providerProfileResult = { status: 'source_audio_unavailable' }` in memory. No voice_provider_profiles row written. Subsequent `findActiveProviderProfileForUser` and `findLatestProviderProfileForVoiceProfile` return null, causing tracks.js preflight to return `SUNO_VOICE_PERSONA_SETUP_REQUIRED` with `requires_voice_enrollment: true` — implying user should re-enroll. Re-enrolling repeats same failed concat. **User stuck without clear error trail; ops has no row to investigate.**
   - Fix: Either (a) persist a voice_provider_profile with `status='failed'` and `last_error='source_audio_unavailable'` in this branch, OR (b) reject entire enrollment (5xx) so user retries chunk upload.

6. **[MEDIUM] src/routes/internal-suno-callback.js:107-125 — Token-only auth mode bypasses HMAC body verification**
   - Issue: If `tokenMatches` is true (query token matches secret), handler accepts request without validating body via HMAC. Documented as supported path (Suno doesn't yet sign callbacks), but token sent in URL — lands in webserver access logs, intermediary proxies, browser referrer headers. Leaked token grants long-term ability to spoof any callback content. Combined with stub being no-op today, low-risk; **once stub becomes a state-mutator, becomes critical.** HMAC path requires `expected = HMAC(secret, body)`, but implementation accepts EITHER, not BOTH.
   - Fix: Before allowing stub to mutate state in future patch, enforce HMAC-only auth (or require both query token AND HMAC). Document SUNO_CALLBACK_URL token-rotation procedure. **(Overlaps adv-3.)**

7. **[MEDIUM] src/routes/tracks.js:819-833, 1063-1077, 1235-1245 — Persona preflight runs after the trackVersion existing-job short-circuits**
   - Issue: In `render_preview` (line 805-817), if `existingJob` is terminal-failed and lyrics haven't changed, handler returns 409 ALREADY_RENDERING_RECENT_FAILURE _before_ persona preflight. A user whose persona has since transitioned to `failed` sees stale render-failure code rather than new SUNO_VOICE_PERSONA_FAILED 422. iOS RenderController retries same failed job rather than directing user to re-enroll.
   - Fix: Move `preflightUserVoiceReadiness` call above the `existingJob && isTerminalFailedJobStatus(existingJob.status)` block so a regressed persona surfaces the right error code.

8. **[MEDIUM] src/routes/enrollment.js:897-925 — Late-grant of persona consent silently survives after session expiry check would expire it**
   - Issue: Late-grant block runs _before_ `expires_at` check (line 934). If session already expired, late-grant UPDATE writes consent_scopes and re-fetches session, then next check expires session and returns 410. **The consent_scopes column is now populated on an expired session.** If user starts new enrollment, migration 098 backfill or future logic searching latest session by user_id may pick up consent from this expired session.
   - Fix: Move late-grant block AFTER `expires_at` check so only runs on valid session. Or only update if `session.status` still in {recording, processing}.

9. **[MEDIUM] src/services/suno-voice-persona-service.js:43-66 — `hasPersonaConsentScope` lower-cases entire string before JSON parsing**
   - Issue: Line 47 does `consentScope.trim().toLowerCase()` then attempts JSON.parse. JSON case-sensitive for property names like `"scopes"`. Future scope with mixed case (e.g., `voice_suno_persona_v2_RC1`) wouldn't match because comparison happens against lowercased parsed value. Today only scope is `voice_suno_persona_v1` (already lowercase), so no current bug. Latent trap.
   - Fix: Lowercase only AFTER parsing (lowercasing values, not whole JSON string), OR document that all scope literals MUST be lowercase and add runtime guard in scope-grant write paths. **(Overlaps adv-16.)**

### SUGGESTION

10. **[SUGGESTION] src/routes/enrollment.js:1240-1243 — `personaVocalWindow` computed even when persona branch will not run inside the transaction**
    - Issue: `personaVocalWindow` computed when `shouldQueueSunoPersona && hasProviderConsent && cleanAudioReady`. Inside transaction at line 1304, same triple-condition re-checked. Today they cannot change (no awaits between checks that mutate them), but duplicated condition is fragile.
    - Fix: Compute once. Extract helper `shouldEnqueuePersona = shouldQueueSunoPersona && hasProviderConsent && cleanAudioReady`.

11. **[SUGGESTION] src/routes/enrollment.js:1067 — `enrollmentSessionHasPersonaConsent(session)` reads from possibly-stale `session` if late-grant updated it**
    - Issue: Tied to the idempotency fix. Once status guards prevent re-entry, this concern is moot.
    - Fix: Tied to #2 above.

12. **[SUGGESTION] src/routes/tracks.js:248-255 — Pre-existing share-token stickiness write happens outside any transaction**
    - Issue: `findActiveTrackShare` mutates `tracks.share_token_id` mid-read for sticky behavior. Concurrent call from second request can race UPDATE. SQLite serialized so OK; PG with multiple writers may produce flapping share_token_id values. **Pre-existing**, out of scope for this diff.
    - Fix: Noted for future hardening.

## Residual Risks

- Migration 098 back-fills `enrollment_sessions.consent_scopes` for ALL historical sessions by copying from voice_provider_profiles. Sessions where user never explicitly granted persona consent receive non-null scope retroactively. **(Confirmed across reviewers: adv-6, mig-8.)**
- Internal-suno-callback stub intentionally no-op; adding state mutation later without first promoting auth from query-token to HMAC will be security regression. Track this transition.
- tracks.js preflight stores `voice_provider_profile_id` in `jobs.step_data`. Worker must re-validate at execution time; if user deletes voice profile between preflight and worker pickup, worker throws `E302_SUNO_PERSONA_PROFILE_DELETED` — verify user-facing error mapping handles gracefully.
- No explicit cap on how many `pending` provider profiles a user can accumulate. With idempotency hole open, script-clicker can flood `voice_provider_profiles`. Add per-user count cap or unique-active constraint.

## Testing Gaps

- No test exercises enrollment-complete handler with `session.status` already `'completed'` to confirm idempotent behavior.
- No test for `cleanAudioReady = false` branch (concat throws) — need fixture where ffmpeg/concatWavFiles raises and verify response surfaces `source_audio_unavailable`.
- No test exercises Postgres transaction rollback through enrollment-complete: throw inside `createVoiceProviderJob` and assert `voice_profiles` and `enrollment_sessions.status='completed'` were rolled back. Today they will not be.
- No test for `existingJob` terminal-failed AND user persona failed — confirms render_preview returns correct error code.
- No test for late-grant path on already-expired enrollment session.

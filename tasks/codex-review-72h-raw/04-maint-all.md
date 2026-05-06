# Reviewer: maintainability (all new/changed code)

## Findings (12 total)

### HIGH

1. **[HIGH] src/providers/suno-persona.js:400-476 — Dead production code `createPersonaFromSourceUrl`**
   - 76-LOC convenience wrapper exported and tested, but no production caller. Real flow (`runSunoVoicePersonaJob` in `suno-voice-persona-service.js:301-470`) calls `uploadFileUrl`, `submitUploadCoverTask`, `pollUploadCoverForAudio`, `generatePersona` separately because each step requires DB state-machine writes (`markProviderProfile*`) and `assertProviderJobStillAllowed` re-checks between them. Wrapper papers over required interleavings.
   - Fix: Delete `createPersonaFromSourceUrl` and its export. Drop corresponding test in `test/suno-persona-provider.test.js` (~lines 200-260).

2. **[HIGH] src/services/suno-voice-persona-service.js:432-433 — Phantom config knobs**
   - Reads `config.SUNO_PERSONA_GENERATE_MAX_ATTEMPTS` / `SUNO_PERSONA_GENERATE_RETRY_DELAY_MS` not declared in `src/config.js`. Always undefined; `|| 4` / `|| 5000` fallbacks always win. Looks tunable, isn't.
   - Fix: Either (a) declare both env vars in `src/config.js` and document, or (b) inline `4` and `5000` and delete the misleading config lookup.

3. **[HIGH] src/workflows/runner.js:120 — Duplicate `PERSONALIZED_VOICE_MODES`**
   - `render-contract.js:5` already defines `const PERSONALIZED_VOICE_MODES = new Set(["user_voice", "personalized"])`. Runner re-declares locally. Drift trap (per project's duplicate-function rule).
   - Fix: Export `PERSONALIZED_VOICE_MODES` from `render-contract.js`, import in `runner.js`, delete local copy.

### MEDIUM

4. **[MEDIUM] src/services/suno-voice-persona-service.js:232-532 — `runSunoVoicePersonaJob` is 300-line function with 8 inline re-fetch blocks**
   - Same 6-line `({ providerProfile, session } = await assertProviderJobStillAllowed({...}))` pattern repeats 8 times. Function does pre-flight, upload, cover-submit, audio-poll, persona-generate, post-persona check, error-bookkeeping x2.
   - Fix: Extract closure `const recheck = () => assertProviderJobStillAllowed({...})`, OR split into `prepareUpload`, `submitCover`, `resolveAudio`, `generatePersonaStep` async functions orchestrated by `runSunoVoicePersonaJob`.

5. **[MEDIUM] src/utils/provider-sanitize.js:33 — `MAX_LENGTH` exported but unused externally**
   - Module exports `{ sanitizeProviderError, MAX_LENGTH }` but `MAX_LENGTH` has no external consumer. Premature surface area.
   - Fix: Remove `MAX_LENGTH` from exports (or delete entirely, inline `1000` into slice).

6. **[MEDIUM] src/providers/suno-persona.js:42-49 — `sanitizeProviderError` referenced before its `require`**
   - Line 42 calls inside `ensureSuccess`; `const { sanitizeProviderError } = require(...)` lives at line 49. CommonJS hoisting at runtime saves it but reader sees undeclared identifier. Misleading explain-WHAT comment too.
   - Fix: Move `require` to top with other imports (lines 1-8). Delete the explanatory comment.

7. **[MEDIUM] src/services/feature-flags.js:83-86 + src/config.js:74-82 — Suno-persona config fragmented across two systems**
   - `config.SUNO_MODEL` defaults `"V5"`; persona feature flag defaults `"V5_5"`; service hardcoded fallback `"V5_5"`. Three sources of truth for "which Suno model do we use?".
   - Fix: Pick one source. If runtime tuning needed, drop env-var `SUNO_MODEL` and read from feature-flags. Document chosen layer.

8. **[MEDIUM] src/services/enrollment-session-service.js:25-26 — Per-process random HMAC key is security theatre**
   - When `LOG_ID_HMAC_KEY` unset, generates fresh key on every process boot. Logs persist across restarts; "deterministic" hash isn't correlatable across restarts; rotates randomly across Railway containers. 16-byte HMAC truncated to 16 hex chars = 8 bytes entropy = weak vs brute-force on small ID spaces. Function name `hashIdForLog` + `event: enrollment_session_token_revoked` JSON look like compliance auditing but aren't.
   - Fix: Either (a) require `LOG_ID_HMAC_KEY` to be set, throw at module-load when missing, or (b) drop HMAC entirely, emit truncated raw IDs (`id.slice(0,4)…id.slice(-4)`) like `redactedId` does in `suno-persona.js`.

9. **[MEDIUM] src/services/voice-provider-profile-service.js:255-278 — `markProviderProfileManualCleanupRequired` is `markProviderProfileFailed` with different default reason**
   - Both UPDATE row to `status='failed'`, set `last_error`, optionally update metadata. Differences: manual-cleanup also writes `provider_profile_id = COALESCE(?, provider_profile_id)`, omits `WHERE deleted_at IS NULL`, default error `"remote_persona_manual_cleanup_required"`. Drift risk.
   - Fix: Collapse to `markProviderProfileFailed(db, id, error, { providerProfileId = null, includeDeleted = false, metadata = null })`. Manual-cleanup callers add `{ providerProfileId, includeDeleted: true }`.

10. **[MEDIUM] src/services/suno-voice-persona-service.js:99-108 — `markPersonaGenerationStarted` leaks `voice_provider_jobs` SQL across domain boundary**
    - 9-line function does one `UPDATE voice_provider_jobs SET step = 'generate_persona'...`. Only place outside `voice-provider-profile-service.js` that touches `voice_provider_jobs.step`. Per U3 plan, that table is owned by profile-service. Leak undoes the consolidation.
    - Fix: Move to `voice-provider-profile-service.js` as `markVoiceProviderJobStep(db, jobId, step)`, import it.

### SUGGESTION

11. **[SUGGESTION] src/providers/suno-persona.js:65-87 — Doc comment misplaced**
    - Lines 65-79 are a 14-line doc comment for `extractSunoAudioId` (defined 30 lines lower at 96), with `describeShape` wedged between. Reader jumps past two unrelated functions to reach documented one.
    - Fix: Move doc comment immediately above `function extractSunoAudioId(...)`. Keep `describeShape`, `pickAudioIdLike` as private helpers below or hoist with their own one-liners.

12. **[SUGGESTION] src/workflows/runner.js — diff is ~80% Prettier reformatting (PROCESS, not code)**
    - 2,776 insertions / 1,320 deletions; substantive new logic is ~30 lines (persona contract enforcement at line 1979, `recoverStaleVoiceProviderJobs` at 5452, `isProviderCompleteAudioPipeline` branch at 3969, 2 new imports). Rest is whitespace/quote normalization. Hides actual change.
    - Fix: For future PRs, do reformatting commits separately. No code change needed; flag for process.

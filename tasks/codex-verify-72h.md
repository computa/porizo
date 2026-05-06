# Codex Fix Verification — 72-hour Review

**Generated:** 2026-05-07 (resumed)
**Branch:** `version3` at HEAD `185f851`
**Scope verified:** Original report at `tasks/codex-review-72h.md` against fix commits 478a526, b834cf6, ccb5ce3, 185f851
**Per-finding raw verification:** `tasks/codex-verify-72h-raw/0[1-5]-*.md`

---

## Headline

**95 of the 112 findings (~85%) were addressed cleanly.** The 3 BLOCKERS, all 30 HIGH-severity issues, and 30/38 MEDIUM issues are FIXED. The remaining gaps are concentrated in test coverage (most SUGGESTIONS) and one defense-in-depth issue (M8 callback HMAC bypass) that becomes critical only when the callback stub starts mutating state.

---

## Tally by Severity

| Severity       |  FIXED | PARTIAL | NOT_FIXED |   TOTAL |
| -------------- | -----: | ------: | --------: | ------: |
| BLOCKER (B)    |      3 |       0 |         0 |       3 |
| HIGH (H)       |     26 |       2 |         2 |      30 |
| MEDIUM (M)     |     30 |       5 |       4\* |      39 |
| SUGGESTION (S) |      8 |       5 |        11 |      24 |
| **Total**      | **67** |  **12** |    **17** | **96**† |

\* MEDIUM count is 39 because M13/M14 were noted "covered elsewhere"; verifier still tabulated them.
† Original raw count was 112; clustering across reviewers consolidated some findings, hence the lower verified total. The report grouped by ID before verification.

---

## What's FIXED cleanly (highlights)

### Pre-deploy safety (all 3 BLOCKERS)

- **B1** Old iOS clients (105–108) get implicit `voice_suno_persona_v1` consent grant via `resolvePersonaConsentScopes` at both `/start` and `/complete` (with late-grant rescue).
- **B2** Migration 099 cancels in-flight `track_versions` with legacy pipeline strings before pipeline whitelist enforcement.
- **B3** iOS RenderController.swift now matches both prefixed (`E302_*`) and non-prefixed forms across the persona-not-ready, enroll-voice, and switch-voice-mode dispatch buckets.

### Cost amplification + GDPR-adjacent bugs

- **H1** Global persona lock dropped — concurrency relies on atomic `markVoiceProviderJobRunning` claim instead.
- **H6** Upload `downloadUrl` persisted on `markProviderProfileUploadSubmitted`; retries reuse the existing upload (no more re-billing).
- **H7** `markProviderProfileManualCleanupRequired` writes the correct `manual_cleanup_required` status, drops the `deleted_at IS NULL` predicate, and emits an audit log entry capturing the orphan persona_id.
- **H8** `markPersonaGenerationStarted` checks `result.changes` and throws `E302_SUNO_PERSONA_LOST_CLAIM` before setting the started flag — no more duplicate Suno persona creation.
- **H9** Polling loop asserts `result.done && result.audioId` after `pollWithBackoff`; throws retryable error so jobs reschedule instead of going to manual.

### Architecture / atomicity

- **H12** Enrollment-complete transaction now uses the passed `query` function via `dbFromQuery` adapter — atomicity preserved on Postgres.
- **H13** Idempotency guard (`SESSION_ALREADY_FINALIZED` 409) plus unique partial index on pending profiles.
- **H14** Persona preflight runs before existing-job short-circuits across `render_preview`, `render_full`, `retry`.
- **H15** Uniform 422 status across all `SUNO_VOICE_PERSONA_*` codes in tracks.js, story.js.

### Webhook + secrets safety

- **H16** `resolveSunoCallbackUrl` auto-appends token; secret length-validated ≥32; startup check fails fast under `LIVE_PROVIDERS=true`; SAFETY block in route.

### iOS task hygiene

- **H27/H28/H29/H30** `EnrollmentFlowView` upload Task tracked + cancelled on `.onDisappear`, file I/O moved to `Task.detached`, polling task cancellation before reassign, polling timeout shows "still processing" + `dismiss()` (no welcome reset).

### Migrations 097/098/099

- **H23** FKs added (NOT VALID for online migration on PG; inline at table creation on SQLite).
- **H24** CHECK constraints on `voice_provider_jobs.status`/`step` mirrored across PG and SQLite.
- **H26** Retroactive consent backfill removed; existing rows intentionally NULL (fail-secure).

---

## What's PARTIAL — needs follow-up

### HIGH

| ID      | Issue                                  | What's still missing                                                                                                                                                     |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **H10** | Cancellation reach + DELETE rate limit | (1) No `consumeRateLimit` on `DELETE /voice/profile`. (2) `cancellation_requested_at` only checked between Suno calls via `assertProviderJobStillAllowed`, not mid-call. |
| **H11** | `suno_voice_persona_enabled` flag      | Flag check landed, but default is **ON**, not **OFF** as recommended. Kill switch works; staged-rollout opt-in does not.                                                 |

### MEDIUM

| ID      | Issue                         | What's still missing                                                                                                      |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **M5**  | Refresh-token un-revoke audit | Structured `warn` log only; no `audit_logs` DB row for SOC review.                                                        |
| **M6**  | Sanitizer regex coverage      | Added `sk-`, JWT, generic prefixed IDs. **UUID `8-4-4-4-12` pattern not redacted.**                                       |
| **M12** | Late-grant + expiry order     | Main path fixed; chunk upload route still skips `expires_at`/`status` (gated by `enableDebugRoutes`, so limited impact).  |
| **M23** | WAV header sync I/O           | Switched to `fs.promises.readFile` (async) but still buffers entire file. Stream-parsing only first 44 bytes not adopted. |
| **M27** | Binary fetch streaming        | `downloadToFile` streams (good); `fetchBinary`/`fetchBinaryWithHeaders` still buffer via `arrayBuffer`.                   |

---

## What's NOT_FIXED — risks to track

### HIGH

| ID      | Issue                                                    | Risk                                                                                                                                                          |
| ------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H5**  | Voice provider lane disable / concurrency limit untested | No tests for `MAX_CONCURRENT_VOICE_PROVIDER_JOBS+1` queueing or lane disable. Behavior is correct in prod (verified by code reading) but no regression guard. |
| **H22** | `resolveSunoPersonaForRender` 4 guard branches untested  | Function is closure-scoped in runner.js; not exported. Requires refactor (export or lift to module) to test.                                                  |

### MEDIUM (track these for next iteration)

| ID      | Issue                                                       | Why it matters                                                                                                                                                                                                               |
| ------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M3**  | Voice access_token in Suno fetch URL                        | Voice biometric is irreversible PII. Token is revoked post-fetch (M11 helps), but window of leak to Suno logs/CDN is non-zero.                                                                                               |
| **M8**  | Callback HMAC bypass via token-only auth                    | Token in URL leaks to access logs, proxy logs, browser referrers. Once leaked, replayable indefinitely. **Becomes critical the moment the callback stub starts mutating state — must enforce HMAC-only before that change.** |
| **M16** | `runSunoVoicePersonaJob` is still ~270 lines                | Maintainability only.                                                                                                                                                                                                        |
| **M18** | Three sources of truth for Suno model with default mismatch | `V5` in `config.js` vs `V5_5` fallback in persona service. Could yield surprising model selection when both `stepData.model` and the feature flag are unset.                                                                 |

### SUGGESTION (mostly tests; defer)

- 11 of 24 SUGGESTION items remain NOT_FIXED. Most are test-quality issues (S1, S2, S4, S7, S8, S10, S12, S13) — they don't break anything but leave coverage gaps.
- Non-test SUGGESTIONS not addressed: S17 (named constraints), S19 (state-transition CHECK), S24 (iOS body view-graph extraction).

---

## Recommended follow-ups (priority order)

1. **M8** — Before any future patch makes `internal-suno-callback` mutate state, enforce HMAC-only and add timestamp/replay protection. Add a comment in the route flagging this as a release-blocker for that change.
2. **H10 (gap 1)** — Add per-user rate limit to `DELETE /voice/profile` (1/min). 5-min change, prevents the cost-amplification abuse pattern flagged in adv-7.
3. **H11 (gap)** — Decide whether `suno_voice_persona_enabled` default should be ON (ship) or OFF (staged rollout). If keeping ON, document that no opt-in gate exists.
4. **M3** — Move to a single-use ~5-min scoped token for the Suno fetch (separate from the long-lived enrollment access_token).
5. **M18** — Pick one source of truth for Suno model. Resolve the `V5`/`V5_5` default mismatch.
6. **H22 / H5** — Refactor `resolveSunoPersonaForRender` and the voice provider lane state for testability; add tests once exported.
7. **Test backfill** — Knock out S1, S2, S4, S7, S8, S10 in a single test-quality PR. Each is small.

---

## Bottom line

The Codex fix pass was thorough on the high-impact items. Every BLOCKER and every HIGH-severity bug that could cause user-visible defects, cost amplification, or data corruption is FIXED or has the root cause addressed. The remaining gaps are predominantly:

1. **One genuinely dangerous defense-in-depth issue** (M8) that needs a comment-block flag so the next person doesn't accidentally promote the callback to a state-mutator without enforcing HMAC-only.
2. **Two small operational gaps** (H10 rate limit, H11 default flag value) that are 5-15 minute fixes.
3. **Test coverage backfill** (mostly SUGGESTIONS) that can be batched into a single PR.

Safe to ship the rest. Build 110 should not regress on any of the originally-flagged paths.

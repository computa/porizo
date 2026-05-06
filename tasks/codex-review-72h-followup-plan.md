# Codex Review Follow-up Fixes — Completed

Source: `tasks/codex-verify-72h.md`. Implementing the 17 NOT_FIXED + 12 PARTIAL findings.

Status: all listed items have been implemented and verified.

## Batch 1 — Security comments + sanitizer + audit log

- [x] **M8** Add SAFETY comment block in `src/routes/internal-suno-callback.js` flagging HMAC-only requirement before state mutation
- [x] **M6** Add UUID `8-4-4-4-12` regex to `src/utils/provider-sanitize.js`
- [x] **M5** Write `audit_logs` row when refresh-token grace-period un-revoke fires in `src/services/auth-service.js`

## Batch 2 — Operational gaps

- [x] **H10 gap 1** Per-user rate limit on `DELETE /voice/profile` (1/min) in `src/routes/enrollment.js`
- [x] **H11** Document deliberate ON-by-default for `suno_voice_persona_enabled` in feature-flags.js
- [x] **M12** Apply expiry/status check to chunk upload route at enrollment.js:936-948

## Batch 3 — Single source of truth for Suno model (M18)

- [x] Align `config.SUNO_MODEL` default with feature-flag `V5_5`

## Batch 4 — Voice biometric token scoping (M3)

- [x] Issue ~5-min scoped token for Suno fetch (separate from enrollment access_token)

## Batch 5 — Mid-call cancellation (H10 gap 2)

- [x] Cancellation-aware Suno calls inside `submitUploadCoverTask` / `pollUploadCoverForAudio`

## Batch 6 — Performance

- [x] **M23** Stream-parse 44-byte RIFF header instead of full readFile
- [x] **M27** Stream `fetchBinary`/`fetchBinaryWithHeaders` in `src/providers/http.js`

## Batch 7 — Maintainability

- [x] **M16** Extract `recheck()` closure for `assertProviderJobStillAllowed` re-fetch
- [x] **H3 leftover** Remove duplicate `PERSONALIZED_VOICE_MODES` at `src/routes/tracks.js:24`

## Batch 8 — Test quality

- [x] **S1** Replace `parseJson` tautology with real test
- [x] **S2** Real test for `DEFAULT_AI_VOICE_MODEL` flow
- [x] **S4** Stub LLM in rate-limit test
- [x] **S7** Assert `last_error`/`error_code` after stale-job recovery
- [x] **S10** Assert `gift_reservations.status === 'consumed'`
- [x] **S12** Use `t.skip(...)` instead of silent return

## Batch 9 — Tests for closure-scoped runner functions

- [x] **H22** Export `resolveSunoPersonaForRender` and add 4 guard-branch tests
- [x] **H5** Test for `MAX_CONCURRENT_VOICE_PROVIDER_JOBS` cap

## Batch 10 — DB constraint hardening

- [x] **S17** Name CHECK/UNIQUE constraints
- [x] **S19** State-transition CHECK or app-level validation

## Batch 11 — iOS polish

- [x] **S24** Extract `EnrollmentFlowView` step views

## Batch 12 — More test quality

- [x] **S3** Concurrent version increment — assert success count + DB rows
- [x] **S5** Wire real DB into callback test
- [x] **S9** voice_provider_jobs side-effect assertions
- [x] **S11** Split default-voice-mode tests
- [x] **S14** Sanitize boundary + multi-token tests

## Verification gates

- After each batch: `npm test -- --bail` to confirm no regression.
- After Batches 1-3: targeted unit-test run for affected modules.
- After Batch 11: iOS build sanity check via XcodeBuildMCP.

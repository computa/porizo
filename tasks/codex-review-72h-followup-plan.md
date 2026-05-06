# Remaining Codex Review Fixes — Implementation Plan

Source: `tasks/codex-verify-72h.md`. Implementing the 17 NOT_FIXED + 12 PARTIAL findings.

## Batch 1 — Security comments + sanitizer + audit log

- [ ] **M8** Add SAFETY comment block in `src/routes/internal-suno-callback.js` flagging HMAC-only requirement before state mutation
- [ ] **M6** Add UUID `8-4-4-4-12` regex to `src/utils/provider-sanitize.js`
- [ ] **M5** Write `audit_logs` row when refresh-token grace-period un-revoke fires in `src/services/auth-service.js`

## Batch 2 — Operational gaps

- [ ] **H10 gap 1** Per-user rate limit on `DELETE /voice/profile` (1/min) in `src/routes/enrollment.js`
- [ ] **H11** Document deliberate ON-by-default for `suno_voice_persona_enabled` in feature-flags.js
- [ ] **M12** Apply expiry/status check to chunk upload route at enrollment.js:936-948

## Batch 3 — Single source of truth for Suno model (M18)

- [ ] Align `config.SUNO_MODEL` default with feature-flag `V5_5`

## Batch 4 — Voice biometric token scoping (M3)

- [ ] Issue ~5-min scoped token for Suno fetch (separate from enrollment access_token)

## Batch 5 — Mid-call cancellation (H10 gap 2)

- [ ] Cancellation-aware Suno calls inside `submitUploadCoverTask` / `pollUploadCoverForAudio`

## Batch 6 — Performance

- [ ] **M23** Stream-parse 44-byte RIFF header instead of full readFile
- [ ] **M27** Stream `fetchBinary`/`fetchBinaryWithHeaders` in `src/providers/http.js`

## Batch 7 — Maintainability

- [ ] **M16** Extract `recheck()` closure for `assertProviderJobStillAllowed` re-fetch
- [ ] **H3 leftover** Remove duplicate `PERSONALIZED_VOICE_MODES` at `src/routes/tracks.js:24`

## Batch 8 — Test quality

- [ ] **S1** Replace `parseJson` tautology with real test
- [ ] **S2** Real test for `DEFAULT_AI_VOICE_MODEL` flow
- [ ] **S4** Stub LLM in rate-limit test
- [ ] **S7** Assert `last_error`/`error_code` after stale-job recovery
- [ ] **S10** Assert `gift_reservations.status === 'consumed'`
- [ ] **S12** Use `t.skip(...)` instead of silent return

## Batch 9 — Tests for closure-scoped runner functions

- [ ] **H22** Export `resolveSunoPersonaForRender` and add 4 guard-branch tests
- [ ] **H5** Test for `MAX_CONCURRENT_VOICE_PROVIDER_JOBS` cap

## Batch 10 — DB constraint hardening

- [ ] **S17** Name CHECK/UNIQUE constraints
- [ ] **S19** State-transition CHECK or app-level validation

## Batch 11 — iOS polish

- [ ] **S24** Extract `EnrollmentFlowView` step views

## Batch 12 — More test quality

- [ ] **S3** Concurrent version increment — assert success count + DB rows
- [ ] **S5** Wire real DB into callback test
- [ ] **S9** voice_provider_jobs side-effect assertions
- [ ] **S11** Split default-voice-mode tests
- [ ] **S14** Sanitize boundary + multi-token tests

## Verification gates

- After each batch: `npm test -- --bail` to confirm no regression.
- After Batches 1-3: targeted unit-test run for affected modules.
- After Batch 11: iOS build sanity check via XcodeBuildMCP.

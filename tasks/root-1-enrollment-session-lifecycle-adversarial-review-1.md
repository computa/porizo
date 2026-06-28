# Root 1 enrollment-session lifecycle adversarial review 1

Date: 2026-06-27

## Scope reviewed

- `src/database/enrollment-session-repository.js`
- `src/routes/enrollment.js`
- `test/enrollment-session-repository.test.js`
- `test/services/enrollment-session-service.test.js`
- `test/voice-enrollment.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

## Findings

No P0/P1 findings found in this pass.

## Checks performed

- Confirmed `src/routes/enrollment.js` has no remaining direct `enrollment_sessions` SQL references.
- Confirmed finalization claim still guards by `session_id`, `user_id`, and open statuses only.
- Confirmed transaction-scoped completion uses `createEnrollmentSessionRepository(txDb)`, preserving rollback semantics with voice-profile/provider writes.
- Confirmed failure-path status updates preserve the previous status values: `failed_internal`, `failed_quality`, and `failed_verification`.
- Confirmed late consent update remains conditional on `consent_scopes IS NULL`.
- Confirmed access-token rotation remains targeted by session id.

## Validation

- `node --test --test-concurrency=1 test/enrollment-session-repository.test.js test/services/enrollment-session-service.test.js`
- `NODE_ENV=test JWT_SECRET=test_jwt_secret_32_chars_minimum_value ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/voice-enrollment.test.js`
- `npm run lint`
- `git diff --check`

## Residual risk

- The route still owns voice-profile SQL, storage/QC orchestration, and provider setup. Those are intentionally outside this slice and should move under separate repository/service boundaries.
- Full-suite validation still needs to run after this slice because `voice-enrollment` is high-traffic shared behavior.

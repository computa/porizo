# Root 1 Auth Security Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-security-repository.js` for `auth_events` inserts and user login
  lockout persistence.
- Replaced direct `auth-service.js` SQL for auth-event logging, failed-login
  count increment/read, `locked_until` writes, lockout reads, and lockout reset.

## Boundary

This slice intentionally does not move JWT signing/verification, password
hashing, refresh-token rotation, one-time token verification, account-deletion
orchestration, auth route response shaping, or lockout duration policy. The
service keeps business decisions; the repository owns only persistence.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** Atomic failed-login increment semantics are preserved with
  `COALESCE(failed_login_count, 0) + 1`.
- **P2 VERIFIED:** Lockout escalation, account-locked checks, reset behavior,
  and auth-event metadata storage remain service-compatible through the
  existing public `authService` API.

## Risks Checked

- **Enumeration hardening:** route-facing login behavior stays unchanged; the
  existing locked-account enumeration test remains green.
- **Policy leakage into repository:** lockout threshold, escalation duration,
  metadata JSON serialization, and event id generation remain in the service.
- **Agent resource management:** no new subagents were launched because
  inherited agent sessions remain stale/unmanaged; bounded local parallel
  commands were used instead.

## Validation

- `node --check src/database/auth-security-repository.js`
- `node --check src/services/auth-service.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-security-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/security-units-6-7-8.test.js test/auth-login-enumeration.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `npm run lint`
- `npm test` (2,907 tests; 2,884 pass / 23 skipped / 0 fail; 449,196.389667 ms)
- `git diff --check -- src/services/auth-service.js src/database/auth-security-repository.js test/auth-security-repository.test.js docs/architecture/architecture-debt-register-2026-06.md tasks/root-1-auth-receiver-attribution-repository-adversarial-review-1.md`

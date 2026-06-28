# Root 1 Auth Profile Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-profile-repository.js` for auth route profile/contact reads and
  small user/profile mutations.
- Replaced route-local SQL in `routes/auth.js` for:
  - current-user profile assembly,
  - user email fallback reads for reset/verification flows,
  - profile display-name updates,
  - profile-completion skip timestamp writes,
  - verified-email uniqueness checks,
  - pending verification-email lookup,
  - phone-link idempotency checks.
- Reused `identity-repository.js` for the remaining social verified-email lookup
  in the same auth contact-read family.

## Boundary

This slice intentionally does not redesign auth profile response shape, change
identity-service ownership of contact creation/verification, alter email
verification dispatch, move Apple provider-data writes, or extract social
provider orphan cleanup. The route still owns HTTP validation, public error
codes, masking, email dispatch, and calls into `identity-service`.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** `buildUserProfileResponse()` still shapes `providers`,
  `auth_methods`, `contacts`, `primary_email`, `primary_phone`, and
  `needs_profile_completion` in the route; the repository returns raw rows only.
- **P2 VERIFIED:** Verified-email conflict checks still exclude the current user
  for profile updates and still require `verified_at IS NOT NULL`.
- **P2 VERIFIED:** Phone link remains idempotent for the same user before
  delegating cross-user conflict handling to `identityService.linkIdentityToUser`.

## Risks Checked

- **Email verification fallback:** reset/verify flows now read user email through
  the repository without changing token verification or error envelopes.
- **Pending-email resend:** lookup ordering remains latest unverified email by
  `created_at DESC LIMIT 1`.
- **Profile skip:** remains analytics-only; `buildUserProfileResponse()` still
  derives completeness from `identityService.computeProfileCompleteness()`.
- **Route cleanup:** targeted profile/contact SQL moved out of `routes/auth.js`;
  provider-data and orphan-cleanup SQL remains out of scope for later auth
  provider-linking slices.
- **Agent resource management:** no new subagents were launched because inherited
  agent sessions timed out and `close_agent` previously stalled; local bounded
  parallel commands were used instead.

## Validation

- `node --check src/database/auth-profile-repository.js`
- `node --check src/routes/auth.js`
- `git diff --check -- src/routes/auth.js src/database/auth-profile-repository.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/critical-fixes.test.js`
- `npm run lint`
- `npm test` (2,890 tests; 2,867 pass; 0 fail; 23 skipped; 451,530.863 ms)

# C1 Auth Revocation Adversarial Review

Date: 2026-06-26

Scope: C1 auth revocation gap, dev/test fallback boundary, and regressions exposed while terminating this root.

## Verdict

- P0: 0
- P1: 0
- C1 root status: terminated for backend scope

## Fixed In This Root

- Protected routes no longer accept access tokens after the backing session has been revoked.
- Protected routes no longer accept access tokens for soft-deleted users.
- Access tokens must carry a session id, and the session must belong to the token subject.
- `ALLOW_ANON_USER_ID` fallback is only honored in `development` or `test`.
- Startup now fails closed when auth fallback env vars are enabled outside `development` or `test`.
- Artwork side jobs now expose a promise handle and route shutdown waits briefly for active jobs, preventing background writes after the test DB closes.
- Enrollment completion catch path now sees profile persistence state correctly.
- Slow/live story E2E files are explicit opt-in instead of silently entering full local validation.

## External Review

Oracle review returned zero P0/P1 findings. P2/P3 findings were triaged as follows:

- Fixed: dev/test fallback trust boundary.
- Fixed: artwork job lifetime across app shutdown.
- Deferred: duplicate auth implementations (`requireUserId` vs `requireAuth`) should be collapsed in the auth root after repository boundaries are in place.
- Deferred: logout-vs-in-flight protected mutation race needs a mutation-boundary authorization strategy; current fix guarantees subsequent requests reject revoked sessions.
- Deferred: live provider coupling in local tests belongs to the provider/test-hermeticity root.

## Validation

- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js test/jobs/artwork-job.test.js test/render-endpoints.test.js test/mvp-flow.test.js`
  - 85 passed, 0 failed
- `npm run lint`
  - passed
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true npm test`
  - 2455 tests, 2432 passed, 0 failed, 23 skipped
- `git diff --check`
  - passed

## Follow-Up Roots

- Repository/server bootstrap root: centralize DB access before larger route/service splits.
- Auth root: unify auth middleware and session validation contracts.
- Provider root: remove live provider calls and fixed retry waits from normal local test paths.

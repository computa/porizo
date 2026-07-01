# Root 1 Auth Receiver Attribution Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Extended `receiver-session-repository.js` with
  `matchRecentUnmatchedSessionByIp()`.
- Replaced route-local receiver-session SQL in `routes/auth.js` for the
  heuristic post-signup same-IP receiver attribution fallback.

## Boundary

This slice intentionally does not move auth signup/social/phone orchestration,
client-IP extraction, the "unknown" IP skip guard, or error logging. It also
does not change deterministic receiver handoff attribution; this only covers
the fallback for registrations without the in-app handoff.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The 72-hour window, first/last IP match, newest
  `updated_at` ordering, and `matched_user_id IS NULL` first-writer-wins guard
  are preserved.
- **P2 IMPROVED:** The repository now performs selection and update in one SQL
  statement, reducing the race window from route-level select-then-update while
  preserving the same external behavior.

## Risks Checked

- **Attribution fuzziness:** The same NAT/IP tradeoff remains; the repository
  does not widen matching criteria.
- **Deterministic handoff boundary:** `receiver-session-service.markAppOpened`
  remains the deterministic writer; this slice only touches the fallback path.
- **Agent resource management:** no new subagents were launched because inherited
  agent sessions timed out and `close_agent` previously stalled; local bounded
  parallel commands were used instead.

## Validation

- `node --check src/database/receiver-session-repository.js`
- `node --check src/routes/auth.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/receiver-session-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/receiver-attribution.test.js`
- `npm run lint`
- `git diff --check -- src/routes/auth.js src/database/receiver-session-repository.js test/receiver-session-repository.test.js`
- `npm test` — 2,876 pass / 23 skipped / 0 fail; duration
  449,512.227166 ms.

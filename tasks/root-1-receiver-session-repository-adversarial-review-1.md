# Root 1 Receiver-Session Repository — Adversarial Review 1

## Pass-1 verdict: ZERO P0 / ZERO P1

Reviewer: parallel explorer agent, read-only.
Scope:
- `src/services/receiver-session-service.js`
- `src/database/receiver-session-repository.js`
- `test/receiver-session-service.test.js`
- `test/receiver-session.test.js`
- `test/share-flow.test.js`
- `test/sharing-security.test.js`
- `src/routes/sharing.js` receiver-session call sites

Validation reviewed as already passing:
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/receiver-session-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/receiver-session.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/share-flow.test.js test/sharing-security.test.js`
- `npm run lint`

## Findings

### P2 — Stale claim-token consume could still report success

**Status:** fixed after review.
**Type:** VERIFIED.
**Location:** `src/services/receiver-session-service.js`, `consumeReceiverClaimToken`.

Scenario: two callers can select the same unconsumed receiver-claim token before either update commits. Caller A consumes it first. Caller B's `UPDATE receiver_claim_tokens ... consumed_at IS NULL` changes zero rows, but the service previously continued to mark the session handoff resolved and returned `true`.

Impact: preserved pre-refactor behavior and route code did not trust this boolean for stream access, so not P1. Still worth hardening because Root 1 is the correct slice to isolate persistence state transitions.

Smallest fix applied:
- Check `repository.consumeReceiverClaimToken(...)` result.
- Return `false` and do not call `markHandoffResolvedIfUnset` if `changes === 0`.
- Added direct injected-repository regression coverage.

### P3 — Metadata sanitation test used a valid key

**Status:** fixed after review.
**Type:** VERIFIED.
**Location:** `test/receiver-session-service.test.js`.

Scenario: test label said "with dash" but used `invalid_key_with_dash`, which is valid under `/^[a-zA-Z0-9_]{1,48}$/`. A real dash-key sanitation regression would not be caught.

Smallest fix applied:
- Changed test metadata key to `invalid-key-with-dash`.
- Asserted it is absent while the valid `source` key remains.

### P3 — New repository/test files are untracked until included in handoff

**Status:** documented.
**Type:** VERIFIED.
**Location:** `src/database/receiver-session-repository.js`, `test/receiver-session-service.test.js`.

Scenario: applying only tracked diffs would make `receiver-session-service.js` require a missing module.

Smallest fix:
- Include both untracked files in this Root 1 slice handoff/commit.

## Vector Check

- Receiver-session secret validation, share-id binding, and timing-safe comparison remain in the service.
- The repository receives hashes, not plaintext receiver secrets or public claim tokens.
- Claim-token lookup order is preserved: `receiver_claim_tokens` first, then legacy `receiver_sessions.receiver_claim_token_hash` fallback.
- Handoff rotation preserves compare-and-set and retry semantics.
- Event-limit ordering is preserved: existing sessions update `last_event_*` before event capacity is checked.
- No SQLite/Postgres adapter compatibility P0/P1 found; repository uses the existing `prepare().get/run` adapter shape and `?` placeholders.

## Post-Fix Main-Thread Validation

- `test/receiver-session-service.test.js`: 6 pass.
- `test/receiver-session.test.js`: 22 pass, 1 skipped.
- `test/share-flow.test.js test/sharing-security.test.js`: 54 pass, 1 skipped.
- `npm run lint`: pass.

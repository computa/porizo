# Test Baseline (Phase 4)

## Critical finding: the test command silently skips ~76% of the suite

`package.json` `test` = `node --test ... test/**/*.test.js`. Under `sh` (no `globstar`),
`**` collapses to `*`, so it runs only files exactly **one** directory deep
(`test/<dir>/<file>.test.js`) — **excluding all 114 top-level `test/*.test.js` files AND
the two-level `test/writer/v3/*` files**. Result: `npm test` reports ~590 tests / 0 fail,
while the TRUE suite is **2452 tests**.

- Verified true baseline (every file via `find`, with `--test-isolation=process`):
  **2452 tests · 2390 pass · 49 fail · 7 skipped.** Isolation didn't change the count →
  failures are genuine per-file, not cross-file state leakage.

**Recommendation (design decision for user):** split hermetic unit tests from
credential-gated integration tests, then point `npm test` at the hermetic set recursively
(e.g. quoted glob `'test/**/*.test.js'` so _node_ expands it, or a `find`-based script).
Naively "fixing" the glob makes `npm test` red locally because many integration tests need
API keys/network.

## The 49 failures, categorized

| category                                 | ~count | examples                                                                                                                         | verdict                                                                                                            |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Env-gated (need LLM/network)**         | ~23    | `writer/v3/e2e-*`, `story-suggestions`, `guidance` → `fetch failed ECONNREFUSED`                                                 | NOT bugs — need live LLM endpoint/keys or mocks                                                                    |
| **Env-gated (need ASC P8 key)**          | ~4     | `app-store-connect-service` → `DECODER routines::unsupported`                                                                    | NOT bugs — no signing key in test env                                                                              |
| **Test fixture (credits not seeded)**    | ~5     | `music`, `mvp-flow`, `poems` → `402 INSUFFICIENT_*_CREDITS`                                                                      | test setup should grant credits                                                                                    |
| **Test infra (refresh/session cascade)** | ~6     | `auth-api` refresh/me/logout/sessions → "Token not found / session binding missing"                                              | test-DB/session-binding interaction; product rate-limit + binding logic are correct. Needs isolated investigation. |
| **Real product bug — FIXED**             | 1      | `auth-api` "should reject duplicate email" → 500 instead of 409                                                                  | **FIXED** (see below)                                                                                              |
| **Stale tests — FIXED**                  | 2      | verify-email token binding; REFUND song count (migration 075)                                                                    | **FIXED**                                                                                                          |
| **Other (per-cluster TBD)**              | ~8     | `security-units`, `hosting-hardening`, `sharing-security`, `story-to-track-contract`, `gifts`, `receiver-session`, `billing-api` | need individual triage; likely fixture/env                                                                         |

## Real bug found via tests + FIXED

- **Signup with a duplicate email returned 500, not 409.** The pre-check only blocks
  _verified_ email contacts (so phone-registration's unverified email doesn't block email
  signup), but `user_auth_providers` is UNIQUE on (provider, provider_user_id). A second
  email/password signup with the same address sailed past the pre-check and crashed on the
  constraint → 500. Fix: detect the unique violation (PG 23505 / SQLite 2067 / "UNIQUE
  constraint failed") in the signup catch and return 409 EMAIL_EXISTS. `auth-api` duplicate-
  email test now passes.

## Touched-file results (post-fix)

- `apple-webhook-handler.test.js`: 19/19 ✅ (was 18/19)
- `auth-identity-model.test.js`: 27/27 ✅ (was 26/27)
- `auth-api.test.js`: 15/21 (was 14) — remaining 6 = refresh/session test-infra cluster.

## Blocker for live user-story testing

The "stand up backend + live-test" phase needs real credentials (Suno, ElevenLabs, ASC P8,
LLM keys) — not present in this environment. Hermetic flows can be tested; provider-backed
flows (enrollment, render, music, ASC) cannot run end-to-end without keys.

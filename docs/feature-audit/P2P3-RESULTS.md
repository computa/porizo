# P2/P3 Robustness Backlog — Verification & Fix Results

Systematically verified all **128 P2/P3 `gaps_for_robustness`** against real code (8 parallel
domain agents → `verify-p2p3/*.md`), then **re-verified each agent "confirmed-real" finding by
reading the code directly** before touching anything. Discovery layer ran ~80% false-positive;
the agents' own "confirmed-real" subset ran ~50% false-positive on second pass.

## IMPLEMENTED (genuinely real, low-risk, worth-it) — committed

| id  | fix                                                            | value                |
| --- | -------------------------------------------------------------- | -------------------- |
| G17 | cold email suppresses recipients matching an unsubscribed user | compliance/trust     |
| D14 | rate-limit Apple/Google receipt validation (10/min/user)       | abuse/cost           |
| D10 | rate-limit subscription restore (5/5min/user)                  | enumeration defense  |
| H9  | embed player error state instead of stuck-disabled button      | UX                   |
| F2  | reject publishing a poem with no verses (400)                  | UX (no empty shares) |
| A5  | 8s timeout on social-login provider calls                      | no login hangs       |

## VERIFIED NOT-REAL (agent "confirmed-real" that failed direct re-verification)

| id  | claim                                                 | reality                                                                                                      |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| B7  | lyrics edit bypasses moderation                       | sanitized at render (runner.js:1998/3104/3437) + moderation step                                             |
| G18 | MCP endpoint burns Suno/Seed-VC credits               | `create-song` returns a deep link; no paid API                                                               |
| G13 | rate-limit-reset not superadmin-gated                 | endpoint path doesn't exist as described                                                                     |
| C17 | enrollment transcript not moderated for impersonation | misguided — embedding captures voice TIMBRE, not words; real guard is record-in-app/no-upload + risk scoring |
| B2  | no rate limit on story endpoints                      | heavily rate-limited (story_start 20/hr, story_lyrics 30/hr, …)                                              |
| F13 | cover-generator returns null silently                 | graceful degradation when sharp absent; throwing would BREAK track creation                                  |
| F1  | poem stuck "generating" on crash                      | failures set `generation_failed`; only a hard process crash strands it (edge case)                           |

## REAL but DEPRIORITIZED (with reasons — open backlog)

| id                  | issue                                                                             | why held                                                                                      |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| E1                  | share-creation DELETE+INSERT not transactional → rare concurrent 500              | low value (double-tap) + HIGH risk (share path reworked across 17 commits)                    |
| C5/C6/C10           | EL voice orphan on crash / profile stuck after stale-job sweep / no clone retry   | real but edge-case (worker-crash); moderate effort; needs careful txn ordering                |
| C1/C18              | concurrent enrollment sessions / consent revoke doesn't cancel in-flight jobs     | minor; edge-case                                                                              |
| F14                 | song OG image regenerated per request (no disk cache)                             | perf/cost; needs cache infra (cache key + invalidation)                                       |
| F4/F5/F6/F9/F17/F20 | poem OG content-hash key, blog autofill overwrite-guard, tunable thresholds, etc. | minor polish                                                                                  |
| E9/E21              | push dedup key / deferred-claim table                                             | minor / moderate                                                                              |
| A9/A21              | device-token per-token revocation / static JWKS for HS256                         | A9 needs a table+migration; A21 is a design call (404 vs RS256)                               |
| H8/H16/H23          | Android web-player Play Store path / AASA components / test mp3 in prod           | H8 covered by OneLink; H16 `paths` still valid (risky to change); H23 is a deletion (flagged) |

**Conclusion:** every genuinely-real, reasonable-risk product/UX/robustness gap surfaced by the
audit has been implemented. The remaining items are edge-case, high-risk-for-low-value, minor
polish, or design decisions — listed here so they're tracked, not lost.

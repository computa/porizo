# Verification Results — Corrected Reality

The raw discovery + first-pass "adversarial" agents over-reported. Every finding below was
re-checked by **reading the actual function top-to-bottom** (not trusting agent summaries).
Headline: the **45 "P0/P1" issues collapsed to 1 genuine bug** (now fixed) + a few minor/
product-decision items. This codebase was hardened substantially on 2026-06-18; most "critical"
findings were existing guards the survey agents didn't see.

## GENUINE bug found + FIXED ✅

| id      | sev | issue                                                                                                                                                                                                                                                               | status                                                                                                                                                                                 |
| ------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COMP-1b | P1  | `user_contacts` (user's real email+phone, plaintext) survives account deletion: it relies on `ON DELETE CASCADE`, but `deleteUserAccount` SOFT-deletes the user row so the cascade never fires — leaving authoritative PII even though `users.email` is anonymized. | **FIXED** — added `DELETE FROM user_contacts WHERE user_id=?` inside the deletion txn (auth-service.js). Tested: no new failures; identity+deletion tests green. NOT committed/pushed. |

## GENUINE but PRODUCT DECISION (not bugs — need user call)

| id     | sev | issue                                                                                                                                  | recommendation                                                                                  |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| COMP-2 | P1  | No GDPR data-export / portability endpoint (Art. 20). `logDataExportRequest()` exists but no route assembles/delivers data.            | Build `GET /account/data-export`? It's a new feature, not a regression.                         |
| BILL-5 | P2  | Apple `REFUND_REVERSED` / `REFUND_DECLINED` types are defined but not in the handler `switch` → routed to DLQ as unhandled (not lost). | Add 2 switch cases (REVERSED → re-grant idempotently, DECLINED → ack). Low risk, low frequency. |
| G2     | P2  | `POST /mcp` is unauthenticated (but rate-limited 60/min; triggers no paid API directly).                                               | Document as intentional, or add optional token.                                                 |
| SEC-8  | P2  | Password reset revokes refresh tokens but not active sessions (access tokens are short-lived 1h).                                      | Add `revokeAllSessionsExcept` — defensible either way.                                          |

## CONFIRMED FALSE POSITIVES (no action — already handled) ❌

- Audio endpoints "no auth" → gated by `web_stream_allowed` / stream_key.
- Admin RBAC "ungated" → `requireAdminRole(["superadmin"])` enforced.
- Gift-ops "SQL injection" → filter keys are hardcoded fragments, values parameterized.
- Chunk upload "unbounded" → `MAX_AUDIO_SIZE` guard.
- `/onboarding/suggest` "no rate limit" → 30/min + local template, no external LLM.
- Full-render "no credit guard" → entitlement-stamp model reuses preview spend (billing_holds removal intentional, migration 095).
- Preview "TOCTOU double-spend" → spend + guard + INSERT in one `db.transaction()`.
- "No compensation on spend→render fail" → same transaction, auto-rollback.
- Device-binding "COALESCE NULL no-op" → explicit boolean checks.
- Gift-delivery "retry runner missing" → `jobs/gift-dispatch.js` sweeps outbox (wired server.js:2988).
- Share follow-ups "no-op" → `jobs/share-followups-daily.js` registered (server.js:5480).
- `receiver_claim_tokens` "unwired" → issue/redeem/SSE routes at sharing.js:1048/1131/1266.
- Enrollment audio "7-day purge missing" → `jobs/cleanup.js` fully implements it, started at server.js:5246.
- GDPR deletion "soft-only, PII retained" → users row anonymized (email/display_name/avatar) + ~23 tables hard-deleted + auth_events scrubbed. (Only `user_contacts` was the real residual — now fixed.)
- Voice exhaustion "stuck pending_provider forever" → transitions to `STATUS.FAILED` (line 652).
- Social/phone "lockout bypass" → not brute-forceable (phone = Twilio per-code cap + 10/hr IP; social = valid provider token required).
- Apple webhook "DLQ write-only" → manual admin reprocess + `performDLQAutoReprocess` pattern exists.

## Pre-existing test failure (not mine)

- `test/auth-identity-model.test.js` → `/auth/verify-email` ("Contact must be verified after token consumption") fails with my change stashed too. Env/token issue, pre-dates this work.

# Verified Fix Plan (Phase 2 output)

Source: adversarial verification of the 16 P0 / 29 P1 discovery findings against real code.
Detail: `verify-security.md`, `verify-billing.md`, `verify-compliance.md`. Canonical tracker: `feature-tracker.csv`.

**Verification collapsed 16 "P0s" → 1 real P0.** 12 discovery findings were confirmed FALSE POSITIVES (existing guards the survey missed).

---

## Tier 1 — surgical, low blast radius, clear correct behavior (do first)

| id     | sev | issue                                                               | fix                                                                                          | blast radius                                                                                                            |
| ------ | --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SEC-7  | P1  | Social (Apple/Google) + phone OTP login skip account lockout        | Call existing `incrementFailedLoginCount` + lockout check on those failed-auth paths         | auth-service.js only; fn already exists/exported; risk = locking out legit users → mirror email-path thresholds exactly |
| SEC-8  | P2  | Password reset revokes refresh tokens but not active sessions       | Add `revokeAllSessionsExcept(null)` alongside existing refresh-token revoke in reset handler | auth.js reset path; 2nd-order: forces re-login on all devices (intended)                                                |
| BILL-5 | P2  | Apple `REFUND_REVERSED` / `REFUND_DECLINED` fall through to unknown | Add switch cases: REVERSED → re-grant; DECLINED → ack no-op                                  | apple-webhook-handler.js; idempotent re-grant guard needed                                                              |
| SEC-2  | P2  | `public/autoresearch-results.json` served unconditionally           | Move file out of `public/`; assert `ENABLE_DEBUG_ROUTES=false` in prod config                | static path only; confirm nothing reads it from public/                                                                 |

## Tier 2 — new job/cron/migration, moderate

| id              | sev | issue                                   | fix                                                                                                    | blast radius                                                                     |
| --------------- | --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| COMP-3          | P1  | Enrollment audio 7-day purge missing    | New `src/jobs/enrollment-audio-purge.js`; sweep sessions >7d, delete storage files; register in worker | storage deletion = destructive → dry-run guard + only `status=completed`/expired |
| COMP-8          | P1  | Voice-provider job exhaustion silent    | On `attempts>=max`, set profile `provider_error` + enqueue notification                                | voice-provider-profile-service.js; ensure status enum allows it                  |
| BILL-6 / COMP-7 | P2  | Webhook DLQ write-only (no auto-replay) | Scheduled sweeper mirroring `performDLQAutoReprocess` (runner.js:2321) for rows <24h                   | reuses proven pattern; cap attempts                                              |
| COMP-9          | P1  | ElevenLabs orphan voice on crash        | Write staging row before EL API call; nightly reconciliation prunes untracked voice IDs                | enrollment txn ordering; reconciliation must not delete in-flight voices         |
| COMP-10         | P2  | Circuit breaker in-memory only          | Persist to `circuit_breaker_state` table w/ TTL; load on boot                                          | new migration + provider wiring; keep in-mem as fast path                        |

## Tier 3 — higher blast radius / product decision

| id     | sev    | issue                                  | fix                                                                                                                                                            | blast radius                                                                                                                         |
| ------ | ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| COMP-1 | **P0** | GDPR deletion soft-only — PII retained | In `deleteUserAccount`: null/anonymize PII columns on `users`, `DELETE FROM user_contacts`, async storage purge of user audio; keep row for audit w/ tombstone | DESTRUCTIVE + irreversible. Needs: tx wrapping, audit-log entry, decision on anonymize-vs-delete, test coverage. DO NOT auto-deploy. |
| COMP-2 | P1     | GDPR data-export endpoint missing      | New `GET /account/data-export` assembling user data; `logDataExportRequest()` already exists                                                                   | new route; PII assembly must be auth-scoped to self                                                                                  |
| BILL-3 | P1     | Google consumable ACK missing          | Add `acknowledgePurchase(token,id,"product")` for non-sub IAPs                                                                                                 | **pre-Android-launch — defer until Android IAP ships**; no current prod impact                                                       |

---

## Implementation order

1. Tier 1 (SEC-7, SEC-8, BILL-5, SEC-2) — surgical, TDD where a test harness exists.
2. Tier 2 jobs/sweepers (COMP-3, COMP-8, BILL-6, COMP-9, COMP-10).
3. Tier 3: COMP-1 (careful, tested, flagged for review), COMP-2. Defer BILL-3 (Android not live).

**Constraint:** implement + test locally. NO commit/push/deploy without explicit user approval (esp. COMP-1 destructive purge + any migration).

---
title: "fix: Remediate all adversarial audit security vulnerabilities"
type: fix
status: active
date: 2026-03-30
deepened: 2026-03-30
reviewed: 2026-03-30
reviewers: correctness-reviewer, reliability-reviewer, api-contract-reviewer
---

# Fix: Remediate All Adversarial Audit Security Vulnerabilities

## Overview

Comprehensive security remediation for 31 vulnerabilities identified by a 5-agent adversarial audit (auth bypass, injection, race conditions, file handling, entitlement abuse). Cross-referenced with the March 2026 bug audit (112 verified bugs). Reviewed by 3 specialist agents (correctness, reliability, API contract) with 26 findings incorporated.

## Problem Frame

The Porizo platform handles personal audio content, voice data, and financial transactions. An adversarial audit revealed exploitable vulnerabilities across authentication, billing, input validation, and file handling. The most critical issues enable unlimited free resource generation and forged subscription state.

## Requirements Trace

- R1. No unauthenticated access to user content (audio, covers, metadata)
- R2. All financial operations (credit spend, subscription) must be atomic and checked before expensive work
- R3. All user input entering FFmpeg, SQL, LLM prompts, or file paths must be sanitized
- R4. All webhook endpoints must verify request origin/signature
- R5. All rate-sensitive endpoints must call `consumeRateLimit` before expensive operations
- R6. All state transitions must use WHERE guards to prevent race conditions
- R7. Risk-level enforcement must apply to all voice-related endpoints
- R8. Share tokens must resist enumeration, TOCTOU, and PIN bypass
- R9. Storage operations must validate path containment
- R10. Pre-watermark intermediate files must not persist after completion
- R11. All new security guards must emit structured log lines for monitoring

## Scope Boundaries

- **In scope**: All 31 adversarial audit findings + critical overlapping prior audit findings
- **Out of scope**: Full signed-URL migration for preview audio (H6 — documented as deferred, MVP acknowledges UUID obscurity)
- **Out of scope**: Inaudible watermark implementation (known gap, spec acknowledges "TODO")
- **Out of scope**: Full re-architecture of content-filter.js to structured LLM message roles (M1 — partial fix only)
- **Out of scope**: H2 (lyrics billing) — REMOVED per correctness review: lyrics is a preview step, not a billable event. Existing 30/hr rate limit is the appropriate control

## Already Remediated (verified in current code)

Per correctness review, these prior audit findings are already fixed:
- **AUTH-01/AUTH-02**: Missing `await` on logout/password-reset token revocation — FIXED
- **SVC-01**: `sanitizeForPrompt()` not called in poem-generator.js — FIXED (poem-generator.js:240-243 calls it on all 4 user inputs)
- **SVC-02**: Gemini API key in URL query parameter — FIXED
- **BILL-05**: Apple webhook unsigned payload acceptance — FIXED (apple-webhook-handler.js:199-205 rejects when appleValidator missing)

## Known Gaps (prior audit criticals not in this plan's scope)

These confirmed critical findings from the March 2026 audit are NOT addressed in this plan. They require separate remediation:
- **BILL-01**: Google sync never calls `updateEntitlements` for existing subscriptions
- **BILL-02/BILL-03**: `spendSong/PoemInTransaction` double-spend race (no advisory lock)
- **BILL-04**: `handleRevocation` sets `credits_balance = newBalance` instead of 0
- **BILL-06**: `buildValidationFromTxInfo` hardcodes `isRevoked: false`
- **API-01**: Story session ownership hijacking via unclaimed sessions
- **DB-04**: Race condition in `incrementTrackVersion`
- **DB-06**: Gift wallet balance can go negative

> Note: BILL-02/BILL-03 are especially concerning since Units 1 and 11 add new `spendPoem` calls that inherit these races. A follow-up plan should address these with advisory locks.

## Context & Research

### Relevant Code and Patterns

- **Auth middleware**: `requireUserId` at `src/server.js:601-642`
- **Rate limiting**: `consumeRateLimit(userId, actionKey, limit, windowSeconds)` at `src/server.js:1201-1262`
- **Billing spend**: `spendPoem(userId, poemId)` / `spendSong(userId, trackId)` via `subscription-manager.js`
- **Path containment**: `resolveStoragePath(key)` at `src/server.js:950-957` — the correct pattern
- **Transaction pattern**: `db.transaction(async (query) => { ... })` from `src/database/postgres.js:116-137`
- **Test pattern**: `node:test` + `app.inject()` with `x-user-id` header

### Institutional Learnings

From `tasks/lessons.md`:
- **Atomic financial operations**: Never read-modify-write on balances
- **PIN adversarial review**: Check lockout, success-path counter reset, rate limit layering
- **Every terminal state needs a test**: For each `spend`, test all outcomes
- **Stuck-state recovery**: Every status lock needs try/catch reset or sweeper

## Key Technical Decisions

- **Google webhook**: Shared secret verification (URL token or authorization header). Return **403** (not 503) when secret unset — 503 triggers Pub/Sub retries indefinitely. Emit startup warning.
- **FFmpeg text injection**: `textfile=` approach WITH `:expansion=none` in the drawtext filter to disable `%{expr}` evaluation. Write to dedicated `porizo-ffmpeg/` temp subdirectory with age-based sweeper.
- **Preview audio auth**: Defer full signed-URL migration. Add rate limiting as intermediate hardening.
- **Path containment**: Replicate `resolveStoragePath` pattern into `resolveLocalPath`. Must NOT defer caller audit — `putFile` will crash with `TypeError: path must be a string` if null passed to `path.resolve`.
- **Poem/story credit pattern (REVISED per reviewers)**: Use "check-then-spend" — read-only entitlement check BEFORE LLM call (gates access), spend AFTER successful generation (avoids refund complexity). Both Unit 1 and Unit 11 must use the same pattern.
- **Cover image auth**: Must include share-token query param bypass (`?share_token=X`) to preserve OG image previews in iMessage/WhatsApp/social media.
- **Login counter**: Atomic SQL `SET failed_login_count = failed_login_count + 1`
- **PIN generation**: `crypto.randomInt(100000, 1000000)` everywhere

## Open Questions

### Resolved During Planning

- **Q: Should preview endpoints require full auth?** → No. UUID obscurity + rate limiting for now; signed URLs P1.
- **Q: Should lyrics generation be billed?** → No (correctness review). Lyrics is a preview step, not a billable event. Existing 30/hr rate limit is appropriate.
- **Q: Should resolveLocalPath throw or return null?** → Return null, but all callers in local.js MUST have explicit null guards that throw descriptive errors.
- **Q: Does Apple webhook already verify JWS?** → Yes (correctness review confirmed: apple-webhook-handler.js:199-205 rejects unsigned).
- **Q: Should poem credit be spent before or after LLM?** → Check before, spend after (correctness review). Avoids refund complexity.
- **Q: Google webhook rejection on missing secret — 503 or 403?** → 403 (reliability review). 503 triggers Pub/Sub retries.
- **Q: Retry status guard — include 'blocked'?** → Yes (both reviewers). Must match the SELECT's status set: `('failed', 'dead_letter', 'blocked')`.

### Deferred to Implementation

- **Q: What is the exact Google Pub/Sub verification mechanism?** → Check if shared secret is configured.
- **Q: Should `allowDeviceTokenFallback` be disabled in production?** → Verify no production claim flows rely on it before restricting.

## Implementation Units

### Phase 1: Critical Fixes (must ship first)

- [ ] **Unit 1: Story route billing + rate limiting fixes**

  **Goal:** Close critical business logic bypasses in story routes

  **Requirements:** R2, R5

  **Dependencies:** Soft dependency on Unit 11 (must use same credit pattern)

  **Files:**
  - Modify: `src/routes/story.js`
  - Test: `test/story-api.test.js` (or create `test/story-billing.test.js`)

  **Approach:**
  - C1: Add read-only poem credit check to `POST /story/:id/to-poem` BEFORE LLM call. If check fails, return 402 without invoking LLM. Keep `spendPoem()` AFTER successful generation (check-then-spend pattern, matching Unit 11)
  - H3: Add `consumeRateLimit(userId, "track_create", 20, 60 * 60)` to `POST /story/:id/to-track`
  - H7: Add `consumeRateLimit(userId, "audio_transcribe", 10, 60 * 60)` to both `POST /v2/story/:id/audio` and `POST /v2/audio/transcribe`
  - Cross-cutting: Each new guard emits `[SecurityGuard:CreditCheck]` or `[SecurityGuard:RateLimit]` structured log

  **Patterns to follow:**
  - Rate limiting: `src/routes/tracks.js:79-84`
  - Credit check-then-spend: see Unit 11 approach

  **Test scenarios:**
  - Happy path: POST /story/:id/to-poem with credits → check passes → LLM generates → spend succeeds → poem returned
  - Error path: POST /story/:id/to-poem with 0 credits → check fails → 402 → no LLM call
  - Edge case: POST /story/:id/to-track at rate limit (21st call) returns 429
  - Edge case: POST /v2/audio/transcribe at rate limit returns 429
  - Integration: Concurrent /to-poem calls with 1 credit — only one succeeds (inherits BILL-03 race; documented in Known Gaps)

  **Verification:** All story billing tests pass. No LLM calls when credits are 0.

- [ ] **Unit 2: Google webhook authentication**

  **Goal:** Prevent forged Google Play subscription webhooks

  **Requirements:** R4, R11

  **Dependencies:** None. Deploy requires `GOOGLE_WEBHOOK_SECRET` env var provisioned first.

  **Files:**
  - Modify: `src/routes/billing.js`
  - Test: `test/billing-api.test.js`

  **Approach:**
  - Add verification at top of `POST /billing/webhooks/google`: check `?token=` query param or `authorization: Bearer` header against `GOOGLE_WEBHOOK_SECRET`
  - If `GOOGLE_WEBHOOK_SECRET` is not configured: return **403** (not 503 — 503 triggers Pub/Sub retries). Emit startup warning via `console.warn("[SecurityGuard:WebhookAuth] GOOGLE_WEBHOOK_SECRET not configured — all Google webhooks will be rejected")`
  - Apple webhook: Already verified as fixed (apple-webhook-handler.js:199-205)

  **Test scenarios:**
  - Happy path: Webhook with valid token processes notification
  - Error path: Webhook with invalid/missing token returns 401
  - Error path: Webhook when secret unset returns 403 (not 503)
  - Edge case: Empty authorization header rejected

  **Verification:** Unauthenticated POST to `/billing/webhooks/google` returns 401/403.

- [ ] **Unit 3: Storage path containment**

  **Goal:** Prevent path traversal in all storage operations

  **Requirements:** R9, R11

  **Dependencies:** None

  **Files:**
  - Modify: `src/storage/local.js`
  - Modify: `src/utils/common.js` (getVersionDir)
  - Test: `test/storage-security.test.js` (create)

  **Approach:**
  - Add containment check to `resolveLocalPath(key)` matching `resolveStoragePath` pattern: `path.resolve` + `startsWith` check. Return null on traversal.
  - **CRITICAL (per reliability review)**: Add explicit null guards to ALL callers in local.js: `putFile`, `downloadToFile`, `deleteObject`, `objectExists`, `headObject`. Each null guard must throw `new Error("[SecurityGuard:PathTraversal] Path traversal blocked: " + key)` — not silently return false.
  - **Also fix `listKeys` and `listObjects`** (per correctness review): These bypass `resolveLocalPath` and use `path.join(storageDir, prefix)` directly. Route them through `resolveLocalPath` or add the same containment check.
  - Add ID format validation to `getVersionDir` in both `common.js` and `server.js`: validate against `/^[a-zA-Z0-9._-]+$/` (include dots for test IDs per reliability review). This is defense-in-depth, not a vulnerability fix.

  **Test scenarios:**
  - Happy path: Normal key resolves correctly
  - Error path: Key with `../` throws with SecurityGuard prefix
  - Error path: Absolute path `/etc/passwd` throws
  - Error path: `listKeys` with traversal prefix blocked
  - Edge case: `putFile` with null path from traversal throws TypeError-safe error (not raw crash)
  - Edge case: getVersionDir with UUID IDs works; crafted IDs rejected

  **Verification:** All storage tests pass. Path traversal throws descriptive errors.

### Phase 2: High-Priority Fixes

- [ ] **Unit 4: FFmpeg drawtext injection fix**

  **Goal:** Prevent FFmpeg filter expression injection via user text

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `src/utils/ffmpeg.js`
  - Test: `test/ffmpeg-security.test.js` (create)

  **Approach:**
  - Replace inline `text='${safeTitle}'` with `textfile=` approach
  - Write user text to temp file in dedicated `os.tmpdir()/porizo-ffmpeg/` directory
  - **CRITICAL (per correctness review)**: Add `:expansion=none` to the drawtext filter to disable `%{expr}` evaluation. The `textfile=` option alone does NOT disable expression processing.
  - Clean up temp file in `finally` block
  - Add age-based sweeper: on each render, delete any temp files in `porizo-ffmpeg/` older than 10 minutes (prevents disk fill from crashed renders)

  **Test scenarios:**
  - Happy path: Normal title renders correctly
  - Error path: Title with `%{eif:1+1:d}` does not execute (`:expansion=none` blocks it)
  - Error path: Title with `;[v1]nullsink` does not inject filter chain
  - Edge case: Unicode title renders correctly
  - Edge case: Empty title produces valid output
  - Cleanup: Temp file deleted after success and failure

  **Verification:** FFmpeg security tests pass. Adversarial titles produce no filter injection.

- [ ] **Unit 5: Share token race condition + security fixes**

  **Goal:** Fix TOCTOU device binding, PIN-gate download tokens, harden PIN generation

  **Requirements:** R6, R8, R11

  **Dependencies:** None. iOS must handle 409 on claim (blocking dependency per reliability review — verify iOS handles this before shipping).

  **Files:**
  - Modify: `src/routes/sharing.js`
  - Modify: `src/routes/tracks.js` (PIN generation)
  - Modify: `src/server.js` (PIN generation)
  - Test: `test/sharing-security.test.js` (create or extend)

  **Approach:**
  - H4 (REVISED per correctness review): UPDATE must be `AND bound_device_id IS NULL AND status = 'unbound'` — guards both device-bind race AND status race
  - M3: Only return `dl_token` and `web_stream_url` AFTER PIN verification or device binding
  - M6: Replace `Math.floor(100000 + Math.random() * 900000)` with `crypto.randomInt(100000, 1000000)` in all locations
  - M7: Add production guard for `allowDeviceTokenFallback` — verify no production flows rely on it first
  - L6: Replace `pin !== share.claim_pin` with `crypto.timingSafeEqual` in claim handler
  - Emit `[SecurityGuard:ClaimRace]` on 409

  **Test scenarios:**
  - Happy path: Single claim binds device correctly
  - Race condition: Two concurrent claims — only first succeeds, second gets 409
  - Error path: Claim with wrong PIN does not return dl_token
  - Error path: Claim on already-claimed ('claimed' status) share returns 409
  - Edge case: Empty PIN string does not increment lockout counter
  - Happy path: PIN is 6 digits from crypto.randomInt
  - Error path: Device token fallback rejected when not test/dev

  **Verification:** Concurrent claim test demonstrates only one success.

- [ ] **Unit 6: Job retry status guard**

  **Goal:** Prevent user retry from resetting a running job

  **Requirements:** R6

  **Dependencies:** None

  **Files:**
  - Modify: `src/server.js` (retry endpoint ~line 2576)
  - Test: `test/job-retry.test.js` (create or extend)

  **Approach (REVISED per both reviewers):**
  - Add `AND status IN ('failed', 'dead_letter', 'blocked')` to the retry UPDATE — MUST include `'blocked'` to match `findLatestFailedJobForVersion`'s SELECT
  - Check `changes === 0` → return 409 Conflict

  **Test scenarios:**
  - Happy path: Retry on failed job resets to queued
  - Happy path: Retry on blocked job resets to queued
  - Error path: Retry on running job returns 409
  - Error path: Retry on completed job returns 409
  - Edge case: Retry on already-queued job returns 409

  **Verification:** Running/completed jobs cannot be reset.

### Phase 3: Medium Fixes

- [ ] **Unit 7: Enrollment risk level enforcement**

  **Goal:** Block high-risk and blocked users from voice enrollment

  **Requirements:** R7

  **Dependencies:** None

  **Files:**
  - Modify: `src/routes/enrollment.js`
  - Test: `test/enrollment-api.test.js`

  **Approach:**
  - Add `getUserRiskLevel(userId)` check to `POST /voice/enrollment/start` — this is the gate; `complete` requires a valid session from `start`, and intermediate chunk uploads are presigned-URL-gated
  - Block `risk_level === "blocked"` or `"high"` with 403 `ACCOUNT_BLOCKED`

  **Test scenarios:**
  - Happy path: Normal user can start enrollment
  - Error path: Blocked user gets 403 on enrollment/start
  - Error path: High-risk user gets 403

  **Verification:** Enrollment risk tests pass.

- [ ] **Unit 8: Login counter atomic increment**

  **Goal:** Fix read-then-write race on failed login counter

  **Requirements:** R6

  **Dependencies:** None

  **Files:**
  - Modify: `src/services/auth-service.js`
  - Test: `test/auth-service.test.js`

  **Approach:**
  - Replace read-modify-write at auth-service.js:664-685 with atomic SQL:
    `UPDATE users SET failed_login_count = failed_login_count + 1, locked_until = CASE WHEN failed_login_count + 1 >= ? THEN ? ELSE locked_until END WHERE id = ?`

  **Test scenarios:**
  - Happy path: Failed login increments counter
  - Happy path: Threshold triggers lockout
  - Edge case: Concurrent failed logins both increment
  - Happy path: Successful login resets counter

  **Verification:** Counter increments are atomic.

- [ ] **Unit 9: Content filter + moderation hardening**

  **Goal:** Strengthen prompt injection defense and impersonation detection

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `src/services/content-filter.js`
  - Modify: `src/providers/moderation.js`
  - Test: `test/moderation.test.js`

  **Approach:**
  - M1: Add newline normalization (collapse 3+ → 2, strip `\r`). Add Unicode NFKC normalization before injection pattern matching
  - M10: Expand impersonation detection — run `normalizeText` before pattern matching, add semantic patterns
  - SVC-01: Already verified as fixed (poem-generator.js:240-243) — no action needed

  **Test scenarios:**
  - Happy path: Normal text passes unchanged
  - Error path: `\n\n\nSYSTEM NOTE:` collapsed
  - Error path: Unicode "v0ice 0f Taylor" detected after NFKC
  - Error path: "exactly how Taylor would sing" detected
  - Edge case: "voice of reason" (legitimate) — assess false positive risk

  **Verification:** Moderation tests pass with adversarial cases.

- [ ] **Unit 10: Upload validation + intermediate file cleanup**

  **Goal:** Validate uploaded audio format; clean up pre-watermark files

  **Requirements:** R3, R10

  **Dependencies:** None

  **Files:**
  - Modify: `src/routes/enrollment.js`
  - Modify: `src/workflows/runner.js`
  - Test: `test/enrollment-api.test.js`, `test/watermark.test.js`

  **Approach:**
  - M8: Check magic bytes — WAV: bytes 0-3 = `RIFF` + bytes 8-11 = `WAVE`; MP3: `ID3` or `0xFF 0xFB`; M4A: **bytes 4-7** = `ftyp` (NOT bytes 0-3 — per correctness review). Reject non-audio with 415
  - M9: After watermark step succeeds, delete `mix.wav`. On watermark failure, preserve for retry. Cleanup in `finally` with success check

  **Test scenarios:**
  - Happy path: Valid WAV accepted
  - Error path: PNG rejected with 415
  - Edge case: M4A correctly detected via offset-4 ftyp check
  - Happy path: mix.wav deleted after watermark success
  - Error path: mix.wav preserved on watermark failure

  **Verification:** Upload validation and cleanup tests pass.

- [ ] **Unit 11: Poem credit ordering fix**

  **Goal:** Gate poem generation behind credit check; spend after success

  **Requirements:** R2

  **Dependencies:** Unit 1 must use the same pattern (soft dependency)

  **Files:**
  - Modify: `src/routes/poems.js`
  - Test: `test/poems-api.test.js`

  **Approach (REVISED per correctness review — "check-then-spend" not "spend-then-refund"):**
  - Add read-only entitlement check (`poems_remaining > 0`) BEFORE `generatePoem()` call. If check fails, return 402 immediately — no LLM cost
  - Keep `spendPoem()` AFTER successful generation (existing location). The atomic `WHERE poems_remaining > 0` guard in spendPoem handles the concurrent case
  - This avoids all refund/idempotency complexity. The pre-check is a fast gate; the post-spend is the atomic deduction

  **Test scenarios:**
  - Happy path: Poem with credits → check passes → LLM generates → spend → returned
  - Error path: 0 credits → check fails → 402 → no LLM call
  - Error path: Check passes → LLM fails → no spend → poem marked generation_failed → retryable
  - Edge case: Concurrent generate with 1 credit — both pass check, one spend succeeds, other gets insufficient

  **Verification:** No LLM calls when credits are 0.

- [ ] **Unit 12: Cover auth + admin SQL + CORS + misc low-severity fixes**

  **Goal:** Close remaining findings with share-link-safe cover auth

  **Requirements:** R1, R3, R5, R11

  **Dependencies:** None

  **Files:**
  - Modify: `src/server.js`
  - Modify: `src/services/admin-service.js`
  - Modify: `src/routes/billing.js`
  - Test: Various existing test files

  **Approach:**
  - M4 (REVISED per API contract review): Add auth to `GET /cover/:trackVersionId/:size` BUT include share-token bypass: if `?share_token=X` query param matches a valid share token for this track, allow unauthenticated access. This preserves OG image previews in iMessage/WhatsApp/social. Without this bypass, all share link previews lose cover art.
  - M13: Admin SQL allowlist already has double defense (correctness review confirmed). Consolidate into single authoritative check — `const UPDATABLE_COLUMNS = new Set(allowedFields)` and check at SQL construction. Frame as consolidation, not gap fix.
  - L3: Gate `GET /health/providers` behind admin session
  - L7: CORS defaults — startup warning if `CORS_ORIGIN` unset in production
  - L8: Add `consumeRateLimit(userId, "trial_activate", 3, 60 * 60)` to trial activation

  **Test scenarios:**
  - Happy path: Cover with valid auth returns image
  - Happy path: Cover with valid share_token (no auth) returns image
  - Error path: Cover without auth or share_token returns 401
  - Error path: Health/providers without admin session returns 401
  - Happy path: Admin update with allowed column succeeds
  - Error path: Admin update with disallowed column rejected

  **Verification:** Cover auth preserves share link OG previews. Admin, health tests pass.

## Cross-Cutting: Security Guard Monitoring (R11)

Every new security guard must emit a structured log line for production observability:

| Guard | Log Prefix | Fires When |
|-------|-----------|------------|
| Path traversal | `[SecurityGuard:PathTraversal]` | resolveLocalPath blocks a key |
| Webhook auth | `[SecurityGuard:WebhookAuth]` | Google webhook rejected |
| Credit check | `[SecurityGuard:CreditCheck]` | Pre-LLM credit gate blocks request |
| Claim race | `[SecurityGuard:ClaimRace]` | Concurrent claim rejected (409) |
| Impersonation | `[SecurityGuard:Impersonation]` | Impersonation pattern detected |
| Rate limit | `[SecurityGuard:RateLimit]` | New rate limits fire (track_create, audio_transcribe) |

These enable dashboard filtering and false-positive monitoring post-deploy.

## System-Wide Impact

- **Interaction graph**: Story routes now check poem credits via subscription-manager. Sharing routes get stricter state guards. Cover images get auth with share-token bypass.
- **Error propagation**: New 401/402/403/409/415 responses. iOS client MUST handle: 402 (to-poem/poems), 409 (claim race, retry), 403 (enrollment risk). Per API contract review: 17 endpoint changes, 8 breaking.
- **State lifecycle**: Share claim is now atomic. Job retry has status guard. Both are behavioral changes.
- **API surface parity**: Cover image auth must include share-token bypass to preserve OG previews.
- **Rate limit blast radius**: Rate limiting fails-closed on DB errors. Each new rate-limited endpoint increases blast radius. Consider fail-open for non-security-critical endpoints (transcribe) in future.

## Risks & Dependencies

- **iOS client (BLOCKING for Unit 5)**: 409 on claim race requires iOS handling before ship. Other new error codes (402, 403) should be handled but are less critical (users see generic error)
- **Google webhook secret (BLOCKING for Unit 2)**: `GOOGLE_WEBHOOK_SECRET` must be provisioned + Google Play Console URL updated BEFORE deploy
- **Cover image OG previews (BLOCKING for Unit 12)**: Share-token bypass is MANDATORY. Without it, all share link previews on iMessage/WhatsApp/social lose cover art
- **FFmpeg temp files**: Dedicated porizo-ffmpeg/ directory with age-based sweeper prevents disk fill
- **Content filter false positives**: Monitor `[SecurityGuard:Impersonation]` log rate after deploy
- **BILL-02/03 inheritance**: Units 1 and 11 add spendPoem calls that inherit the known double-spend race. Documented in Known Gaps — requires advisory lock follow-up

## Sources & References

- Prior audit: `docs/reports/bug-audit-2026-03-06.md` (112 verified bugs)
- Lessons: `tasks/lessons.md` (atomic operations, PIN review, terminal state tests)
- Patterns: `src/server.js:950-957` (resolveStoragePath), `src/routes/tracks.js:79-128` (rate limit + risk level)
- Correctness review: 15 findings (2 blocker, 6 important, 7 minor)
- Reliability review: 11 findings (2 high, 4 medium, 3 low)
- API contract review: 17 endpoint changes mapped, 8 breaking, deploy requirements documented

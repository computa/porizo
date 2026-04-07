---
title: "fix: Remediate 7 CSO onboarding security findings"
type: fix
status: active
date: 2026-04-07
---

# Fix: Remediate 7 CSO Onboarding Security Findings

## Overview

Implement all 7 security fixes from the April 7 CSO audit of the app onboarding sequence. 4 HIGH, 3 MEDIUM severity. No critical findings. All fixes are safe, non-breaking changes to existing auth routes.

## Problem Frame

The CSO audit found 7 gaps in the onboarding/auth flow: a missing schema validation, open CORS, plaintext phone storage (documentation only), in-memory rate limiting that resets on restart, an unrate-limited enumeration endpoint, auto-linking without confirmation, and a registration token not bound to IP.

## Requirements Trace

- R1. All mutation endpoints must have Fastify JSON Schema validation
- R2. CORS must be restricted to known origins in production
- R3. Auth rate limiting must survive process restarts
- R4. Unauthenticated endpoints that reveal user existence must be rate-limited
- R5. Account linking via social auth must require explicit user confirmation
- R6. Registration tokens must be bound to the originating IP
- R7. Phone plaintext storage risk must be documented for future sprint

## Scope Boundaries

- **In scope**: All 7 CSO findings
- **Out of scope**: Phone number encryption at rest (requires migration + key management, deferred to roadmap)
- **Out of scope**: iOS client changes for social auto-link confirmation (server returns signal, client adapts later)

## Context & Research

### Relevant Code and Patterns

- `src/routes/auth.js:307-433` — existing Fastify schema patterns to follow
- `src/server.js:1229-1290` — existing DB-backed `consumeRateLimit()` with sliding window (reuse for auth)
- `migrations/001_init.sql` — `rate_limits` table with PK `(user_id, action_type, window_start_ms)`. user_id is used as a general key, not strictly a user ID
- `test/auth-api.test.js` — node:test framework, Fastify inject pattern, `clearRateLimits()` for test isolation
- `src/routes/auth.js:169-190` — in-memory `isRateLimited()` that all auth endpoints currently use

### Institutional Learnings

- Prior security audit (March 30, 31 findings) is `status: completed`. Our 7 findings are non-overlapping.
- `consumeRateLimit()` uses atomic increment-then-check pattern. Safe to reuse for IP-keyed auth rate limiting.
- The `rate_limits.user_id` column is already used generically (e.g., `userId` can be an IP address or composite key).

## Key Technical Decisions

- **Reuse `consumeRateLimit()` for auth rate limiting** instead of creating a new table. The existing `rate_limits` table and sliding-window function already handle the hard parts (atomic increment, TOCTOU prevention, weighted window). The `user_id` column can hold IP addresses or composite keys like `phone-send:+1234567890`. This avoids a new migration for a new table.
- **Social auto-link: server returns `requires_link_confirmation` flag** instead of silently linking. The iOS client can show a prompt. This is a behavior change but strictly more conservative (users who relied on auto-link now need to confirm).
- **Phone plaintext: document only**. Encryption at rest requires a migration, key management, and query pattern redesign. Not appropriate for a quick security fix pass.

## Open Questions

### Resolved During Planning

- **Can `consumeRateLimit()` handle IP-based keys?** Yes. The `user_id` column is TEXT and is already used as a generic key. Passing `ip:${clientIp}` works without schema changes.
- **Will switching auth rate limiting to DB break tests?** Tests already call `clearRateLimits()` to reset the in-memory Map. We'll keep the in-memory limiter as a fast-path cache and add DB persistence behind it. For the test environment, the in-memory limiter is sufficient.

### Deferred to Implementation

- **Exact wording of `requires_link_confirmation` response** — the implementer should match the existing response shape patterns in auth.js

## Implementation Units

- [ ] **Unit 1: Add schema to PATCH /auth/profile**

**Goal:** Close the only schema-less mutation endpoint in auth.js

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `src/routes/auth.js`
- Test: `test/auth-api.test.js`

**Approach:**
- Define `profileUpdateSchema` near line 425 (after `usernameAvailableSchema`), matching the existing inline schema pattern
- Properties: `contact_email` (string, format: email, maxLength: 255), `display_name` (string, maxLength: 100)
- `additionalProperties: false` to reject unexpected fields
- Add `schema: profileUpdateSchema` to the route at line 1177

**Patterns to follow:**
- `signupSchema` at line 309 for the inline object pattern
- `loginSchema` at line 323 for minimal body schema

**Test scenarios:**
- Happy path: PATCH with valid `contact_email` returns 200
- Happy path: PATCH with valid `display_name` returns 200
- Error path: PATCH with unknown field `is_admin: true` returns 400 (schema rejection)
- Error path: PATCH with `contact_email` exceeding 255 chars returns 400
- Edge case: PATCH with empty body returns 400 (existing handler checks)

**Verification:** `npm test` passes. Manually sending extra fields to PATCH /auth/profile returns 400.

---

- [ ] **Unit 2: Rate limit username availability check**

**Goal:** Prevent bulk username enumeration on the unauthenticated endpoint

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `src/routes/auth.js`
- Test: `test/auth-api.test.js`

**Approach:**
- Add `isRateLimited(`username-check:${getClientIp(request)}`, 30, 60 * 1000)` at the top of the `/users/username/available` handler
- 30 requests per minute per IP is generous for legitimate use, blocks scraping

**Patterns to follow:**
- Existing `isRateLimited()` calls throughout auth.js (e.g., line 443 for signup)

**Test scenarios:**
- Happy path: Username check returns `available: true` or `available: false`
- Error path: 31st request within 1 minute returns 429

**Verification:** `npm test` passes. Rate limit is applied.

---

- [ ] **Unit 3: CORS strict mode in production**

**Goal:** Fail hard when CORS_ORIGIN is unset in production instead of silently allowing all origins

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `src/server.js`

**Approach:**
- Replace the `console.warn` at line 308 with `throw new Error("CORS_ORIGIN must be set in production. ...")` 
- Change fallback from `true` (reflect all) to `false` (deny all) as defense-in-depth
- Keep current behavior for `NODE_ENV !== "production"` (allow all for dev/test)

**Patterns to follow:**
- The `getJwtSecret()` pattern in `src/services/auth-service.js:14-33` that throws in production when unconfigured

**Test scenarios:**
- Test expectation: none — CORS config is environment-specific. Verify manually that dev still works and that setting CORS_ORIGIN in production restricts origins.

**Verification:** Server starts normally in dev. In production (or simulated), missing CORS_ORIGIN throws at startup.

---

- [ ] **Unit 4: IP-bind registration tokens**

**Goal:** Registration tokens can only be consumed from the same IP that created them

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `src/routes/auth.js`
- Test: `test/auth-api.test.js`

**Approach:**
- Add `ipAddress` parameter to `consumeRegistrationToken(db, token, phoneNumber, ipAddress)`
- Add `AND (ip_address = ? OR ip_address IS NULL)` to the WHERE clause in the UPDATE statement
- The `OR ip_address IS NULL` handles any tokens created before this change (graceful rollout)
- Update the caller at `POST /auth/phone/register` (line 1501) to pass `clientIp`

**Patterns to follow:**
- The existing `createRegistrationToken` already stores `ipAddress || null` at creation time (line 71)

**Test scenarios:**
- Happy path: Token consumed from same IP succeeds
- Error path: Token consumed from different IP returns invalid
- Edge case: Token with NULL ip_address (legacy) consumed from any IP succeeds

**Verification:** `npm test` passes. Registration token from one IP cannot be used from another.

---

- [ ] **Unit 5: Social auth auto-link requires confirmation**

**Goal:** Prevent silent account takeover via email-based auto-linking in social auth

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `src/routes/auth.js`
- Test: `test/auth-api.test.js`

**Approach:**
- In the social auth handler at line 798-806, when an email match is found, check for `request.body.confirm_link` flag
- If no `confirm_link`, return 200 with `{ requires_link_confirmation: true, existing_account_email: maskedEmail }` instead of silently linking
- If `confirm_link: true`, proceed with existing auto-link logic
- Add `confirm_link: { type: "boolean" }` to `socialAuthSchema` properties
- Mask the email for privacy: show first 2 chars + `***@domain.com`

**Patterns to follow:**
- The `maskedPhoneDisplay` pattern used elsewhere for privacy-safe display
- The existing `autoLinked` tracking at line 871

**Test scenarios:**
- Happy path: Social auth with new email creates new account (no change)
- Happy path: Social auth with matching email AND `confirm_link: true` auto-links (existing behavior preserved)
- Error path: Social auth with matching email WITHOUT `confirm_link` returns `requires_link_confirmation: true` with masked email
- Edge case: Social auth where provider email is not verified (email_verified=0) does not trigger auto-link prompt

**Verification:** `npm test` passes. Social auth with a matching email now returns confirmation prompt unless `confirm_link: true` is sent.

---

- [ ] **Unit 6: DB-backed auth rate limiting**

**Goal:** Auth rate limits survive process restarts and work across instances

**Requirements:** R3

**Dependencies:** None (reuses existing `rate_limits` table and `consumeRateLimit()`)

**Files:**
- Modify: `src/routes/auth.js`
- Test: `test/auth-api.test.js`

**Approach:**
- Import or receive `consumeRateLimit` from the server context (it's defined inside `registerRoutes`, so it needs to be passed to `registerAuthRoutes` or extracted)
- Actually, simpler: create a `consumeAuthRateLimit(db, key, limit, windowSeconds)` function directly in auth.js that uses the same `rate_limits` table with the same atomic pattern
- Replace `isRateLimited()` calls with `consumeAuthRateLimit()` calls at each auth endpoint
- Keep `isRateLimited()` as a first-pass in-memory check for performance (avoid DB round-trip when clearly under limit), with DB as authoritative store
- The `user_id` column accepts arbitrary TEXT — use composite keys like `signup:${ip}`, `login:${ip}:${email}`, `phone-send:${ip}`
- Update `clearRateLimits()` to also clear DB entries in test mode

**Patterns to follow:**
- `consumeRateLimit()` in `src/server.js:1229-1290` for the atomic sliding-window pattern
- The existing `rate_limits` table schema from `migrations/001_init.sql`

**Test scenarios:**
- Happy path: Rate limit blocks after exceeding threshold (same as before)
- Integration: Rate limit persists if in-memory state is cleared (simulating restart)
- Edge case: DB failure falls back gracefully (returns rate-limited, not crash)

**Verification:** `npm test` passes. Rate limits survive `clearRateLimits()` call (DB layer persists).

---

- [ ] **Unit 7: Document phone plaintext storage risk**

**Goal:** Mark phone number plaintext storage as a known security debt item

**Requirements:** R7

**Dependencies:** None

**Files:**
- Modify: `src/routes/auth.js`

**Approach:**
- Add `// SECURITY TODO: Phone numbers stored in plaintext. See CSO audit 2026-04-07 Finding #3.` comments at lines 1310 and 1521 where phone numbers are written to the users table
- Add similar comment at `findUserByPhone` (line 136)

**Test scenarios:**
- Test expectation: none — documentation-only change

**Verification:** Comments are present. No behavioral change.

## System-Wide Impact

- **Rate limiting**: Switching to DB-backed changes the failure mode from "silently reset on restart" to "DB-backed durability". If DB is down, the fallback returns rate-limited (deny by default), which is safer than allowing unlimited attempts.
- **Social auto-link**: Existing users who sign up with Apple/Google and have matching emails will now see a confirmation prompt instead of auto-linking. This is a behavior change the iOS client should handle gracefully (treat `requires_link_confirmation` as a known response type).
- **CORS**: If Railway doesn't have `CORS_ORIGIN` set, the server will fail to start. Verify the env var exists before deploying.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| CORS throw breaks production startup | Verify CORS_ORIGIN is set on Railway before deploying |
| DB rate limiting adds latency to auth endpoints | In-memory first-pass check avoids DB for most requests |
| Social auto-link change breaks iOS flow | iOS should handle `requires_link_confirmation` response; if not, users can still sign in normally (just creates new account instead of linking) |
| Registration token IP check blocks users behind dynamic NAT | `OR ip_address IS NULL` fallback + 15-minute expiry makes this unlikely |

---
title: "feat: Cross-identifier deduplication for onboarding"
type: feat
status: active
date: 2026-04-07
---

# Feat: Cross-Identifier Deduplication for Onboarding

## Overview

Every registration path currently only checks its own identifier type. Email signup checks email. Phone signup checks phone. Social auth checks provider ID + email. This creates duplicate accounts when the same person registers via different methods. This plan adds cross-identifier lookup so all three identifier types (email, Apple/Google ID, phone) are checked before any new account is created.

## Problem Frame

A user signs up with Apple Sign-In (email: alice@gmail.com). Later they try phone auth with their real number. The system creates a second account because phone registration never checks email. Now they have two accounts, two credit balances, two voice profiles. The same happens in reverse — phone-first users who later do Apple Sign-In get a second account.

The `AccountCheckView` on iOS asks "Do you already have an account?" but this relies on the user knowing they should say yes. The server should catch duplicates regardless.

## Requirements Trace

- R1. All registration paths must check email, phone, AND social provider IDs before creating a new account
- R2. When a cross-identifier match is found, return `account_exists` with the existing account's auth methods so the user can sign in via the existing method and link
- R3. User can login to the same account using any linked identifier (email, phone, Apple/Google)
- R4. No silent auto-merging — user must prove ownership of the existing account before linking

## Scope Boundaries

- **In scope**: Server-side cross-identifier lookup on all 3 registration paths + iOS client handling of `account_exists` response
- **Out of scope**: Account merging tool (admin-initiated merge of two existing accounts)
- **Out of scope**: Retroactive dedup of existing duplicate accounts in production
- **Out of scope**: Facebook auth (low usage, same pattern as Google — can be added later)

## Context & Research

### Relevant Code and Patterns

- `src/routes/auth.js:findUserByPhone()` — existing cross-table phone lookup (user_auth_providers + legacy users.phone_number)
- `src/routes/auth.js:541` — email signup dedup: `SELECT id FROM users WHERE email = ?`
- `src/routes/auth.js:832` — social auth dedup: `SELECT user_id FROM user_auth_providers WHERE provider = ? AND provider_user_id = ?`
- `src/routes/auth.js:891` — social auto-link by email (now requires `confirm_link`)
- `src/routes/auth.js:1542` — phone verify dedup: `findUserByPhone()`
- `PorizoApp/PorizoApp/AccountCheckView.swift` — iOS "Do you have an account?" UI (already exists)
- `PorizoApp/PorizoApp/PhoneAuthState.swift` — state machine: idle → phoneEntry → phoneVerification → accountCheck
- `PorizoApp/PorizoApp/ProfileCompletionView.swift:418` — handles EMAIL_EXISTS (409) response already

### Institutional Learnings

- Prior security audit (March 2026) established atomic state transitions and WHERE guards as the pattern for preventing race conditions
- Social auto-link was just changed (this session) to require `confirm_link` flag — the `account_exists` response follows the same pattern

## Key Technical Decisions

- **Server returns `account_exists` with auth methods, not auto-merges**: The user must sign in via their existing method to prove ownership, then linking happens automatically. This avoids the security risk of merging accounts without proof of identity on both sides.
- **New helper `findExistingAccountByIdentifiers()`**: A single function that checks all three identifier types in one query batch. Used by all registration paths. Centralizes the cross-identifier logic instead of scattering checks across each handler.
- **Response shape**: `{ account_exists: true, auth_methods: ["apple", "email"], masked_email: "al***@gmail.com", masked_phone: "+1***4567" }` — gives the iOS client enough to show "Sign in with Apple to access your account" without revealing the full identifiers.
- **Phone registration is the primary gap to close**: It currently creates accounts with zero cross-checks beyond phone. Email signup already blocks on `users.email` (which catches social signups that set email). Social auth already checks email via auto-link. Phone is the blind spot.

## Open Questions

### Resolved During Planning

- **UX for cross-match**: Return `account_exists` with auth methods. User signs in via existing method, phone auto-links post-login. (User chose this approach.)
- **Does email signup need phone cross-check?**: No. Email signup doesn't collect phone, so there's nothing to cross-check. The phone linking happens later via ProfileCompletionView.
- **Does social auth need phone cross-check?**: Yes, but only when the social provider doesn't return an email (rare). When it returns an email, the existing email cross-check catches it. When it doesn't (Apple private relay, no email), the social user has no identifier to cross-check against phone users.

### Deferred to Implementation

- **Exact query shape for `findExistingAccountByIdentifiers()`**: May be a single JOIN or multiple queries depending on what performs better with the existing indexes.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
Registration Request (any path)
        │
        ▼
┌─────────────────────────────┐
│ findExistingAccountByIdent  │  ← NEW: checks email + phone + provider
│  ifiers(email, phone, provId)│     across users + user_auth_providers
└─────────────┬───────────────┘
              │
     ┌────────┴────────┐
     │                 │
  match found     no match
     │                 │
     ▼                 ▼
  Return            Proceed with
  account_exists    registration
  + auth_methods    (existing flow)
  + masked IDs
```

## Implementation Units

- [ ] **Unit 1: Add `findExistingAccountByIdentifiers()` helper**

**Goal:** Centralized cross-identifier lookup that checks all three identifier types

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `src/routes/auth.js`
- Test: `test/auth-api.test.js`

**Approach:**
- Place the function near `findUserByPhone()` (they're the same family of lookup functions)
- Accept `{ email, phone, providerType, providerUserId }` — all optional
- For each non-null identifier, query the relevant table:
  - email → `SELECT id, phone_number FROM users WHERE email = ? AND deleted_at IS NULL`
  - phone → `findUserByPhone()` (reuse existing function)
  - provider → `SELECT user_id FROM user_auth_providers WHERE provider = ? AND provider_user_id = ?`
- When a match is found, fetch the user's linked auth methods: `SELECT provider FROM user_auth_providers WHERE user_id = ?`
- Return `{ exists: true, userId, authMethods: ['apple','phone'], maskedEmail, maskedPhone }` or `{ exists: false }`
- Mask email: first 2 chars + `***@domain`. Mask phone: country code + `***` + last 4.

**Patterns to follow:**
- `findUserByPhone()` at `src/routes/auth.js:148` for the multi-table lookup pattern
- `maskPhoneNumber` in `src/services/sms-service.js:92` for phone masking

**Test scenarios:**
- Happy path: No identifiers match → returns `{ exists: false }`
- Happy path: Email matches existing user → returns user with auth methods
- Happy path: Phone matches existing user → returns user with auth methods
- Happy path: Provider ID matches existing user → returns user with auth methods
- Edge case: Email matches a soft-deleted user → returns `{ exists: false }`
- Edge case: Multiple identifiers provided, one matches → returns the match
- Edge case: All identifiers null → returns `{ exists: false }`
- Integration: Returned `authMethods` array correctly reflects all providers linked to the matched user

**Verification:** Helper returns correct results for all identifier types. Masked values don't reveal full identifiers.

---

- [ ] **Unit 2: Add cross-identifier check to phone registration**

**Goal:** Phone registration checks email and social providers before creating a new account

**Requirements:** R1, R2

**Dependencies:** Unit 1

**Files:**
- Modify: `src/routes/auth.js` (phone register handler)
- Test: `test/auth-api.test.js`

**Approach:**
- In `POST /auth/phone/register`, after `consumeRegistrationToken` succeeds but before creating the user, call `findExistingAccountByIdentifiers({ phone: phoneNumber })`
- The existing `findUserByPhone` check already catches phone-only duplicates. The new check catches cross-identifier duplicates (e.g., a user who registered via Apple and has the same phone in `users.phone_number` via profile completion)
- When match found, return: `{ account_exists: true, auth_methods: [...], masked_email: "...", masked_phone: "..." }`
- Use HTTP 200 (not 409) — this is informational, not an error. The client should show a "sign in to link" flow.
- NOTE: The phone number was just verified via OTP. The registration token is consumed. If the user follows through and signs in via their existing method, the phone should auto-link. Store the verified phone temporarily so the link can happen after sign-in.

**Patterns to follow:**
- The `requires_link_confirmation` response pattern we just added to social auth

**Test scenarios:**
- Happy path: Phone not linked to any account → registration proceeds normally (existing behavior)
- Happy path: Phone matches existing user via `user_auth_providers` → returns `account_exists` with auth methods
- Error path: Phone matches a different user's email account (cross-identifier) → returns `account_exists`
- Edge case: Phone matches soft-deleted account → registration proceeds (no match)
- Integration: `account_exists` response includes correct masked identifiers and auth methods list

**Verification:** Phone registration no longer creates duplicate accounts when the phone is associated with an existing user through any identifier.

---

- [ ] **Unit 3: Add cross-identifier check to social auth (new user path)**

**Goal:** Social auth checks phone before creating a new account

**Requirements:** R1, R2

**Dependencies:** Unit 1

**Files:**
- Modify: `src/routes/auth.js` (social auth handler, new-user branch)
- Test: `test/auth-api.test.js`

**Approach:**
- In the social auth handler's "new user" branch (after checking `existingProvider` and email auto-link), before creating the user, call `findExistingAccountByIdentifiers({ email: userEmail })` — but we already check email via the auto-link flow. The gap is: if the email doesn't match but the user has a phone linked to another account
- Actually, social auth has NO phone number to check. The social provider (Apple/Google) doesn't return a phone. So the cross-check here is limited to: email cross-checks (already handled by auto-link) and provider ID (already handled)
- The real value is: if a phone-only user later does Apple Sign-In and Apple returns their email, and that email matches the phone user's profile completion email → the auto-link (with `confirm_link`) handles this
- **Decision**: Social auth's cross-check is already sufficient via the email auto-link path. No additional phone cross-check is possible because social providers don't give us a phone number. Mark this unit as "verified sufficient" rather than adding dead code.

**Test scenarios:**
- Happy path: Social auth with email matching phone-only user's profile email → `requires_link_confirmation` (already implemented)
- Edge case: Social auth with Apple private relay (no real email) → creates new account (no cross-check possible)

**Verification:** Confirm existing auto-link + `confirm_link` covers the social→email cross-identifier case. Document that social→phone cross-check is not possible without the phone number from the provider.

---

- [ ] **Unit 4: iOS client handles `account_exists` response**

**Goal:** iOS app shows "sign in to link" flow when server returns `account_exists`

**Requirements:** R2, R4

**Dependencies:** Unit 2

**Files:**
- Modify: `PorizoApp/PorizoApp/AuthManager.swift`
- Modify: `PorizoApp/PorizoApp/PhoneAuthState.swift`
- Modify: `PorizoApp/PorizoApp/Models/AuthModels.swift`
- Create: `PorizoApp/PorizoApp/AccountExistsView.swift`

**Approach:**
- Add new state to `PhoneAuthState`: `case accountExists(authMethods: [String], maskedEmail: String?, maskedPhone: String?)`
- In `AuthManager`, when phone register returns `account_exists`, transition to this state
- New `AccountExistsView` shows: "An account with this phone already exists. Sign in with [Apple/Email] to link your phone."
  - Show available auth methods as buttons (Apple Sign-In, Email login)
  - After successful sign-in via existing method, auto-call `POST /auth/phone/link` to link the verified phone
- This replaces the current `AccountCheckView` flow for the cross-identifier case
- Add `VerifyPhoneCodeResponse.accountExists` field and `AccountExistsInfo` model

**Patterns to follow:**
- `AccountCheckView.swift` for the existing "do you have an account?" pattern
- `PhoneAuthState` state machine for state transitions
- `VerifyPhoneCodeResponse` in `AuthModels.swift` for response model pattern

**Test scenarios:**
- Happy path: Server returns `account_exists` with `["apple"]` → view shows Apple Sign-In button
- Happy path: User taps Apple Sign-In → signs in → phone auto-links → proceeds to main app
- Error path: User cancels sign-in → returns to auth screen
- Edge case: Server returns `account_exists` with `["email"]` → view shows email login option
- Edge case: Server returns `account_exists` with `["apple", "email"]` → view shows both options

**Verification:** Full flow works end-to-end: phone verify → account_exists → sign in with existing method → phone linked → user lands in main app with all identifiers linked.

---

- [ ] **Unit 5: Auto-link phone after cross-identifier sign-in**

**Goal:** After user signs in via existing method (prompted by `account_exists`), automatically link the verified phone

**Requirements:** R3, R4

**Dependencies:** Unit 4

**Files:**
- Modify: `src/routes/auth.js` (social auth + login handlers)
- Modify: `PorizoApp/PorizoApp/AuthManager.swift`
- Test: `test/auth-api.test.js`

**Approach:**
- iOS client passes `pending_phone_link: "+1234567890"` in the login/social auth request body after being prompted by `account_exists`
- Server-side: after successful login, if `pending_phone_link` is present, verify the phone was recently verified (check `phone_verifications` table for a recent verified_at for this phone within 15 minutes) and auto-link via the same logic as `POST /auth/phone/link` (without requiring a new OTP)
- This is safe because: (1) the phone was just verified via OTP in the previous step, (2) the user proved ownership of the existing account by signing in, (3) the 15-minute window prevents stale phone claims
- Add `pending_phone_link` to `loginSchema` and `socialAuthSchema` (optional string, E.164 pattern)

**Patterns to follow:**
- `POST /auth/phone/link` handler for the phone linking logic (reuse the same transaction pattern)
- The existing `phone_verifications` table for checking recent verification

**Test scenarios:**
- Happy path: Login with `pending_phone_link` → phone verified within 15 min → phone auto-linked → response includes updated profile
- Error path: Login with `pending_phone_link` but no recent verification → phone NOT linked, login still succeeds (no error, just skip linking)
- Error path: Login with `pending_phone_link` but phone already linked to another user → phone NOT linked, login still succeeds
- Edge case: Social auth with `pending_phone_link` → same behavior as login
- Integration: After auto-link, `GET /auth/me` shows `phone_number` and `providers` includes "phone"

**Verification:** Full round-trip: phone verified → account_exists → sign in → phone auto-links → user has all identifiers on one account.

## System-Wide Impact

- **API surface**: New optional fields in login/social auth responses (`account_exists`, `auth_methods`). New optional field in login/social auth requests (`pending_phone_link`). All additive, no breaking changes.
- **iOS client**: New `AccountExistsView` and state in `PhoneAuthState`. Existing `AccountCheckView` still works for the "I know I have an account" flow.
- **Error propagation**: `account_exists` is a 200 response, not an error. The client handles it as a flow redirect, not a failure.
- **State lifecycle**: Verified phone stored in `phone_verifications` table with 15-minute window. If user abandons the flow, the phone claim expires naturally. No orphaned state.
- **Unchanged invariants**: Email signup, email login, social auth for existing users, and direct phone login (existing phone user) are all unchanged. This only affects NEW registration when a cross-identifier match is found.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Phone verification expires before user completes sign-in flow | 15-minute window is generous. If expired, user re-verifies phone (graceful degradation). |
| Race condition: two users try to link same phone simultaneously | UNIQUE constraint on `user_auth_providers(provider, provider_user_id)` prevents double-link. Second attempt gets 409. |
| iOS client doesn't handle `account_exists` response | Existing client ignores unknown fields. Worst case: user sees generic error or gets a new account. No crash. |
| `findExistingAccountByIdentifiers` adds latency to registration | 2-3 simple indexed queries. Sub-5ms. Negligible compared to SMS delivery. |

## Sources & References

- Related: `docs/plans/2026-04-07-002-fix-cso-onboarding-security-fixes-plan.md` (social auto-link confirmation)
- Related: `docs/plans/2025-01-11-authentication-design.md` (original auth design)
- Related code: `src/routes/auth.js:findUserByPhone()`, `PorizoApp/PorizoApp/AccountCheckView.swift`

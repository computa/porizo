# Identity Contract

> Authoritative source-of-truth for Porizo's identity model.
> All code touching users, authentication, contacts, or entitlements MUST conform to this contract.
> Version: 2.0 | Last updated: 2026-07-11

---

## 1. Three-Layer Model

### Layer 1: `users` -- Account and Entitlement Owner

One row per real Porizo account. The sole anchor for everything valuable.

**Owns:** songs, gifts, credits, subscriptions, entitlements, voice profiles, audit history.

**Rules:**

- Survives auth method additions, removals, and provider account changes.
- Is the ONLY entity billing and credits point to.
- `users.email` and `users.phone_number` are **denormalized mirrors only** -- synced FROM `user_contacts`. Never written directly by auth flows.

**Invariant:** All entitlements, credits, songs, purchases, and library state attach ONLY to `users.id`. Never to identifiers, devices, or provider accounts. Linking a new auth method NEVER creates new entitlement rows.

---

### Layer 2: `user_auth_providers` -- Sole Sign-In Authority

The ONLY table used for sign-in resolution. Nothing else participates in authentication.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `user_id` | UUID | FK -> users.id |
| `provider` | ENUM | `apple` \| `phone` \| `email` \| `google` |
| `provider_user_id` | TEXT | Provider-scoped unique subject |
| `provider_data` | JSONB | Provider-specific claims (nullable) |
| `verified_at` | TIMESTAMP | When identity was verified |
| `linked_at` | TIMESTAMP | When linked to this user |
| `last_used_at` | TIMESTAMP | Updated on each sign-in |
| `status` | ENUM | `active` \| `revoked` \| `suspended` |

**Constraints:**

- `UNIQUE (provider, provider_user_id)` -- one provider identity links to exactly one user.

**Sign-in resolution:**

| Provider | Lookup |
|----------|--------|
| `phone` | `provider='phone'`, `provider_user_id=<E.164>` |
| `apple` | `provider='apple'`, `provider_user_id=<apple_sub>` |
| `email` | `provider='email'`, `provider_user_id=<normalized_email>` |
| `google` | `provider='google'`, `provider_user_id=<google_sub>` |

**NOT** `users.email`. **NOT** `users.phone_number`. Those columns do not participate in auth.

---

### Layer 3: `user_contacts` -- Sole Contact Authority

Stores verified and unverified contact methods. Source of truth for reachability.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `user_id` | UUID | FK -> users.id |
| `type` | ENUM | `email` \| `phone` |
| `value_normalized` | TEXT | Canonical form (lowercase email, E.164 phone) |
| `value_display` | TEXT | Human-readable form |
| `verified_at` | TIMESTAMP | NULL until verified |
| `source` | ENUM | `user_entered` \| `apple_claim` \| `phone_otp` \| `admin` \| `provider_sync` |
| `source_identity_id` | UUID | FK -> user_auth_providers.id (nullable) |
| `is_primary` | BOOLEAN | One per (user_id, type) |
| `is_relay` | BOOLEAN | True for Apple relay emails |
| `created_at` | TIMESTAMP | |

**Constraints:**

- `UNIQUE (type, value_normalized) WHERE verified_at IS NOT NULL` -- a verified contact belongs to exactly one user.
- Unverified contacts MAY have duplicates (pending verification resolves ownership).

---

## 2. Profile Completeness -- Derived Policy

```
profile_requirements_v1:
  - at least one verified non-relay email contact
  - phone is optional, but must be verified before it can be used as an auth identity
```

**Rules:**

- Computed at query time, never stored.
- Drives onboarding nags and feature gating.
- A user CAN exist and authenticate before satisfying these requirements, but the
  product must continue prompting for a verified non-relay email until it exists.
- A phone contact does not satisfy the real-email requirement.
- Unverified contacts never satisfy a verified-contact requirement.
- Versioned: future product changes update the version number, not the identity model.

---

## 3. Linking and Conflict Rules

| Scenario | Outcome |
|----------|---------|
| New identity linked to authenticated user | ALLOW -- create `user_auth_providers` row |
| `provider_user_id` already linked to another user | BLOCK -- `E118_PROVIDER_ALREADY_LINKED` |
| Contact value from new identity conflicts with verified contact on another user | BLOCK -- `E119_EMAIL_CONFLICT` |
| Two users need merging | Manual resolution required -- no automatic merge in product flows |
| Backfill encounters conflict | Hard fail -- requires manual resolution before cutover |

`confirm_link`, a UI confirmation, a matching email claim, or possession of only
one account's session is never sufficient proof for linking two accounts. Linking
an identity to an existing account requires a current authenticated session for
that account plus fresh proof of the identity being added.

---

## 4. Entitlement Invariant

Everything valuable belongs to `users.id`. Full stop.

- Auth methods are **pointers** into that user.
- Contact methods are **attributes** of that user.
- Linking a new auth method NEVER creates new entitlement rows.
- Login via any linked method resolves to the same `users.id`.
- Account merge (if implemented) MUST migrate entitlements atomically.

---

## 5. Auth Method Stance

| Provider | Status | UI Promotion |
|----------|--------|-------------|
| `apple` | Supported backend compatibility | Hidden from the release UI |
| `phone` | Supported backend compatibility | Hidden from the release UI |
| `email` | First-class | Sole visible registration and login identity |
| `google` | Supported backend compatibility | Hidden from the release UI |
| email magic link | First-class | Canonical registration, login, and recovery method |

Existing provider identities remain resolvable for migration and rollback, but the
release UI offers only platform-bound email magic links.

Password credentials are optional for an email identity. A verified email identity
may authenticate by password, magic link, or both, and all methods resolve to the
same `users.id`.

---

## 6. Contact Lifecycle

```
CREATE  -->  VERIFY  -->  PROMOTE  -->  MIRROR
```

| Stage | Action | Effect |
|-------|--------|--------|
| **CREATE** | Insert unverified contact with source provenance | Row exists, `verified_at` is NULL |
| **VERIFY** | Set `verified_at` on token consume or OTP confirm | Contact now participates in uniqueness constraint |
| **PROMOTE** | Set `is_primary = true` (one per type per user) | This contact becomes the canonical for its type |
| **MIRROR** | Sync to `users.email` / `users.phone_number` | Denormalized columns updated from primary verified contacts only |

**Mirror rule:** `users.email` and `users.phone_number` are NEVER written except by the mirror step. They reflect the current primary verified contact. If no primary verified contact exists for a type, the mirror column is NULL.

---

## 7. Cutover Criteria

Route refactor to the three-layer model may NOT proceed until ALL of the following are true:

- [ ] Zero unresolved conflicts in backfill
- [ ] All identity model tests pass
- [ ] `users.email` mirrors match `user_contacts` primary verified email for every user
- [ ] `users.phone_number` mirrors match `user_contacts` primary verified phone for every user
- [ ] Sign-in resolution uses `user_auth_providers` exclusively -- no fallback to `users` columns

---

## 8. Platform-Bound Magic Login Contract

Magic-link infrastructure is shared, but every login transaction is bound to the
platform that requested it: `ios`, `android`, or `web`. A transaction created for
one platform must never authenticate another platform.

### 8.1 Transaction credentials

Every transaction has two independent secrets:

1. A random 256-bit link secret delivered by email and stored only as a hash.
2. A random request secret returned to the requesting client and stored only as a hash.

The request secret is stored in iOS Keychain, Android Keystore-backed storage, or
a Secure/HttpOnly pre-authentication cookie on web. Exchange requires both
secrets. A platform name supplied by a client is metadata, not proof.

### 8.2 Platform routes

Authentication links use HTTPS verified associations only:

| Platform | Link namespace | Platform proof |
|----------|----------------|----------------|
| iOS | `https://auth.porizo.co/auth/magic/ios` | Universal Link plus Keychain request secret |
| Android | `https://auth.porizo.co/auth/magic/android` | Verified App Link plus Keystore request secret |
| Web | `https://auth.porizo.co/auth/magic/web` | Pre-auth HttpOnly cookie plus CSRF/origin checks |

Custom URL schemes must never carry authentication credentials. A mismatched
platform displays recovery guidance and does not consume the transaction.

### 8.3 Exchange semantics

- Link expiry is 15 minutes.
- Links and request secrets are single-use.
- `GET` never consumes a credential or creates a session; email scanners may issue GET requests.
- Exchange is a state-changing `POST`.
- Validation, consumption, identity resolution/linking, session creation, token-family creation,
  and audit recording commit in one database transaction.
- Exactly one concurrent exchange succeeds.
- Raw secrets and complete authentication URLs are excluded from logs, analytics,
  attribution redirects, crash reports, referrers, and support artifacts.
- Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

### 8.4 Account behavior

- Existing verified email identity: sign in to its existing `users.id`.
- Unknown email: entering an address creates no account. Only a successful
  two-secret exchange creates one user, one entitlement owner, and its verified
  email identity. The same visible flow therefore handles registration and login.
- Authenticated user adding email: bind the transaction to that `users.id`; after
  exchange, verify the contact and link the email identity to that same user.
- Email stored only as an unverified legacy contact: do not create a second owner
  and do not auto-link it. Return `LEGACY_ACCOUNT_RECOVERY_REQUIRED` with masked,
  contextual recovery methods only after both magic-link factors are proven.
- Email already owned by another user: do not switch, merge, or move ownership.
  Enter explicit account recovery/consolidation.
- An already-authenticated client opening a link for a different user must never
  silently replace its active account.

### 8.5 Cross-device behavior

Version 1 supports same-device completion only. If a native association fails and
the email opens in a browser, page load has no side effect. An explicit user tap may
approve the email factor, but it creates no session. The requesting app must then
present its device-only request secret to status/complete. A forwarded link or a
different device cannot authenticate because that request secret is absent.

---

## 9. Session Contract

All sessions are server-side records anchored to `users.id`.

- Native access tokens are short-lived and include both `sub = users.id` and `sid = user_sessions.id`.
- Native refresh tokens are opaque, hashed at rest, session-bound, family-tracked,
  rotated on every use, and revocable.
- Web uses an opaque `__Host-porizo_session` cookie with `Secure`, `HttpOnly`,
  `SameSite=Lax`, `Path=/`, and no `Domain` attribute. Web credentials are never
  exposed to JavaScript or browser storage.
- Access-token lifetime is 15 minutes.
- Session idle lifetime is 90 days.
- Session absolute lifetime is 365 days and rotation may not extend beyond it.
- Logout revokes the current session. Account-security events may revoke all sessions.
- Account deletion, identity linking/unlinking, primary-email changes, payment changes,
  and voice-security operations require recent authentication.
- Recent authentication means a qualifying primary credential was verified within
  the preceding 15 minutes. Refresh-token rotation and passive session use never
  advance `authenticated_at`.

---

## 10. Apple Private Relay and Delivery Contract

Apple relay contacts remain valid contacts when forwarding works, but they do not
satisfy the non-relay email requirement. Relay detection includes:

- `privaterelay.appleid.com`
- `private.icloud.com`

`porizo.co` and `send.porizo.co` are registered Apple email sources. Delivery
bounce, complaint, and suppression events must update contact deliverability so
automated lifecycle email stops after a terminal failure. Delivery failure never
changes authentication or entitlement ownership.

---

## 11. Account Deletion Contract

Database state is tombstoned and committed before irreversible external storage
deletion begins. Storage cleanup runs from durable post-commit work and is
idempotent/retryable. A database rollback must never occur after files have been
irreversibly deleted. Authentication, billing, identity, content, and cleanup
events remain auditable without retaining raw credentials.

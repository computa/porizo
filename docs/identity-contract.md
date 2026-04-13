# Identity Contract

> Authoritative source-of-truth for Porizo's identity model.
> All code touching users, authentication, contacts, or entitlements MUST conform to this contract.
> Version: 1.0 | Last updated: 2026-04-13

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
  - at least one verified phone contact
```

**Rules:**

- Computed at query time, never stored.
- Drives onboarding nags and feature gating.
- A user CAN exist and authenticate before satisfying these requirements.
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
| `apple` | First-class | Promoted in iOS UI |
| `phone` | First-class | Promoted in iOS UI |
| `email` | Supported | Backend identity type, not promoted in UI yet |
| `google` | Supported | Backend identity type, not promoted in UI yet |

No provider is "legacy". All are supported backend identity types. UI promotion is a product decision independent of the identity model.

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

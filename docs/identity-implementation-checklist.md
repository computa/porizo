# Authoritative Identity Model Implementation Checklist

This checklist is the implementation control surface for the authoritative identity model.

It is intentionally strict:
- A task is not done when code exists.
- A task is done only when its acceptance criteria and validation checks pass.
- If a phase has unresolved blockers, later phases do not count as complete.

## Core Vision

Porizo must support:
- one `user` as the sole owner of entitlements, credits, subscriptions, songs, gifts, and audit history
- many linked sign-in methods resolving to that same `users.id`
- contact/profile data managed independently from sign-in methods
- onboarding flows that can change without changing the identity core

## Global Invariants

These must remain true at every phase:

- `users.id` is the only owner of entitlements and durable product state.
- Sign-in resolution uses `user_auth_providers` only.
- Contact state uses `user_contacts` only.
- `users.email` and `users.phone_number` are mirrors only.
- No product flow silently merges users.
- No identifier conflict creates a second account.

## Phase 0: Identity Contract

### Deliverables

- [ ] Create [identity-contract.md](/Users/ao/Documents/projects/porizo/docs/identity-contract.md)
- [ ] Define `users`, `user_auth_providers`, and `user_contacts`
- [ ] Define profile completeness as derived policy, not identity truth
- [ ] Define linking/conflict rules
- [ ] Define entitlement invariant explicitly

### Acceptance Criteria

- [ ] The contract answers:
  - who owns entitlements
  - what table authoritatively resolves sign-in
  - what table authoritatively stores contacts
  - what happens on identifier conflict
  - what onboarding is allowed to require without changing the identity core
- [ ] Contract names the current product completeness policy separately from identity
- [ ] Contract is short enough to be read before implementation and precise enough to block conflicting route logic

## Phase 1: Schema Normalization

### Phase 1A: Evolve `user_auth_providers`

### Deliverables

- [ ] Add PG migration for new auth-identity columns
- [ ] Add SQLite migration for parity
- [ ] Add indexes for active login resolution

### Required Columns

- [ ] `verified_at`
- [ ] `linked_at`
- [ ] `last_used_at`
- [ ] `status`

### Acceptance Criteria

- [ ] PG migration uses `TIMESTAMPTZ` for timestamps
- [ ] SQLite migration uses `TEXT` for timestamps
- [ ] Provider values remain compatible with current system (`apple`, `phone`, `email`, `google` if still supported)
- [ ] Existing rows are backfillable without ambiguity in the happy path

### Phase 1B: Create `user_contacts`

### Deliverables

- [ ] Add PG migration for `user_contacts`
- [ ] Add SQLite migration for parity
- [ ] Add uniqueness and lookup indexes

### Required Columns

- [ ] `id`
- [ ] `user_id`
- [ ] `type`
- [ ] `value_normalized`
- [ ] `value_display`
- [ ] `verified_at`
- [ ] `source`
- [ ] `source_identity_id`
- [ ] `is_primary`
- [ ] `is_relay`
- [ ] `created_at`

### Acceptance Criteria

- [ ] Verified contacts cannot be claimed by two users
- [ ] A user can have multiple contact records over time
- [ ] Relay email can be represented without pretending it satisfies completeness
- [ ] Schema supports future onboarding changes without schema redesign

## Phase 2: Identity Service Layer

### Deliverables

- [ ] Create [identity-service.js](/Users/ao/Documents/projects/porizo/src/services/identity-service.js)
- [ ] Move identity logic out of auth routes

### Required Service Functions

- [ ] `resolveUserByIdentity(type, subject)`
- [ ] `createUserWithIdentity(identity, initialContacts, profile)`
- [ ] `linkIdentityToUser(userId, identity)`
- [ ] `createOrUpdateContact(userId, contact)`
- [ ] `verifyContact(userId, type, valueNormalized, source)`
- [ ] `setPrimaryContact(userId, contactId)`
- [ ] `computeProfileCompleteness(userId, policyVersion)`
- [ ] `syncUserContactMirrors(userId)`
- [ ] `recordIdentityUsage(identityId)`

### Acceptance Criteria

- [ ] Auth routes stop writing `user_auth_providers` directly
- [ ] Auth routes stop writing `users.email` and `users.phone_number` directly
- [ ] Service enforces identity conflict rules consistently across Apple, phone, and email flows
- [ ] Completeness computation is policy-driven, not duplicated inline

## Phase 3: Backfill and Cutover Prep

### Deliverables

- [ ] Create [backfill-identity-model.js](/Users/ao/Documents/projects/porizo/scripts/backfill-identity-model.js)
- [ ] Create [conflict-report.json](/Users/ao/Documents/projects/porizo/scripts/conflict-report.json) output format

### Backfill Tasks

- [ ] Backfill auth-identity metadata conservatively
- [ ] Create phone contacts from verified phone identities
- [ ] Create email contacts from current verified emails
- [ ] Mark relay emails as `is_relay = true`
- [ ] Choose deterministic primary contacts
- [ ] Rebuild `users.email` and `users.phone_number` from contacts

### Acceptance Criteria

- [ ] Backfill aborts on unresolved identity conflicts
- [ ] Conflict report identifies exact users and identifiers involved
- [ ] Mirror fields match contacts after backfill
- [ ] No route cutover happens until unresolved conflicts = `0`

## Phase 4: Backend Route Refactor

### Deliverables

- [ ] Refactor `/auth/social`
- [ ] Refactor `/auth/phone/verify`
- [ ] Refactor `/auth/phone/register`
- [ ] Refactor `/auth/login`
- [ ] Refactor `/auth/phone/link`
- [ ] Add `/auth/identity/link/apple`
- [ ] Add `/auth/email/resend-verification`
- [ ] Add browser/deep-link verification consume endpoint
- [ ] Refactor `/auth/profile`
- [ ] Refactor `/auth/me`

### Acceptance Criteria

- [ ] All sign-in resolution goes through identity service
- [ ] All linking goes through identity service
- [ ] Email update path creates/updates contact state rather than mutating user mirror fields directly
- [ ] `/auth/me` returns enough data for account management UI:
  - linked methods
  - contacts
  - primary contact values
  - completeness state
  - missing requirements
- [ ] Conflict responses are explicit and deterministic

## Phase 5: iOS Product Layer

### Deliverables

- [ ] Add `AccountManagementView`
- [ ] Wire Settings -> Account Management
- [ ] Add Apple linking flow
- [ ] Reuse phone OTP for phone linking
- [ ] Add email verification UX
- [ ] Add verification deep-link handling
- [ ] Make phone-first email required in UI
- [ ] Update `ProfileCompletionView` to use server completeness/missing reasons
- [ ] Clean up `AccountExistsView`

### Acceptance Criteria

- [ ] User can see linked auth methods
- [ ] User can see contact verification state
- [ ] Apple-first user can add phone
- [ ] Phone-first user can add Apple
- [ ] Phone-first onboarding requires email in product flow
- [ ] Relay-email users are clearly asked for a real email
- [ ] AccountExistsView only offers actual reachable auth methods

## Phase 6: Tests

### Backend Tests

- [ ] Add [auth-identity-model.test.js](/Users/ao/Documents/projects/porizo/test/auth-identity-model.test.js)
- [ ] Add migration/backfill correctness coverage

### iOS Tests

- [ ] Add API contract tests for new `/auth/me` shape
- [ ] Add account-management view tests
- [ ] Add phone-first email-required tests
- [ ] Add email verification deep-link tests

### Acceptance Criteria

- [ ] Identity sign-in permutations resolve to the same `users.id`
- [ ] Linking does not create duplicate entitlements
- [ ] Verified-contact uniqueness is enforced
- [ ] Relay email does not satisfy completeness
- [ ] Backfill fails on unresolved conflicts

## Phase 7: Documentation

### Deliverables

- [ ] Update [personalized-song-platform-spec.md](/Users/ao/Documents/projects/porizo/specs/personalized-song-platform-spec.md)
- [ ] Update [architecture-and-flows.md](/Users/ao/Documents/projects/porizo/docs/architecture-and-flows.md)
- [ ] Update [CLAUDE.md](/Users/ao/Documents/projects/porizo/CLAUDE.md)

### Acceptance Criteria

- [ ] Docs no longer describe Firebase/Auth0-era auth as current
- [ ] Docs reflect the three-layer model: user, auth identity, contact
- [ ] Docs reflect current product policy separately from identity model

## Exit Criteria

The identity model is considered implemented only when all of the following are true:

- [ ] Contract document exists and matches implementation
- [ ] Schema normalization is complete
- [ ] Backfill completed with zero unresolved conflicts
- [ ] Auth routes all use the identity service
- [ ] `/auth/me` exposes linked methods, contacts, and completeness state
- [ ] iOS account management UI is live
- [ ] Linking flows work both directions
- [ ] Entitlement invariants are proven by tests
- [ ] Docs are updated


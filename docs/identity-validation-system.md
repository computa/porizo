# Authoritative Identity Model Validation System

This document defines how Porizo proves the identity vision was actually implemented.

The goal is not code confidence alone. The goal is operational confidence that:
- one user can authenticate with multiple linked methods
- contact verification works
- onboarding policy can evolve without breaking identity
- entitlements stay attached to the same `users.id`

## Validation Philosophy

Use five layers:

1. `Contract validation`
   Confirms the implementation matches the written model.
2. `Data-model validation`
   Confirms schema, backfill, and mirrors are correct.
3. `Backend behavior validation`
   Confirms routes and service logic preserve identity and entitlement invariants.
4. `Client behavior validation`
   Confirms the iOS product actually exposes and uses the model correctly.
5. `Manual end-to-end validation`
   Confirms the real user flows feel coherent and do not hide broken edge cases.

## Validation Artifacts

Store results under:

```text
docs/validation/identity/
  scenarios.md
  fixtures.md
  rubric.md
  runs/
    YYYY-MM-DD-before/
      report.md
      screenshots/
      logs/
    YYYY-MM-DD-after/
      report.md
      screenshots/
      logs/
```

## Required Test Fixtures

The system needs deterministic fixtures before the validation is trustworthy.

### Identity Fixtures

- `F1` Apple-first user with verified Apple identity and no phone
- `F2` Phone-first user with verified phone and no Apple
- `F3` User with Apple + phone already linked
- `F4` User with Apple relay email and no real email
- `F5` User with unverified real email contact
- `F6` Conflicting phone claimed by another user
- `F7` Conflicting verified email claimed by another user
- `F8` User with existing entitlements, credits, and songs

### Backfill Fixtures

- `B1` Legacy user using `users.phone_number` only
- `B2` Legacy user using `users.email` only
- `B3` Legacy user with mismatched mirrors vs provider/contact source
- `B4` Duplicate verified phone across two users
- `B5` Duplicate verified email across two users

## Validation Matrix

## V0: Contract Validation

### Checks

- [ ] [identity-contract.md](/Users/ao/Documents/projects/porizo/docs/identity-contract.md) exists
- [ ] Route and service behavior match contract terms
- [ ] No route writes contact mirrors directly
- [ ] No route resolves login via `users.email` or `users.phone_number`

### Evidence

- code review references
- route/service grep results
- implementation notes in run report

## V1: Schema Validation

### Checks

- [ ] `user_auth_providers` has required identity columns
- [ ] `user_contacts` exists in PG and SQLite
- [ ] uniqueness and lookup indexes exist
- [ ] migrations run cleanly on fresh DB
- [ ] migrations run cleanly on realistic upgraded DB

### Commands

Run the project’s migration validation commands plus targeted schema tests.

Minimum expectations:
- [ ] fresh-db migration test
- [ ] upgraded-db migration test
- [ ] schema parity test between PG and SQLite

### Pass Criteria

- no missing columns
- no broken constraints
- no migration drift

## V2: Backfill Validation

### Checks

- [ ] phone contacts created correctly
- [ ] email contacts created correctly
- [ ] relay emails marked correctly
- [ ] primary contacts selected deterministically
- [ ] `users.email` and `users.phone_number` rebuilt from contacts
- [ ] unresolved conflicts cause hard failure

### Required Tests

- [ ] backfill of clean legacy data succeeds
- [ ] backfill with mirror mismatch resolves deterministically or fails clearly
- [ ] duplicate verified phone aborts
- [ ] duplicate verified email aborts

### Pass Criteria

- zero unresolved conflicts for real cutover data
- mirror fields equal computed primary contacts for every user

## V3: Backend Identity Behavior Validation

### Core Scenarios

#### S1 Apple-first -> link phone -> phone sign-in

Steps:
1. create Apple-first user
2. link phone through OTP
3. logout
4. sign in by phone

Pass:
- same `users.id`
- same entitlements
- same songs
- phone identity `last_used_at` updated

#### S2 Phone-first -> link Apple -> Apple sign-in

Pass:
- same `users.id`
- same entitlements
- same songs

#### S3 Existing verified email conflict

Pass:
- no duplicate user created
- explicit conflict response

#### S4 Existing phone conflict

Pass:
- no duplicate user created
- explicit conflict response

#### S5 Relay email completeness

Pass:
- Apple relay email does not satisfy completeness
- adding verified real email clears missing-email state

#### S6 Email verification lifecycle

Steps:
1. set unverified email
2. resend verification
3. consume token
4. fetch profile

Pass:
- contact becomes verified
- primary email mirror updates correctly

#### S7 Entitlement invariant

Pass:
- linking methods never creates duplicate entitlement rows
- linked sign-in methods resolve to same credits/subscription/songs

### Test Output Requirements

Every backend scenario must record:
- request/response summary
- resulting `users.id`
- linked providers
- contact records
- entitlement record ids

## V4: `/auth/me` Contract Validation

### Checks

- [ ] linked methods returned
- [ ] contacts returned
- [ ] primary contact values returned
- [ ] completeness returned
- [ ] missing reasons returned

### Pass Criteria

The iOS client can build account management UI without guessing or re-deriving identity state.

## V5: iOS Client Validation

### Automated UI / contract scenarios

#### S8 Account Management loads

Pass:
- linked Apple state visible
- linked phone state visible
- email verification state visible

#### S9 Phone-first onboarding requires email

Pass:
- continue disabled until valid email entered

#### S10 Apple link flow

Pass:
- user can add Apple to existing phone-first account
- success refreshes profile state

#### S11 Phone link flow

Pass:
- user can add phone to existing Apple-first account
- success refreshes profile state

#### S12 Email verification deep link

Pass:
- app consumes verification deep link
- profile refreshes
- verified badge appears

#### S13 Persistent completeness nag

Pass:
- incomplete profile shows prompt on fresh launch
- skip does not clear `needs_profile_completion`

### iOS Evidence

- screenshots
- accessibility snapshots
- logs
- test output

## V6: Manual End-to-End Validation

These are the final trust-building scenarios and must be run on a real device before declaring success.

### M1 Apple-first real flow

1. Fresh install
2. Sign in with Apple
3. If relay email, add real email
4. Add phone
5. Kill app
6. Relaunch
7. Sign in by phone

Pass:
- lands in same account
- same songs and credits visible

### M2 Phone-first real flow

1. Fresh install
2. Sign in by phone
3. Enter email
4. Complete onboarding
5. Add Apple
6. Logout
7. Sign in by Apple

Pass:
- same account
- same entitlements

### M3 Verification flow

1. Add or change email
2. Receive verification email
3. Open link on device

Pass:
- account shows verified email
- completeness updates

### M4 Conflict flow

1. Attempt to link an Apple ID already linked elsewhere
2. Attempt to link a phone already linked elsewhere

Pass:
- clear conflict explanation
- no duplicate account or data split

## Run Reports

Each validation run must produce `report.md` with:

- scope
- git commit / branch
- migration version
- fixtures used
- scenario results
- failures
- blockers
- follow-up actions

Suggested structure:

```text
# Identity Validation Run - YYYY-MM-DD

## Environment
- commit:
- db:
- app build:

## Scenario Results
- S1: PASS
- S2: PASS
- ...

## Failures
- ...

## Evidence
- screenshots:
- logs:
- test artifacts:

## Release Gate
- READY / NOT READY
```

## Release Gate

The identity vision is only considered implemented when all of the following are true:

- [ ] V0 contract validation passes
- [ ] V1 schema validation passes
- [ ] V2 backfill validation passes with zero unresolved conflicts
- [ ] V3 backend identity behavior passes
- [ ] V4 `/auth/me` contract validation passes
- [ ] V5 iOS client validation passes
- [ ] V6 manual end-to-end validation passes
- [ ] entitlement invariants are proven

If any one of these fails, the identity rollout is not complete.


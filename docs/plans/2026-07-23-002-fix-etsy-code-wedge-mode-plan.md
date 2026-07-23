# Etsy Option 2.5: code wedge with dormant API automation

Status: implementation-ready
Owner decision: approved 2026-07-23

## Problem

The current branch contains valuable Etsy fulfilment hardening, but it also
changed the launch strategy from manually issued codes to an Etsy Seller API
integration that cannot launch before app approval. The old code flow also
attached paid entitlement to a browser-local guest, so losing that browser
could lose access.

## Requirements

- **R1 — One authority:** `etsy_fulfilment_mode` is exactly `off`, `code`, or
  `api`. The three migration-137 booleans are no longer runtime authorities.
- **R2 — Fail closed:** invalid or unreadable mode behaves as `off`.
- **R3 — Code launch:** in `code`, `/etsy` and `/etsy/code` present printed-code
  entry. Receipt lookup, Etsy OAuth bootstrap, provider webhooks, receipt
  reconciliation, ready-unit processing, and fulfilment outbox processing do
  not execute.
- **R4 — Forward compatibility:** in `api`, `/etsy` presents receipt entry while
  `/etsy/code` remains available for every previously issued code.
- **R5 — Durable ownership:** code redemption requires control of a verified
  email and credits the canonical account, never a guest/browser identity.
- **R6 — Secret hygiene:** a redemption code appears only in a typed request
  body and server-side claim record. It never appears in a URL, referrer,
  browser history, localStorage, sessionStorage, magic-link payload, or routine
  route path.
- **R7 — Atomicity:** email verification, canonical account resolution, code
  redemption, wallet grant, and claim consumption either commit together or
  remain retryable. A code grants one fungible gift credit at most once.
- **R8 — Cross-device recovery:** the verification link may be opened on a
  different browser. It establishes the account session there; the same account
  can subsequently sign in on any device and retain the credit/song.
- **R9 — Neutral hardening remains:** durable MP3 artifact retries, authenticated
  MP3 delivery, GDPR handling, guest/account convergence, audit records, and
  API schema stay in place.
- **R10 — Honest wedge:** operator documentation and listing instructions say
  made-to-order/manual delivery and direct buyers to `/etsy/code`; they do not
  promise instant API fulfilment.
- **R11 — One paid receipt, one audited code:** live codes are issued
  individually to a verified paid receipt by a superadmin, delivery is recorded,
  and generic paid-equivalent batches remain retired.

## Key decisions

- A dedicated `etsy_code_claim` magic-login purpose is narrower and safer than
  weakening the existing same-browser web-login CSRF contract.
- The emailed link contains only a magic transaction ID and fragment secret.
  The raw redemption code remains in a server-side pending claim joined to that
  transaction.
- Generic MP3 artifact work runs in every mode. Etsy provider/order workers run
  only in `api`.
- `well-known` routes remain independent; they have no Etsy provider dependency.
- A code may be revealed through the audited admin API only while its assignment
  is undelivered. The generic Etsy file never contains a buyer code.
- Existing migration-137 flags remain as inert compatibility data so rollback
  and old environments are understandable; new code does not read them.

## Implementation units

### U1. Authoritative mode and provider fencing

Files:

- `migrations/138_etsy_option_2_5.sql`
- `migrations/pg/138_etsy_option_2_5.sql`
- `src/services/etsy-fulfilment-mode.js`
- `src/routes/web-etsy.js`
- `src/routes/web-etsy-webhook.js`
- `src/server.js`
- `src/routes/admin/etsy-codes.js`
- `src/services/etsy-redemption-service.js`
- `test/services/etsy-fulfilment-mode.test.js`
- `test/routes/web-etsy.test.js`
- `test/server-etsy-mode.test.js`

Test scenarios:

1. Missing, malformed, and database-error modes fail closed.
2. `off` exposes neither buyer path nor webhook processing.
3. `code` enables code checks/claims but returns 404 for receipt and webhook
   surfaces and makes no Etsy client call.
4. `api` enables receipt/webhook/order workers and retains code redemption.
5. MP3 artifact retries run in all modes; ready-unit/outbox workers run only in
   `api`.
6. Live issue/reveal/delivery operations are superadmin-only, audited, require
   idempotency keys, and execute only in `code`.

### U2. Verified-email pending code claim

Files:

- `migrations/138_etsy_option_2_5.sql`
- `migrations/pg/138_etsy_option_2_5.sql`
- `src/services/etsy-code-claim-service.js`
- `src/services/etsy-redemption-service.js`
- `src/services/magic-login-service.js`
- `src/database/magic-login-repository.js`
- `src/routes/auth.js`
- `src/server.js`
- `test/services/etsy-code-claim-service.test.js`
- `test/magic-login-api.test.js`

Test scenarios:

1. A valid unredeemed code and valid email create one expiring pending claim;
   raw code is absent from the public response and email URL.
2. Unknown, void, redeemed, expired, rate-limited, and mode-disabled requests
   return distinct public states without consuming the code.
3. A link opened without the originating cookies can verify the email, create
   or recover the canonical account, redeem once, and set a secure web session.
4. Any failure in account resolution, wallet grant, or claim transition rolls
   back the magic transaction and code.
5. Replays cannot mint another credit; another account cannot take an already
   redeemed code.

### U3. Buyer UI and mode routing

Files:

- `web-funnel/src/api/etsy.ts`
- `web-funnel/src/EtsyEntry.tsx`
- `web-funnel/src/steps/EtsyLanding.tsx`
- `web-funnel/src/main.tsx`
- `web-funnel/src/App.tsx`
- `web-funnel/src/api/etsy.test.ts`
- `web-funnel/src/EtsyEntry.test.tsx`
- `web-funnel/src/steps/EtsyLanding.test.tsx`

Test scenarios:

1. `/etsy` renders code entry in `code`, receipt entry in `api`, and unavailable
   in `off`; `/etsy/code` renders code entry in both launch modes.
2. Code normalization is local only; requests send it in JSON bodies.
3. A valid code moves to email verification, then “check your email”; no guest
   session is created and the code is not persisted client-side.
4. Invalid/void/redeemed/rate/config/network states preserve accurate copy.
5. The handoff marks the journey commerce-free and suppresses Stripe, sign-up,
   pricing, and “make another” surfaces.

### U4. Operations and launch truth

Files:

- `docs/operations/etsy-fulfilment.md`
- `tasks/todo.md`

Test scenarios:

1. The runbook documents exact mode values and safe transitions.
2. Code-mode instructions describe separate code entry and a manual delivery
   SLA, with no code-bearing URL.
3. API approval, real webhook evidence, and refund reconciliation remain
   explicit external gates before switching to `api`.

## Validation

1. Focused service, route, auth, and frontend tests while implementing.
2. Migration parity review for SQLite/Postgres.
3. Backend affected suites plus web-funnel test/build.
4. One integrated adversarial review covering auth, entitlement atomicity,
   secret exposure, mode bypasses, timer behavior, and rollback.
5. Strict scoped preflight, lint, full backend suite, and production build
   before handoff.

## Out of scope

- Etsy Seller App approval, live OAuth connection, or enabling `api`.
- Changing gift-credit economics; Etsy, Stripe, and StoreKit credits remain one
  fungible wallet.
- Deploying or changing production flags in this implementation commit.

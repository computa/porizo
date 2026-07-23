---
title: "fix: Make Etsy fulfilment launch-safe"
date: 2026-07-23
type: fix
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Make Etsy fulfilment launch-safe

## Goal Capsule

Convert the Etsy wedge from an unassigned bearer-code prototype into a truthful,
recoverable purchase channel that uses the same fungible gift-wallet and gift
delivery lifecycle as web and iOS. A paid Etsy receipt must create exactly one
auditable entitlement unit per purchased quantity; its buyer must be able to
claim and recover that unit across browsers and devices; the final MP3 must be a
durable, downloadable deliverable; cancellation/refund must reverse the exact
grant; and no Etsy fulfilment surface may expose alternate commerce.

Etsy does not expose a per-receipt digital-file upload API. The automated
contract is therefore:

1. The Etsy instant listing contains one generic, non-secret instruction PDF.
2. `order.paid` creates durable fulfilment units after the server fetches and
   verifies the receipt, shop, listing, payment state, buyer email, and quantity.
3. The buyer enters their receipt reference, completes Turnstile, and then
   proves control through the existing verified-email magic-link session using
   the receipt's `buyer_email`.
4. The verified claim binds the unit to a stable Porizo identity and the shared
   gift wallet. It never depends on local storage or a raw code in a URL.
5. A completed Etsy gift is delivered only when its durable MP3 exists.

If production Seller App access cannot return `buyer_email`, or Etsy does not
approve transaction-only off-platform claim/final-delivery email, automation
must remain disabled and the listing must use Etsy's manual made-to-order flow
with an honest human SLA.

## Scope

### In scope

- Every accepted finding P0.1–P2.15 in Ambrose's 2026-07-23 review.
- Paired SQLite/PostgreSQL migrations and concurrency-safe repositories.
- Etsy webhook receipt ingestion, reconciliation seams, claim delivery, refund
  reversal, administrative operations, metrics, and incident visibility.
- Web-funnel session recovery, explicit claim, journey isolation, commerce-free
  policy, MP3 download, runtime pricing, rate limits, and honest error states.
- Listing-contract assets/runbook and launch preflight.

### Out of scope

- Pretending Etsy can upload a unique file to each instant-download receipt.
- Marketing email, buyer profiling, or retention of Etsy PII beyond fulfilment
  and support requirements.
- A second Etsy-specific gift balance or render lifecycle.
- Destructive removal of already-delivered content after a refund; existing
  gift-wallet debt/reversal semantics remain authoritative.

## Product Contract

### Key decisions

1. **Automated delivery uses generic PDF + verified email claim.** Etsy receipt
   IDs, buyer IDs, and codes are not authentication.
2. **Gift credits remain fungible.** Etsy is an immutable purchase source that
   grants the existing gift wallet; consumption follows the ordinary
   reservation, generation, gift order, share, and delivery lifecycle.
3. **Precheck never consumes entitlement.** Turnstile initiation returns a
   short-lived server-signed proof bound to receipt and client IP. Claim state
   changes occur only through an authenticated, verified-email, replay-safe
   POST that presents that proof.
4. **MP3 is required for Etsy delivery.** A ready song with a missing MP3 is a
   pending fulfilment incident, not a successfully delivered Etsy order.
5. **Refunds reverse the exact grant.** Unspent credit is removed; spent credit
   produces the existing bounded debt semantics without silently deleting
   content.
6. **Commerce-free is server provenance.** Browser session storage may improve
   presentation, but it cannot be the policy authority.
7. **Launch is feature-gated.** Schema and read paths deploy first; automation
   remains off until real-receipt identity, policy approval, secrets, ingress,
   reconciliation, and dry-run gates pass.

## Requirements

- **R1 — Paid-order integration:** verified `order.paid` ingestion creates one
  unique fulfilment unit per valid configured listing quantity and no duplicate
  unit on replay.
- **R2 — Durable recovery:** entitlement claim/recovery works on another browser
  or device after email proof and survives navigation, crashes, and storage
  clearing.
- **R3 — Session refresh:** Etsy entry shares the normal one-refresh/one-retry
  access-token rotation contract and does not trust an expired stored token.
- **R4 — Journey isolation:** an Etsy claim namespaces/clears stale web-order
  recovery and cannot be redirected into an unrelated success order.
- **R5 — Buyer MP3:** the owner can download the advertised MP3 from Success via
  a short-lived owner-gated URL.
- **R6 — Durable artifact:** MP3 state, attempt count, error, incident, retry,
  and admin backfill are persistent and idempotent.
- **R7 — Admin controls:** order exception, legacy quarantine, refund, retry,
  and replay operations require the configured privileged role, emit exactly
  one redacted audit record, and return `no-store`. New unassigned code
  mint/export is removed; legacy compatibility is separately time-gated and
  must be off before launch.
- **R8 — Cancellation/refund:** `order.canceled` triggers authoritative receipt
  and payment reconciliation. Successful payment adjustments are deduplicated
  and mapped to affected transaction units; full cancellation/refund reverses
  all affected units, while unsupported partial ambiguity fails to an audited
  manual operation rather than guessing.
- **R9 — Sales metrics:** Gate A reports paid orders/units, claim and delivery
  conversion, fulfilment latency, cancellations/refunds, and incidents—not
  minted inventory as sales.
- **R10 — Ownership merge:** guest-to-account convergence atomically transfers
  Etsy order/unit/code ownership with wallet and gift state.
- **R11 — Secret hygiene:** no raw redemption/claim secret appears in URL query
  or path, logs, analytics, referrers, normal admin lists, or audit payloads.
- **R12 — Commerce-free fulfilment:** Etsy provenance suppresses Stripe offer,
  sign-in wall, store navigation, home links, and “make another” on every entry,
  refresh, deep link, preview, offer, dim, and success state; server checkout is
  also denied for Etsy-origin fulfilment.
- **R13 — Runtime pricing:** public pricing/listing manifest derives price,
  currency, availability, format, SLA, revision, and refund claims from the
  active server product/catalog contract.
- **R14 — Rate policy:** read-only validation does not consume the mutating
  claim budget; invalid mutations are bounded; idempotent owner recovery remains
  available; `Retry-After` drives exact UI copy.
- **R15 — Honest precheck errors:** missing, disabled, rate-limited,
  misconfigured, and temporary/network failures map to distinct initial states.

## Architecture

### Data model

Paired migration `137_etsy_fulfilment.sql` adds:

- `etsy_connections`: encrypted OAuth tokens, expiries, scopes, connection
  status, reconnect requirement, reconciliation cursor, lease, lag, and
  last-success/error health.
- `etsy_webhook_events`: unique provider event ID, body digest, receipt ID,
  processing state/attempts/error/DLQ timestamps; no raw secrets.
- `etsy_orders`: unique `(shop_id, receipt_id)`, verified payment/cancellation
  state, listing/transaction snapshot, encrypted minimal buyer contact plus a
  keyed lookup digest, order totals, lifecycle timestamps, and owning claim
  principal/user.
- `etsy_order_units`: unique `(order_id, transaction_id, ordinal)`, code/grant,
  reservation/gift/track links, claim/delivery/refund state and timestamps.
- `etsy_claim_tokens`: token digest and last four only, expiry, consumption, and
  email-verification binding.
- `etsy_payment_adjustments`: unique adjustment/item IDs, status, amount,
  currency, transaction mapping, and reconciliation timestamps.
- `etsy_fulfilment_outbox`: order-scoped claim-mail generations and unit-scoped
  final-MP3 delivery actions, lock, attempts, `next_attempt_at`, provider ID,
  redacted error, and terminal state.
- `track_artifacts`: unique `(track_version_id, kind)`, object key, integrity,
  status, attempts, error, and timestamps.

Legacy redemption codes receive a stable ID, order/unit/grant links, a keyed
lookup digest and last four. New unassigned mint/export is disabled. Any
temporary legacy export requires an expiring migration flag, superadmin
step-up, sealed one-time download, and dual audit; launch requires the flag off,
raw values shredded, and no live unassigned code. Existing redeemed rows are
associated only when their wallet grant matches unambiguously; ambiguous rows
are quarantined as incidents.

### Provider boundary

- Verify Etsy webhook raw bytes using
  `webhook-id.webhook-timestamp.raw-body`, timestamp freshness, and the configured
  signing secret before recording the event.
- Parse only identifiers from the payload, construct an allowlisted receipt API
  request from configured shop ID, and verify paid/non-canceled state plus
  listing/SKU allowlist before mutation.
- Return 2xx only after a verified event is durably inserted, or its unique
  webhook ID already exists. Processing is asynchronous; database failure
  returns non-2xx so Etsy retries.
- Initial Etsy OAuth authorization is an operator-controlled secret bootstrap
  using minimal `transactions_r`; an admin connect/callback UI is not part of
  this implementation. Runtime rotation keeps encrypted access/refresh tokens
  behind a database lease and token-version fence, refreshes once on 401,
  honors `Retry-After`, bounds timeouts, and marks a current-generation
  `invalid_grant` as reconnect-required without letting a stale replica
  disconnect newer credentials.
- Webhook inbox is primary. A leased single-leader reconciliation job paginates
  receipts and payment adjustments since `(cursor - overlap)`, advances the
  cursor only after the complete page set commits, and records lag/health.
  Receipt 404, unpaid state, or missing transactions immediately after a paid
  event is retryable eventual consistency. Manual replay is audited.

### Claim boundary

- Generic Etsy PDF links only to `/etsy`; it contains no code.
- Buyer submits receipt reference by POST with Turnstile. The constant-shape
  response carries a five-minute HMAC proof bound to receipt and client IP;
  direct claim calls and cross-IP replay fail before identity lookup.
- If the current session does not own the verified receipt email, the existing
  magic-link flow establishes the verified account session. Receipt and native
  Etsy-unit recovery references remain opaque and survive that redirect.
- The CSRF/origin-checked POST exchange atomically attaches every still-unclaimed
  unit for that receipt to a provider-scoped claim principal and creates one
  immutable wallet grant per unit. Idempotent re-entry returns the same unit set.
- Linking or merging an existing Porizo account follows the authoritative
  magic-link/convergence contract; normalized email equality alone never merges.
- The server issues an Etsy fulfilment journey ID. The first create/reserve POST
  locks one eligible unit and atomically binds unit → wallet reservation → gift
  order/track. Commerce policy, refunds, artifacts, and metrics derive from this
  chain, including mixed-origin wallets and concurrent tabs.

### Artifact and delivery boundary

- The current AAC/M4A master feeds one explicit MP3 compatibility transcode with
  configured codec/bitrate plus byte-length and integrity checks. This is not
  represented as lossless; a real-artifact listening check is a launch gate.
  MP3 encode/upload is a leased durable artifact operation. Failures stay
  pending, retry with bounded backoff, create an incident on exhaustion, and
  can be replayed by audited admin action.
- Etsy `delivered_at` cannot advance before the MP3 object and integrity check
  pass.
- Owner-gated download returns a short-lived URL and safe filename, never an
  object key.
- Passing integrity enqueues a unique `MP3_READY_EMAIL` generation so buyers who
  left the browser receive the final transaction-only download notice.

## Implementation Units

### U0 — Schema, state machines, and launch flags

**Covers:** R1, R2, R6, R8, R9, R11
**Files:** paired migration 137, migration verifier/tests, Etsy repositories.
**Evidence first:** migration parity and repository tests for replay, unit
uniqueness, state monotonicity, claim/refund concurrency, raw-secret redaction,
and legacy backfill incidents.
**Verification:** `npm run verify:migrations`; focused SQLite tests; PostgreSQL
concurrency tests.

### U1 — Etsy provider, webhook inbox, reconciliation, and refunds

**Depends on:** U0
**Covers:** R1, R8, R9, R14
**Files:** Etsy client, admin OAuth connect/callback/reconnect, webhook
verifier/route, ingestion/reconciliation lease service, payment-adjustment
adapter, reversal adapter, server registration, ops metrics.
**Evidence first:** invalid signature/freshness, duplicate/out-of-order paid and
canceled events, crash/replay, OAuth refresh, 429, 5xx timeout, allowlist,
quantity 2+, unspent/spent reversal, payment adjustment mapping, unsupported
partial ambiguity, pagination/cursor crash, 404-then-visible eventual
consistency, two-worker lease, and reconciliation-overlap tests.

### U2 — Identity-bound claim, recovery, merge, and admin policy

**Depends on:** U0, U1
**Covers:** R2, R3, R4, R7, R10, R11, R14, R15
**Files:** claim/recovery services and routes, email templates, guest merge,
admin Etsy routes/service, shared web session refresh, Etsy landing/API.
**Evidence first:** GET/double mount cannot consume; two-secret POST claim;
Turnstile and abuse budgets; quantity 2+ and token reissue; cross-device fresh
challenge/resume; existing-account safety; expired-token refresh; stale order
isolation; atomic journey binding and merge rollback; role/audit matrix; no
URL/log/admin secret; honest precheck and rate-limit states.

### U3 — Durable MP3 and buyer download

**Depends on:** U0, U2
**Covers:** R5, R6
**Files:** runner artifact materialization, artifact repository/retry worker,
download route, Etsy order status, Success UI, admin retry/backfill.
**Evidence first:** one canonical encode and quality/integrity checks;
encode/upload/object-check failure; restart repair; incident exhaustion; no
premature delivery; MP3-ready mail dedupe; owner/stranger; URL expiry refresh;
and UI processing/ready/error states.

### U4 — Commerce-free policy and runtime catalog

**Depends on:** U2
**Covers:** R12, R13
**Files:** server Etsy provenance/status, App/Offer/Success/Dim/SiteChrome,
checkout guard, public pricing hydration, versioned listing manifest/PDF source,
and Etsy listing preflight.
**Evidence first:** new-tab/deep-link/storage-clearing Etsy states expose no
alternate commerce; checkout is rejected; ordinary web remains unchanged;
pricing/listing availability and claims match both runtime product configuration
and the real Etsy listing's active state, currency, price/variation and digital
format. Tax is never represented as the Etsy checkout total.

### U5 — Operations, rollout, and end-to-end proof

**Depends on:** U1–U4
**Covers:** R1–R15
**Files:** Etsy operations runbook, env/preflight, health/admin dashboards,
account deletion/export/PII retention coverage, listing-contract tests, and a
manual fulfilment queue/runbook for Shop Manager
`Complete order → Upload file → Complete order`, with ownership, dual-control,
overdue alert, cancellation instructions, and measured human SLA.
**Verification:** one real Etsy test order proves paid ingestion, claim email,
second-device recovery, song generation, MP3 download, refund reconciliation,
and redacted audit/metrics. Also prove fresh OAuth authorization, forced refresh
and reconnect, listing mismatch fail-closed, and mutually exclusive automated
versus manual listing mode. Automation stays disabled until this passes.

## Verification Contract

### Focused

- `node --test --test-concurrency=1` for changed Etsy, webhook, refund, merge,
  admin, artifact, and route tests.
- `npm --prefix web-funnel test --` for Etsy/session/App/Offer/Success tests.
- Expected red evidence is recorded before each behavior-bearing implementation.

### Affected

- `npm run verify:migrations`
- PostgreSQL Etsy concurrency/integration tests
- `npm --prefix web-funnel run lint`
- `npm --prefix web-funnel run test`
- `npm --prefix web-funnel run build`
- Root lint plus affected backend suite

### Final

- `npm run agent:preflight -- --strict --scope` for every owned path.
- `npm run lint`
- `npm test`
- Full web-funnel lint/test/build.
- One consolidated adversarial code review; every accepted finding gets a
  regression test and re-verification.
- Production-like Seller App receipt preflight and real-order dry run remain
  explicit external evidence; absence blocks enablement, not deployment of
  dark schema/code.

## Rollout

1. Deploy paired schema, read paths, redacted health, and disabled flags.
2. Configure signing secret, keyed code/claim pepper, encrypted Etsy OAuth
   connection, shop/listing allowlist, and Cloudflare-only trusted ingress.
3. Backfill legacy grants; resolve every ambiguous incident manually.
4. Enable webhook ingestion and reconciliation with claim disabled; verify paid
   order/unit counts against Etsy.
5. Confirm a real receipt includes `buyer_email` and obtain Etsy policy approval.
6. Verify the real Etsy listing matches the versioned manifest, then enable
   verified claim for a single test listing; complete the real-order dry
   run including cancellation.
7. Choose exactly one live mode: upload the generic non-secret PDF and enable
   approved automation, or publish a made-to-order listing and run the manual
   queue. Never leave the instant PDF live while automation is disabled.

Rollback disables claim and automation independently while preserving the
provider inbox/order ledger for reconciliation. It never deletes paid order,
grant, audit, or artifact state.

## Definition of Done

- Each R1–R15 has an implemented code path and observed regression proof.
- No paid entitlement depends on browser-local credentials or a raw URL secret.
- Paid and canceled events, authoritative payment adjustments, and audited
  post-Etsy local entitlement reversals are monotonic, idempotent, auditable,
  and reconcile to the shared gift wallet. The application never claims to
  issue the Etsy money refund itself.
- MP3 delivery is durable, retriable, owner-gated, and visible to the buyer.
- Etsy provenance remains commerce-free across reloads/devices.
- Runtime price/listing claims cannot drift from active product configuration.
- All focused, affected, migration, PostgreSQL concurrency, full, and review
  gates pass.
- Automation remains disabled until Etsy identity/policy and the real-order dry
  run are proven.

## Residual external decisions and evidence

- Etsy written approval for generic-PDF plus transaction-only email claim and
  final-download delivery.
- Real Seller App verification that `buyer_email` is populated.
- Production Etsy OAuth/signing credentials and listing identifiers.
- A real production MP3 listening check at the configured bitrate; the current
  source is AAC/M4A and the MP3 is a compatibility transcode, not lossless.
- Final public claim-link SLA. Until measured, listing copy must not promise
  “instant” song completion; manual fallback advertises its human SLA.
- Approved PII retention duration: encrypted buyer email is redacted after the
  fulfilment/support window, while non-PII financial/reversal evidence remains.

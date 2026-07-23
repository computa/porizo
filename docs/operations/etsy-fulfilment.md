# Etsy fulfilment operations

## Launch state

`etsy_fulfilment_mode` is the only runtime authority:

- `off`: no Etsy buyer entry, code claim, provider webhook, OAuth bootstrap,
  receipt reconciliation, or provider fulfilment worker.
- `code`: manual, receipt-assigned codes at `/etsy/code`; provider automation
  remains dark.
- `api`: receipt entry and provider automation; `/etsy/code` remains available
  so previously issued codes never strand.

Invalid or unreadable values fail closed to `off`. The migration-137 Etsy
booleans are inert compatibility data and must not be used as operational
controls.

Launch the wedge in `code` only after:

- The listing is made-to-order and states the manual delivery SLA.
- The generic instruction file points to `/etsy/code` and contains no code.
- An operator has tested issue, reveal, delivery marking, verified-email claim,
  cross-device sign-in, MP3 download, cancellation, and audit.
- Each paid Etsy receipt is assigned exactly one code through the audited
  superadmin endpoint. Generic bearer-code batches remain retired.
- The listing price, currency, active state, digital format, SLA, revision
  promise, and refund promise match the approved listing manifest.

Do not switch to `api` until all of these are proven:

- A real Seller App receipt includes `buyer_email`.
- Etsy has confirmed that the generic instruction file plus transaction-only
  claim/final-download emails comply with seller policy.
- `ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`, `ETSY_ACCESS_TOKEN`,
  `ETSY_REFRESH_TOKEN`, `ETSY_SHOP_ID`, `ETSY_LISTING_IDS`,
  `ETSY_WEBHOOK_SECRET`, and
  `ETSY_DATA_ENCRYPTION_KEY`, `ETSY_DATA_ENCRYPTION_KEY_ID`, and
  `ETSY_DATA_ENCRYPTION_KEYRING` are configured.
- Webhook signature, duplicate delivery, reconciliation, claim on a second
  device, MP3 download, cancellation, and audit have passed with a real order.

An event is acknowledged only after its verified webhook ID and body digest are
durably inserted. Processing failures stay retryable. Never fetch a webhook's
arbitrary `resource_url`; construct the receipt URL from configured shop and
receipt IDs.

`ETSY_KEYSTRING` is the OAuth `client_id`. API requests send
`x-api-key: <ETSY_KEYSTRING>:<ETSY_SHARED_SECRET>`; never put the shared secret
in an OAuth token request. `ETSY_WEBHOOK_SECRET` must be Etsy's canonical
base64 `whsec_` value decoding to at least 32 bytes.

Initial OAuth authorization is currently an operator-controlled credential
bootstrap, not an in-product connect screen. Store the access and refresh tokens
in the production secret manager, set `ETSY_TOKEN_GENERATION` to a positive
strictly increasing integer, and restart once to seed the encrypted
`etsy_connections` row, then remove plaintext values from the runtime
environment where the hosting platform permits it. Refresh-token rotation uses
a database lease and version fence so only one replica calls Etsy; a stale
`invalid_grant` cannot disconnect a newer token generation. A genuine
`reconnect_required` state requires the operator to obtain new credentials and
advance `ETSY_TOKEN_GENERATION` before restart. A process carrying an old
generation cannot reconnect or overwrite the newer credential lineage.

Rotate the Etsy data key without an unreadable-data window: retain the old
`ETSY_DATA_ENCRYPTION_KEY_ID` and key in the JSON
`ETSY_DATA_ENCRYPTION_KEYRING`, install the new key under a new current ID,
then deploy. Decryption and buyer-email lookup accept both lineages while all
new writes use the new key. Keep the prior key in the production secret manager
until a verified re-encryption/backfill reports zero envelopes with its ID;
removing a still-referenced key is a release-blocking error.

Run the count and backfill through Railway so production database access stays
inside the service environment:

```sh
railway run npm run etsy:key:scan
railway run npm run etsy:key:rotate
railway run npm run etsy:key:scan
```

Do not remove a previous key until the final scan reports
`old_envelope_count: 0`.

Outside `api`, the Etsy provider webhook returns 404 before ingestion and no
provider worker runs. Switching away from `api` is therefore an emergency stop,
not a lossless pause: reconcile the disabled interval from Etsy before declaring
the system current. Webhook requests larger than 256 KiB are rejected before
JSON parsing.

## Manual code mode

1. Verify the Etsy receipt is paid and not canceled.
2. Issue one code with
   `POST /admin/dashboard/etsy/codes/issue`, including `receipt_id`,
   `listing_id`, `batch_label`, and a fresh `Idempotency-Key`. The endpoint is
   superadmin-only, returns the bearer code once, and creates an assignment
   record.
3. Send the code through the buyer's Etsy order messages. If the response was
   lost before delivery, a superadmin may use the audited one-time operational
   reveal endpoint while the assignment is still `assigned`.
4. Mark delivery with
   `POST /admin/dashboard/etsy/codes/:receiptId/delivered`, a delivery evidence
   reference, and a fresh `Idempotency-Key`. Delivered codes cannot be revealed
   through the admin API.
5. The buyer opens `/etsy/code`, types the code separately, and verifies an
   email. The server holds the pending code claim; the email link contains no
   code and may be opened on another device.
6. Verification atomically resolves the canonical account, burns the code, and
   grants one shared gift-wallet credit. That credit is fungible across web and
   the app.

Never send `/etsy?code=...`, store a code in browser storage, or paste one into
the generic Etsy file. Never issue an unassigned batch for live orders.

## Automated mode

1. Upload the generic instruction file generated from
   `marketing/etsy/fulfilment-instructions.html`. It contains no receipt,
   redemption code, token, or buyer data.
2. `order.paid` creates an order and one unit per quantity.
3. Buyer opens `/etsy`, enters the receipt number, and signs in through the
   verified email flow using the email on the Etsy receipt.
4. Claim grants the shared gift wallet and creates an Etsy fulfilment journey.
5. The normal gift lifecycle creates the song. Etsy delivery remains pending
   until the durable MP3 artifact passes integrity checks.
6. Final transaction-only email and Success expose the authenticated MP3.

Do not advertise instant song completion. Publish only a claim-link and final
song SLA measured by production-like dry runs.

## Refunds and cancellation

`order.canceled` triggers an authoritative receipt/payment refetch. Deduplicate
payment adjustment and item IDs. Reverse only deterministically mapped units.
Fee-only, failed, partial, or ambiguous adjustments enter manual review rather
than guessing. Unspent credits are removed; spent credits use the shared
purchase-reversal debt semantics.

The application does not issue money refunds. Refund money in Etsy Shop Manager
first. The retired `/refund` admin route returns `410`; after Etsy confirms the
refund or cancellation, a superadmin may call the audited `local-reversal`
operation with a reason and Etsy evidence reference. Its response explicitly
reports `money_refunded: false`.

In code mode, void an unredeemed assignment before marking the Etsy refund
complete. A redeemed assignment retains its receipt, owner, grant transaction,
and delivery state for support and accounting; never delete or reassign it.

## MP3 incidents

`track_artifacts` is the source of truth. A failed artifact is not delivered.
Retry/backfill must be idempotent and verify object existence, byte length, and
SHA-256. Admin retry/replay is superadmin-only and audited. The buyer sees
“still preparing” rather than a broken download.

The current render master is AAC/M4A, so the advertised MP3 is an explicit
compatibility transcode rather than a lossless-source encode. Launch approval
therefore requires a listening check on a real production artifact at the
configured MP3 bitrate; do not describe the download as lossless. Artifact
leases prevent duplicate repair across replicas, and exhausted retries remain
an incident until an audited replay succeeds.

`mp3_ready_email` delivery is a durable leased outbox. Failed sends retry with
bounded backoff and a stable provider idempotency key. After eight attempts the
row becomes `uncertain` and stops retrying automatically so an ambiguous send
cannot spam the buyer; operations must reconcile it manually.

Every manual MP3 replay and reconciliation call must include a fresh
`Idempotency-Key` (8–128 characters). Retrying the same HTTP operation reuses
that key and one audit intent; a later deliberate replay uses a new key and
therefore creates a distinct audit record.

## Privacy

Buyer email is transaction-only. It is encrypted at rest and separately
HMAC-indexed. Redact encrypted contact after the approved fulfilment/support
retention window while retaining non-PII receipt, grant, reversal, and audit
identifiers required for accounting. Include Etsy order/unit/artifact state in
account export; deletion tombstones ownership without destroying the immutable
financial ledger.

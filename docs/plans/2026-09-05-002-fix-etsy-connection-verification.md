# Etsy connection verification before deployment

## Objective

Make Porizo's Etsy receipt exporter use an authorized shop connection independently of the retired fulfilment mode. Verify live receipt and payment reads before deployment. Do not deploy or enable the old redemption flow.

## Work checklist

- [x] Read pstack Principles in full. Model shop authorization separately from fulfilment; fix the mode-gated credential access at its source.
- [x] Reproduce it yourself on the matching surface via the driver skill. All four new server-wiring cases failed on the baseline.
- [x] Binary-search the cause. Mode gates prevented database credentials/bootstrap; the client also fell back to environment tokens after missing or revoked storage credentials.
- [x] Plan the fix. Remove credential-mode coupling and make the configured token provider authoritative. No new public API.
- [x] Verify on the same surface; the original repro now passes. Main-checkout affected suite: 48/48. Scope network-count assertions to Etsy so unrelated server startup probes do not affect the security regression.
- [x] Stage the commits so the failing repro lands before the fix in git history. Intentionally skipped: no commit requested and checkout is not authorized for release.
- [x] Run Opening a PR. Intentionally skipped: verification before deployment, not a PR.
- [x] Check local configuration without printing secrets. No Etsy variables in `.env`.
- [x] Check Railway production variables without printing secrets. No `ETSY_*` variables configured on the `porizo` service.
- [x] Inspect logged-in Etsy developer applications and complete available authorization steps. Seller app approved; PKCE grant completed with `shops_r transactions_r`.
- [x] Read an authorized real receipt/payment through the local exporter, or record the exact external prerequisite that prevents it. Live shop 67327622 and receipt listing passed; zero orders exist, so receipt/payment export is externally blocked until a real paid order exists.
- [x] Review, affected tests, and handoff with an explicit deployment hold. Full backend suite: 3510 passed, 25 skipped, zero failures (3535 total), 606 seconds. Final affected source/test Oxlint and scoped whitespace checks pass. Existing central-server complexity/anti-slop debt remains outside this patch; no whole-repo lint pass is claimed.

## Throughput checkpoint

Expected 45–90 minutes. One isolated native bug-fix lane owns `src/server.js`, a new connection wiring test, and only reproduced client issues. Parent checks Etsy/Railway prerequisites. First result within ten minutes; hard lane limit twenty minutes. This avoids concurrent edits to credentials and source. App approval, shop consent, or a missing paid receipt may block live proof.

## Context and evidence

Branch `feat/web-recipient-delivery-parity`. Preflight found 225 dirty paths, 218 outside this slice, zero staged outside scope. Preserve them. Railway project `amiable-blessing`, service `porizo`, production environment. Nine Etsy variables prepared with `--skip-deploys`, values verified without printing credentials. No deployment requested.

An Etsy OAuth connection is an encrypted row in `etsy_connections`, scoped to `shop_id`, with access/refresh tokens, connection status and token version. It must be available to the made-to-order exporter when `etsy_fulfilment_mode` is `off`. Fulfilment policy must not control credential retrieval or token refresh.

Live proof: invalid access credentials elicited a real Etsy 401; refresh succeeded, encrypted token version advanced to 2, and a rebuilt server read receipts using only the stored credentials. Rotated credentials were saved to macOS Keychain before preparing Railway variables. No paid provider call, buyer message, purchase, or Etsy order mutation occurred.

Live listing review found HTML-encoded question labels and option values. A new regression reproduced rejection of `Recipient&#39;s name`; the Etsy input boundary now decodes labels/answers once using the already-installed `he@1.2.0`, promoted to a direct dependency. Decoding is not applied again to uploaded canonical JSON. Affected parser/pipeline/bootstrap/admin tests: 35/35. Changed modules/tests pass Oxlint CC/anti-slop. Live five-question ordering, required flags, 256/256/1000 limits and all 360 occasion/style combinations match the local contract.

Railway deployment before and after variable preparation: `ce80467a-9cf6-4d23-910b-ad6dbd386d24`, status `SUCCESS`. This confirms the variable preparation did not deploy the code or restart the running service.

Evidence logs: `/private/tmp/porizo-etsy-connection-tests.log` (48 affected tests), `/private/tmp/porizo-etsy-entity-tests.log` (35 post-decoding affected tests), `/private/tmp/porizo-etsy-connection-full-tests.log` (full suite, including the new decoding regression). Code was not committed or deployed. The isolated OAuth lane completed in approximately 18 minutes, overlapping the live registration/authorization work; do not add this duration to parent wall time.

Deployment hold: choose/configure `ETSY_MTO_OWNER_ID`; finish local verification; then obtain explicit deployment approval. A real paid receipt and buyer download remain end-to-end launch evidence. The local callback is an operator bootstrap URL, not a production endpoint.

# Etsy made-to-order fulfilment

## Delivery contract

Etsy supports made-to-order digital listings: the seller attaches the finished file when completing the order. The earlier instant-download-only conclusion was incorrect. Porizo's listing is made-to-order; there is no instant-download option. A real paid order and buyer download remain required operational evidence, not something local fixture tests prove.

Porizo creates the song. Etsy delivers the final MP3. Porizo never sends an Etsy buyer a redemption code, a Porizo share link, a Porizo email, or a Porizo download link.

## Before opening the listing

- Set `ETSY_MTO_OWNER_ID` to an active system account that can render with `ai_voice`.
- Set `ETSY_SHOP_ID` and `ETSY_LISTING_IDS` to the live shop and the eligible made-to-order listing.
- Keep the retired `etsy_fulfilment_mode` flag `off`. Import refuses to run alongside the old code/API redemption flow.
- Configure the existing authenticated Etsy API client (`ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`, OAuth credentials with receipt/payment read access). Missing configuration disables this workflow with an explicit error, not the rest of Porizo.
- Confirm the listing uses the five checkout fields in `marketing/appstore/etsy/listing-copy.md`.
- Run one paid buyer-account test before launch. Verify the Etsy personalization fields, the uploaded MP3, and the buyer Etsy Downloads page.

## Per-order runbook

### Connection configuration

The approved own-shop seller app is **Porizo Order Fulfilment** (`porizo-order-fulfilment`). It is authorized for `shops_r transactions_r` only. Shop ID: `67327622`; eligible listing ID: `4569202477`. No order-writing or listing-writing scope is granted.

Configure `ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`, `ETSY_SHOP_ID`, `ETSY_LISTING_IDS`, `ETSY_ACCESS_TOKEN`, `ETSY_REFRESH_TOKEN`, `ETSY_TOKEN_GENERATION`, `ETSY_DATA_ENCRYPTION_KEY`, and `ETSY_DATA_ENCRYPTION_KEY_ID`. Initial token generation is `1`; increase it only for a newly authorized replacement connection, not routine refreshes. Keep the encryption key stable so existing encrypted records remain readable.

On first use, Porizo bootstraps the OAuth tokens into encrypted `etsy_connections` storage regardless of the fulfilment mode. Thereafter the connected database row is authoritative. Refreshes are coordinated and persisted; missing or reconnect-required rows cannot silently fall back to environment tokens.

The authorized credential bundle is stored locally in macOS Keychain under service `com.porizo.etsy.connection`, account `porizo`. Do not print it, commit it, or copy it into a ticket. Railway production variables were prepared with `--skip-deploys`; the running deployment has not picked them up. `ETSY_MTO_OWNER_ID` still needs an explicitly selected active generation account before release.

Authorization uses Etsy's authorization-code flow with PKCE and single-use state. The registered local operator callback is `https://localhost:9443/etsy/callback`. It is not a deployed Porizo callback endpoint. During the initial supervised grant, the callback URL was captured locally, its state and destination checked, and its one-use code exchanged directly with Etsy. Repeat authorization if Etsy revokes the grant; never reuse the authorization code.

**Verification on 2026-09-05:** live shop and receipt-list reads passed through Porizo's server with mode `off`. Live 401 recovery, token refresh, encrypted persistence, and server restart using stored credentials also passed. Etsy returned zero receipts. Actual receipt/payment export, five-field personalization mapping, song generation, MP3 upload, and buyer download still require a real paid order; fixtures do not prove these live contracts.

The live listing personalization API confirms all five required questions in the expected order, 15 occasions, 24 styles, and a 1000-character memory. Every occasion/style combination passes local catalog normalization. Etsy returns HTML-encoded text in this API (for example `Recipient&#39;s name`); the transaction parser decodes labels and answers once, before matching fields and checking canonical values. Uploaded canonical JSON is not decoded again. Etsy documents transaction personalization in `variations` with `property_id: 54` in its [personalization migration guide](https://developers.etsy.com/documentation/tutorials/personalization-migration/).

### Fulfil an order

1. In Etsy Shop Manager, confirm the order is paid, not canceled or refunded, and belongs to the eligible listing.
2. In Admin at `/admin/etsy`, enter the receipt ID and choose **Download order JSON**. This is Porizo's authenticated Etsy API exporter, not an Etsy-native JSON download button and not the sales CSV report.
3. Upload that JSON, review all five answers, and acknowledge **Import and generate songs**. Export, preview, and confirmation check current Etsy payment and personalization. The server persists the units before returning, then automatically creates lyrics and enqueues rendering. You can close the browser. Reimporting the same unit does not create another song.
4. When the unit becomes `ready_for_etsy_upload`, download the MP3 from Admin.
5. Open the exact Etsy order in Shop Manager. Choose Complete order, upload the MP3, and complete the Etsy order.
6. Return to Admin. Enter the receipt again, acknowledge the upload, add the restricted Etsy completion evidence reference, and record the completion attestation.

`etsy_completion_attested` records a human statement. It is not proof that Etsy delivered the file. The buyer Etsy Downloads screen in the paid test order is the launch proof.

Download and attestation recheck Etsy eligibility and compare current personalization. Download verifies the stored bytes against the MP3 artifact size and SHA-256. Listen to the downloaded song before uploading it to Etsy. No automatic Etsy upload is performed.

## JSON and production limits

- Schema version 1; maximum 128 KiB and 20 eligible transactions per receipt. Unrelated listings are excluded.
- Each transaction must have quantity 1. Quantity greater than 1 is rejected because one set of personalization answers cannot safely identify several songs. Export never invents per-recipient briefs.
- Exactly five configured labels are required. Short answers allow 256 characters; the specific memory allows 1000. Occasion and song style must match the supported catalog. Unknown, duplicated, missing, stale, or edited answers fail closed.
- The file includes the five checkout answers, not later Etsy Messages. Additional story details or changed instructions sent through messages require operator handling; they are not silently merged into an already imported brief.
- Export requires a settled payment with no adjustments, an eligible paid receipt, and the configured shop/listings. Uploaded JSON is not payment proof by itself: import re-fetches Etsy.
- Production sweeps run every five seconds independently of the browser. Database uniqueness and per-item claims prevent normal duplicate generation. Known render jobs resume after a restart; uncertain interrupted lyric/provider work is held for review.
- The queue exposes only error codes, not provider errors containing buyer stories. Protect exported files as buyer data; do not commit them.

## Handling failures

- If render or MP3 preparation fails, leave the unit out of `ready_for_etsy_upload`. Resolve the production failure before attempting Etsy completion.
- `needs_attention` is intentionally not a one-click paid retry. Inspect the linked track/version/job first; do not import under a fabricated receipt to bypass it. An interrupted external operation may already have incurred cost.
- If Etsy upload fails, leave the unit ready and retry only in Etsy Shop Manager.
- Cancel or refund in Etsy first. Do not use Porizo to issue money refunds.
- Keep buyer stories, receipt data, audio, and screenshots in the approved restricted evidence location. Do not add them to the repository or a support ticket.

## Retired contract

The old code-redemption workflow is not part of this launch. Do not issue codes, direct buyers to `/etsy` or `/etsy/code`, grant Porizo credits, or send Porizo delivery email for Etsy orders.

# Etsy native made-to-order fulfilment plan

## Current execution amendment: file import to ready MP3

This amendment replaces the manual-entry intake and mandatory lyric-approval steps below. The historical checklist remains a record of the earlier proposal, not evidence of completed work. Maintain this amendment under `~/.codex/PLANS.MD`. Ambrose requested implementation on 2026-09-05. Do not start a new PR stack or deploy merely because the historical checklist says to do so.

### Purpose / Big Picture

An operator exports one Etsy order as a JSON file, uploads that file in Porizo Admin, reviews the extracted order, and selects Import and generate. Porizo creates the lyrics, runs its existing moderation and quality checks, generates the song, prepares the MP3, and shows Download MP3. The operator uploads that file when completing the matching order in Etsy. Etsy delivers the buyer's download. Buyers never create a Porizo account or redeem a code. Sales CSV reports are not an input to this workflow.

The intended normal path has no retyping of the five answers, no manual lyric approval, and no repeated Check MP3 action. A rejected brief or failed generation requires attention rather than an invented answer or an unbounded paid retry. Audio remains available for operator listening before Etsy completion.

### Progress

- [x] (2026-09-05) Read the existing MTO service, routes, admin screen, and server integration. Confirmed that file import is absent.
- [x] (2026-09-05) Read pstack principles. Boundary discipline requires validating the external export before it enters the generation system.
- [x] (2026-09-05) Inspect the live Etsy Download Data page. It offers Order Items, Orders, Etsy Payments Sales, and Etsy Payments Deposits CSV exports.
- [x] (2026-09-05) Request the 2026 Order Items export. Etsy reports that it generates the download and emails a link. No CSV bytes or populated order fixture have been obtained.
- [x] (2026-09-05) Confirm official API documentation returns multiple personalization answers in transaction variations. This is evidence for API data, not proof of CSV contents.
- [x] (2026-09-05) Ambrose clarified that the input must be one order JSON file, not a sales CSV. CSV investigation is closed and does not block the JSON design.
- [x] (2026-09-05) Found existing `etsyClient.getReceipt(receiptId)` and `getPaymentByReceiptId(receiptId)` in `src/services/etsy-client.js`.
- [x] Freeze version 1 JSON contract and implement authenticated exporter plus live revalidation.
- [x] Preserve dirty branch `feat/web-recipient-delivery-parity`; isolate JSON/UI agent assignments and integrate only explicit files. No commit or deployment.
- [x] Select the smallest design: durable MTO units drive the existing render jobs; no CSV parser, browser extension, parallel generation platform, or private import-record subsystem.
- [x] Implement strict import preview and confirmed import with duplicate/conflict handling.
- [x] Implement durable automatic lyrics, render enqueue, MP3 repair and queue reconciliation.
- [x] Replace manual Admin intake with JSON upload/review, progress, readable lyrics, MP3 download and explicit completion controls.
- [x] Consolidated adversarial review and focused final review; fix startup configuration failure, queue starvation, stale answers, post-readiness refunds, delayed track links, stale-worker mutation, interrupted render recovery, missing-anchor approval and serialized lyric display.
- [x] Browser fixture verifies upload → preview → acknowledged import → ready MP3 → download → receipt-confirmed attestation. Wrong receipt keeps completion disabled. All data and API responses in this browser check are synthetic.
- [x] Full backend regression passes: 3,504 passed, 24 skipped, zero failures (593 seconds). Follow-up focused checks cover the final review fixes.
- [ ] Verify a real paid order from original Etsy export through buyer download. Record external evidence privately.

### Implemented contract and deviations from the initial proposal

This section is authoritative over the original proposed implementation details below.

- `src/services/etsy-mto-order-file.js` owns the strict Zod envelope and shared brief normalization. `exportOrder()` reads Etsy receipt/payment; `verifyFile()` re-fetches current Etsy data. The unsigned local file is never trusted as payment proof. Missing configuration produces an operation error without breaking server startup.
- Routes: `GET /admin/dashboard/etsy/mto/export/:receiptId`, `POST /admin/dashboard/etsy/mto/import/preview`, and `POST /admin/dashboard/etsy/mto/import`. Confirmation accepts the original bounded JSON text again, revalidates it, and atomically inserts units; no expiring preview record is necessary.
- One receipt, at most 20 eligible transactions, quantity exactly 1 per transaction. Greater quantity fails closed until a product contract can identify each song's brief. Do not manufacture quantity ordinals from one answer set.
- Existing unit states are reused. `received` is the durable queue, `verified_paid` covers lyric production, `lyrics_review` is a short internal stage (not a mandatory operator action), then `rendering`, `ready_for_etsy_upload`, and `etsy_completion_attested`. Failures become `needs_attention`.
- Migration 140 adds claim token, lease expiry and safe error code. Five-second sweeps claim units and fairly rotate work. Track/version links persist before external lyric work. State/link writes are token-fenced and claims are checked before external steps. Expired uncertain work is not automatically charged again. A committed render job can be recovered without resubmitting it.
- Download and completion perform a fresh Etsy eligibility/brief check. Download verifies size and SHA-256. Listening uses the downloaded MP3; there is no separate in-browser audio player. Human attestation remains distinct from Etsy/buyer delivery proof.
- No automatic retry button for uncertain paid work. Operators must investigate the linked track/version/job; do not fabricate identities or re-submit provider work blindly.

### Verification evidence (2026-09-05)

- Focused Node contract, repository, pipeline, bootstrap, route and artifact tests: 47 passed, zero failures. Command: `NODE_ENV=test node --test test/services/etsy-mto-*.test.js test/services/etsy-artifact-service.test.js test/database/etsy-mto-repository.test.js test/routes/admin-etsy-mto.test.js`.
- Full suite: `npm run agent:watch -- --estimate-minutes 8 -- npm test` → 3,504 passed, 24 skipped, zero failures in 593 seconds. Log: `/private/tmp/porizo-etsy-full-tests.log`. Final localized changes were rechecked with the focused suite rather than rerunning unrelated successful tests.
- Real PostgreSQL 14 check: `PG_TEST_DB=porizo_etsy_verify_20260905_0329 node tools/run-tests-postgres.js test/database/etsy-mto-postgres.test.js` → migrations applied, concurrent-import/claim regression passed. The isolated test database was dropped afterward. Explicit text casts prevent PostgreSQL null-parameter type ambiguity in fenced SQL. Log: `/private/tmp/porizo-etsy-pg.log`.
- Integrated fixture uses real SQLite migrations/repositories/routes and render-job creation, with mocked Etsy/provider/storage boundaries. It proves one render job, MTO track isolation, ready-state reconciliation, matching MP3 download, checksum rejection, refund rejection and completion attestation. It does **not** prove real provider audio or Etsy buyer delivery.
- Oxlint with repository anti-slop rules and CC≤20 passes for new MTO modules, repository/routes, artifact service and Admin components. Existing `src/server.js` still has unrelated complexity/anti-slop violations; no threshold was raised or suppression added. New bootstrap code was extracted into its own checked module.
- Admin TypeScript and production Vite build pass (build output kept outside the dirty `public/admin` tree). Existing large-chunk warning remains.
- `npm run verify:migrations` passes.
- Browser fixture evidence: `/private/tmp/porizo-etsy-ui-{preview,ready,download,completed}.png`; fixture counters show one preview, import, download and completion. The fixture is not production.
- Two native agent lanes supplied implementation/review. Review diversity is limited to the available native runtime, not independent external model providers.
- Local Etsy credential/configuration variables are absent. Live receipt shape, OAuth access, real generation, production deployment and buyer download remain external evidence work.
- Final preflight: 224 dirty paths, 197 outside the declared scopes, zero staged outside scope. Existing unrelated edits were preserved; no commit or deploy. The local synthetic browser server was stopped after QA. Native agent assignments are complete.

### Surprises & Discoveries

The live listing is made-to-order and uses five required fields in this order: Recipient's name, Your relationship to them, Occasion, Song style, and A specific memory or message. The memory field allows 1,000 characters. Recipient and relationship allow 256 characters. There are 15 occasions and 24 styles.

`src/services/etsy-mto-service.js` currently limits all fields to 500 characters and defines an unrelated style allowlist. Replace that duplication with the canonical style registry in `src/providers/style-registry.js`. In particular, valid published styles such as Afrobeats and Amapiano currently fail intake. Map display names to canonical keys, including R&B, Jùjú, Igbo Highlife, Bossa Nova, and Latin Pop. Read the occasion definitions used by the product and preserve the 15 published choices.

`admin/src/pages/EtsyMto.tsx` posts manually entered JSON. It has no upload control. It stores a selected item snapshot that can become stale after queue refresh. It displays brief JSON rather than the lyrics it asks an operator to approve. Its completion action currently fills acknowledgement and receipt automatically instead of asking the operator to confirm them.

`verifyPaidUnit` in `src/server.js` checks configured shop, listing, owner, and a nonempty evidence reference. It does not independently check an Etsy payment. An uploaded local file is also not cryptographic proof of payment. Treat an authenticated operator's confirmation as an attestation unless a live Etsy check exists.

The previous statement that Etsy cannot attach files after purchase was incorrect. The live editor and public listing confirm made-to-order download after seller completion. There must be no generic instant-download instruction file.

### Decision Log

On 2026-09-05, Ambrose chose a per-order JSON handoff and explicitly rejected sales CSV. Build an Export order JSON action using the existing authenticated Etsy receipt and payment read methods. Do not claim Etsy Shop Manager has a native JSON download button without observing one. The exporter reads Etsy data and produces `etsy-order-<receipt-id>.json`; it does not require the operator to assemble JSON or copy five answers.

The proposed exporter belongs in Porizo Admin, with an Etsy order ID as input, because the existing backend already owns Etsy credentials. This placement requires confirmation if Ambrose specifically requires the download action inside Etsy's own page. Do not silently substitute a browser extension or inject a persistent script into Etsy. If API access is unavailable, report the exact prerequisite before claiming that order export works.

Use a versioned envelope containing `schema_version`, `exported_at`, configured `shop_id`, the receipt identity and eligibility snapshot, eligible transactions, quantity, and all five named answers. Populate it from the official receipt transaction `variations` array, where multiple personalization entries can have `property_id: 54` and custom `formatted_name` values. Map by exact known question labels, never array position. Keep the raw authoritative response server-side only as needed for audit and minimize personal data in the downloaded file. Sign the exported envelope with server-held key material and verify it on import, or re-fetch the Etsy order on import. A user-editable JSON boolean must never be the only payment check.

On 2026-09-05, the normal generation path changes from mandatory human lyric approval to automatic production after one explicit Import and generate action. Existing moderation and lyric validation remain mandatory. Failures stop in needs_attention. Operators can review the result before fulfilling Etsy, but the happy path does not require intermediate approval clicks.

On 2026-09-05, payment and production remain separate facts. Export uses authenticated Etsy reads and import refreshes current paid, canceled, and refund status before production. Missing or stale evidence blocks generation. Do not silently add OAuth scopes or scrape customer data from other sources. Show the evidence source and the production count before Import and generate incurs expense.

### Context and Orientation

The existing files are `src/services/etsy-mto-service.js`, `src/database/etsy-mto-repository.js`, `src/routes/admin/etsy-mto.js`, `admin/src/pages/EtsyMto.tsx`, and paired `139_etsy_mto.sql` migrations. Server wiring is in `src/server.js`. Rendering uses the existing durable jobs and `src/workflows/runner.js`. MP3 preparation already exists in `src/services/etsy-artifact-service.js`.

Keep one fulfilment unit per `(shop_id, receipt_id, transaction_id, ordinal)`. The ordinal identifies a purchased unit within a quantity and starts at zero. Never use recipient name or CSV row number as identity. The eligible live listing is `4569202477`; configure it through `ETSY_LISTING_IDS`, not a source-code constant. Keep `ETSY_SHOP_ID` and `ETSY_MTO_OWNER_ID` server-owned. An uploaded file must not choose the production account.

### Plan of Work

First implement the per-order exporter against the documented receipt and payment API contracts. Verify a private real response and create a structurally identical anonymized fixture. Preserve line breaks, Unicode, long messages, and all named personalization entries. Determine whether several items or quantities share a brief. Reject ambiguity rather than combining several recipients into one song. Describe the exact Export order JSON and upload steps in `docs/operations/etsy-fulfilment.md`.

Implement a pure JSON parser in `src/services/etsy-mto-import.js`. Enforce a bounded file size and transaction count, an explicit schema version, allowed listing IDs, explicit identifiers, complete answers, valid lengths, canonical styles and occasions, and verified source evidence. Reject unsupported versions, malformed JSON, unknown required semantics, and mixed-order envelopes. Do not use an LLM to infer missing identifiers, payment, or answer boundaries. Exclude unrelated buyer addresses and email.

Add superadmin-only preview and confirmation routes under `/admin/dashboard/etsy/mto/imports`. Preview parses and validates without generating lyrics, creating tracks, or spending money. Return row errors, existing matching units, conflicting units, proposed generation count, and the five extracted answers. Confirmation must revalidate server-side from a bounded private import record identified by a digest. Do not trust a client-edited preview payload. Expire abandoned imports and redact source data from logs.

Persist the confirmed import before starting external work. The request returns promptly with a durable import ID and unit IDs. Reuse the existing job infrastructure for production, not an unawaited promise or a browser polling side effect. A closed browser, process restart, repeated upload, or repeated confirmation must not create a second track or second provider charge. Use database uniqueness and transactional claims in PostgreSQL and SQLite. Recover interrupted stages using stored track, version, and provider job IDs. An uncertain provider submission goes to needs_attention rather than blindly submitting again.

Extend MTO production through explicit received, verified_paid, generating_lyrics, rendering, preparing_mp3, ready_for_etsy_upload, needs_attention, and etsy_completion_attested states. Validate any required schema changes in both database migrations. Automatically reconcile completed renders and failed jobs. Preserve existing moderation and no-Porizo-delivery behavior. Only a verified MP3 for the active version can become downloadable. Check storage presence, actual size, checksum, audio type, and Etsy's applicable file limits before readiness.

Replace the Admin manual-entry form with a file picker, parsing feedback, and a review screen. Show each unit's order identity, recipient, relationship, occasion, style, complete message, payment evidence, and duplicate status. Import and generate begins work only for explicitly selected valid units. Display durable progress, failure reasons, retry eligibility, generated lyrics, an authenticated audio preview, and Download MP3. Refresh by selected ID rather than retaining a stale item object. Do not truncate a 1,000-character message in storage or generation context.

Name downloads with the receipt, transaction, and ordinal so operators can match files to Etsy orders. Preserve server-side safe filename construction. Keep order completion manual in Etsy. In Admin, record completion only after the operator re-enters the matching receipt and checks an upload acknowledgement. Store an audit record of the exact MP3 and operator, but never label this as independently verified Etsy delivery.

### Concrete Steps

From `/Users/ao/Documents/projects/porizo`, run scoped `npm run agent:preflight -- --scope <path>` before edits. The current checkout has extensive unrelated changes. Do not stage, overwrite, or deploy those changes as part of this work.

Verify the existing Etsy API configuration without printing credentials. Read one authorized receipt and its payment through `etsy-client.js`. Add a superadmin-only Export order JSON action and endpoint, then download its bounded, versioned envelope. Do not use Settings, Options, Download Data or wait for a sales-report email for this workflow.

Run focused Node tests for importer, service, repository, and routes while implementing. Use `npm run agent:watch -- --estimate-minutes <n> -- <command>` for checks expected to exceed two minutes. Run the affected Admin checks and browser fixture flow before a full release gate. Use Oxlint, not ESLint, and never raise the complexity ceiling to pass. Run `npm run verify:migrations` if migrations change. Record exact commands and outcomes here.

### Validation and Acceptance

A populated per-order JSON file imports without manual answer entry. Export and preview create no production records or jobs. A 1,000-character story survives byte-for-byte where normalization is not intentional. Every published style and occasion maps correctly. Multiline stories, Unicode, unsupported schema versions, malformed JSON, edited evidence, and duplicate labels have deterministic results. Unpaid, canceled, refunded, wrong-listing, missing-answer, and ambiguous orders cannot generate.

Reimporting the same file returns existing units. Exporting the same order again does not regenerate existing units. A changed brief for the same purchased unit produces a conflict, not an overwrite. Concurrent confirmation and a restart after each external stage leave one active track and one effective render submission. Failed units do not prevent valid units from being reviewed, but partial acceptance must be explicit in the preview.

In a synthetic browser test, upload the anonymized Etsy fixture, inspect the preview, confirm generation, close and reopen the page, observe progress to ready, listen, and download a valid MP3. Use controlled providers for this test and label that evidence synthetic. Prove access is denied to unauthenticated and insufficient-role users. Verify no buyer email, redemption code, or public Porizo share is produced.

Final live acceptance requires one legitimate paid buyer order, its original Etsy export, one actual generated MP3, matching Shop Manager upload and completion, and the buyer's Etsy download. Do not buy from the seller's own account or create fabricated reviews. Obtain approval for any test purchase or deployment requiring new authority. A green synthetic test alone is not launch proof.

### Idempotence and Recovery

Retain the source digest and unit identity independently of temporary upload retention. Matching retries return the prior result. Conflicting input requires operator review. Cap automatic retries using existing job policy. Retry MP3 conversion without regenerating the song. A terminal or refunded unit never returns to ready automatically. Recheck current eligibility before manual retry or Etsy completion because an old export cannot reflect a later refund.

### Artifacts and Notes

Official export instructions: https://help.etsy.com/hc/en-us/articles/360000343328-How-to-Download-a-Spreadsheet-of-Your-Sold-Transactions

Official multiple-personalization transaction contract: https://developers.etsy.com/documentation/tutorials/personalization-migration/

The live export page is `https://www.etsy.com/your/shops/me/download`. Keep real buyer files outside the repository in a restricted location. Commit only synthetic or carefully anonymized fixtures. Do not include raw browser HTML, session values, or buyer data in logs or plan evidence.

### Interfaces and Dependencies

The parser produces normalized order units and row-level validation errors from file bytes. Generation accepts only server-confirmed normalized units. The Admin imports API exposes preview, confirmation, and status, with no endpoint that implies uploading to Etsy. Existing MTO download and attestation routes remain internal, authenticated operations. Final route payload shapes depend on the export evidence and must be frozen before frontend implementation.

### Outcomes & Retrospective

The file-import implementation is not complete. The input is now explicitly one order JSON file. The repository already contains authenticated receipt and payment readers, but the exporter, JSON upload, and automatic production integration remain to be built and verified. A sales CSV sample is no longer required. Do not claim that Etsy provides a native per-order JSON download button or that the proposed exporter is operational.

Revision note, 2026-09-05: added Ambrose's file-import and automatic-generation requirement, the 1,000-character brief contract, canonical catalog mapping, durable processing, and honest payment and export acceptance gates. The prior manual-entry proposal below is superseded wherever it conflicts with this amendment.

## Historical proposal

Etsy buyers will give Porizo their song brief at Etsy checkout and will receive the finished MP3 through Etsy Downloads. Porizo will become the internal production system. It will not be the buyer delivery channel. The work replaces the active code-redemption contract and stops before Etsy completion, because Etsy requires the operator to upload each finished file in Shop Manager. The stack has two PRs in order. `MTO-1` creates the server contract. `MTO-2` gives an operator the queue and the launch materials.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/autopilot-stack.md` under the installed plugin. Ambrose reviews and lands the verified stack. Execution starts only on Ambrose's explicit go.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, write the program objective into the standing orders and your todolist with this exact text. "Run `docs/plans/2026-09-05-001-feat-etsy-native-made-to-order-fulfilment-plan.md` in the frozen order MTO-1 then MTO-2. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ambrose lands the stack. Done means one paid test order has its custom MP3 attached and completed in Etsy Shop Manager."
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/architect/SKILL.md`
  - [ ] `skills/principle-model-the-domain/SKILL.md`
  - [ ] `skills/principle-boundary-discipline/SKILL.md`
  - [ ] `skills/principle-make-operations-idempotent/SKILL.md`
- [ ] Arm the 30-minute audit tick as a real cadence. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the standing orders. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a lane only on affirmative failure evidence, and dispatch its replacement in the same tick. Then send the operator a status message, whether or not anything changed, with the queue table of PR, owner, state, and head SHA, the verdicts since the last tick, what merged, open operator gates, and blockers."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent reaches a clean verdict. MTO-1 starts from `main`. MTO-2 starts after MTO-1 and targets the MTO-1 branch.
  - [ ] MTO-1 is first.
  - [ ] MTO-2 follows MTO-1.
- [ ] Hold the file boundaries. MTO-1 owns `migrations/139_etsy_manual_fulfilment.sql`, `migrations/pg/139_etsy_manual_fulfilment.sql`, `src/services/etsy-manual-fulfilment-service.js`, `src/services/etsy-manual-fulfilment-reconciler.js`, `src/database/etsy-manual-fulfilment-repository.js`, `src/routes/admin/etsy-manual-fulfilment.js`, `src/jobs/etsy-manual-fulfilment-retention.js`, `src/server.js`, the full legacy Etsy removal inventory, and their tests. MTO-2 owns `admin/src/pages/etsy/`, `admin/src/App.tsx`, `admin/src/components/Sidebar.tsx`, `admin/package.json`, `marketing/appstore/etsy/listing-copy.md`, `docs/operations/etsy-fulfilment.md`, and the manual launch runbook.
- [ ] Hold the review gate. MTO-2 changes the operator interface. It waits for Ambrose's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Record the intended PR base repository as canonical `<base-repo>` and validate it through the active forge.
- [ ] Open the PR before self-proof and follow the readiness rule in `skills/poteto-mode/playbooks/opening-a-pr.md`. Keep the PR draft until its focused tests and migration parity pass.
- [ ] Run `npm run agent:preflight -- --scope <owned path>` before each edit. Run `npm run agent:preflight -- --strict` with every owned path before each commit. Stage only the named files and run `git diff --cached --check`.
- [ ] Run `npm run lint`, the focused Node tests, `npm run verify:migrations`, and `npm run admin:build` when the changed PR needs them. MTO-2 adds its test runner before claiming an admin unit-test gate.
- [ ] Run `skills/deslop/SKILL.md` before each commit and `skills/no-comments/SKILL.md` before review.
- [ ] Triage every review-bot or security finding as fix, dismiss, or ask. Record the reason in the PR.

### Verdict and merge, for every PR

- [ ] At the merge-ready head SHA, run the repository validation ladder. One check gates static and focused checks. Run the ten local fixture scenarios in the relevant Verify, live block serially. One review audits the diff and the receipts.
- [ ] Accept a PR only when every check and scenario passes. Return findings to the owner. A new SHA gets a new verdict.
- [ ] Append a clean PR to the frozen stack. No owner merges, enables auto-merge, or closes a PR. Ambrose lands MTO-1 before MTO-2.

### Boot recipe, for every live lane

Each local fixture scenario runs serially at the PR head in an isolated worktree and saves a receipt. This obeys the repository limit of three parallel agents. Drive browser work through the available browser automation tool. Do not use a simulated Etsy completion as proof of real Etsy completion.

- [ ] Fetch the exact head SHA into the lane worktree.
- [ ] Run `npm run agent:watch -- --estimate-minutes 8 -- npm test` only for a full backend gate. Use focused test commands for every other lane.
- [ ] Start the server with a temporary SQLite database, a fake object store, an Etsy manual fulfilment owner configured for the fixture, and live providers disabled.
- [ ] Save synthetic-fixture browser screenshots under `/tmp/porizo-etsy-mto/<pr>/scenario-<n>/` and return the file path in the scenario receipt. Never store a real Etsy brief, buyer identity, receipt, audio, or checkout screenshot in the repository.

## Build the manual fulfilment domain (MTO-1)

**Depends on.** None.

**Files.**

- [ ] Create the paired `139_etsy_manual_fulfilment.sql` migrations and `src/database/etsy-manual-fulfilment-repository.js`.
- [ ] Create `src/services/etsy-manual-fulfilment-service.js`, `src/services/etsy-manual-fulfilment-reconciler.js`, `src/jobs/etsy-manual-fulfilment-retention.js`, and `src/routes/admin/etsy-manual-fulfilment.js`.
- [ ] Edit `src/server.js`, `src/workflows/runner.js`, the share-pre-generation path, storage lifecycle policy, and the relevant route registrations.
- [ ] Produce and attach the exact legacy-removal inventory before editing. It includes every registered Etsy route, webhook, OAuth or feature-mode service, funnel page or API, worker, email path, instruction asset, and test. Delete the registrations before deleting implementations.
- [ ] Delete the public redemption routes, the `/etsy` funnel entry, the code issue routes, the generic instruction asset, and legacy mode workers only after the cutover inventory is clear.
- [ ] Create focused repository, service, route, migration, and render-contract tests.

**Build.**

- [ ] Model one delivery unit as `etsy_manual_fulfilments`. Its immutable identity is `(shop_id, receipt_id, transaction_id, ordinal)`. It has `listing_id`, the five-field Etsy brief, a raw-personalization hash, `track_id`, `track_version_id`, `mp3_artifact_id`, `production_state`, `etsy_financial_state`, and delivery-attestation fields. A receipt can therefore contain several fulfilment units without cross-delivering their songs. Store no buyer email, code, public link, or payment method.
- [ ] Freeze the v1 Etsy brief schema. The five fields are `recipient_name`, `occasion`, `specific_memory`, `relationship`, and `style`. The style picker maps only to canonical Porizo style keys. Pronunciation is not collected in v1. Reject unknown values and text outside the Etsy field contract before a track is created. Preserve the raw Etsy field snapshot only for the retention period.
- [ ] Require an `Idempotency-Key` on every mutation. A matching duplicate unit and normalized brief returns the original unit. A changed duplicate returns 409 and appends a redacted conflict audit event without altering the stored brief or any terminal state. Compare-and-set transitions and row locks make cancel, reconciliation, retry, and completion races safe.
- [ ] Separate payment and production truth. `etsy_financial_state` is `active`, `canceled`, `refunded`, or `partial_refund_attention`. `production_state` is `received`, `verified_paid`, `lyrics_review`, `rendering`, `ready_for_etsy_upload`, `etsy_completion_attested`, `canceled`, or `needs_attention`. Before lyrics generation, require a superadmin attestation of the configured shop, eligible listing, exact unit identity, paid status, and observed time with a restricted evidence reference. Reject unpaid, canceled, refunded, wrong-shop, and wrong-listing units.
- [ ] Add a server-only `ETSY_MANUAL_FULFILMENT_OWNER_ID`. Startup fails when the configured production account is absent or cannot render with `ai_voice`. Add real migrations for `tracks.etsy_manual_fulfilment_id` and `tracks.delivery_channel = 'etsy_mto'`. The service creates a track and version for that owner, generates lyrics with the established brief-to-context contract, preserves moderation, and moves the unit to `lyrics_review`. An operator approves the lyrics before the service records the dedicated Etsy fulfilment funding source and queues the full render. It never spends a buyer wallet credit.
- [ ] Prevent Porizo delivery side effects for `delivery_channel = 'etsy_mto'`. The runner must skip share-token creation, share follow-up scheduling, buyer email, public play URL, and Porizo download delivery. Test each absence.
- [ ] Add a reconciliation service with a concurrency-safe claim. It promotes only a `rendering` unit with a full-ready version and verified `full_mp3` to `ready_for_etsy_upload`. The artifact must have a storage key, SHA-256 digest, valid MP3 type, a byte length from 1024 through 20 MiB, and match the active approved version. A failed render, storage mismatch, or exhausted MP3 repair becomes `needs_attention`; a canceled or terminal unit never promotes. Retry creates a bounded new version and preserves prior attempts.
- [ ] Add a superadmin-only MP3 download endpoint. It streams the verified active artifact with a safe attachment filename and `Cache-Control: no-store`. It emits one redacted audit event. It does not create a public URL, buyer email, Porizo share, or delivery email. Reject unauthenticated users, ordinary users, lower roles, stale sessions, and cross-unit artifacts.
- [ ] Split Etsy actions. `Open Etsy order` is non-mutating. `Record Etsy completion attestation` is superadmin-only and occurs only after the operator uploads and completes the exact Etsy unit. It requires the retyped receipt, an explicit upload-and-completion acknowledgement, a restricted evidence reference, and pins artifact ID, approved version ID, SHA-256, byte length, filename, operator, and Etsy completion time. A matching replay returns the original attestation, while changed evidence conflicts. It must never claim that Porizo uploaded a file to Etsy.
- [ ] Define operator recovery. Before completion, an operator can correct a brief, regenerate lyrics, approve the replacement, retry an eligible render or MP3 repair, cancel, or record Etsy-first cancellation or refund. Each action carries a reason and idempotency key, invalidates stale artifact eligibility, retains prior attempts and immutable audit evidence, and uses the legal transition matrix.
- [ ] Add explicit retention. Thirty days after an Etsy completion attestation, cancellation, or refund, a scheduled job deletes the source brief, linked lyrics, linked generated audio and object-store copies, provider or log payloads, and legacy code or claim PII eligible for deletion. It retains only receipt and unit identity, listing ID, state history, hashes, timestamps, and redacted audit metadata. Unresolved units and legal holds block deletion. Store real test-order evidence only in the approved restricted location outside the repository.
- [ ] Make a read-only production cutover inventory a blocking gate. Enumerate every outstanding legacy receipt, code, claim, wallet grant, reservation, render, and outbox delivery. Resolve each through completion or Etsy refund and record restricted evidence before removal. Then remove `code`, `api`, and `off` as public delivery modes together with their workers, funnels, emails, settings, and listing copy. No buyer route, code, generic PDF, redemption credit, receipt webhook, or Etsy email may remain reachable.

**You see.**

- [ ] An authenticated superadmin can attest one paid unit, enter the five Etsy fields, review and approve its lyrics, and render it. The response contains a non-public unit ID and `lyrics_review`, then `rendering`, then `ready_for_etsy_upload` only after a valid MP3 exists. The only downloadable file is the attached MP3.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add repository tests for unit identity, matching and conflicting duplicates, terminal-state preservation, legal transition compare-and-set updates, cancellation races, completion replay, and the PostgreSQL row-lock path. Run `node --test --test-concurrency=1 test/database/etsy-manual-fulfilment-repository.test.js`.
- [ ] Add service tests for the five-field mapping, paid attestation, owner configuration, lyrics moderation and approval, dedicated funding, exactly-once render enqueue, no-share side effects, reconciliation, bounded retries, artifact validation, retention, and completion attestation. Run `node --test --test-concurrency=1 test/services/etsy-manual-fulfilment-service.test.js test/services/etsy-manual-fulfilment-reconciler.test.js`.
- [ ] Add route tests for every superadmin-only mutation and read, rejection of unauthenticated, ordinary-user, lower-role, stale-session, and cross-unit access, public-route removal, idempotency keys, and completion evidence. Run `node --test --test-concurrency=1 test/routes/admin-etsy-manual-fulfilment.test.js test/routes/full-song-mp3.test.js`.
- [ ] Run `npm run verify:migrations` and `npm run lint`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head. Run them serially as synthetic-fixture scenarios under the boot recipe.

- [ ] Lane 1. Regression scenario against trunk. Run the old public Etsy entry at trunk and head. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-1/public-entry.png`. Pass when trunk exposes the old code entry and head returns 404 without leaking a code or unit state.
- [ ] Lane 2. Attest a paid fixture unit with the five valid brief fields. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-2/unit-created.png`. Pass when the response shows `lyrics_review`, one version exists, and no share token or buyer-delivery side effect exists.
- [ ] Lane 3. Submit the same unit and matching brief twice. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-3/idempotent-unit.png`. Pass when both responses reference one fulfilment and no render job exists before lyric approval.
- [ ] Lane 4. Submit the same unit with a changed story, then a different transaction on the same receipt. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-4/unit-identity.png`. Pass when the changed input returns 409 without mutation and the different transaction creates a separate unit.
- [ ] Lane 5. Attempt paid attestation for an unpaid, refunded, wrong-shop, wrong-listing, and missing-memory fixture. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-5/intake-rejected.png`. Pass when every request is rejected before a track is created.
- [ ] Lane 6. Try to render unapproved lyrics, then approve moderated fixture lyrics. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-6/lyrics-gate.png`. Pass when the first request is blocked and the second creates exactly one funded render job.
- [ ] Lane 7. Complete a render with a missing, oversized, or checksum-mismatched MP3, then recover a failed conversion without a second song generation. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-7/artifact-reconcile.png`. Pass when the unit needs attention until the valid active-version artifact moves it to `ready_for_etsy_upload`.
- [ ] Lane 8. Race a cancellation against artifact reconciliation. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-8/cancel-race.png`. Pass when a canceled unit never becomes ready and the provider result is retained only as redacted audit evidence.
- [ ] Lane 9. Download the ready file as a superadmin and as every forbidden role. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-9/mp3-access.png`. Pass when the valid request has `audio/mpeg`, a non-zero attachment body, and `Cache-Control: no-store`, while forbidden requests receive no bytes.
- [ ] Lane 10. Open Etsy without mutation, then record mismatched and matching completion attestations. Save `/tmp/porizo-etsy-mto/MTO-1/scenario-10/etsy-attestation.png`. Pass when only the matching post-upload attestation reaches `etsy_completion_attested`, pins the exact artifact, and its matching replay is idempotent.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure create-to-render-enqueue latency and ready-artifact-to-download latency.
- [ ] Probe. Run ten valid fixture orders at trunk first and then at the head, alternating runs. Trunk lacks the new manual flow, so record that fact and measure the head only for a create request and a ready MP3 download.
- [ ] Baseline. Record the trunk first result as "manual fulfilment unavailable" and record the first head measurements in milliseconds.
- [ ] Rule. Fail when median head create-to-enqueue latency exceeds 500 milliseconds or median ready-artifact-to-download latency exceeds 1000 milliseconds in the fixture environment.

**Review gate.** None. MTO-1 is not review-gated.

**Merge.**

- [ ] Root records a clean verdict at the exact head SHA.
- [ ] The owner documents every retired public route, every retained historical table, the clean production cutover inventory, and the retention worker contract in the PR.
- [ ] Ambrose adds MTO-1 to the stack but does not merge it until MTO-2 has a clean verdict.

## Build the operator queue and replace the listing contract (MTO-2)

**Depends on.** MTO-1.

**Files.**

- [ ] Create `admin/src/pages/etsy/ManualFulfilments.tsx`, `admin/src/pages/etsy/ManualFulfilmentCreate.tsx`, `admin/src/pages/etsy/ManualFulfilmentDetail.tsx`, `admin/src/pages/etsy/contracts.ts`, and their tests. Add the minimal Vitest, jsdom, and Testing Library harness in `admin/package.json` before writing the tests.
- [ ] Edit `admin/src/App.tsx` and `admin/src/components/Sidebar.tsx` to add the Etsy queue under Operations.
- [ ] Replace `marketing/appstore/etsy/listing-copy.md` and `marketing/etsy/fulfilment-instructions.html` with the Etsy-native listing contract. Delete the instruction asset if the made-to-order listing does not need an attached file.
- [ ] Replace the code-mode sections of `docs/operations/etsy-fulfilment.md` with the operator runbook.
- [ ] Create `docs/operations/etsy-native-made-to-order-dry-run.md` with a checklist for one real test purchase.

**Build.**

- [ ] Build a superadmin-only create screen. It collects the exact Etsy shop, receipt, transaction, ordinal, paid-status attestation, restricted evidence reference, and five-field brief. It shows matching duplicates without creating a second unit and blocks conflicted duplicates. It never collects a buyer email.
- [ ] Build a queue with `received`, `verified_paid`, `lyrics_review`, `rendering`, `ready_for_etsy_upload`, `etsy_completion_attested`, `canceled`, and `needs_attention`. Show the exact unit identity, recipient name, occasion, created time, production state, financial state, failure reason, and overdue marker. Do not show a buyer email.
- [ ] Make the detail page show the exact five-field brief, current production and financial states, lyric-review and correction controls, approved-version history, failure reason, one Download MP3 action only when ready, one non-mutating Open Etsy order action, and one Record Etsy completion attestation action after the upload. The attestation requires a retyped receipt, explicit acknowledgement, restricted evidence reference, and the pinned artifact summary. It cannot submit an Etsy completion itself.
- [ ] Write the five Etsy checkout fields exactly as the frozen manifest. Require recipient name, occasion, and one memory. Offer relationship and a curated canonical style list as optional fields. Do not collect pronunciation in v1. State a truthful delivery SLA in business days. State that the buyer receives an MP3 through Etsy Downloads after the order is complete.
- [ ] Remove every reference to Porizo redemption codes, `porizo.co/etsy`, Porizo credits, account creation, an external intake, an external download, an external share link, and email delivery from the Etsy listing and runbook.
- [ ] Write the operator runbook as the exact sequence. Read and verify the paid eligible Etsy unit in Shop Manager. Enter its identity, evidence reference, and brief in the queue. Review or correct generated lyrics, approve them, and review the audio. Download the pinned MP3. Select Open Etsy order. In Etsy Shop Manager select the exact order, select Complete order, upload the MP3, select Complete order, return to Porizo, retype the receipt, acknowledge the upload, attach the restricted evidence reference, and record the completion attestation. If Etsy upload fails, leave the Porizo unit in `ready_for_etsy_upload` and retry only in Shop Manager.
- [ ] State the hard boundary in the runbook. Porizo treats `etsy_completion_attested` as a human attestation, never as proof of Etsy delivery. Etsy remains the source of truth for buyer delivery, cancellation, and refunds. The runbook directs the operator to cancel or refund in Etsy first, then record the financial state and evidence in Porizo.

**You see.**

- [ ] A production operator can move from an Etsy receipt and its checkout brief to a ready MP3, complete that exact Etsy order manually, and retain a redacted Porizo audit trail without ever sending the buyer to Porizo.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add admin UI tests for intake validation, duplicate display, queue filtering, lyric-review controls, missing-artifact states, receipt confirmation, attestation evidence, and disabled completion buttons. Run `npm --prefix admin run test -- --run src/pages/etsy`.
- [ ] Add contract tests that compare the operator API response with `admin/src/pages/etsy/contracts.ts`. Run `node --test --test-concurrency=1 test/routes/admin-etsy-manual-fulfilment.test.js`.
- [ ] Add a listing-copy test that fails on `code`, `porizo.co/etsy`, `credit`, `share link`, and `email delivery`, and requires the words `Etsy Downloads`, `AI`, and the named delivery SLA. Run `node --test --test-concurrency=1 test/marketing/etsy-native-listing-contract.test.js`.
- [ ] Run `npm run admin:build`, `npm run lint`, and `npm run verify:migrations`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head. Run them serially as synthetic-fixture scenarios under the boot recipe.

- [ ] Lane 1. Regression scenario against trunk. Open the Operations navigation at trunk and head. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-1/queue-navigation.png`. Pass when head exposes the Etsy queue and trunk does not.
- [ ] Lane 2. Enter a paid fixture Etsy unit and valid brief. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-2/intake.png`. Pass when the UI creates one `lyrics_review` unit and shows the duplicate result on replay.
- [ ] Lane 3. Open a lyric-review unit. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-3/lyrics-review.png`. Pass when the reviewer can correct and approve lyrics but cannot download or attest completion.
- [ ] Lane 4. Filter the queue to `needs_attention`. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-4/attention-filter.png`. Pass when only synthetic attention fixtures remain with an available recovery action.
- [ ] Lane 5. Open a rendering unit. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-5/rendering-state.png`. Pass when Download MP3 and attestation are disabled.
- [ ] Lane 6. Open a ready unit. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-6/ready-state.png`. Pass when Download MP3 and Open Etsy order are enabled, the manual Shop Manager instruction is visible, and attestation is still protected.
- [ ] Lane 7. Download the ready MP3. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-7/download-action.png`. Pass when the browser receives a non-zero MP3 file and the page remains on the unit.
- [ ] Lane 8. Open Etsy then type the wrong receipt in the attestation dialog. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-8/attestation-rejected.png`. Pass when the Open Etsy action has no mutation and the attestation remains blocked.
- [ ] Lane 9. Type the matching receipt, acknowledge the manual upload, and attach synthetic evidence. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-9/attestation-recorded.png`. Pass when the queue shows `etsy_completion_attested`, the pinned artifact is displayed, and one audit event exists.
- [ ] Lane 10. Inspect the listing-copy preview and run the local dry-run checklist through the operator UI. Save `/tmp/porizo-etsy-mto/MTO-2/scenario-10/dry-run-complete.png`. Pass when it says AI-assisted, made-to-order, Etsy Downloads, and the approved SLA with no off-platform path, and every non-Etsy step has a matching state and evidence field.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure queue first-contentful data time and detail-page data time for 50 fixture orders.
- [ ] Probe. Run the same fixture dataset at trunk first and then at the head, alternating runs. Trunk lacks the queue, so record that fact and isolate the head queue and detail requests.
- [ ] Baseline. Record the trunk first result as "Etsy queue unavailable" and record the first head medians in milliseconds.
- [ ] Rule. Fail when the head median queue data time exceeds 1000 milliseconds or the head median detail data time exceeds 750 milliseconds on the fixture dataset.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 6 synthetic screenshots into `docs/operations/evidence/MTO-2-review-ready-state.png`.
- [ ] Record a 30 to 60 second video of the synthetic create, download, and attestation path. Save it as `docs/operations/evidence/MTO-2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root records a clean verdict at the exact head SHA.
- [ ] The listing copy has Ambrose's explicit content approval before the listing changes in Etsy.
- [ ] Ambrose lands MTO-1 and MTO-2 in order. Do not enable a listing until the real buyer-account dry run passes.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Run one real paid test order from a separate Etsy buyer account. Verify the buyer confirmation, five Etsy personalization fields, generated MP3 metadata, Shop Manager completion, and buyer Etsy Downloads screen. Save evidence only under the approved restricted location outside the repository.
- [ ] Reply to the operator with the completed scope, the two PR URLs and SHAs, the test evidence location, the Etsy listing ID, the final SLA, and any remaining policy or tax work.

## Appendix A. Prototype evidence

**Purpose / Big Picture.** No prototype is required before implementation. The repository already proves the difficult internal parts, the MP3 artifact, owner-gated bytes, and idempotent render orchestration. The one unproven behaviour is Etsy's live made-to-order completion screen. The program proves it with a paid test order after MTO-2 is merge-ready.

**Progress.** At plan creation on 2026-09-05, no implementation box is complete. The current production endpoint `GET https://api.porizo.co/web/etsy/mode` returned `{"mode":"code"}`. Focused current Etsy contracts passed 66 tests in 10.3 seconds. No code changed while creating this plan.

**Surprises & Discoveries.** The old launch plan already described the manual workflow in its Option 1 table, but an owner decision later chose code redemption. The current operations guide therefore delivers a Porizo credit rather than an Etsy-native file. Etsy has no API that can upload a unique file to a buyer order. The operator upload is a permanent manual step.

**Decision Log.** Use an Etsy fulfilment unit instead of a receipt or old credit model. The unit models the actual deliverable and prevents false delivery states for multi-item receipts. Use a configured Porizo production account and `ai_voice` for this channel because an Etsy buyer has not enrolled a personal voice. Keep Etsy as the only buyer delivery channel. A Porizo completion record is an operator attestation only, never proof of Etsy delivery. Retain only minimum accounting and redacted audit data after the defined retention period, but remove all reachable code redemption behaviour once the cutover inventory is clear. These decisions were made by Codex on 2026-09-05 from the product workflow requested by Ambrose.

## Appendix B. Alternatives rejected

The existing code-redemption funnel lost because it sends a buyer away from Etsy and does not attach the final song to the Etsy order. Etsy webhook automation lost because the current live mode is not configured for it, it cannot read a checkout brief without an Etsy app, and it still cannot upload a per-order digital file. A generic instant-download PDF lost because the buyer needs a custom MP3, not instructions for another system.

## Appendix C. Risks

The operator is the delivery bottleneck. MTO-2 makes overdue units visible and records an attestation, but it cannot prove the Etsy upload without a human check. A failed render must keep a unit out of `ready_for_etsy_upload`. A buyer refund or cancellation must happen in Etsy first. The launch dry run must check the buyer Downloads screen, not only the Shop Manager state. An Etsy listing that promises user-voice output is out of scope because it requires voice-consent and enrollment that Etsy checkout does not collect. A real checkout may contain multiple units, so launch requires exact unit identity rather than receipt-only handling.

## Appendix D. Links and reading list

Read `docs/operations/etsy-fulfilment.md`, `marketing/appstore/etsy/listing-copy.md`, `src/workflows/runner.js`, `src/services/etsy-artifact-service.js`, `src/routes/tracks.js`, and `docs/plans/2026-07-23-001-fix-etsy-launch-readiness-plan.md` before MTO-1. MTO-1 uses `skills/how/SKILL.md` and `skills/architect/SKILL.md`. MTO-2 uses `skills/technical-writing/SKILL.md`, `skills/unslop/SKILL.md`, and the browser driver. Keep the decision trail required by `skills/show-me-your-work/SKILL.md` in the PR worktree.

**Outcomes & Retrospective.** The planned outcome is a buyer-visible Etsy MP3 download and a small internal queue that gives the next operator one honest source of work. The remaining external evidence is the Etsy test purchase and the buyer-side download. Update this section, Progress, Surprises & Discoveries, and Decision Log as execution produces evidence.

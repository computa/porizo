# Lessons Learned

Patterns and rules to prevent repeated mistakes. Review at session start.

---

## Session Rules

### 2026-07-13 — iOS client shipped to TestFlight ahead of its backend (deploy ≠ working, deploy never happened)

**Trigger:** TestFlight build 150 magic-link login failed on-device with "We could not check the link." Prod logs showed `Route POST:/auth/magic/native/status not found` (404) on every ~3s poll.

**Mistake:** The magic-login backend (commit `d3010039`/`21083be5`: routes, service, migrations 124–128) was committed to LOCAL `main` and a TestFlight build cut from it — but `main` was never pushed. `origin/main` (what Railway auto-deploys) was stuck 6 days stale at `65f5bef1`, so the routes the client depends on didn't exist in prod. The client half shipped; its backend half never left the laptop.

**Rule:** Before cutting a TestFlight/App Store build that depends on new backend routes, confirm `git branch -r --contains <commit>` shows the backend commit on `origin/main` AND that Railway actually redeployed it (`origin/main` HEAD == running build; probe the new route for non-404). Client and server for one feature must ship as a pair — verify the server is LIVE in prod, not merely committed. Fix here was a single `git push origin main`; verified 404→400 on the route post-deploy.

### 2026-07-10 — Literal path grep is not enough before moving runtime assets

**Trigger:** The marketing consolidation reported zero references for `marketing/emails/` and archived its three HTML files. The admin route actually built that path with `path.join(process.cwd(), "marketing", "emails")`, so the literal grep could not see it and template previews silently returned `File not found`.

**Rule:** Before moving a directory, combine three checks: search both the full path and its final path component; inspect runtime path construction (`path.join`, URL/file maps, config); and run the narrow consumer smoke test after the move. A zero-result literal grep is evidence, not proof that a directory is dead.

### 2026-07-10 — Grep for live path references BEFORE archiving any marketing dir (the ENOENT lesson, applied)

**Trigger:** Consolidating `marketing/` — the plan (and the design agent) listed `marketing/email/` and `marketing/ads-analytics/` as archive targets because "cold email is paused" and "ads-analytics is gitignored output."

**Mistake (prevented):** Both are load-bearing. A mandatory pre-move `grep -rn "marketing/<target>" scripts/ src/ package.json` caught: `src/routes/admin/marketing.js:282` reads `marketing/email/` templates; `co.porizo.audio-probe` (the plist we KEEP) logs into `marketing/email/.state/`; `scripts/ads/store.mjs`+`dashboard.mjs` write `marketing/ads-analytics/` every run. Archiving either would have reproduced the exact 3-day cold-email ENOENT outage this repo already suffered.

**Rule:** "Paused channel" ≠ "dead directory." Before archiving ANY path, grep scripts/ + src/ + package.json + launchd plists for references; paste the result into the archive manifest. A dir can be referenced by a kept process's log path, not just its own code.

### 2026-07-10 — Meta Ads MCP DOES work from Claude Code now (supersedes the 2026-05-29 note)

**Trigger:** Marketing pipeline pressure test. `mcp__claude_ai_Meta_Ads__ads_get_ad_accounts` returned live account `29474028` (Acuoos Pty Ltd, mcp-enabled + queryable) directly from this Claude Code session.

**Mistake (corrected):** The 2026-05-29 lesson said "Meta official Ads MCP can't OAuth via Claude Code CLI → use Graph API." That was true for the loopback-OAuth flow then; a Meta Ads MCP is now connected in-session and works for reads (and likely writes).

**Rule:** Prefer the Meta Ads MCP as the primary read/publish path; keep the `meta` CLI (`~/meta-ads/.env`) + Graph API as fallback. The `scripts/ads/run.mjs` analyzer still reads `.env` directly, so measurement is independent of MCP auth.

### 2026-05-29 — iOS 14+ SKAN campaigns need `promoted_object` at the CAMPAIGN level (and the Meta MCP can't auth via Claude Code CLI)

**Trigger:** Relaunching the Father's Day install campaign via Marketing API. Every ad-set creation under a SKAN campaign (`is_skadnetwork_attribution=true`) failed with `Invalid campaign attribution for non-iOS14+ campaign` (subcode 3955009) — even with valid iOS 15+ `user_os` targeting, the SKAdNetwork 4.0 toggle ON, and the iPad Store ID added. I spent most of a session assuming it was Meta-side propagation lag and waited ~12h; it persisted.

**Mistake:** I set `promoted_object` (the app binding) only on the **ad set**, which is correct for non-SKAN app campaigns. iOS 14+ SKAN campaigns enforce "one app per campaign," so the app must be declared via `promoted_object` at the **campaign** level _at creation time_ (it's immutable afterward — you can't PATCH it on). Without it, Meta refuses to classify the campaign as iOS-14+, producing the misleading "non-iOS14+ campaign" error despite `is_skadnetwork_attribution=true` being set.

**Rule:**

1. To create an iOS 14+ SKAN install campaign via Graph API, set `promoted_object={"application_id":..., "object_store_url":...}` on BOTH the campaign (`POST /act_X/campaigns`) AND the ad set. The campaign-level binding is the one the public API docs omit but the Ads Manager UI sets automatically.
2. `promoted_object` is immutable after campaign creation (subcode 1885090). If you forgot it, DELETE and recreate the campaign — don't try to PATCH.
3. Prerequisites that ARE real (do these first, in Events Manager + FB App Dashboard): (a) iPad Store ID populated on the FB App's iOS platform card so `supported_platforms` includes `IPAD`; (b) SKAdNetwork 4.0 toggle ON in Events Manager → app dataset → Settings. Verify app eligibility with `GET /act_X/ios_fourteen_campaign_limits?app_id=Y` — a `{campaign_limit, campaign_group_limit}` response means the app is iOS-14 eligible.
4. **Meta's official Ads MCP (`https://mcp.facebook.com/ads`) cannot complete OAuth through Claude Code CLI.** Claude Code's MCP OAuth uses a `http://localhost:PORT/callback` loopback redirect; Facebook's OAuth dialog enforces HTTPS on every redirect URI (even loopback) and returns "Insecure Login Blocked." This is unfixable from our side (the OAuth app's settings are Meta's). The MCP works with Claude Desktop / ChatGPT / Cursor, not Claude Code CLI. Use the `meta` CLI / Graph API instead — and note the campaign-level `promoted_object` fix above makes the API path fully sufficient.

### 2026-05-15 — Audit BOTH `.gitignore` AND `.railwayignore`/`.dockerignore` when porting a script that reads runtime files

**Trigger:** Cold-email daily job was ported from `marketing/email/cold-daily-send.py` (laptop launchd) to a backend Node job (`src/jobs/cold-email-daily.js`). Job runs on Railway, reads templates from `/app/marketing/email/*.html`.
**Mistake:** Templates lived under `marketing/email/` which was excluded from git (`/marketing/*` with no `email/` allow rule) AND blanket-excluded from Railway upload (`marketing/` in `.railwayignore`). Backend deployed, ran on schedule, threw `ENOENT` on every 5-min poll for 3 days. Zero emails sent. The catch block silently released the daily-fire claim, so the campaign row showed `last_run_date_utc IS NULL` — looked identical to "never tried."
**Rule:**

1. When porting any local script that reads files at runtime into a deployed service, list every file path it reads and verify each one passes ALL ignore filters: `.gitignore` (so the file is in the repo), `.railwayignore` (so `railway up` uploads it), `.dockerignore` (so the Docker build context includes it).
2. For Railway specifically: `marketing/`, `docs/`, `tests/`, etc. are commonly blanket-excluded in `.railwayignore`. If new runtime code needs a subdirectory, carve out a `!subdir/` allow rule and re-exclude the noise (state dirs, `*.py` from the old version, fixtures).
3. After deploy, prove the file is on the container before claiming the fix. If you can't `railway ssh` (no key), hit a route that reads the same file (here: `/admin/dashboard/marketing/email-templates`) or accept that proof comes from the next legitimate scheduler tick.
4. When a scheduled job's claim/release pattern can silently swallow errors, monitor the LOG for the actual error string — `last_run_date_utc IS NULL` is ambiguous between "didn't try" and "tried and released."

### 2026-05-05 — Do not invent webhook signatures for vendors that only document callback URLs

**Trigger:** Adding a SunoAPI callback receiver for upload-cover/persona probe tasks.
**Mistake:** Implemented `X-Suno-Signature` + HMAC-SHA256 over the raw body as a placeholder because it is a common webhook convention, but SunoAPI's public docs only document `callBackUrl`; they do not document a provider-signed header.
**Rule:**

1. If vendor docs do not document a callback signature scheme, do not rely on a fabricated header for production safety.
2. Protect the endpoint with a callback URL secret token (`?token=<secret>`) when the vendor only lets us configure the URL.
3. Keep optional support for the likely future signature scheme only as additive compatibility, not as the required production contract.
4. Stub callbacks must not mutate state until the auth contract is vendor-confirmed and covered by live callback evidence.

### 2026-05-05 — When typing an external API response shape, mark the test fixture PLACEHOLDER until a live capture replaces it

**Trigger:** Replacing an opaque graph-traversal extractor with a typed extractor against a vendor API (Suno upload-cover task status response).
**Mistake:** Wrote the typed extractor against a fixture inferred from existing extractor candidate paths and SunoAPI public docs — never validated against a real captured response. CI green became a self-fulfilling test, masking the risk that the real shape would not match.
**Rule:**

1. When committing a typed extractor for a third-party response, the test fixture MUST carry `_fixture_metadata.captured_from` and `capture_timestamp` fields.
2. Add a CI gate (env-var-driven test) that fails when the fixture status is `PRELIMINARY` AND a deploy-time env var (`SUNO_PERSONA_PROBE_VERIFIED=true`) is set.
3. Never enable a feature flag whose hot path runs the typed extractor until the gate passes.
4. The probe script that captures the fixture redacts Bearer tokens, URLs, and provider IDs deterministically (so structural references stay intact for tests).

### 2026-05-05 — Token revocation extraction: audit predicates, never collapse signatures

**Trigger:** Refactoring duplicated SQL across modules (the 3 `UPDATE enrollment_sessions SET access_token = NULL` sites — one `WHERE id = ?`, two `WHERE user_id = ?`).
**Mistake:** Initial refactor instinct was a single `revokeEnrollmentSessionToken(db, identifier)` taking either id type. Lost the predicate distinction; would have silently revoked all of a user's sessions when a per-session revoke was intended.
**Rule:**

1. When extracting cross-module SQL, list every call site's `WHERE` clause first.
2. If the predicates differ, the extracted helpers MUST differ — distinct names that name the predicate (`revokeEnrollmentSessionToken` vs `revokeAllEnrollmentSessionTokensForUser`).
3. The Duplicate Function Rule's "either they serve different purposes (name them differently) or one is wrong (fix it)" applies during extraction, not just during code review.

### 2026-05-05 — Don't ship a freshness budget without wiring the cache through callers

**Trigger:** Optimizing repeated DB-fetch-and-validate calls in a job runner (`assertProviderJobStillAllowed` → 8× per job × 3 reads = ~24 round trips).
**Mistake:** Added `cachedState` parameter and a 5-second freshness window inside the function, then shipped without updating any of the 8 call sites to pass `cachedState`. Net DB load unchanged from pre-optimization; the dead-code branch silently never fires.
**Rule:**

1. When introducing a parameter that callers must pass to enable an optimization, update at least one call site in the same commit OR delete the parameter.
2. A test that covers the new branch (`cachedState` provided + within budget → 0 DB reads) keeps the optimization honest.
3. If the optimization can't ship together with caller updates, ship the caller-update PR first; don't merge the dead path "for later wiring."

### 2026-04-11 — App Store versions must use AFTER_APPROVAL release type

**Trigger:** Creating a new App Store Connect version (via `asc versions create` or the ASC web UI)
**Mistake:** Versions 1.4, 1.5.1, and 1.5.2 were created with `releaseType: MANUAL` (vs `AFTER_APPROVAL` on 1.0-1.3). 1.5.2 was approved by Apple but sat in `PENDING_DEVELOPER_RELEASE` because the manual trigger was forgotten — users didn't see the update for an extra day.
**Rule:** Every new version, without exception, gets `--release-type AFTER_APPROVAL`:

```bash
asc versions create --app 6758205028 --version "X.Y.Z" --platform IOS \
  --release-type AFTER_APPROVAL --copy-metadata-from "<previous>"
```

If a version already exists with `MANUAL`, fix it before submission:

```bash
asc versions update --version-id "VERSION_ID" --release-type AFTER_APPROVAL
```

Documented in `PorizoApp/submissionchecklist.md` Section 0.

### 2026-04-11 — /appstore-review is a pre-submission blocker, not a nice-to-have

**Trigger:** Any TestFlight external beta or App Store submission
**Mistake:** Was about to submit build 92 to external beta review without running the compliance audit first. Would have caught a NO-GO verdict only after Apple's scanner auto-rejected.
**Rule:** Run `/appstore-review` BEFORE every submission (TestFlight external or App Store). If the verdict is NO-GO, fix blockers and re-run until GO. Never skip based on "small diff" reasoning — the Feb 2026 iPad screenshot rejection and the April 2026 TikTok SDK/IDFA mismatch both came from "small" changes that bundled rejection-grade issues.

### 2026-02-21 — Every terminal state in financial workflows needs a test

**Trigger:** Building any feature where tokens/credits are spent
**Mistake:** The gift dispatch happy path (spent → sent) had a refund on cancel, but the failure path (spent → failed) silently ate the token. Only the golden path was tested.
**Rule:** For every `spend` operation, enumerate ALL terminal states and verify each one handles the financial consequence:

- `spent → sent` ✓
- `spent → failed → refunded` ← was missing
- `spent → cancelled → refunded` ✓

### 2026-02-21 — State machines need stuck-state recovery

**Trigger:** Any workflow that uses status locking (`SET status = 'processing'`)
**Mistake:** `dispatchGiftById` locked the row to `dispatching` but had no try/catch — an unhandled exception left the row permanently stuck. The poller only queries `scheduled` and `dispatch_retry`, so stuck rows were invisible.
**Rule:** Every status lock MUST have a corresponding recovery mechanism:

- Wrap in try/catch that resets to retryable state
- OR add a sweeper that reclaims rows stuck in transient states for > N minutes
- Always increment attempt counter in the catch block to prevent infinite retry loops

### 2026-02-21 — Claim/PIN systems need adversarial review

**Trigger:** Building any PIN-protected or attempt-limited access flow
**Mistake:** Anonymous poem unlock reset `claim_attempts` to 0 — reasonable for UX (allow re-visits) but enables brute-force bypass. Nobody asked "what can an attacker do with this?"
**Rule:** Before shipping any claim/PIN system, run a 5-minute adversarial review:

1. What happens if someone tries all PINs? (lockout must be effective)
2. Does any success path reset the lockout counter? (it shouldn't for unauthenticated flows)
3. Is there a rate limit on top of the attempt counter?

### 2026-02-21 — Integration steps go on pre-submission checklist, not code comments

**Trigger:** Features that depend on external configuration (Apple Developer portal, DNS, CDN)
**Mistake:** Universal links were commented out with `<!-- requires provisioning profile update -->`. External-dependency tasks get deferred and forgotten because they can't be tested locally.
**Rule:** When code depends on external setup:

1. Add the external step to the pre-submission checklist (not a code comment)
2. Create a test that verifies the integration works (e.g., AASA route test)
3. Code comments should reference the checklist item, not be the only record

### 2026-02-21 — Atomic operations for concurrent financial data

**Trigger:** Any read-modify-write on balances, counters, or inventory
**Mistake:** Wallet used `SELECT balance` → compute → `UPDATE balance`. Works in dev (single user), fails under concurrent load (double-spend).
**Rule:** Financial mutations must be atomic:

- Use `UPDATE ... SET balance = balance + ? WHERE (balance + ?) >= 0` (single SQL statement)
- PostgreSQL: use `RETURNING` for the new value
- SQLite: check `changes > 0` (serialized writes make this safe)
- Never trust a value you read in a previous query for a write condition

### 2026-02-21 — Secondary paths get less rigor — compensate explicitly

**Trigger:** Adding a "shortcut" or "already handled" path after the primary flow is built
**Mistake:** PoemClaimView's re-open path used `shareId` as poem ID and `previewLines` as verses because the dev was working with data available in the share info response, not data the poem actually needs.
**Rule:** When adding a secondary path (re-open, cache hit, already-authenticated):

1. Verify it produces the EXACT same data shape as the primary path
2. If it can't, call the primary path instead of reconstructing data
3. Add a test that exercises the secondary path specifically

### 2026-03-03 — Verify table schema before referencing columns in SQL

**Trigger:** Poem claim returning 500 with `column "bound_device_id" does not exist`
**Mistake:** The claim endpoint UPDATE referenced `bound_device_id` on `poem_share_tokens`, but the column was never created. The query was written by analogy with `share_tokens` (track shares) which has it. Nobody ran `\d poem_share_tokens` to verify.
**Rule:** When writing SQL against a table, verify the columns exist — especially when copying patterns from a similar table. Run `\d table_name` in production before deploying queries that reference columns you haven't verified.

### 2026-03-03 — Empty-PIN re-claim burns lockout counter

**Trigger:** iOS `reClaimPoem()` sending `pin: ""` on every page load, locking out recipients after 5 views
**Mistake:** The server counted empty/missing PINs as failed attempts. The iOS code auto-called the claim endpoint on load for "already accessible" shares, but the server-side `requires_pin` flag was being ignored.
**Rule:** Server-side: reject empty PINs without incrementing counters. Client-side: check `requiresPin` before calling claim endpoints. Both sides must guard against programmatic callers burning attempt limits.

---

## Patterns to Avoid

### Success-bias implementation

Building the golden path fully (with refunds, audit entries, events) but treating the failure path as "just set status = failed." Every state transition deserves the same rigor.

### Comment-driven deferral

`// TODO: requires X` or `<!-- requires provisioning -->` as the sole record of an integration dependency. These are invisible to checklists and QA.

### Read-modify-write on shared mutable state

`SELECT x` → compute → `UPDATE x` is never safe under concurrency. Always use atomic SQL operations for counters, balances, and inventory.

---

## Patterns That Work

### Refund-before-status-update

When a financial operation fails permanently, refund FIRST, then update status. If the refund throws, the row stays in a retryable state and the next cycle re-attempts. This prevents the "token lost, no retry path" failure mode.

### Idempotency keys on financial operations

`gift_refund_dispatch_{giftId}` ensures that crash-recovery retries don't double-refund. Every financial mutation should have an idempotency key derived from the triggering event.

### Re-use idempotent endpoints instead of reconstructing data

PoemClaimView's `reClaimPoem()` calls the same claim endpoint (which is idempotent for bound users) instead of building a fake Poem object from incomplete data. Fewer code paths = fewer bugs.

### Atomic UPDATE with WHERE guard

`UPDATE wallet SET balance = balance - 1 WHERE balance >= 1` is both the check and the mutation in one statement. No race window. Works on both PostgreSQL and SQLite.

---

### 2026-04-11 — Verify ad SDK is integrated BEFORE launching paid app install campaigns

**Trigger:** Launching any Meta/Google/TikTok/Apple Search Ads campaign with "App Install" objective for the iOS app.

**Mistake:** Launched `PORIZO_INSTALLS_Women25-45_2026Q2` Meta campaign and burned $78.30 over 30 days with **zero attributed installs**. Root cause: Facebook SDK (`FBSDKCoreKit`) had never been integrated in the iOS app. Events Manager → Datasets → Porizo showed **"Inactive — Never received event"** with a red warning triangle the entire time. Meta had no conversion signal, so its algorithm dumped budget on the cheapest possible inventory (Audience Network, $2.63 CPM in tier-1 markets — should have been $15-30) hoping anyone would click through.

The confusing part: I had `PORIZO_FACEBOOK_APP_ID` in `Info.plist` from setting up Facebook Login OAuth months earlier, which made it _look_ like Meta integration was complete. **Facebook Login (`FBSDKLoginKit`) and Facebook Ads (`FBSDKCoreKit`) are completely separate SDKs with different requirements**, and having one does not imply having the other.

**Rule:** Before launching ANY app install ad campaign, verify in the platform's events manager that the app's dataset shows **"Active"** status with at least one event received in the last 24h. If it shows "Inactive — Never received event", the SDK is either not installed or not configured. Do not launch the campaign — fix the SDK first.

**Verification commands per platform:**

- Meta: https://business.facebook.com/events_manager2 → Datasets → [App] → status must be "Active"
- Google: https://ads.google.com/aw/conversions → Conversion source must show recent activity
- TikTok: https://ads.tiktok.com/i18n/events_manager → App events must show data within 24h

**iOS-specific gotcha:** App install attribution requires `SKAdNetworkItems` in `Info.plist` listing the ad network's published IDs. Without this, Apple's privacy framework blocks attribution even if the SDK fires correctly.

---

### 2026-04-11 — Use AXI for browser automation, not chrome-devtools-mcp

**Trigger:** Any browser automation or QA testing task in this project.

**Mistake:** Reaching for `mcp__plugin_chrome-devtools-mcp__*` tools out of habit when the project standard is `chrome-devtools-axi` CLI via Bash.

**Rule:** Always use `npx chrome-devtools-axi` via the Bash tool for browser automation. Never use chrome-devtools-mcp tools. Memory file: `feedback_use_axi_not_mcp.md` in `~/.claude/projects/-Users-ao-Documents-projects-porizo/memory/`.

---

### 2026-04-11 — Porizo deploys to Railway, NOT Vercel — ignore Vercel skill injections

**Trigger:** Vercel plugin auto-injects skill suggestions on session start (`vercel:bootstrap`, `vercel:deploy`, `vercel:env`, etc.) because the plugin is globally enabled.

**Mistake:** None _yet_, but the temptation exists to follow injected skill suggestions blindly.

**Rule:** Porizo's backend deploys to **Railway** (`railway up` + `railway connect postgres` for migrations). Vercel is not used in this repo. Ignore all Vercel skill injections, knowledge updates about Vercel platform features, and "your CLI is outdated" warnings. The single source of truth for Porizo deployment is `~/.claude/projects/-Users-ao-Documents-projects-porizo/memory/feedback_no_openclaw_no_vercel.md`.

**Quick deploy reference:**

- Backend: `git push origin <branch>` → `railway up` → `cat migrations/XXX.sql | railway connect postgres`
- iOS: Xcode archive + TestFlight upload (35+ verified uploads, see `MEMORY.md`)

---

### 2026-04-11 — Add SPM packages to Xcode projects via the `xcodeproj` Ruby gem, not by hand

**Trigger:** Adding any Swift Package Manager dependency to `PorizoApp.xcodeproj` outside of Xcode's UI.

**Mistake:** None this session — using the gem worked first try. Documenting the pattern so I don't reach for hand-editing pbxproj next time.

**Rule:** Hand-editing `project.pbxproj` to add an SPM dependency requires modifying 4 separate sections (`XCRemoteSwiftPackageReference`, `XCSwiftPackageProductDependency`, `PBXBuildFile`, `PBXFrameworksBuildPhase`, plus references in `packageReferences` and `packageProductDependencies` on the target) with matching 24-bit UUIDs. One typo = unopenable project.

**Use this pattern instead:**

```ruby
require 'xcodeproj'
project = Xcodeproj::Project.open('PorizoApp/PorizoApp.xcodeproj')
target = project.targets.find { |t| t.name == 'PorizoApp' }

# Add package
pkg_ref = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
pkg_ref.repositoryURL = 'https://github.com/...'
pkg_ref.requirement = { kind: 'upToNextMajorVersion', minimumVersion: '1.0.0' }
project.root_object.package_references << pkg_ref

# Add product dependency to target
dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
dep.package = pkg_ref
dep.product_name = 'YourProductName'
target.package_product_dependencies << dep

# Link in Frameworks build phase
build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
build_file.product_ref = dep
target.frameworks_build_phase.files << build_file

project.save
```

Then run `xcodebuild -resolvePackageDependencies` to fetch the source. The gem is what CocoaPods uses internally — battle-tested.

---

### 2026-04-11 — Gate optional SDK integrations behind `#if canImport(...)` AND a runtime config check

**Trigger:** Adding any optional third-party SDK that requires both a build-time package AND a runtime config value (API key, client token, etc.).

**Mistake:** None this session — the pattern worked. Capturing it because it's reusable.

**Rule:** When adding an optional SDK like Facebook Ads, OneSignal, Amplitude, etc., use a **two-layer guard**:

1. **Compile-time guard** with `#if canImport(SDKName)` — lets the project compile even before the SPM package is added (anyone pulling the branch isn't blocked on package resolution)
2. **Runtime guard** that checks the config value isn't empty AND doesn't still contain `$(` (the literal placeholder pattern from unresolved Info.plist substitutions)

```swift
#if canImport(FacebookCore)
private enum FBSDK {
    static var isConfigured: Bool {
        let token = Bundle.main.object(forInfoDictionaryKey: "FacebookClientToken") as? String ?? ""
        return !token.isEmpty && !token.contains("$(")
    }
}
#endif
```

Then in app delegate:

```swift
#if canImport(FacebookCore)
if FBSDK.isConfigured {
    ApplicationDelegate.shared.application(application, didFinishLaunchingWithOptions: launchOptions)
}
#endif
```

This prevents both: (a) "module not found" build errors before SPM is set up, and (b) "missing client token" NSException crashes at runtime when developers haven't pasted the real token yet.

---

### 2026-04-12 — Use `asc` CLI for App Store Connect operations, not fastlane

**Trigger:** Any App Store Connect operation — privacy declarations, version management, TestFlight, metadata.
**Mistake:** Installed fastlane (gem install, 73 gems, 90+ seconds) to upload privacy declarations when the project already has `asc` CLI (`/opt/homebrew/bin/asc`, v1.2.1) which covers the same functionality via `asc web privacy plan --app APP_ID --file ./privacy.json`. Didn't check existing tooling before reaching for a new dependency.
**Rule:** Check `which asc` and `asc --help` before installing any new CLI for App Store Connect workflows. The `asc` CLI covers: privacy declarations (`asc web privacy`), version management (`asc versions`), TestFlight upload (`asc publish testflight`), App Store submission (`asc publish appstore`), validation (`asc validate`), and metadata (`asc metadata`). It's already installed and configured in this project.

---

### 2026-04-12 — xcodebuildmcp CAN archive, export, and upload to TestFlight

**Trigger:** Any iOS archive + TestFlight upload task
**Mistake:** Claimed xcodebuildmcp "doesn't have archive, export, or TestFlight upload tools" and fell back to raw `xcodebuild` CLI. The user corrected me: xcodebuildmcp has been used for all distribution workflows in this project. I made the claim without testing the tool — I just scanned the tool names and assumed `build_device` couldn't archive.
**Rule:** Do not claim a tool "can't" do something based on reading tool names alone. Test it first, or ask the user. xcodebuildmcp wraps xcodebuild comprehensively — `build_device` with appropriate `extraArgs` or dedicated commands handle archive + export + upload. Always check `session_show_defaults` and the tool's `extraArgs` parameter before asserting limitations.

---

### 2026-04-26 — Confirm UGC asset choices before rendering on credit-consuming platforms

**Trigger:** Reel.farm UGC video composer. Auto-selected demo tile + I picked an uploaded song ("thanks mom.mp3") without verifying with user, and without checking project-side curated assets in `marketing/`.

**Mistake:** Burned 2 export credits producing videos with the wrong song and wrong demo. The user corrected: "you used the wrong song and demo for the reel." The correct Mother's Day song lives in `marketing/audio hooks/clips/mom-shower-love/` (segmented as hook/proof/payoff/tail per `README.md`). The correct product demos live in `marketing/product demo/Thank you mom*.mp4`. Neither were uploaded to ReelFarm yet — the platform's existing assets ("thanks mom.mp3", stock demo tiles) were stale/different files with similar names.

**Rule:** Before clicking Create / generate / render on any paid/credited platform (ReelFarm, Suno, ElevenLabs, etc.):

1. Read the project's `marketing/` directory for curated assets first (`find marketing/audio*`, `find marketing/product*`).
2. Read any `README.md` inside clip directories — they contain the recommended pairing for the campaign.
3. List the chosen song path and demo path explicitly in chat.
4. Wait for user confirmation.
5. Only then upload + render.

Naming similarity on a remote platform ("thanks mom.mp3" vs `marketing/audio hooks/.../proof.mp3`) is not evidence the asset is the same file. Confirm by checksum or by user before spending credits.

---

## Workflow Improvement Candidates

> These patterns are candidates for upgrading from "lessons" to enforceable workflow rules.
> When we're ready to formalize, each can become a hook, checklist gate, or review agent trigger.

1. **Financial state audit** — After implementing any spend/credit feature, require a test for every terminal state (success, failure, cancel, timeout) that verifies the financial consequence (refund, hold release, etc.)

2. **Stuck-state sweeper** — Any new state machine should declare its transient states and maximum dwell time. A pre-submission check could grep for status locks without corresponding recovery.

3. **Adversarial claim review** — Before any PIN/token-gated flow ships, trigger a security-reviewer agent focused specifically on lockout bypass, counter reset, and rate limit gaps.

4. **Integration dependency tracker** — Replace code comments with a structured file (`docs/integration-deps.md`) that lists external setup steps. Pre-submission hook verifies all items are checked off.

5. **Concurrency test requirement** — Any function that mutates shared numeric state (balances, counters) should have a concurrent test that runs 2+ simultaneous mutations and verifies no over-count/under-count.

6. **Ad campaign SDK precheck** — Before any paid app install campaign launches (Meta, Google, TikTok, Apple Search Ads), require verification that the platform's events manager shows "Active" status with events received in the last 24h. Could be a `/ads-precheck` skill that opens each platform's events manager URL and screenshots/parses the dataset status. Would have prevented the $78 burn on the women 25-45 campaign.

### 2026-05-01 — TikTok reels: ONE 21s music track, never clip-and-repeat

**Trigger:** Building first AI-mom reaction reel; clipped a 12s chorus and was going to layer it under voice slots.

**Mistake:** Defaulted to a short music clip with the assumption we'd loop or pad the rest. Earlier reels with this approach had repeating audio that sounded amateur — exactly the bug user flagged.

**Rule:** All Porizo TikTok reels are scored with **one continuous 21s music track**. Music plays through the whole reel; volume ducks under voiceovers and restores after. Never cut a shorter clip and loop it. This is the project standard — wire it into `pipeline/audio_kit.py` as the default behavior, not a per-reel decision.

---

## [2026-06-18] Semicolon in a SQL migration COMMENT crashed boot → full prod 502 outage

**Trigger:** Wrote `migrations/pg/120_remove_default_seed_admin.sql` with explanatory comments that contained `;` (e.g. "...via the admin setup endpoint; new environments..." and "...admin_users delete; cleared explicitly...").

**Mistake:** The migration runner (`src/database/postgres.js` / `sqlite.js`) splits each file on `;` and runs every chunk. A `;` inside a `--` comment splits that comment, so the trailing fragment ("new environments bootstrap...") got executed as invalid SQL → migration 120 threw during `runMigrations` on boot → the app process crash-looped → **502 across api.porizo.co + porizo.co + the iOS Apple sign-in** (all the same backend). The migration also never recorded. A subagent had already hit this exact trap on migration 118 and warned about it; I reintroduced it.

**Rule:** NEVER put a `;` inside a migration comment — the runner splits naively on `;`. Comments must contain zero semicolons; only real statements end with `;`. Before committing ANY migration, run `grep -nE '^\s*--.*;' <file>` and confirm it is empty. Migrations are boot-critical: a throwing migration takes the whole app down, so verify against the PG-backed path (sqlite may not catch it), and after deploying a migration, confirm it actually recorded in `schema_migrations` before assuming success.

---

## A "primary CTA" on a shared screen is NOT an unmissable step (2026-06-22)

**Trigger:** Building the recipient-first create flow, I chose (per the brainstorm) to put "Pick from Contacts" as the _primary CTA on the existing name-entry screen_ — alongside the name text field, occasion chips, type toggle, and Next button.

**Mistake:** Users (including the founder, on build 136) skipped the contact pick entirely — they typed a name and hit Next, never tapping the coral button. That defeats the whole feature: no recipient phone captured → no one-tap "Send to [recipient]" → no improved device-binding. A control that _renders_ and is visually "primary" is not the same as a control users will actually use when other inputs on the same screen also satisfy the "what do I do here" question. I verified on the simulator that the button _rendered_, which was necessary but not sufficient — it didn't tell me whether the flow funnels users into it.

**Rule:** When a capture is central to a feature's value (and skippable), make it a DEDICATED step where it is the only/dominant action — don't make it one option among several on a combined screen. "Strongly encouraged" must be structural (a step you walk through), not just visual hierarchy. And when verifying UX, check the _funnel_ (can the user trivially bypass the intended action?), not just that the control is present.

**Bonus (same session):** Disable autocorrect on name fields — the sim keyboard autocorrected "Chioma" → "Can". Recipient names must not be mangled (`.autocorrectionDisabled()`).

---

## 2026-06-22 — A feature that works on the "happy" path is not done until every path to the same state has it

**Trigger:** Shipped one-tap "Send to [recipient]" on the synchronous create→reveal flow.

**Mistake:** Assumed the reveal was the only place a user reaches a finished song. But a slow render (~4 min, partly because prod Anthropic credits were exhausted) trips the `waitTimeout` "Notify me when ready" screen — the user exits to home, gets a push, and opens the song from the **library**. That async path had **no** send-to-the-collected-number: the recipient phone lived only in in-memory view state (`setup.recipientPhone` inside `WarmCanvasFlowView`), so it vanished the moment the create flow closed. The number _was_ persisted server-side, but the track API model didn't expose it and no library surface read it. I spent a long time debugging "no send CTA" before the user clarified they took the "Notify me" path.

**Rule:** When a feature attaches to a _completion state_, enumerate **every** path that reaches that state (sync reveal, async notify-me → library, resume, notification-open) and make the feature present on all of them. Persist feature-critical data on the **model + API**, not just transient view state. Also: when a user reports "X doesn't work," ask which _path_ they took before assuming the surface is broken (the reveal's CTA was fine; they just never saw the reveal).

---

## 2026-06-22 — Don't stack a second SwiftUI `.sheet`/`.confirmationDialog` onto a view that already presents

**Trigger:** Migrated the reveal's one-tap send into a reusable `.directSendHost` ViewModifier that added `.confirmationDialog` + `.sheet(item:)`.

**Mistake:** The host (WarmCanvasFlowView / MySongs / TrackPlayerFullView) already carries `.sheet(item: $activeSheet)`, `.fullScreenCover`, and `.alert`. Stacking another SwiftUI presentation on the same view **silently no-ops** — the action fired (the link minted; `POST /share` showed in prod logs) but nothing appeared. The user tapped "Send" repeatedly to no effect.

**Rule:** From inside a screen that already hosts presentations (or is itself inside a `.fullScreenCover`), present transient UIKit UI (`MFMessageComposeViewController`, `UIActivityViewController`, `UIAlertController` action sheets, `CNContactPickerViewController`) **imperatively** — `topViewController().present(...)` — not via a second SwiftUI modifier. Same fix as the contact-picker dismissal cascade.

**Also (same session):** `CreateFlowResumeTarget.revealBloom` is NOT wired in `rebuildWarmCanvasState` (falls to `default` → lyrics). The target that rebuilds playback and lands on `moment = .reveal` is `.trackPlayer`. Verify enum cases are actually handled in the switch before routing to them.

---

## 2026-06-22 — A 200 from the server doesn't mean the client decoded the response

**Trigger:** "Send to [name]" did nothing across builds 140/141. Prod logs showed `POST /share` returning **200** on every tap — so I assumed the link minted and chased a _presentation_ bug (SwiftUI sheet conflict → rewrote to imperative UIKit). It still didn't work.

**Mistake:** The real failure was a **client-side decode throw**, invisible in server logs. One-tap send calls `createShare(requirePin: false)`; the backend returns `claim_pin: null` for PIN-less shares (`share-service.js:150`), but iOS `CreateShareResponse.claimPin` was a **non-optional `String`** → `JSONDecoder` threw on the null → `makePinlessShareLink` threw → the send bailed into its `catch` (a toast) **before presenting**. The 200 masked it; I burned two builds on the wrong layer.

**Rule:** When a feature works on one code path but not another that hits the **same endpoint with different params**, diff the **response shape** between the two paths and check model **optionality** — a field that's non-null on the default path but null on the variant makes the _entire_ decode throw. A 2xx status only means the server succeeded; confirm the client actually _decoded and used_ the body (add/inspect the decode-error path) before concluding it's a downstream/UI bug. Default response fields that any code path can null out should be optional (or tolerated via `decodeIfPresent`).

---

## Dead-code checks must include the relative-path import form (2026-06-23)

**Trigger:** Verifying whether `src/services/og-text-utils.js` was unimported dead code before deleting it.

**Mistake:** Grepped only for `services/og-text-utils` (the from-root path) and concluded "zero importers — safe to delete." Two sibling modules (`poem-og-variants.js`, `song-og-variants.js`) actually imported it via the **relative** `require("./og-text-utils")`, which my grep missed. The file was a **live duplicate**, not dead — and worse, it was the drifted copy without the F20 fix, so all 6 OG card variants still had the overflow bug. A final relative-form check caught it one step before `rm`.

**Rule:** Before declaring a module dead or deleting it, grep for **every** form callers can use: the from-root path (`dir/name`), the relative sibling form (`./name`, `../dir/name`), AND bare `require(...name...)`. Sibling modules almost always import via `./`. A single absolute-path grep is not proof of "no importers" — it's the exact false-negative the claim-verification rule warns about. When you find live importers of a duplicate, consolidate them onto the canonical version (don't preserve the fork), then delete.

---

## npm test globs run under /bin/sh, which has no `**` (globstar) (2026-06-23)

**Trigger:** The `/goal` test loop; `npm test` reported far fewer tests than `find test -name '*.test.js'` showed.

**Mistake (latent, in package.json):** `"test": "node --test test/**/*.test.js"` — unquoted. npm runs scripts via `/bin/sh`, where `**` is NOT globstar; it collapses to `*`, matching only `test/<onedir>/*.test.js`. Result: only 54 of 208 files ran (~26%), and ALL 114 top-level `test/*.test.js` files were silently skipped. Every "npm test passes" claim only ever covered a quarter of the suite; newly-added top-level test files never ran in CI.

**Rule:** When a test/build npm script uses a `**` glob, QUOTE it (`"test/**/*.test.js"`) so the _tool_ (node --test, jest, etc.) expands it with real globstar — never rely on the shell. Verify suite size with `find ... -name '*.test.js' | wc -l` vs. what the runner reports; a large gap means the glob is under-matching. The Bash tool here runs zsh (where `**` works), which MASKS the bug — always reproduce script globs under `/bin/sh -c` to see what npm actually runs.

---

## Don't "fix" an intentional design without evidence the problem occurs (2026-06-29)

**Trigger:** Gift-reservation 94%-abandonment investigation. A subagent diagnosed a "45-min TTL races the async render" bug and I implemented "extend the reservation instead of expiring while a gift-funded track is in flight."

**Mistake:** That change fought a DELIBERATE design — expiry of an abandoned gift draft refunds the credit AND soft-deletes the orphaned draft via `deleteGiftFundedReservationContent`, with an existing test ("deletes gift-funded content when a reservation expires") asserting exactly that. Worse, production data showed the race has NEVER fired: only 1 gift-funded track has ever existed (266 standard vs 1 gift_wallet). The real leak is an iOS client gap (it doesn't send `gift_reservation_id` on song-create, so songs are never linked to the reservation) — a CLIENT problem the backend already supports. I was about to break intentional GC to fix a theoretical race that doesn't occur.

**Rule:** Before changing behavior to fix a "race"/"bug," confirm with PRODUCTION DATA that it actually occurs at meaningful volume. If an existing test + helper function encode the current behavior, treat it as intentional design until proven otherwise — the question is "which behavior is right and does the bad one actually happen?", not "could this theoretically be a problem?". A subagent's plausible diagnosis is a hypothesis, not a verified fact — verify the blast radius against real data first. Reverted; kept only the verified, isolated fix (false gift incidents).

---

## 2026-06-30 — PG verification harness must not load .env

**Trigger:** Building a "run the test suite against real Postgres" harness (Gate 1 of refactor verification).
**Mistake:** Added `-r dotenv/config` to load JWT_SECRET for PG runs. This pulled in `.env`'s production auth values (overrode ALLOW_ANON_USER_ID and friends), causing `billing-restore-path.test.js` to return 401 instead of 200/400 — a FALSE failure. The test mocks its own DB and never touches Postgres; it relies on the clean `NODE_ENV=test` + explicit-flag env that `npm test` provides.
**Rule:** To force tests onto real PG, set `NODE_ENV=test DB_PROVIDER=postgres POSTGRES_*=...` and KEEP the standard test flags (`ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true`). Do NOT load `.env` (no `dotenv/config`). `DB_PROVIDER` wins over the `NODE_ENV==='test'→sqlite` default in `getDatabase()`, so the DB flips to PG while the rest of the test contract stays intact. Tests that inject a mock `db` into `buildServer({db})` ignore the DB env entirely.

---

## 2026-07-02 — A 502 from Cloudflare is an ORIGIN crash; "public DB works" ≠ private network works

**Trigger:** "Admin dashboard not reachable." It was a symptom — the entire backend was returning Cloudflare 502 (Host: Error) because the Railway container was crash-looping for ~2 days.

**Root cause:** A transient connection timeout to `postgres.railway.internal` at boot threw out of `runMigrations → getDatabase → start()`, the process exited, and Railway's restarts kept hitting the same private-network readiness race. The app had **zero connection retry**, so a momentary DB-unreachable window was fatal and never self-healed. Fix: `waitForConnection()` probes `SELECT 1` with exponential backoff BEFORE migrations (migrations still run exactly once, never retried). Tunable via `DB_CONNECT_MAX_ATTEMPTS` / `DB_CONNECT_BASE_DELAY_MS` / `DB_CONNECT_MAX_DELAY_MS`. Commit `f4b0f70`.

**Mistake:** My first instinct was "stuck container → redeploy." The redeploy changed nothing, and I nearly concluded Postgres was fine because `railway connect postgres` + `SELECT 1` worked. That success was over the **public TCP proxy (IPv4)**; the backend connects over the **private network** (`*.railway.internal`, IPv6-only). "Public proxy works, private times out" is a network-path signature, not a stuck-process one — a restart can't fix it. (In this case the network did recover and the fresh deploy's own first probe succeeded, but the reasoning step was wrong.)

**Rules:**

1. **502 with Cloudflare's "Host: Error"** = origin is down/crashing, NOT an edge/route/auth problem. Check `railway logs` for a boot crash before touching the app-level route the user named. An Access `302` on `/admin/*` succeeds even while the origin is dead because Cloudflare answers it before hitting origin — don't let a working protected route fool you into thinking the app is up.
2. **`railway connect postgres` proves the PUBLIC proxy, not the private network.** To diagnose service-to-service reachability, use `private_network_status` for BOTH services and confirm each endpoint is `ready`/`ACTIVE` on the same network. Railway private IPs are IPv6 (`fd12:...`); "public works, private times out" points at the private path, and no restart fixes a network-layer problem.
3. **Any boot-time external dependency (DB, cache, queue) must retry with backoff, not crash the process.** A single transient timeout that kills `start()` turns a 5-second blip into an indefinite outage under a restart policy. Probe-then-proceed; keep one-shot side effects (migrations) out of the retry loop.

---

## 2026-07-04 — Skip @Observable only recomposes on reads of the model's own STORED properties

**Trigger:** Building the U11 onboarding view (Android/Skip Fuse). Taps on the graph options registered (no crash) but the screen never advanced to the next question.

**Mistake:** The `@Observable AndroidOnboardingModel` held a plain (non-observable) `OnboardingGraphEngine` and exposed `currentNode`/`currentQuestion` as computed properties that delegated straight to the engine. Mutating engine state (even while bumping an unrelated `step: Int`) did NOT re-render the view. On iOS whole-object invalidation often masks this; Skip→Compose is stricter — it only recomposes when `body` reads a property whose _stored_ backing changed.

**Rule:** For a Skip `@Observable` model, the state that drives the UI must be a **stored** property on the model itself, and `body` must **read** it. Two-part fix: (1) store the observed state directly (`private(set) var currentNodeId: String`, reassigned on every mutation via a `sync()`), and (2) make any computed passthrough read that stored property first (`_ = currentNodeId`) so SwiftUI/Skip records the dependency. A computed property that only reads a hidden non-observable object is invisible to the recomposition tracker. Verify on the emulator, not just the host build — this class of bug compiles and passes host unit tests cleanly (the pure engine was 8/8 green) and only surfaces as a dead UI on device.

---

## 2026-07-04 — Skip deep-link warm delivery + observation gotchas (U13)

**Trigger:** Wiring poem-share deep links (`porizo://poem-share/<id>`) to a claim sheet on Android/Skip.

**Mistakes & fixes:**

1. **Parser host coverage.** The custom-scheme branch only matched `porizo://receiver-handoff`; `porizo://poem-share` fell through to `.unknown` and was silently ignored — even though the `am start` intent "succeeded". **Rule:** when adding a deep-link route, update ALL THREE: the parser (route by host), the `AndroidManifest.xml` intent-filters (both the custom `porizo://<host>` and the `https` pathPrefix), and the router switch. A resolved intent that reaches `onOpenURL` can still no-op if the parser doesn't recognize the host. Add a parser regression test.
2. **Warm-while-active delivery has no scenePhase transition.** A link arriving via `onNewIntent` while the app is already foregrounded doesn't fire `scenePhase→.active`, so a `.onChange(of: scenePhase)` pull never runs. Cold + warm-from-background work via `.task`/scenePhase; warm-while-active does not.
3. **Skip @Observable observation is narrow.** Neither `.onChange(of:)` on a nested `@Observable`'s property, NOR a foreign singleton assigned to `@State var x = Singleton.shared`, reliably fires the observer on Skip. (Confirmed on-device: `onOpenURL` bumped the signal but the view's `.onChange` never ran.) **Rule:** for a cross-boundary (AppDelegate→view) notification, register a **direct main-actor callback** the view owns (`AndroidDeepLinkInbox.onLink = { consume() }`) and invoke it from `onOpenURL` — don't rely on @Observable signal propagation across instances. This composes with lesson-#5 (Skip recomposes only on reads of the model's own stored props): observation is per-instance and per-stored-property; anything crossing an instance or lifecycle boundary needs an explicit callback, not a reactive signal.

**Note:** real-world deep links (tapped from Messages/browser) are cold or warm-from-background — both work end-to-end. The warm-while-active gap only shows under `am start` on an already-foregrounded task and is covered by the callback fix.

---

## 2026-07-04 — Skip `#if SKIP` free funcs can only reference Kotlin-visible symbols (U14)

**Trigger:** Wiring a OneSignal notification-tap listener. The Kotlin bridge closure needed to hand the payload to Swift; kept getting `Unresolved reference 'AndroidPushInbox'` / `'AndroidPushTapStore'` in the transpiled `AndroidNativeAdapters.kt`.

**Root cause:** Skip's split-compile treats a Swift file two ways. A `#if SKIP` block transpiles to a **plain Kotlin function** (Android-only glue). Everything OUTSIDE `#if SKIP` in a file that's consumed only host-side transpiles to an **empty bridge stub** (e.g. `AndroidPushRouting.kt` was 71 bytes — package + imports, no types). So a `#if SKIP` Kotlin func can reference: other `#if SKIP` funcs, native `.kt` bridge objects, and Skip stdlib — but NOT a Swift `enum`/`struct` that lives in a host-bridged file, and NOT a mutable Swift global (doesn't survive the split).

**Rule:** When a native `.kt` bridge callback must reach Swift-only state (stores, inboxes, view callbacks), do NOT try to call a Swift type from the `#if SKIP` Kotlin func. Instead forward to a **bridged Swift method** — a func marked `/* SKIP @bridge */public func …` on a bridged object (e.g. the AppDelegate). That method runs as real Swift and can touch any Swift symbol. This is exactly how `onOpenURL` already crosses the boundary; `onNotificationTap` follows the same shape. Pattern: Kotlin listener → `AppDelegate.shared.onXxx(payload)` (bridged) → Swift store + `AndroidDeepLinkInbox.onLink?()`.

**Corollary:** cross-boundary delivery (native→view) should reuse the proven UserDefaults-store + onLink-callback path (see lessons #6/#7), not @Observable signals or mutable globals.

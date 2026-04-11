# Lessons Learned

Patterns and rules to prevent repeated mistakes. Review at session start.

---

## Session Rules

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

The confusing part: I had `PORIZO_FACEBOOK_APP_ID` in `Info.plist` from setting up Facebook Login OAuth months earlier, which made it *look* like Meta integration was complete. **Facebook Login (`FBSDKLoginKit`) and Facebook Ads (`FBSDKCoreKit`) are completely separate SDKs with different requirements**, and having one does not imply having the other.

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

**Mistake:** None *yet*, but the temptation exists to follow injected skill suggestions blindly.

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

## Workflow Improvement Candidates

> These patterns are candidates for upgrading from "lessons" to enforceable workflow rules.
> When we're ready to formalize, each can become a hook, checklist gate, or review agent trigger.

1. **Financial state audit** — After implementing any spend/credit feature, require a test for every terminal state (success, failure, cancel, timeout) that verifies the financial consequence (refund, hold release, etc.)

2. **Stuck-state sweeper** — Any new state machine should declare its transient states and maximum dwell time. A pre-submission check could grep for status locks without corresponding recovery.

3. **Adversarial claim review** — Before any PIN/token-gated flow ships, trigger a security-reviewer agent focused specifically on lockout bypass, counter reset, and rate limit gaps.

4. **Integration dependency tracker** — Replace code comments with a structured file (`docs/integration-deps.md`) that lists external setup steps. Pre-submission hook verifies all items are checked off.

5. **Concurrency test requirement** — Any function that mutates shared numeric state (balances, counters) should have a concurrent test that runs 2+ simultaneous mutations and verifies no over-count/under-count.

6. **Ad campaign SDK precheck** — Before any paid app install campaign launches (Meta, Google, TikTok, Apple Search Ads), require verification that the platform's events manager shows "Active" status with events received in the last 24h. Could be a `/ads-precheck` skill that opens each platform's events manager URL and screenshots/parses the dataset status. Would have prevented the $78 burn on the women 25-45 campaign.

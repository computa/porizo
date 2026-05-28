# Plan — Wire up Meta install attribution end-to-end (2026-05-28)

**Goal:** Turn `act_29474028` from a tracking-blind account into one that can run app-install campaigns with **real install/conversion signal** — so Meta can optimize, SKAdNetwork can attribute, and we stop spending blind ($150 lifetime → 0 trackable installs proved we can't do install ads today).

**Owner:** ao · **Scope:** marketing-only (no app feature changes) · **Risk:** mostly Meta Events Manager config + 1 landing-page snippet + small Swift event-logging additions. No DB migrations. No customer-facing changes.

---

## What's already in place (don't redo)

| Piece                                                  | Status                                                                   | Where                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `facebook-ios-sdk` via SPM                             | ✅ integrated                                                            | `PorizoApp/PorizoApp.xcodeproj/...Package.resolved`                                                  |
| `FacebookAppID` / `FacebookClientToken` build settings | ✅ set to `1984455025792561` / `5f5ef71af5f6f046f514bccf946c7c0f`        | `PorizoApp.xcodeproj/project.pbxproj` lines 599-600, 643-644                                         |
| `Info.plist` Facebook + SKAdNetwork keys               | ✅ present (SKAdNetworkItems list, FacebookAutoLogAppEventsEnabled=true) | `PorizoApp/Info.plist`                                                                               |
| FB SDK init in app lifecycle + ATT consent flow        | ✅ wired                                                                 | `PorizoApp/PorizoApp/PorizoAppApp.swift:150-160, 378-414`                                            |
| AppsFlyer MMP integration                              | ✅ referenced (verify it's not just placeholder)                         | `Services/AnalyticsService.swift`, `Info.plist`, `StoreKitManager.swift`, `WarmCanvasFlowView.swift` |
| Marketing API CLI + token + ad account                 | ✅ done today                                                            | `~/meta-ads/.env` (`act_29474028`, never-expiring system-user token)                                 |
| Bundle ID                                              | `porizo.ios.app.PorizoApp`                                               | pbxproj                                                                                              |
| App Store ID                                           | `6758205028`                                                             | observed in install creative                                                                         |

## What's missing (this plan fills these)

| Gap                                                                                                                        | Layer                              |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| The Meta app `1984455025792561` has no **iOS App Dataset** registered in Events Manager                                    | Meta web                           |
| Dataset → `act_29474028` connection                                                                                        | Meta web                           |
| Bundle ID `porizo.ios.app.PorizoApp` ↔ App Store ID `6758205028` ↔ Meta App mapping                                        | Meta web                           |
| **SKAdNetwork conversion value schema**                                                                                    | Meta web                           |
| Meta Pixel on `landing/index.html` (porizo.co)                                                                             | Code (1 file)                      |
| Custom Porizo conversion events fired from the app (`fb_mobile_complete_registration` + 1-2 custom events)                 | Code (Swift)                       |
| Old "Ringoversea's Pixel" needs to stop being the only dataset attached to the ad account                                  | Meta web cleanup                   |
| AppsFlyer ↔ Meta SAN handshake (verify or set up)                                                                          | AppsFlyer dashboard                |
| Confirm Meta app `1984455025792561` is configured as a **mobile app** (not just a Business app), or create a dedicated one | Meta web — first-step verification |

---

## Phase 0 — VERIFIED 2026-05-28

- ✅ **Q1 resolved:** Meta app `1984455025792561` is already a **mobile-app-typed** Meta app (`object_store_urls.itunes` = `id6758205028`). It's owned by Acuoos and listed under `act_29474028.advertisable_applications`. **Reuse this app — do not create a new one.**
- ✅ **AppsFlyer is genuinely integrated** — SPM `AppsFlyerFramework`, build settings `APPSFLYER_DEV_KEY=oU9qifzktE3bom9eWBWDTD` + `APPSFLYER_APPLE_APP_ID=6758205028`, full event mapping in `AnalyticsService.swift`.
- ❌ **FBSDK direct event logging missing** — only `AppEvents.shared.activateApp()` fires; the typed conversion events are mapped to AppsFlyer only.
- ❌ **No App Events Dataset** registered in Events Manager (only the dead Ringoversea web pixel exists in the business).

## Decisions made

- **Q2 — Dual-rail attribution.** AppsFlyer stays the MMP. Also fire FBSDK direct events for the canonical conversions (mirror AnalyticsService's existing AppsFlyer forwarder). Meta sees first-party signal + AppsFlyer dashboard forwards as a second path.
- **Q3 — SKAN schema:**
  - **Coarse (3):** LOW = install/activate · MEDIUM = `authCompleted` · HIGH = `firstSongCompleted` OR `purchase`.
  - **Fine (0–63):** purchase revenue buckets in AUD ($0 / $0–5 / $5–15 / $15–50 / $50+).
  - **AEM priority order:** Purchase → Subscribe → CompleteRegistration → AddToCart (song created).
- **Q4 — Separate web dataset** for `porizo.co`.
- **Q5 — Disconnect Ringoversea's Pixel** from `act_29474028` after Phase 6 verifies.

## Open questions (need answers before Phase 1)

> These change what we do, not just how. Worth resolving up front.

- **Q1.** Is Meta app `1984455025792561` already configured as a "mobile app" (i.e., has the iOS App Dataset capability) or is it only the Business/Marketing-API app I added the use case to today? If only the latter, we either (a) add the **"Create & manage app ads with Meta Ads Manager"** use case (already on it ✓) plus an iOS dataset to the same app, or (b) create a **separate Meta app** specifically for the iOS app. Most installs guides recommend (a) — same app. → **Phase 0 verifies this; don't proceed past it without the answer.**
- **Q2.** Is AppsFlyer the primary MMP and Meta a **SAN** (Self-Attributing Network) hooked via AppsFlyer's postback config? Or is Meta direct the source of truth and AppsFlyer just a measurement layer? This decides whether SKAN postbacks are configured to land on Meta directly, on AppsFlyer (who forwards), or both. Default assumption: **AppsFlyer primary, Meta as SAN** (matches the code comment "Both FBSDK and AppsFlyer need the result").
- **Q3.** Which event is the **anchor conversion** for SKAN value bucketing? SKAN gives one 6-bit postback per install. Candidates ranked by signal value: `purchase` > `complete_registration` (= voice enrollment done) > `add_to_cart` (= first song-create) > `app_install`. Recommendation: **`purchase` as fine value + `complete_registration` as coarse**, but needs sign-off.
- **Q4.** Web pixel: reuse the iOS app dataset's web events, or create a **separate web dataset** specifically for porizo.co? Recommend separate — cleaner separation of "web visitor → app install" vs "app event" funnels.
- **Q5.** Should we **disconnect Ringoversea's Pixel** from `act_29474028` (it's a dead 2016 pixel)? Recommended: yes, after Phase 6 ships, so we have a working replacement first.

---

## Phase 0 — Pre-flight verification _(start here, ~15 min)_

- [ ] **0.1** Query the Meta app's current product/use-case + app type via Graph API to confirm it can host an iOS app dataset
  - `cd ~/meta-ads && python3 -c '... GET /1984455025792561?fields=name,namespace,app_type,server_ip_whitelist,object_store_urls,domains'` (script in `scripts/aso/` to be added if useful)
- [ ] **0.2** Check whether an App Dataset already exists for `porizo.ios.app.PorizoApp`
  - Events Manager → Data Sources → search bundle id; or Graph API `GET /{business_id}/owned_apps?fields=name,object_store_urls`
- [ ] **0.3** Verify AppsFlyer is genuinely wired (not stub): grep for `AppsFlyerLib.shared().start(...)` and check `AnalyticsService.swift`'s init order
  - `grep -n "AppsFlyer" PorizoApp/PorizoApp/Services/AnalyticsService.swift`
- [ ] **0.4** Confirm the current `FacebookClientToken` (`5f5ef71af5f6f046f514bccf946c7c0f`) is valid for app `1984455025792561` — try `meta ads adaccount list` (we did, ✓) **and** a sanity dataset-fetch for the app
- [ ] **0.5** Get the user's answers to Q1–Q5 above

**Gate:** Don't move on until Q1 is answered. If it requires creating a new Meta app, Phase 1 looks very different.

---

## Phase 1 — Register the iOS App Dataset in Meta Events Manager _(item 1 + item 4)_

- [ ] **1.1** Events Manager → **Connect Data Sources → App → iOS**
  - Bundle ID: `porizo.ios.app.PorizoApp`
  - App Store URL: `https://apps.apple.com/app/id6758205028`
  - Link to Meta app: `1984455025792561` (or new app per Q1)
  - Name the dataset: `Porizo iOS App`
- [ ] **1.2** Verify the resulting **App Dataset ID** is captured; record it in this plan file and in `~/.claude/.../memory/reference_meta_ads_cli.md`
- [ ] **1.3** Events Manager → Dataset → **Settings → Connected Assets** → add `act_29474028`
  - This is the SKAN postback routing — without it, Apple postbacks won't reach this ad account
- [ ] **1.4** Verify connection via Graph API: `GET /act_29474028?fields=connected_app_data_sources` should now include the new dataset
- [ ] **1.5** Remove or note the old "Ringoversea's Pixel" — leave connected for now (per Q5); add a comment in this plan: "Disconnect after Phase 6 verified"

**Verification:** App Dataset visible in Events Manager with bundle id ✓; `connected_app_data_sources` of `act_29474028` includes it ✓.

---

## Phase 2 — Verify FB SDK event flow end-to-end _(item 2)_

> SDK is already integrated; this phase confirms events actually land in the new dataset, then adds the 2 most valuable custom events for Porizo.

- [ ] **2.1** Read `PorizoApp/PorizoApp/PorizoAppApp.swift` 130-170 and 370-420 — verify FBSDK init runs unconditionally after `FacebookClientToken` is non-empty (it is, per pbxproj)
- [ ] **2.2** Read `PorizoApp/PorizoApp/Services/AnalyticsService.swift` — catalog what events it already logs and whether they route to FBSDK + AppsFlyer
- [ ] **2.3** Build & install a dev build on a test device (real device required for FB AEM testing — simulator won't get SKAN postbacks)
  - `xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Debug build`
  - install on device via `xcrun devicectl ...`
- [ ] **2.4** Launch app → trigger an `App Activate` event (auto-logged by `FacebookAutoLogAppEventsEnabled=true`) → check Events Manager → Test Events tab → confirm the event arrives within ~30s
- [ ] **2.5** Add custom event logging for the **2 anchor Porizo conversions** (recommended set, finalize with Q3):
  - `fb_mobile_complete_registration` ← when voice enrollment succeeds
  - `fb_mobile_add_to_cart` ← when first song-create request is queued
  - `fb_mobile_purchase` (with `valueToSum` = credits price) ← when a credit pack is purchased (we have StoreKit so this is natural)
  - File: extend `Services/AnalyticsService.swift` with `logFBEvent(name:params:)` wrapper if not already present
- [ ] **2.6** Verify each custom event arrives in Test Events
- [ ] **2.7** Confirm AppsFlyer mirror events fire too (cross-check in AppsFlyer dashboard); answer **Q2** definitively after this

**Verification:** All 4 events (`fb_mobile_activate_app`, `complete_registration`, `add_to_cart`, `purchase`) visible in Events Manager Test Events; AppsFlyer dashboard shows the same install + 3 in-app events.

---

## Phase 3 — SKAdNetwork conversion schema _(item 3)_

> One install = one 6-bit SKAN postback. Spend this carefully.

- [ ] **3.1** Decide on **fine vs coarse** conversion scheme (Q3). Recommended starting schema:
  - **Coarse (LOW/MEDIUM/HIGH):**
    - LOW: install + open
    - MEDIUM: complete_registration (voice enrollment done)
    - HIGH: purchase (any credit purchase)
  - **Fine (0-63):** map to revenue bucket of first purchase
- [ ] **3.2** Events Manager → App Dataset → **Aggregated Event Measurement → Configure conversions**
  - Order the 8 priority slots (only top 8 are tracked under SKAN):
    1. `Purchase` (high value)
    2. `Subscribe` (if Porizo has subs)
    3. `Complete Registration`
    4. `Add to Cart` (first song create)
    5. `View Content`
    6. `App Activate`
       7-8. reserve
- [ ] **3.3** Configure the SKAN postback **conversion value schema** to map the events above to coarse + fine values per Meta's UI
- [ ] **3.4** Submit the schema (Meta requires explicit "save & verify" — takes ~30 min to propagate)
- [ ] **3.5** Cross-check `Info.plist` `SKAdNetworkItems` against [Meta's current published SKAN ID list](https://developers.facebook.com/docs/SKAdNetwork/) — Apple caps at 100, Meta's list is ~100, so they should match exactly. Update if drifted.

**Verification:** Events Manager AEM page shows 8-slot priority order; SKAN preview shows coarse + fine mappings; `Info.plist` SKAN list matches Meta's current canonical list.

---

## Phase 4 — Bundle-ID ↔ App Store linkage _(item 4 — mostly absorbed into Phase 1, this is the final verification)_

- [ ] **4.1** In Events Manager → App Dataset → **App Store Linking**, confirm:
  - Bundle ID: `porizo.ios.app.PorizoApp` ✓
  - App Store ID: `6758205028` ✓
  - Country/region of store: AU (or "Worldwide" if available)
- [ ] **4.2** Send a test SKAN postback from the test device (Meta has a "Test SKAdNetwork" tool in Events Manager) → verify it lands on `act_29474028`
- [ ] **4.3** Document the linkage in `reference_meta_ads_cli.md` memory file

**Verification:** Test SKAN postback arrives in `act_29474028` Events Manager log.

---

## Phase 5 — Meta Pixel on `porizo.co` landing _(item 5)_

> The landing page exists at `landing/index.html` (Vercel deploy via `landing/vercel.json`). Tiny file (88 lines), no analytics today.

- [ ] **5.1** Events Manager → **Connect Data Sources → Web → Meta Pixel** → name it `Porizo Web Pixel`; if Q4 = separate web dataset, this is its own; otherwise attach to the iOS App Dataset
- [ ] **5.2** Get the new **Pixel ID**; record it in this plan
- [ ] **5.3** Edit `landing/index.html` — inject the base Pixel snippet in `<head>` (before `</head>`) with **environment-aware Pixel ID** (avoid hardcoding):

  ```html
  <!-- Meta Pixel -->
  <script>
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod
          ? n.callMethod.apply(n, arguments)
          : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(
      window,
      document,
      "script",
      "https://connect.facebook.net/en_US/fbevents.js",
    );
    fbq("init", "<PIXEL_ID>");
    fbq("track", "PageView");
  </script>
  <noscript
    ><img
      height="1"
      width="1"
      style="display:none"
      src="https://www.facebook.com/tr?id=<PIXEL_ID>&ev=PageView&noscript=1"
  /></noscript>
  ```

- [ ] **5.4** Add 1 conversion event on the "Get the App" CTA click — fire `fbq('track', 'Lead')` before redirecting to App Store (handler in same file)
- [ ] **5.5** Deploy to Vercel (auto on push to main); verify the live page loads the pixel snippet
- [ ] **5.6** Use [Meta Pixel Helper](https://chrome.google.com/webstore/detail/meta-pixel-helper/...) Chrome extension to confirm PageView + Lead both fire on porizo.co
- [ ] **5.7** Events Manager → Web Pixel → **Test Events** confirms events arriving
- [ ] **5.8** _(Optional, bonus)_ Hook up **Conversions API** server-side from the Porizo backend (`src/server.js` already runs Fastify; add `src/routes/marketing-pixel.js` posting to `https://graph.facebook.com/v21.0/<PIXEL_ID>/events` with the system-user token). Skip if Q4 says we don't need it yet.

**Verification:** Pixel Helper shows PageView + Lead firing on `porizo.co`; Test Events panel confirms in Meta UI.

---

## Phase 6 — End-to-end verification + relaunch _(prove it works before spending real money)_

- [ ] **6.1** Build TestFlight build with the new event logging; install on a fresh device
- [ ] **6.2** Run the install funnel manually: tap an App Store link → install → open → enroll voice → create first song → purchase a credit pack
- [ ] **6.3** Verify in Events Manager that **all 4 events** arrive with proper sequence + timestamps
- [ ] **6.4** Verify AppsFlyer dashboard shows the install + same in-app events
- [ ] **6.5** Wait ~24h for SKAN postback simulation; verify the test install + conversion bucket arrives on `act_29474028`
- [ ] **6.6** Confirm Pixel Helper still shows porizo.co PageView/Lead
- [ ] **6.7** _(now safe)_ Disconnect "Ringoversea's Pixel" from `act_29474028` (per Q5)
- [ ] **6.8** Update memory file `~/.claude/.../memory/reference_meta_ads_cli.md` with: new App Dataset ID, Pixel ID, SKAN schema decision, the date the migration completed
- [ ] **6.9** Update `tasks/lessons.md` with: "Generic 'no installs reported' = check dataset not pixel; old account often has orphan datasets that need disconnecting"

**Verification:** A test install on a fresh device produces measurable signal in **(a)** AppsFlyer, **(b)** Meta Events Manager Test Events, **(c)** SKAN postback log on `act_29474028`. Three independent confirms = ready to spend.

---

## Phase 7 — Relaunch the install campaign _(optional next step, not part of this plan's scope)_

> Only after Phase 6 verifies. Probably a separate plan, but listed for closure.

- Create a new campaign (don't revive the dormant `PORIZO_INSTALLS_Women25-45_2026Q2`; it's anchored to the dead-pixel era)
- Objective: APP_PROMOTION with **Conversion location = App** and **Optimization for app install** now backed by real signal
- Budget guard: A$30/day, kill after 7d if CTR < 1% or CPI > A$5

---

## Effort & risk

| Phase                          | Effort                                                          | Risk                                    |
| ------------------------------ | --------------------------------------------------------------- | --------------------------------------- |
| 0 — verify                     | 15 min                                                          | low                                     |
| 1 — register dataset           | 30 min (web UI)                                                 | low                                     |
| 2 — verify SDK + custom events | 1-2h (Swift + test device)                                      | medium (Swift changes, need TestFlight) |
| 3 — SKAN schema                | 30 min + 24h propagation                                        | low                                     |
| 4 — bundle id linkage          | 15 min                                                          | low                                     |
| 5 — web pixel                  | 30 min (1 file edit + deploy)                                   | low                                     |
| 6 — e2e verify                 | 1-2h hands-on + 24h wait for SKAN                               | medium (real-world test)                |
| **Total active work**          | **~4-5h spread across Phase 0-5**, plus a ~24h soak for Phase 6 |                                         |

## Reversibility

Every step in this plan is reversible:

- Datasets/Pixels can be deleted in Events Manager
- Code additions in `AnalyticsService.swift` are pure additions (no behavior change for non-FBSDK paths)
- `landing/index.html` pixel snippet can be removed
- No DB migrations, no customer-data implications

---

## Approval needed

User please confirm before I start executing:

1. Approve the plan as-is, OR call out changes
2. Answer Q1-Q5 (open questions section)
3. Confirm I should write code changes (Phase 2.5, Phase 5.3) and commit per-phase to a branch — or only execute the Meta web-side work and hand the Swift/HTML edits back for you to do

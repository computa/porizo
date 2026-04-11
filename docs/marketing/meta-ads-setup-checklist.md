# Meta Ads SDK Setup Checklist

**Date:** 2026-04-11
**Why:** Campaign `PORIZO_INSTALLS_Women25-45_2026Q2` spent $78.30 with zero attributed installs because the Facebook SDK was never integrated in the iOS app. Events Manager shows "Inactive — Never received event" on the Porizo dataset. This document walks through everything needed to fix it.

**Your App ID (from Events Manager):** `1984455025792561`
**App Store ID:** `6758205028`
**Bundle ID:** `com.porizo.app`

---

## Step 0 — What I Already Did (Code Side)

✅ `PorizoApp/Info.plist` — added:
- `FacebookAppID` = `1984455025792561`
- `FacebookClientToken` = `$(PORIZO_FACEBOOK_CLIENT_TOKEN)` (env var substitution)
- `FacebookDisplayName` = `Porizo`
- `FacebookAutoLogAppEventsEnabled` = `true`
- `FacebookAdvertiserIDCollectionEnabled` = `true`
- `LSApplicationQueriesSchemes`: added `fbapi`, `fbauth2`, `fb-messenger-share-api`, `fbshareextension`
- `SKAdNetworkItems` array with 30 Meta-published ad network IDs

✅ `PorizoApp/PorizoApp/PorizoAppApp.swift` — added:
- `#if canImport(FacebookCore)` conditional import
- `ApplicationDelegate.shared.application(...)` call in `didFinishLaunchingWithOptions`
- `AppEvents.shared.activateApp()` call on `scenePhase == .active`

All Facebook code is gated behind `#if canImport(FacebookCore)` so the project compiles *right now* even before you add the SPM package. Once you add the package, the code activates automatically on next build.

---

## Step 1 — Add Facebook SDK via Swift Package Manager (Xcode)

**Time:** ~5 min

1. Open `PorizoApp.xcodeproj` in Xcode
2. Click the project in the navigator → select the `PorizoApp` target
3. File menu → **Add Package Dependencies…**
4. Paste URL: `https://github.com/facebook/facebook-ios-sdk`
5. Dependency Rule: **Up to Next Major Version** — starting from `18.0.0` (or whatever is current)
6. Click **Add Package**
7. When prompted for products, add:
   - ✅ **FacebookCore** (required — this is what you need for Ads attribution)
   - ⬜ FacebookLogin (skip — you already have OAuth via your own backend)
   - ⬜ FacebookShare (skip — you have native share sheets)
   - ⬜ FacebookGamingServices (skip)

**Verify:** Build the project (`Cmd+B`). You should see no errors. If you see `No such module 'FacebookCore'`, the package wasn't added correctly.

---

## Step 2 — Get Your FacebookClientToken (Meta App Dashboard)

**Time:** ~3 min

1. Go to https://developers.facebook.com/apps/1984455025792561/
2. Left sidebar → **Settings** → **Advanced**
3. Scroll to **Security** → **Client Token**
4. Copy the token (it will look like a 32-char hex string)

**Confirm the App ID matches:**
- In the URL bar: `.../apps/1984455025792561/` ← must match `FacebookAppID` in Info.plist
- If the Meta app's iOS Bundle ID is different from `com.porizo.app`, go to Settings → Basic → iOS → update Bundle ID to match

**⚠️ If App ID `1984455025792561` does not exist in your Meta dev account:**
You probably need to create a new Meta App of type "iOS" in Meta Business Manager first. The App ID in Events Manager must match the one you create here. If they got out of sync, delete one and recreate it so they match.

---

## Step 3 — Set the Client Token in Info.plist

**Time:** ~2 min

**Important context:** I checked this repo — the existing `$(PORIZO_*)` placeholders in Info.plist have no value source (no xcconfig, no scheme env vars, no .env file). They compile as literal strings. The project's current pattern is effectively: **put the real value directly in Info.plist**.

Given that, the simplest path for `FacebookClientToken` is:

1. Open `PorizoApp/Info.plist`
2. Find the line:
   ```xml
   <key>FacebookClientToken</key>
   <string>$(PORIZO_FACEBOOK_CLIENT_TOKEN)</string>
   ```
3. Replace with:
   ```xml
   <key>FacebookClientToken</key>
   <string>PASTE_YOUR_CLIENT_TOKEN_HERE</string>
   ```
4. Save

**Is it OK to commit the client token?** Yes. Meta's Client Token is designed to be shipped in client apps — it's analogous to a publishable API key, not a secret. It's used to authenticate SDK calls to Meta's servers; it doesn't grant access to ad account management or user data. Meta documents this in the FBSDK setup guide as a value that goes into the iOS bundle.

**If you want to keep it out of git anyway:** create `PorizoApp/Info.Secret.plist` (gitignored), paste the token there, and wire it up via a build phase script — but this is overkill for a client token and breaks the existing Info.plist pattern. Not recommended unless you're reusing the same Meta App ID across multiple untrusted environments.

**Runtime safety:** I added a guard in `PorizoAppApp.swift` that skips FB SDK init entirely if the token is missing or still contains `$(` — so your dev builds won't crash even if you forget to paste. The console will print `[FBSDK] Skipped init — PORIZO_FACEBOOK_CLIENT_TOKEN not set in xcconfig` instead of an NSException.

---

## Step 4 — Build and Run on a Device

**Time:** ~5 min

Simulators work for smoke testing but **real ad attribution only works on physical devices** because SKAdNetwork is tied to iOS device identifiers.

1. Plug in iPhone → select device in Xcode scheme → Build & Run
2. App should launch normally
3. In Xcode console, look for a line like:
   ```
   [FBSDKAppEvents] Starting app activation...
   ```
   This confirms `activateApp()` fired.

**If you see crash-on-launch about Facebook:**
- Most likely `FacebookClientToken` is empty → double-check Step 3
- Or Bundle ID mismatch → double-check Step 2

---

## Step 5 — Verify Events in Events Manager (Critical Checkpoint)

**Time:** ~5 min

This is where you confirm the fix worked. **Do not skip this.**

1. https://business.facebook.com/events_manager2
2. Select business: `29474028`
3. Left sidebar → **Datasets**
4. Click **Porizo** (currently showing red warning triangle)
5. Click **Test Events** tab
6. On your phone: close Porizo completely → reopen it
7. Within ~30 seconds, you should see `fb_mobile_activate_app` appear in the Test Events list with a timestamp

**Success criteria:**
- `fb_mobile_activate_app` event appears in Test Events
- Overview tab: **Status** flips from "Inactive — Never received event" to **"Active"**
- Red warning triangle on the Porizo dataset **disappears**

**If no events show up:**
- Is the device online?
- Is the app actually hitting the Info.plist code path? Check Xcode console for FBSDK logs
- Is `FacebookAutoLogAppEventsEnabled` set to `true`? (yes — I set it in Step 0)
- Is the Bundle ID in Meta App Dashboard matching `com.porizo.app`?

---

## Step 6 — Link Dataset to App Store App

**Time:** ~2 min

Even with events flowing, Meta needs to know which App Store listing to attribute installs to.

1. Events Manager → Datasets → Porizo → **Settings** tab
2. Find **App Store app** or **Linked App** section
3. Search for Porizo in the App Store
4. Confirm it's the right one (App Store ID `6758205028`, developer Acuoos Pty Ltd)
5. Click **Link** / **Connect**

---

## Step 7 — Ship to TestFlight

**Time:** ~15 min

The SDK changes need to go out to whatever iOS build is running the ads campaign. Users of the currently-public App Store build won't have the SDK even after this fix — they'll need to update.

1. Xcode → Product → **Archive**
2. Follow your usual TestFlight upload flow (from memory: `xcodebuild archive -allowProvisioningUpdates` pattern)
3. Submit for App Store review (or TestFlight external testers first to verify events flow for real users)
4. **Wait for the new build to be live on the App Store before spending more ad budget** — new installers need to land on a build that has the SDK, otherwise attribution is still broken

---

## Step 8 — Rebuild the Campaign (Ads Manager)

**Time:** ~20 min

Only after Step 5 shows "Active" and Step 7 is live.

### Campaign settings

| Setting | Value | Why |
|---|---|---|
| Objective | **App Install** | Correct objective now that we can actually measure it |
| Budget | **$50-100/day** | iOS installs cost $3-15 each, need ~50 conversions/week to exit learning phase — $20/day was below this threshold |
| Geo | **Canada only** (start) | Previous data showed Canada at $2.63 CPM with tier-1 audience — cheapest to collect signal. Expand after 1 week. |
| Placements | **Manual**, check ONLY: Facebook Feed, Facebook Reels, Facebook Stories, Instagram Feed, Instagram Reels, Instagram Stories | **Explicitly exclude Audience Network** — that's where your $78.30 probably went |
| Targeting | **Broad**: age 22-55, any gender, no interest targeting | Let the algorithm optimize once it has real conversion signal. Narrow targeting + weak signal = stuck in learning forever. |
| Bid strategy | Highest volume | Default is fine now that there's signal |
| Attribution | 7-day click, 1-day view | Default — iOS attribution is what it is |
| Optimization event | **App Install** (SKAdNetwork) | Make sure this is selected, not "Landing Page View" |

### Creative

Use the counseling ad videos already rendered at `marketing/remotion/out/facebook/`:

1. **young-couple-reel.mp4** (9:16, 22 MB) — Feed + Reels placements
2. **young-couple-feed.mp4** (1:1, 6.7 MB) — Feed placement
3. **established-couple-reel.mp4** (9:16, 22 MB) — Feed + Reels placements
4. **established-couple-feed.mp4** (1:1, 6.7 MB) — Feed placement

**Primary text:** Pull from the counseling ad design brief at `marketing/remotion/2026-03-17-counseling-ad-design.md`
- Young: *"Remember how it started? Turn your memories into a song — in your voice."*
- Established: *"The best gift is a memory they forgot they had."*

**Headline:** `Turn memories into song`
**CTA button:** `Install Now`
**Destination:** App Store URL with Meta click parameters (Meta auto-appends these)

### Learning phase goal

Run for **7 full days minimum** without pausing or editing. Meta needs 50+ conversions to exit learning. Any edit resets the learning clock. If after 7 days you have <50 installs, the problem is cost-per-install > budget — increase budget, don't edit targeting.

---

## Step 9 — Interim Traffic Campaign (Optional Bridge)

If shipping the SDK build will take more than 3-5 days, you can run the Traffic campaign Meta suggested in Screenshot #3 in the meantime.

**Why it's OK without the SDK:**
- Traffic objective tracks link clicks to App Store (Meta can see these server-side, no SDK needed)
- You'll get ~60 link clicks/day at $20/day budget
- Typical click→install rate: 3-8% → realistically 2-5 installs/day
- Cost per install: $5-15 (not measurable in Meta, but inferable from App Store Connect install count delta)

**Caveats:**
- You can't optimize for installs — Meta optimizes for "people who click" which is a weaker signal
- You can't build lookalike audiences from installers
- Don't run longer than 2 weeks — it's a stopgap, not a strategy
- Use ONLY if SDK integration will be delayed

**Setup:** Click "Create ad" on Meta's suggestion UI (Screenshot #3) — it's already preconfigured.

---

## Lessons to Save

After this is fixed and running, add to `tasks/lessons.md`:

> **Trigger:** Launching a new Meta Ads App Install campaign for a mobile app
> **Mistake:** Assumed Facebook Login integration was enough; didn't verify Facebook SDK (FBSDKCoreKit) was wired for ads attribution. Burned $78 on a campaign Meta couldn't measure.
> **Rule:** Before launching ANY Meta App Install campaign, verify Events Manager → Datasets → [App] shows "Active" status with events received in the last 24h. If it shows "Inactive — Never received event", do NOT launch the campaign. Fix SDK first, then launch.

---

## Quick Reference: What Broke vs What Fixes It

| Symptom | Cause | Fix |
|---|---|---|
| Zero attributed installs despite 24K impressions | FB SDK not installed in iOS app | Steps 1-7 |
| CPM of $2-4 on tier-1 women 25-45 (should be $15-30) | Meta had no conversion signal, dumped budget on Audience Network junk | Step 8 (manual placements, exclude AN) |
| Campaign never exited learning phase | $20/day is below 50-conversions/week threshold for iOS installs | Step 8 (budget $50-100/day) |
| Events Manager shows "Never received event" | `fb_mobile_activate_app` never fires because SDK isn't calling `activateApp()` | Steps 1-5 |
| Ad showed in 4 countries at once | Budget too thin, spread across too many geos to generate signal anywhere | Step 8 (single geo first) |

---

# Part 2: TikTok Business SDK Setup

**Status (as of 2026-04-11, build 88+):** Package installed, Swift wired, runtime guard in place. Missing: platform credentials.

## What I Already Did (Code Side)

✅ Added `https://github.com/tiktok/tiktok-business-ios-sdk` v1.6.0 as SPM package → product `TikTokBusinessSDK` linked on `PorizoApp` target.

✅ `PorizoApp/Info.plist` — added keys (with placeholders):
- `PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN` = `$(PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN)`
- `PORIZO_TIKTOK_BUSINESS_APP_ID` = `porizo.ios.app.PorizoApp` *(hardcoded, not a secret — it's your bundle ID)*
- `PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID` = `$(PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID)`

✅ `PorizoApp/PorizoApp/PorizoAppApp.swift` — added:
- `#if canImport(TikTokBusinessSDK)` conditional import
- `TikTokBiz.isConfigured` runtime guard (checks all 3 Info.plist keys are non-placeholder)
- `TikTokBusiness.initializeSdk(TikTokConfig(...))` call in `AppDelegate.didFinishLaunchingWithOptions`, gated by the guard

✅ `SKAdNetworkItems` — added TikTok's primary ad network ID `mj797d8u6f.skadnetwork`.

## Step T1 — Register Your iOS App in TikTok Events Manager

**Time:** ~10 min

1. Go to https://ads.tiktok.com/ → sign in with your TikTok Ads Manager account
2. Top-right menu → **Tools** → **Events Manager** (or: https://ads.tiktok.com/i18n/events_manager)
3. Top of Events Manager → **Connect Data Source** → **App**
4. Select: **SDK integration** (not MMP) — because we're using TikTok Business SDK directly
5. Platform: **iOS**
6. App details:
   - App name: `Porizo`
   - Bundle ID: `porizo.ios.app.PorizoApp` (must match exactly)
   - App Store URL: `https://apps.apple.com/app/porizo/id6758205028`
7. **Save** — TikTok will assign a numeric **TikTok App ID** (a string of digits, different from your bundle ID). Copy it.

## Step T2 — Get the Access Token

**Time:** ~3 min

1. Still in Events Manager → click on the Porizo app you just created
2. **Web Events** or **App Events** tab → **Events API** section (sometimes labeled "Server-to-Server API")
3. **Generate Access Token** → copy the long-lived token

**Note:** This token is technically long-lived but can be regenerated from the same UI if it leaks. Treat it like a secret — don't commit it to a public repo.

## Step T3 — Paste Both Values into Info.plist

**Time:** ~1 min

Open `PorizoApp/Info.plist` and replace:
```xml
<key>PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN</key>
<string>$(PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN)</string>
<!-- bundle id stays as-is -->
<key>PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID</key>
<string>$(PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID)</string>
```

With:
```xml
<key>PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN</key>
<string>YOUR_ACCESS_TOKEN_FROM_STEP_T2</string>
<key>PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID</key>
<string>YOUR_NUMERIC_TIKTOK_APP_ID_FROM_STEP_T1</string>
```

## Step T4 — Ship TestFlight Build

Same as Meta Step 7 — archive, upload, wait for App Store processing, install on your iPhone.

## Step T5 — Verify in TikTok Events Manager

**This is the TikTok equivalent of Meta's "Events Manager shows Active" checkpoint.**

1. Open Porizo on your iPhone (physical device, not simulator)
2. Wait ~60 seconds
3. Return to https://ads.tiktok.com/i18n/events_manager → Porizo app → **Test Events** or **Overview** tab
4. **Success criteria:**
   - ✅ `Launch App` event appears within 60 seconds
   - ✅ `Install App` event appears (fires once per install)
   - ✅ Dataset status flips from "Not receiving events" → **"Active"** or **"Connected"**
   - ✅ SKAdNetwork postbacks start arriving (24-48h after install)

## Step T6 — Create TikTok Campaign

Only after Step T5 passes. Use TikTok Ads Manager → Create Campaign:
- **Objective:** App Promotion → App Installs
- **Budget:** Same $50-100/day discipline as Meta — below that, TikTok can't exit learning
- **Geo:** Start with same region as your Meta campaign for parallel comparison
- **Audience:** **Broad** — TikTok's algorithm is unusually good at finding lookalikes when you give it broad targeting + good creative
- **Placements:** TikTok feed only (skip Pangle/Audience Network initially — same principle as Meta)
- **Creative:** Use the 9:16 counseling videos from `marketing/remotion/out/tiktok/` (`young-couple.mp4` + `established-couple.mp4`) — they were designed for TikTok format

---

# Part 3: Apple Search Ads Setup

**Status (as of 2026-04-11, build 88+):** `AdServices.framework` weak-linked, `AppleAdsAttribution.captureTokenIfAvailable()` wired to fire on every cold launch. Missing: backend integration + campaign.

## Why Apple Search Ads Is Different

Apple Search Ads doesn't use SKAdNetwork or a third-party SDK. Attribution works through Apple's **AdServices framework** which is built into iOS 14.3+:

1. User taps an Apple Search Ad in the App Store
2. User installs your app
3. On first launch, your app calls `AAAttribution.attributionToken()` and gets an opaque 300-400 char token
4. Your app sends this token to your **backend**
5. Your backend POSTs the token to `https://api-adservices.apple.com/api/v1/` (with an API key)
6. Apple returns JSON: `{campaignId, adGroupId, keywordId, orgId, conversionType, ...}`
7. Your backend stores this attribution data and attributes the install to the campaign

**The critical missing piece for Porizo right now is step 4-7: the backend endpoint.**

## What I Already Did (Code Side)

✅ Linked `AdServices.framework` as weak-linked system framework (works on iOS 14.3+)

✅ Added `AppleAdsAttribution.captureTokenIfAvailable()` helper in `PorizoAppApp.swift`:
- Gated behind `#if canImport(AdServices)` + `#available(iOS 14.3, *)`
- Calls `AAAttribution.attributionToken()` on every app launch
- Posts `Notification.Name.appleAdsAttributionTokenCaptured` with the token in `userInfo["token"]`
- Logs errors quietly (expected to fail on simulator and devices with no ad engagement)

✅ Called from `AppDelegate.didFinishLaunchingWithOptions`.

## Step A1 — Decide Whether You Need Apple Search Ads At All

**Apple Search Ads are paid placements in the iOS App Store search results** — when someone searches "custom song" or "personalized music gift" or "voice clone song", your ad can appear at the top of results.

**You should run Apple Search Ads if:**
- Your app solves a problem users actively search for (✅ Porizo does — "birthday song", "custom song gift" are high-intent queries)
- You want the HIGHEST-intent paid traffic possible (users who type "custom song maker" in the App Store are 5-10x more likely to install + retain than Meta interest-targeted traffic)
- You're willing to spend $100-500/day to get meaningful signal

**You should NOT run Apple Search Ads if:**
- Your product is passive-discovery (Meta/TikTok is better for "I didn't know I wanted this" categories)
- You can't afford $100+/day per market
- You haven't optimized your App Store listing yet (keywords in name/subtitle matter more than the ad itself)

**Recommendation for Porizo:** Start Apple Search Ads AFTER Meta proves out. The 9:16 video creative we built doesn't map to App Search Ads (which uses your App Store screenshots), so you're starting fresh on creative. But when you do: target high-intent queries like "birthday song maker", "custom song", "personalized song".

## Step A2 — Backend Endpoint for Token → Apple API (Deferred)

This is a **backend task** that should be added to Porizo's Node.js Fastify API. Specification:

**New endpoint:** `POST /analytics/apple-ads-attribution`
- **Auth:** user session (same as other endpoints)
- **Body:** `{ "attributionToken": "<300-400 char opaque token>" }`
- **Behavior:**
  1. POST the token to `https://api-adservices.apple.com/api/v1/` with `Content-Type: text/plain` body = the token string
  2. Apple responds with JSON (or 404 if token invalid, 500 if rate-limited)
  3. Store the response in a new table `apple_ads_attribution` keyed by `user_id`
  4. On success, trigger whatever downstream attribution your analytics needs (e.g., set a user property in Amplitude, fire a Firebase event)
- **Error handling:**
  - Apple returns 404 for: expired tokens, tokens from non-ASA installs, organic installs
  - Apple has rate limits — back off on 500s
  - Store 404s too, so you don't re-query the same token

**iOS side (already wired):** Listen for `.appleAdsAttributionTokenCaptured` notification in your app's analytics module, then POST to the new endpoint.

**Priority:** LOW. Only build this when you're actually running Apple Search Ads and want to attribute installs.

## Step A3 — Apple Search Ads Account Setup

Only when you're ready to spend:

1. https://searchads.apple.com → sign in with your Apple Developer account
2. Choose **Apple Search Ads Advanced** (not Basic — Basic has no targeting, worse for attribution)
3. Create campaign:
   - **Type:** Search Results (not Today tab, not Product Pages — Search Results is where intent is highest)
   - **Location:** United States first (largest market, highest CPCs but best signal)
   - **Ad Groups** → **Keywords** → start with exact-match on high-intent terms:
     - `custom song`, `personalized song`, `birthday song`, `song for her`, `song for him`, `love song maker`, `voice clone song`
   - **Budget:** $100-200/day minimum
   - **Max CPT:** Start at $1.50 (adjust after 3 days based on winning/losing auctions)

---

# Part 4: Google Ads (UAC / App Campaigns)

**Status (as of 2026-04-11, build 88+):** Already covered by Firebase Analytics integration + Google's SKAdNetwork IDs now in Info.plist.

## Why No SDK Work Was Needed

Google Ads App Campaigns (formerly UAC — Universal App Campaigns) attribute installs via **Firebase Analytics**, which is already integrated in Porizo. When you link your Firebase project to your Google Ads account, conversions flow automatically:

1. User clicks Google App Campaign ad
2. Installs + opens Porizo
3. Firebase Analytics auto-fires `first_open` event
4. Google Ads picks up the `first_open` via the Firebase↔Google Ads link
5. Conversion attributed, optimization signal sent to the algorithm

**The only thing I had to add was the SKAdNetwork IDs**, which are already done (25 new Google IDs added to `Info.plist`, deduplicated against existing Meta IDs).

## Step G1 — Link Firebase to Google Ads

**Time:** ~5 min

1. https://ads.google.com → sign in
2. Top-right menu → **Tools & Settings** → **Setup** → **Linked accounts**
3. Find **Firebase** → **Details** → **Link**
4. Select the Firebase project that Porizo's iOS app uses (check `PorizoApp/GoogleService-Info.plist` if unsure which project)
5. Select the Porizo iOS app
6. Choose conversion events to import — at minimum: `first_open`, `in_app_purchase` if you track StoreKit purchases

## Step G2 — Create a Google App Campaign

1. Google Ads → Campaigns → **+ New campaign**
2. **Goal:** App promotion
3. **Campaign subtype:** App installs
4. **Platform:** iOS
5. **App:** select Porizo (App Store ID `6758205028`)
6. **Budget:** $50-100/day (same discipline as Meta/TikTok)
7. **Targeting:** Keep it broad — Google's machine learning needs room
8. **Assets:** Upload text variations, images, videos (Google will auto-assemble ad combinations)
9. Launch

## Step G3 — No Physical Verification Needed

Unlike Meta/TikTok where you need to visually confirm "Active" in Events Manager, Google Ads attribution flows through Firebase which is already working. The first conversion will show up in Google Ads within 24-48 hours of your first install-from-ad.

---

# Part 5: Cross-Platform Notes

## When to Upgrade to an MMP (Mobile Measurement Partner)

The current setup (4 direct SDKs: Meta + TikTok + Apple + Google-via-Firebase) is fine for **up to ~$10K/month in paid spend**. Above that threshold, consider migrating to a Mobile Measurement Partner:

- **AppsFlyer** — industry standard, ~$0.10/install fee, dashboards every marketer recognizes
- **Singular** — cheaper for lower volumes, better cost analytics
- **Adjust** — strong in EMEA, good fraud detection

**What MMPs give you:**
1. **One SDK replaces all 4** — cleaner build, fewer crashes, unified events
2. **Deterministic attribution across platforms** — solves "Meta and TikTok both claim this install" double-counting
3. **Cohort + LTV dashboards** — tracks user value over 30/60/90 days per channel
4. **Fraud detection** — catches bot installs Meta/TikTok don't flag
5. **Custom SKAdNetwork conversion schemas** — more granular than the SDK-bundled defaults

**When to migrate:**
- Monthly spend > $10K across all channels
- More than 2-3 concurrent campaigns per platform
- You need LTV-based bidding (the direct SDKs only support install-based optimization)
- You're running 3+ platforms and the attribution debugging is eating engineering time

## The Four Platforms at a Glance

| Platform | SDK | Install | Config | Verification | Status |
|---|---|---|---|---|---|
| **Meta (Facebook + Instagram)** | `FacebookCore` | ✅ Added | ✅ Build settings + plist wired | Events Manager → `fb_mobile_activate_app` | **Launch-ready pending live device verification** |
| **TikTok** | `TikTokBusinessSDK` + TikTok OpenSDK | ✅ Added | ⚠️ Integration complete, but real TikTok client key + business creds still required | TikTok Events Manager → Launch App + Share/OpenSDK callback | **Not launch-ready until real TikTok credentials are configured** |
| **Apple Search Ads** | `AdServices` (built-in) | ✅ Linked | ✅ iOS token capture + backend resolution route | Search Ads dashboard + backend attribution rows | **Launch-ready pending campaign + live attribution test** |
| **Google Ads (UAC)** | Firebase Analytics | ✅ Already wired | N/A — via Firebase link | Google Ads → Conversions | **Needs Step G1 (Firebase↔Google Ads link)** |

## Suggested Rollout Sequence (Revised from Part 1)

| Week | Action |
|---|---|
| **Week 1 (now)** | Ship build 88 → verify Meta Events Manager → rebuild Meta campaign → run 7 days untouched |
| **Week 2** | Measure Meta results. Meanwhile: get TikTok credentials (T1-T3), ship build 89 with real TikTok token |
| **Week 3** | Launch TikTok campaign in parallel with Meta. Keep same creative + budget for A/B comparison. Meanwhile: Link Firebase↔Google Ads (G1), launch Google App Campaign. |
| **Week 4** | Three platforms live. Compare CPI + 7-day retention by channel. Kill the loser. Scale the winner. |
| **Month 2** | Consider adding Apple Search Ads (highest-intent channel, but requires App Store Optimization work on keywords first) |
| **Month 3+ (if spend > $10K/mo)** | Evaluate migration to AppsFlyer or Singular for unified attribution |

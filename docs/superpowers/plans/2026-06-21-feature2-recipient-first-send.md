# Feature 2 — Recipient-First Create Flow + One-Tap Personal Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Backend tasks (B1–B2) are TDD with `node:test`; iOS tasks (I1–I6) verify via `xcodebuild` build success + simulator manual checks, with unit tests for pure logic.

**Goal:** Collect the recipient's phone up front (encouraged, skippable), then on the reveal screen send the generated song with one tap from the sender's own iMessage/WhatsApp — improving device-binding by guaranteeing every song has a real, reachable target.

**Architecture:** Backend gains nullable `recipient_phone`/`recipient_channel` on `tracks` and an opt-in PIN-less share path. iOS adds a Contacts-picker primary CTA to the name step (reusing the Gift flow's `GiftContactPickerSheet`), normalizes to E.164 with PhoneNumberKit, and on reveal opens a prefilled `MFMessageComposeViewController` (iMessage/SMS) or `wa.me` link — falling back to the system share sheet when the number was skipped.

**Tech Stack:** Node.js/Fastify + `node:test` (backend); SwiftUI/UIKit, MessageUI, PhoneNumberKit, `xcodebuild` (iOS).

**Design spec:** `docs/superpowers/specs/2026-06-21-device-binding-app-only-recipient-first-design.md`
**Depends on:** Feature 1 (app-only landing) — independent branches, both on `feat/binding-app-only-recipient-first`.

**iOS build verify command** (adapt scheme/sim to `session_show_defaults`):

```
xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

Expect `** BUILD SUCCEEDED **`.
**Backend test:** `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/<file>.test.js`

---

## File Structure

| File                                                                                       | Responsibility                                                   | Action |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------ |
| `migrations/121_add_recipient_contact.sql` + `migrations/pg/121_add_recipient_contact.sql` | Add `recipient_phone`, `recipient_channel` to `tracks`           | Create |
| `src/routes/tracks.js`, `src/routes/story.js`                                              | Accept + store recipient contact on track creation               | Modify |
| `src/services/share-service.js`                                                            | `requirePin` option → PIN-less shares                            | Modify |
| `src/routes/tracks.js` (share endpoint)                                                    | Pass `require_pin` from request to `createOrGetShareToken`       | Modify |
| `PorizoApp/.../Flows/CreateFlowContracts.swift`                                            | `recipientPhone` + `recipientChannel` on `StorySetup`            | Modify |
| `PorizoApp/.../Flows/InlineNamePromptView.swift`                                           | "Pick from Contacts" CTA + `onContactPicked` callback            | Modify |
| `PorizoApp/.../ContactPickerSheet.swift`                                                   | Extract `ContactDestinationMethod` so it's reusable outside Gift | Modify |
| `PorizoApp/.../Util/PhoneNumberNormalizer.swift`                                           | E.164 normalization via PhoneNumberKit (device region)           | Create |
| `PorizoApp/PorizoAppTests/PhoneNumberNormalizerTests.swift`                                | Unit tests                                                       | Create |
| `PorizoApp/.../Util/RecipientMessage.swift`                                                | Build the prefilled message body + send URLs                     | Create |
| `PorizoApp/PorizoAppTests/RecipientMessageTests.swift`                                     | Unit tests                                                       | Create |
| `PorizoApp/.../Flows/MessageComposeSheet.swift`                                            | `MFMessageComposeViewController` wrapper                         | Create |
| `PorizoApp/.../Flows/RevealBloomView.swift`                                                | `onDirectSend` path                                              | Modify |
| `PorizoApp/.../Flows/WarmCanvasFlowView.swift`                                             | Wire contact capture + direct send                               | Modify |
| `PorizoApp/.../Controllers/TrackCreationController.swift`                                  | Pass recipient phone/channel to backend                          | Modify |

---

## Backend (ships independently — additive, inert until the app uses it)

### Task B1: `recipient_phone` / `recipient_channel` columns on `tracks`

**Files:** Create `migrations/121_add_recipient_contact.sql`, `migrations/pg/121_add_recipient_contact.sql`; Modify `src/routes/tracks.js` (~466), `src/routes/story.js` (~4131); Test `test/recipient-contact.test.js`

- [ ] **Step 1: Write the migrations**

`migrations/pg/121_add_recipient_contact.sql`:

```sql
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS recipient_channel TEXT;
```

`migrations/121_add_recipient_contact.sql` (SQLite — no `IF NOT EXISTS` on ADD COLUMN):

```sql
ALTER TABLE tracks ADD COLUMN recipient_phone TEXT;
ALTER TABLE tracks ADD COLUMN recipient_channel TEXT;
```

> Both runners split on `;` (`src/database/postgres.js:299`), so every real statement MUST end with a semicolon. The `tasks/lessons.md` warning is about semicolons _inside comments_, NOT the absence of statement terminators — sibling `migrations/pg/120_*.sql` terminates each statement with `;`.

- [ ] **Step 2: Failing test**

```js
// test/recipient-contact.test.js — TDD: assert POST /tracks stores recipient contact
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const config = require("../src/config");

let app, db;
const USER = "rc-user";
before(async () => {
  db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?,?,?)",
  ).run(USER, new Date().toISOString(), "low");
  app = buildServer({
    db,
    config: { ...config, STORAGE_PROVIDER: "local" },
    storage: createStorageProvider({ ...config, STORAGE_PROVIDER: "local" }),
  });
});
after(async () => {
  if (app) await app.close();
});

describe("recipient contact on tracks", () => {
  it("POST /tracks stores recipient_phone + recipient_channel", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": USER },
      payload: {
        title: "T",
        recipient_name: "R",
        message: "m",
        style: "pop",
        occasion: "birthday",
        recipient_phone: "+61412345678",
        recipient_channel: "imessage",
      },
    });
    const { track_id } = JSON.parse(res.body);
    const row = db
      .prepare(
        "SELECT recipient_phone, recipient_channel FROM tracks WHERE id = ?",
      )
      .get(track_id);
    assert.equal(row.recipient_phone, "+61412345678");
    assert.equal(row.recipient_channel, "imessage");
  });
  it("POST /tracks works with no recipient contact (nullable)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": USER },
      payload: {
        title: "T",
        recipient_name: "R",
        message: "m",
        style: "pop",
        occasion: "birthday",
      },
    });
    assert.equal(res.statusCode, 201);
  });
});
```

Run it → fails (columns/handling absent).

- [ ] **Step 3: Wire the columns into `POST /tracks`**

In `src/routes/tracks.js` (~466), read `recipient_phone`/`recipient_channel` from the body (default `null`), add them to the INSERT column list + values. Mirror exactly how `recipient_name` is read + bound. Add the two fields to the route's request body JSON schema as optional `string` (nullable) so validation doesn't reject them.

- [ ] **Step 4: Wire into `POST /story/:story_id/to-track`**

In `src/routes/story.js` (~4131), add `recipient_phone`/`recipient_channel` to the INSERT (defaulting to `null` — the story flow may not carry them; the iOS create flow passes them via `POST /tracks` OR a subsequent update; see I4). If the story-to-track path is the one the app uses, accept them from the request body too.

- [ ] **Step 5: Run tests + commit**

```bash
NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/recipient-contact.test.js
git commit -m "feat(tracks): nullable recipient_phone/recipient_channel columns

Co-authored by Ambrose Obimma" -- migrations/121_add_recipient_contact.sql migrations/pg/121_add_recipient_contact.sql src/routes/tracks.js src/routes/story.js test/recipient-contact.test.js
```

### Task B2: Opt-in PIN-less shares

**Files:** Modify `src/services/share-service.js` (`createOrGetShareToken` ~91–210), `src/routes/tracks.js` (share endpoint ~1862); Test `test/recipient-contact.test.js` (extend)

- [ ] **Step 1: Failing test** — assert a share created with `require_pin: false` has `claim_pin` NULL:

```js
describe("PIN-less shares", () => {
  it("POST /tracks/:id/share with require_pin:false sets no claim_pin", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": USER },
      payload: {
        title: "T",
        recipient_name: "R",
        message: "m",
        style: "pop",
        occasion: "birthday",
      },
    });
    const { track_id } = JSON.parse(t.body);
    await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/versions`,
      headers: { "x-user-id": USER },
      payload: { style: "pop" },
    });
    db.prepare(
      "UPDATE track_versions SET preview_url='x', status='preview_ready' WHERE track_id=?",
    ).run(track_id);
    const s = await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/share`,
      headers: { "x-user-id": USER },
      payload: { version_num: 1, require_pin: false },
    });
    const { share_id } = JSON.parse(s.body);
    const row = db
      .prepare("SELECT claim_pin FROM share_tokens WHERE id = ?")
      .get(share_id);
    assert.equal(row.claim_pin, null);
  });
  it("re-sharing an existing PINned share with require_pin:false strips the PIN", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": USER },
      payload: {
        title: "T",
        recipient_name: "R",
        message: "m",
        style: "pop",
        occasion: "birthday",
      },
    });
    const { track_id } = JSON.parse(t.body);
    await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/versions`,
      headers: { "x-user-id": USER },
      payload: { style: "pop" },
    });
    db.prepare(
      "UPDATE track_versions SET preview_url='x', status='preview_ready' WHERE track_id=?",
    ).run(track_id);
    // First share WITH a PIN (default), then re-share PIN-less. The idempotent
    // route path must NOT hand back the stale PINned token.
    await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/share`,
      headers: { "x-user-id": USER },
      payload: { version_num: 1 },
    });
    const s2 = await app.inject({
      method: "POST",
      url: `/tracks/${track_id}/share`,
      headers: { "x-user-id": USER },
      payload: { version_num: 1, require_pin: false },
    });
    const { share_id } = JSON.parse(s2.body);
    const row = db
      .prepare("SELECT claim_pin FROM share_tokens WHERE id = ?")
      .get(share_id);
    assert.equal(row.claim_pin, null);
  });
});
```

Run → fails (PIN always set; idempotent path returns the stale PINned token).

- [ ] **Step 2: Add `requirePin` option to `createOrGetShareToken`**

In `src/services/share-service.js`, add an options field `requirePin = true`. Where it does `const claimPin = String(crypto.randomInt(100000, 1000000));` (~132), gate it: `const claimPin = requirePin ? String(crypto.randomInt(100000, 1000000)) : null;`. Ensure the INSERT binds `null` cleanly (the column is nullable — confirm). **Idempotent path:** when an existing non-revoked token is reused AND `requirePin === false` AND that token still has a `claim_pin`, NULL it out (`UPDATE share_tokens SET claim_pin = NULL, claim_attempts = 0 WHERE id = ?`) before returning it — otherwise a returning user's old PINned token leaks a PIN into the one-tap message. Do not otherwise mutate existing tokens.

- [ ] **Step 3: Pass `require_pin` from the share route**

In `src/routes/tracks.js` share endpoint (~1862), read `require_pin` from the body (default `true` for backward-compat) and pass `requirePin` into `createOrGetShareToken`. Add `require_pin` to the endpoint's body schema as optional boolean. **Critical:** this endpoint early-returns an existing share via `findActiveTrackShare` at ~1900–1913 BEFORE `createOrGetShareToken` runs. When `require_pin === false`, do NOT take that bare early return — route through `createOrGetShareToken({ requirePin: false })` so the strip-PIN-on-reuse logic from Step 2 applies; otherwise a returning user gets the stale PINned token back.

- [ ] **Step 4: Run tests + commit**

```bash
NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/recipient-contact.test.js
git commit -m "feat(share): opt-in PIN-less shares via require_pin flag

Co-authored by Ambrose Obimma" -- src/services/share-service.js src/routes/tracks.js test/recipient-contact.test.js
```

---

## iOS

### Task I1: `recipientPhone` + `recipientChannel` on `StorySetup`

**File:** `PorizoApp/PorizoApp/Flows/CreateFlowContracts.swift` (~46)

- [ ] Add to `StorySetup`:

```swift
var recipientPhone: String? = nil
var recipientChannel: String? = nil   // "imessage" | "whatsapp" | nil
```

- [ ] Build (`xcodebuild ... build` → BUILD SUCCEEDED). Commit:

```bash
git commit -m "feat(ios): recipientPhone/recipientChannel on StorySetup" -- PorizoApp/PorizoApp/Flows/CreateFlowContracts.swift
```

### Task I2: Reusable Contacts picker + "Pick from Contacts" CTA

**Files:** `PorizoApp/PorizoApp/ContactPickerSheet.swift`, `PorizoApp/PorizoApp/Flows/InlineNamePromptView.swift`, `WarmCanvasFlowView.swift`

- [ ] **Step 1: Make the destination enum reachable from the create flow.** `GiftContactPickerSheet` references the nested `GiftSendFlowView.GiftDestinationMethod`. Add a file-scope `typealias ContactDestinationMethod = GiftSendFlowView.GiftDestinationMethod` in `ContactPickerSheet.swift` — exposes the type to the create flow with ZERO rename churn. Do NOT create a parallel enum (that would force edits to the picker's `Coordinator`/predicate/`onSelect` signatures). Build.
- [ ] **Step 2: Add an `onContactPicked` callback to `InlineNamePromptView`:** `var onContactPicked: ((_ name: String, _ phone: String?) -> Void)? = nil`, and a primary "Pick from Contacts" button above the name `TextField` that presents `GiftContactPickerSheet(method: .text)` via `.sheet(item:)`. On selection, call `onContactPicked(selection.fullName, selection.phoneNumber)`. Keep the existing typed-name `TextField` as the fallback ("or type a name"). The Contacts system picker needs no permission (`CNContactPickerViewController`).
- [ ] **Step 3: Wire in `WarmCanvasFlowView`** (the `InlineNamePromptView(...)` at ~432): pass `onContactPicked: { name, phone in setup.recipientName = name; setup.recipientPhone = phone }`. Picked contact wins on name conflict (it overwrites). Then the existing `onStart` proceeds.
- [ ] **Step 4:** Build → BUILD SUCCEEDED. Simulator check (`--bypass-auth`): start a song, tap "Pick from Contacts", choose a contact+number, confirm the name pre-fills and the flow proceeds. Commit (scoped to the three files).

### Task I3: PhoneNumberKit E.164 normalizer

**Files:** add `PhoneNumberKit` SPM dep; Create `PorizoApp/PorizoApp/Util/PhoneNumberNormalizer.swift` + `PorizoApp/PorizoAppTests/PhoneNumberNormalizerTests.swift`

- [ ] **Step 1: Add the package** in Xcode: File → Add Package Dependencies → `https://github.com/marmelroy/PhoneNumberKit` (upToNextMajor). This writes an `XCRemoteSwiftPackageReference` to `project.pbxproj` matching the existing template (e.g. the `firebase-ios-sdk` entry). Build to fetch.
- [ ] **Step 2: Failing unit tests:**

```swift
import XCTest
@testable import PorizoApp
final class PhoneNumberNormalizerTests: XCTestCase {
  func testAlreadyE164PassesThrough() {
    XCTAssertEqual(PhoneNumberNormalizer.e164("+61412345678", defaultRegion: "AU"), "+61412345678")
  }
  func testLocalNumberUsesDefaultRegion() {
    XCTAssertEqual(PhoneNumberNormalizer.e164("0412 345 678", defaultRegion: "AU"), "+61412345678")
  }
  func testUnparseableReturnsNil() {
    XCTAssertNil(PhoneNumberNormalizer.e164("not a number", defaultRegion: "US"))
  }
}
```

- [ ] **Step 3: Implement:**

```swift
import PhoneNumberKit
enum PhoneNumberNormalizer {
  private static let kit = PhoneNumberKit()
  /// E.164 (e.g. "+61412345678"), defaulting a missing country code to the
  /// sender's region. Returns nil when the input can't be parsed.
  static func e164(_ raw: String, defaultRegion: String = Locale.current.region?.identifier ?? "US") -> String? {
    guard let parsed = try? kit.parse(raw, withRegion: defaultRegion) else { return nil }
    return kit.format(parsed, toType: .e164)
  }
}
```

> Confirm the current PhoneNumberKit API names (`PhoneNumberKit()` vs `PhoneNumberUtility()`, `.region` accessor) against the fetched version; adjust if the major version differs.

- [ ] **Step 4:** Run tests (`xcodebuild test ...` or the test scheme). Build. Commit.

### Task I4: Persist recipient contact to the backend

**File:** `PorizoApp/PorizoApp/Controllers/TrackCreationController.swift` (+ the API model for the to-track / create request)

- [ ] When creating the track (the `storyToTrack` / `POST /story/:id/to-track` or `POST /tracks` call), include `recipient_phone` (normalized via `PhoneNumberNormalizer.e164(setup.recipientPhone)`) and `recipient_channel` when present. Add the fields to the request model. Skipped number → omit (nil). Build. Commit.

### Task I5: One-tap "Send to [recipient]" on reveal

**Files:** Create `PorizoApp/PorizoApp/Util/RecipientMessage.swift` (+ tests), `PorizoApp/PorizoApp/Flows/MessageComposeSheet.swift`; Modify `RevealBloomView.swift`, `WarmCanvasFlowView.swift`

- [ ] **Step 1: `RecipientMessage` (pure, unit-tested):**

```swift
enum RecipientMessage {
  static func body(recipientName: String, link: String) -> String {
    "I made you a song 🎵 \(recipientName) — open it here: \(link)"
  }
  /// wa.me needs E.164 digits, no "+". Returns nil if phone isn't E.164.
  static func whatsAppURL(phoneE164: String, body: String) -> URL? {
    guard phoneE164.hasPrefix("+") else { return nil }
    let digits = String(phoneE164.dropFirst())
    var c = URLComponents(string: "https://wa.me/\(digits)")
    c?.queryItems = [URLQueryItem(name: "text", value: body)]
    return c?.url
  }
}
```

Tests: body format exact; whatsAppURL strips `+` and encodes text; nil for non-E.164.

- [ ] **Step 2: `MessageComposeSheet`** — a `UIViewControllerRepresentable` around `MFMessageComposeViewController` (`import MessageUI`), setting `recipients = [phone]` and `body`, with a completion callback (`.sent` / `.cancelled` / `.failed`). Guard with `MFMessageComposeViewController.canSendText()`.
- [ ] **Step 3: `RevealBloomView`** — add `var onDirectSend: (() -> Void)? = nil`. When the caller provides it (a recipient phone is known), the primary "Send to [recipientName]" button calls `onDirectSend` instead of `onShare`; otherwise it keeps calling `onShare` (today's system-share path). Do NOT restyle the screen.
- [ ] **Step 4: `WarmCanvasFlowView`** — implement `onDirectSend` (awaitable share path):
  1. **Add an awaitable PIN-less share method.** `ShareController.generateShareLink` returns `void` and fires an internal `Task`, so `shareURLString` is NOT awaitable — do not use it here. Add:
     ```swift
     func makePinlessShareLink(trackId: String, versionNum: Int) async throws -> String {
         let resp = try await apiClient.createShare(trackId: trackId, versionNum: versionNum, requirePin: false)
         return resp.shareUrl
     }
     ```
     Extend `apiClient.createShare(...)` with `requirePin: Bool = true` and include `"require_pin": requirePin` in the `POST /tracks/:id/share` body. (`CreateShareResponse.shareUrl` already exists.)
  2. `let link = try await shareController.makePinlessShareLink(trackId:versionNum:)`.
  3. `let body = RecipientMessage.body(recipientName: setup.recipientName, link: link)`. **MUST use `RecipientMessage.body` — do NOT call `shareController.prepareShareData(...)`/`defaultMessage`, which appends `"\n\nPIN: …"` (`ShareController.swift:410`) and would leak a PIN into a PIN-less share.**
  4. If `setup.recipientChannel == "whatsapp"`, `UIApplication.shared.canOpenURL(URL(string: "whatsapp://")!)`, and `RecipientMessage.whatsAppURL(phoneE164: phone, body: body)` non-nil → `UIApplication.shared.open(url)`.
  5. Else present `MessageComposeSheet(recipients: [phone], body: body)` (iMessage/SMS — Apple auto-routes).
  6. If `setup.recipientPhone == nil` (skipped) → keep today's system share sheet path (`onShare`).
- [ ] **Step 5:** Build → BUILD SUCCEEDED. Run unit tests. Simulator check (`--bypass-auth`, `--fixture-paywall` as needed): complete a song with a contact number → reveal shows "Send to [name]" → tap → Messages composer opens prefilled with the body + recipient (iMessage). Skipped-number path → system share sheet. Commit (scoped).

### Task I6 (optional): "Song ready" push deep-links to reveal/send

**Files:** `src/services/push-notification.js` (payload), iOS push handler

- [ ] Reuse the existing `sendRenderComplete()` (already fired by the workflow runner). Ensure its payload carries `trackId`, and the iOS notification handler routes a tap to the reveal/send screen for that track. **Verify prod APNs env** (`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_PRIVATE_KEY` in Railway) before relying on it; if unset, skip this task for v1 (the sender is usually already on the wait screen). Build. Commit.

---

## Verification

- [ ] Backend: `npm test` green; new `test/recipient-contact.test.js` passes.
- [ ] iOS: `xcodebuild ... build` → `** BUILD SUCCEEDED **`; `xcodebuild test` (PhoneNumberNormalizer + RecipientMessage unit tests) pass.
- [ ] Simulator E2E (`--bypass-auth`): pick contact → create → reveal → "Send to [name]" → prefilled iMessage composer with the exact body and the share link; skipped path → system share sheet.
- [ ] Confirm the minted share is PIN-less (`require_pin:false`) and the recipient flow (open link → app-wall → install → claim) binds without a PIN.

## Open items / dependencies

1. **Info.plist needs NO change** — `whatsapp` is already in `LSApplicationQueriesSchemes`; `sms:` needs no scheme; `NSContactsUsageDescription` is already set via `INFOPLIST_KEY_NSContactsUsageDescription`. (The picker uses `CNContactPickerViewController`, which needs no permission anyway.)
2. **PhoneNumberKit API drift** — confirm class/method names against the fetched major version (Task I3 Step 3).
3. **Ships behind an App Store cycle** — bump `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION` and submit via `asc` when ready (backend B1/B2 can deploy ahead, inert until the app uses them).
4. **APNs prod env** gates Task I6.
5. **Test fixture** — before relying on the B2 test, confirm `POST /tracks/:id/versions` with `{ style: "pop" }` succeeds for the minimal `rc-user` fixture (no entitlement row). If it 402/403s on an entitlement check, seed an `entitlements` row in `before()` the way `test/share-flow.test.js` does.

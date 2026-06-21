# Device Binding: App-Only Playback + Recipient-First Send — Design

**Date:** 2026-06-21
**Branch:** `feat/binding-app-only-recipient-first`
**Author:** Ambrose Obimma (with Claude)
**Status:** Approved design — ready for implementation planning

---

## Problem

The admin dashboard shows the funnel leak directly: hundreds of shares, only **10 device-bound**, most rows `unbound` / "Not bound" with 0 views. Two root causes:

1. **Web playback is a dead-end escape hatch.** A share link (`/play/<id>`) opens a web player that streams the preview freely (`web_stream_allowed=1`). Recipients listen in the browser and have **zero reason to install** → never claim → never bind. Claiming is already app-only and account-gated (web claims return `WEB_CLAIM_NOT_ALLOWED`); recipients simply never get pushed into the app.
2. **No real delivery target.** Sharing is fully manual (generate song → tap Share → system sheet). Many songs are created and barely sent, producing the "0 views, unbound" orphan rows.

**Goal:** Maximize the rate at which a generated song reaches its intended recipient _inside the Porizo app on their device_ (device binding). Binding is the north-star metric for this work.

## Non-Goals (v1)

- No server-side auto-send (no Twilio/WhatsApp Business API sending from the backend).
- No phone-anchored auto-claim. Binding stays the current "first signed-in device to open the link claims it" model. The collected number is for **delivery**, not claim-matching.
- No multi-recipient per song.
- No redesign of `RevealBloomView` or other create-flow screens beyond wiring the send CTA.
- No reminder/resend loop built now (storage is added so it's possible later).

## Sequencing

Two independently-shippable, independently-measurable features:

1. **Feature 1 — App-only share landing.** Server-only. Ships first (hours, not an App Store cycle). Gives a clean read on how much the web-play leak cost.
2. **Feature 2 — Recipient-first create flow + one-tap personal send.** iOS-heavy. Ships second on top of Feature 1.

---

## Feature 1 — App-only share landing (server)

Remove browser **playback** while preserving rich social unfurls and all in-app streaming. Makes the recipient journey "install → claim" the only path.

### Changes

1. **`GET /play/:shareId`** (`src/routes/sharing.js`)
   - Keep **all OG / crawler metadata** (title, cover, `share.mp4`, WhatsApp square variant) so iMessage/WhatsApp link previews stay rich.
   - Replace the player body with an **app-wall**: cover art + "[Sender] made [Recipient] a song for [occasion]" + a single **Open in Porizo** button → existing receiver-save / AppsFlyer OneLink (`src/services/app-link-service.js`).

2. **`GET /share/:shareId/audio`** (`src/routes/sharing.js` ~2451)
   - Serve playable audio **only** when:
     - `share.share_type === 'demo'` (web playback is intentional for demo/marketing embeds), **or**
     - the request carries app context (`x-device-token` header, or `PorizoApp/...` User-Agent).
   - Otherwise return the app-wall / `403`.
   - Safe because the in-app recipient path **claims first, then streams via `/share/:shareId/stream`** (device-gated HLS), and the sender previews their _own_ track (not the share route). Verify the claim-before-play assumption during implementation.

3. **`share.mp4`** (`src/server.js` `ensureShareMp4`, ~1546)
   - Generate the unfurl video from a **teaser only: ≤15s sourced from `preview.m4a`, never `full.m4a`.** Today it embeds the full 45–90s song unauthenticated — a full-song leak that must be closed for "web play disabled" to be real.
   - **Bump the `share.mp4` cache key** so the ~600 existing cached videos regenerate as teasers.
   - A short audio teaser is intentionally kept (not muted): the curiosity it creates drives the tap → install → claim that we want.

4. **Web `/stream` for `platform=web`**: returns the app-wall CTA (already preview-only).

### Scope

- Applies to **all existing + new** shares at the route level.
- **Exemption:** `share_type='demo'` shares keep full web playback (their entire purpose).

### Recipient journey (mostly existing infra; Feature 1 makes it the _only_ path)

```
Recipient taps link
  → app installed?
      yes → Universal Link opens app → app calls /receiver-handoff → claim → bound
      no  → app-wall "Open in Porizo" → App Store → install
            → AppsFlyer OneLink deferred deep link fires handoff
            → register / login (claim requires sign-in)
            → claim → bound
```

### Risk

A recipient who would have listened on web must now install. This is the deliberate binding bet. Fully reversible by reverting the route changes.

---

## Feature 2 — Recipient-first create flow + one-tap personal send (iOS)

Collect the recipient's number up front (encouraged, skippable), then on reveal deliver the song with one tap from the sender's own iMessage/WhatsApp.

### 2a. Capture recipient up front

- At the existing `.nameEntry` sub-phase (`WarmCanvasFlowView.swift` / `CreateFlowTypes.swift`), make **"Pick from Contacts"** the primary CTA.
  - Reuse `CNContactPickerViewController` (`ContactPickerSheet.swift`): **no contacts permission required** (out-of-process picker), forces the user to **tap a specific number**, and returns the contact's **display name**.
  - Selecting a contact fills both `recipientName` and `recipientPhone`.
- **Fallback: "type a name instead"** — name only, number skipped (the encouraged-but-skippable path).
- On conflict (typed name vs picked contact), **the picked contact wins**.
- Constrain picker property selection to **phone numbers** (ignore email properties for this flow).

### 2b. Phone normalization

- Normalize to **E.164** using **PhoneNumberKit**, defaulting a missing country code to the **sender's device region** (`Locale`/region). The existing backend `normalizePhoneNumber` is too naive (turns local `0412…` into invalid `+0412…`) and is not reused here.
- Add `recipientPhone` (E.164) + `recipientChannel` to `StorySetup` (`CreateFlowContracts.swift`).

### 2c. Generate (unchanged) → reveal → one-tap send

- Story → lyrics → render pipeline unchanged.
- **Reuse `RevealBloomView` as-is** — no redesign. Sender hears the short (~15–25s) preview first; **"Send to [recipient]"** is the dominant CTA on the same screen.
- Send expands to:
  - **iMessage** (always shown) → `MFMessageComposeViewController`, `recipients=[number]`, body:

    > `I made you a song 🎵 [recipientName] — open it here: [link]`

    Apple's Messages app auto-routes iMessage (blue) vs SMS (green) — no app-detection needed.

  - **WhatsApp** (shown only if `canOpenURL("whatsapp://")` — WhatsApp installed on the **sender's** device) → `wa.me/<E164>?text=<url-encoded body>`.
  - **If the number was skipped** → system share sheet (`UIActivityViewController`) with the same body.

- The minted share link is the universal artifact; the recipient journey from Feature 1 is identical regardless of channel.

### 2d. PIN handling

- One-tap delivery and a separate-PIN second factor are **mutually exclusive** (the recipient receives only the link). Therefore **shares minted from the create-flow send are PIN-less.**
- Add a `requirePin: false` path to `createOrGetShareToken` (`src/services/share-service.js`) so these shares set `claim_pin = NULL`.
- Residual risk: a link forwarded to a third party before the real recipient claims could be bound by the third party (claim is one-way). Mitigations: private delivery to a specific number, fast real-recipient claim, and **full recovery via the existing admin song-transfer flow**.

### 2e. "Song ready" push (best-effort)

- Reuse the existing `sendRenderComplete()` (`src/services/push-notification.js`, already fired by the workflow runner). Make its tap **deep-link to the reveal/send screen** for that track so the sender can one-tap send if they left during the ~90s render.
- **Dependency:** confirm prod APNs env (`APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_PRIVATE_KEY`) is set in Railway. If not, ship Feature 2 without push — the sender is almost always already watching the render.

### 2f. Backend persistence

- Add nullable `recipient_phone` (E.164) + `recipient_channel` columns to `tracks`, mirroring the gift-order pattern; dropped on track deletion. Enables future resend-nudge ("[recipient] hasn't opened their song — resend?") and "songs with a real target" analytics. The nudge loop itself is **not** built in v1.

### 2g. iOS config

- Add `whatsapp` to `LSApplicationQueriesSchemes` in `Info.plist` (required for `canOpenURL`).

---

## Smaller decisions (locked)

- **`SharePostcardView`** is bypassed in the create flow (the reveal "Send to [recipient]" CTA replaces it). It is **kept** for library re-share paths and **not deleted** — revisit later.
- **"Total Views"** web metric will plateau as web playback dies; the real KPI shifts to **claim / bound rate** (admin already computes `claim_rate` in `admin-service.js getShareMetrics()`).
- **Reroll**: rely on the existing "pre-generate share token at render completion" logic to keep the sent link pointing at the latest confirmed version.

---

## Affected code (reference)

| Concern                                            | File                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Share routes (play, audio, stream, claim, handoff) | `src/routes/sharing.js`                                                 |
| `share.mp4` generation                             | `src/server.js` (`ensureShareMp4`)                                      |
| Share token creation / PIN                         | `src/services/share-service.js`                                         |
| Receiver save / OneLink                            | `src/services/app-link-service.js`                                      |
| AASA universal links                               | `src/server.js` (`/.well-known/apple-app-site-association`)             |
| Push notifications                                 | `src/services/push-notification.js`, `src/workflows/runner.js`          |
| Track persistence                                  | `src/routes/story.js` (`/story/:id/to-track`), `src/routes/tracks.js`   |
| Demo shares                                        | `migrations/068_demo_shares.sql`                                        |
| Create flow shell                                  | `PorizoApp/.../Flows/WarmCanvasFlowView.swift`, `CreateFlowTypes.swift` |
| Shared create state                                | `PorizoApp/.../Flows/CreateFlowContracts.swift` (`StorySetup`)          |
| Contacts picker                                    | `PorizoApp/.../ContactPickerSheet.swift`                                |
| Reveal screen                                      | `RevealBloomView` (reused as-is)                                        |
| Share controller                                   | `PorizoApp/.../Controllers/ShareController.swift`                       |

## Open verification items (resolve during planning)

1. Prod APNs env vars set in Railway? (gates push deep-link in 2e)
2. Confirm the in-app recipient path claims **before** playing (no dependency on public `/audio`) — gates the `/audio` gating in Feature 1 step 2.
3. Confirm `share.mp4` cache-key bump regenerates correctly for already-cached full-audio videos.

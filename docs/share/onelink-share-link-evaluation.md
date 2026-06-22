# Future evaluation: make the share link a OneLink (instead of `porizo.co/play/…`)

**Status:** Parked 2026-06-22. Revisit if the WhatsApp→web-wall hop proves to hurt
recipient conversion. Current shipped flow is the deterministic two-action app-wall
(commit `457da8f`). See [[project_recipient_deeplink_architecture]] in agent memory.

## Where things stand today (verified)

- The link the sender sends = `porizo.co/play/<shareId>` — a **Universal Link**
  (`buildPlayShareUrl`, `src/server.js:1047`; AASA paths `/play/*`,`/s/*`,`/poem/*`,
  `src/server.js:513`). It is **not** a OneLink.
- The **OneLink** (`porizo.onelink.me/hPJL`, `APPSFLYER_ONELINK_BASE_URL`) is built by
  `app-link-service.buildReceiverSaveUrl` and used **only** as `receiver_save_url` — the
  "Get the app" fallback CTA on the web-wall and the player/teaser save buttons. It carries
  `deep_link_value=<receiverHandoffId>` for AppsFlyer deferred deep linking.
- **iMessage/SMS/Safari already open the app directly** from `porizo.co/play/…` (no wall).
  The web-wall only appears where Universal Links don't fire — chiefly **WhatsApp's in-app
  browser (WKWebView)**, which iOS does not let trigger Universal Links.

## The idea

Make the **shared link itself** a OneLink (e.g. `porizo.onelink.me/…?deep_link_value=<shareId-or-handoff>`)
so AppsFlyer's hosted page does the install-detect + route (app-or-store) + deferred deep link,
removing our branded web-wall hop in the WhatsApp case.

## What to TEST before committing to it (the open questions)

1. **Does the OneLink actually open the INSTALLED app?** The original symptom was the OneLink
   resolving to the App Store even when installed. Test `porizo.onelink.me/hPJL?deep_link_value=<rh>`
   on a device WITH the app: does it open the app (via `applinks:porizo.onelink.me` UL or the
   AppsFlyer page's scheme attempt), or bounce to the store? If it bounces, it's an AppsFlyer
   OneLink **template config** issue (deep-link behavior / iOS UL setup), not code.
2. **Rich chat preview.** `porizo.co/play/…` renders the rose artwork + "X made Y a song" via OG
   tags (`web-player/index.html`). Does the OneLink render an equivalent preview in WhatsApp /
   iMessage, or a generic AppsFlyer card? If generic, configure OneLink OG, or accept the loss.
   This is a real conversion lever — the preview is the first thing the recipient sees.
3. **Does it still hit the scheme dialogs?** In WhatsApp's in-app browser the OneLink page will
   still attempt the custom scheme → likely the same "Open in Porizo?" confirm / "address invalid"
   error. Verify whether AppsFlyer's page handles these more gracefully than our wall, or not.
4. **Carry the right deep link.** A share OneLink must encode enough to open the specific song's
   claim (the `receiverHandoffId` is per-receiver-session, minted on web-wall load — a pre-web
   OneLink would need the share/handoff baked in at send time, or resolve shareId→handoff in-app).
   Confirm `parseReceiverHandoffPayload` / `parseShareUrl` can resolve whatever the OneLink carries.
5. **Deferred-install claim end-to-end.** Delete app → tap OneLink → App Store → install → first
   launch → AppsFlyer `didResolveDeepLink` → claim auto-presents. Confirm the song is correct.

## Decision rule

Switch only if (1) the OneLink reliably opens the installed app AND (2) the chat preview is
preserved (or the preview loss is acceptable). Otherwise the branded `porizo.co` wall is the
better default — it keeps the rich preview, direct UL in iMessage, and full control of the copy.

---
date: 2026-04-07
topic: social-sharing-viral-loop
---

# Social Sharing Viral Loop

## Problem Frame

When a Porizo user shares a song on Facebook, Instagram, or X, the recipient taps the link and lands on a PIN entry page. This kills the moment. The recipient doesn't have the PIN (it was DM'd separately), gets confused, and leaves. The share becomes a dead end instead of a viral loop.

With 44 downloads and 0.6% conversion, organic sharing is the most important growth channel. Every shared song should convert listeners into creators. Right now it converts zero.

```
Current flow (broken):
Facebook card → tap → in-app browser → PIN page → confusion → bounce

Target flow:
Facebook card → tap → in-app browser → song auto-plays → emotional peak →
"Create your own" CTA → App Store → download → create → share → loop
```

## Requirements

**Pinless Web Playback**

- R1. The web player (`/play/:shareId`) must auto-play the full song immediately without requiring a PIN. The `GET /share/:shareId` endpoint must always return `web_stream_url` and never return `requires_pin: true` for web requests.
- R2. PIN protection is preserved for in-app claiming only. `POST /share/:shareId/claim` continues to validate the PIN before binding the song to a user's library. The gift unwrapping experience in the Porizo app is unchanged.
- R3. One share link works everywhere: web browsers auto-play, the iOS app (via universal link) shows PIN entry for claiming. No separate link types needed.

**Viral CTA**

- R4. After the song finishes playing, show a prominent "Create a song for someone you love" CTA with an App Store download link. This CTA should appear at the emotional peak — when playback ends — not before.
- R5. The post-play CTA must work in Facebook/Instagram/X in-app browsers (no `window.open` popups, use `<a>` tags with the App Store URL).

**Web Player Quality**

- R6. The web player must load and begin audio playback within 3 seconds on a 4G connection in Facebook's in-app browser.
- R7. The player must show: song title, recipient name, artwork, playback controls, progress bar, and share buttons (Copy Link, WhatsApp, X).

## Success Criteria

- A Facebook share link opens directly to a playing song (no PIN, no intermediate screen)
- The post-play CTA is visible and tappable in Facebook's in-app browser
- Share-to-download funnel is measurable (UTM params on App Store link)

## Scope Boundaries

- No inline feed playback (Facebook/Instagram don't support it for non-whitelisted domains)
- No changes to the iOS in-app share claiming flow (PIN stays for app users)
- No changes to share.mp4 generation or OG metadata (already working well)
- No new share link types — single link, behavior varies by context

## Key Decisions

- **Full song on web, not teaser**: Maximum emotional impact drives the viral loop. A 30s teaser that cuts off feels like a paywall on a gift.
- **One link, two behaviors**: Web always auto-plays; app always requires PIN. Determined by context, not link type. The `claim_pin` stays in the database for app claiming but is ignored by the web player.
- **Web player focus over inline feed playback**: Inline feed audio is gated behind Facebook's whitelist (only Spotify, Apple Music). The in-app browser experience is 100% in our control and works across all platforms.

## Dependencies / Assumptions

- The web player (`web-player/index.html`, `web-player/player.js`) and share API (`src/routes/sharing.js`) are the only files that need changes
- `src/services/share-service.js` does NOT need changes — PINs continue to be generated for app claiming
- The teaser audio endpoint (`/share/:shareId/teaser`) can serve the full song for web playback (or we use the existing `web_stream_url` pattern)

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Should the web player use the `/share/:shareId/teaser` endpoint (rate-limited, no auth) or the full `/share/:shareId/audio` endpoint with a web stream token? The teaser endpoint currently serves `preview.m4a` — it may need to serve `full.m4a` instead.
- [Affects R6][Technical] Facebook's in-app browser may block autoplay. Verify the player handles tap-to-play gracefully as a fallback.
- [Affects R4][Needs research] The web player already has a `post-play-cta` overlay (lines 253-262 of `web-player/index.html`). Verify it's wired up and working — it may already satisfy R4.

## Next Steps

→ `/ce:plan` for structured implementation planning

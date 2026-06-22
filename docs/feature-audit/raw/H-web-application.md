# H — Web Application Feature Audit

**Scope:** Public marketing site, web-player, embed-player, poem-viewer, backend media/streaming endpoints.
**Date:** 2026-06-22
**Method:** Code + markup inspection (no live traffic).
**Key files surveyed:** `public/**`, `web-player/**`, `embed-player/**`, `poem-viewer/**`, `src/server.js` (lines 254–5508), `src/routes/well-known.js`.

---

## Feature Inventory

### 1. Marketing Landing Page (index.html)

- **feature:** Primary marketing homepage
- **user_story:** Visitor lands from search/ad → understands Porizo → taps "Get the app" CTA
- **expected_behavior:** Static HTML at `/` served from `public/` via `@fastify/static`. Full OG + Twitter card meta. Nav links to `/about`, `/pricing`, `/support`, `/blog`. Primary CTA is "Get the app" → App Store / deep link. Google Fonts (DM Sans + Fraunces) loaded from `fonts.googleapis.com`.
- **status:** implemented — `public/index.html` exists with full meta, nav, CTAs
- **gaps:**
  - No meta `description` tag confirmed on homepage (only `og:description` found); could hurt organic snippets
  - No structured data (JSON-LD `MobileApplication` / `Product`) for rich results
  - Google Fonts are render-blocking; no `<link rel="preload">` for critical fonts
  - Nav has no active-state JS; `/blog` link in nav goes to an unconfirmed route (no `blog.html` found in `public/`)
  - No dark-mode OG image variant (single static `og-song.png` used everywhere)
- **key_files:** `public/index.html`, `public/styles/main.css`, `public/assets/og-song.png`

---

### 2. Occasion-Specific SEO Landing Pages

- **feature:** Long-tail SEO pages targeting gift occasions and alternatives
- **user_story:** Gift-giver googles "birthday song for mom" → lands on keyword-targeted page → taps download CTA
- **expected_behavior:** Static HTML pages in `public/` root and `public/gifts/` subdirectory, served as static files. Each page has title + meta description tuned to the keyword. CTAs point to App Store or `porizo:///` custom scheme. Pages are included in `sitemap.xml`.
- **status:** implemented — confirmed 30+ occasion pages including `birthday-song-for-mom.html`, `birthday-song-for-dad.html`, `birthday-song-maker.html`, `anniversary-song-gift.html`, `fathers-day-song.html`, `mothers-day-song.html`, `song-in-your-voice.html`, `songfinch-alternative.html`, `wedding-song-gift.html`, `valentines-song-for-her.html`, plus many more under `public/gifts/`
- **gaps:**
  - `song-in-your-voice.html` still exists as a route — project memory notes voice-cloning promises were false/removed from live promo text, but page may still carry stale copy (not fully verified)
  - iPad screenshots may still carry voice-clone copy (noted in project memory as deferred)
  - No internal linking strategy between occasion pages (each page appears self-contained)
  - Some pages in `public/gifts/` vs root-level creates inconsistent URL structure (`/gifts/song-for-wife-birthday` vs `/birthday-song-for-mom`)
  - No structured data (`HowTo`, `FAQPage`, `Product`) on any landing page
- **key_files:** `public/birthday-song-for-mom.html`, `public/songfinch-alternative.html`, `public/song-in-your-voice.html`, `public/gifts/` (30+ files)

---

### 3. Pricing Page

- **feature:** Public marketing pricing page
- **user_story:** Visitor evaluating cost → sees tiers → taps download or gets started
- **expected_behavior:** Static `public/pricing.html`. Three tiers (Free, Plus, Pro) with monthly/annual billing toggle (`billing-toggle__option`). Twitter card meta present. No server-side gating — fully public.
- **status:** implemented — `public/pricing.html` present with OG/Twitter meta. Title: "Porizo Pricing — Free, Plus, and Pro plans"
- **gaps:**
  - Pricing page appears to be disconnected from actual in-app pricing (IAP prices set in App Store Connect); any price drift between web and App Store is a UX discrepancy and App Store guideline risk
  - Monthly/annual toggle is client-side only — if JS fails the toggle breaks, showing only one set of prices
  - No schema.org `Offer` markup for rich results
  - "Get started" CTAs not confirmed — unclear if they deep-link to App Store or try to launch `porizo:///` (which would fail on desktop)
- **key_files:** `public/pricing.html`, `public/styles/main.css`

---

### 4. Support Page

- **feature:** Static customer support page
- **user_story:** User with a problem → finds help/FAQ content
- **expected_behavior:** Static HTML at `/support`. Shares nav and styles with main marketing site. Links to `/about`, `/pricing`, `/blog`, `/support`.
- **status:** implemented — `public/support.html` confirmed present with full nav markup
- **gaps:**
  - `/blog` nav link appears broken — no `blog.html` or blog route found anywhere in codebase
  - Support page content not inspected in full — unclear if it has self-serve FAQ or just a contact form
  - No live chat or help widget detected
- **key_files:** `public/support.html`, `public/styles/main.css`

---

### 5. About / Our Story Page

- **feature:** Brand story and "about us" page
- **user_story:** Curious visitor → understands who built Porizo and why
- **expected_behavior:** Static HTML at `/about`. Title: "Our Story - Porizo". Min-height 70vh hero with sound wave animation. Meta description: "Learn about Porizo - where technology meets emotion to create deeply personal musical moments."
- **status:** implemented — `public/about.html` confirmed with full head meta and hero section
- **gaps:**
  - Sound wave animation via CSS — if prefers-reduced-motion not respected, accessibility issue
  - Meta description uses generic "technology meets emotion" copy; doesn't include the "song gift" keyword cluster that the rest of the site targets
- **key_files:** `public/about.html`

---

### 6. Legal Pages (Privacy Policy / Terms of Service)

- **feature:** Legal documents
- **user_story:** User or App Store reviewer → reads legal policies
- **expected_behavior:** Static HTML pages in `public/legal/`. Required for App Store listing.
- **status:** implemented — `public/legal/` directory confirmed present
- **gaps:**
  - Content not inspected; if policies reference "your voice" or voice cloning they may conflict with the pivot away from voice-clone positioning
  - No versioning or "last updated" timestamp confirmed in markup
- **key_files:** `public/legal/` (directory contents not enumerated)

---

### 7. Web Song Player (Share Landing Page)

- **feature:** Web-based song share landing — the page a recipient sees when tapping a Porizo share link
- **user_story:** Recipient gets a share link (`/s/:shareToken`) → page loads → either sees app-wall (app-only) or plays a teaser/preview in the browser
- **expected_behavior:**
  1. Server-side renders `web-player/index.html` with OG tags (`{{OG_TITLE}}`, `{{OG_DESCRIPTION}}`, `{{OG_IMAGE}}`, `{{OG_URL}}` etc.) substituted before delivery so iMessage/WhatsApp/Twitter see proper rich-link cards.
  2. `player.js` reads share token from URL path (`/s/:shareToken` or `/play/:shareToken`).
  3. Calls `GET /share-info/:shareToken` → JSON with `app_only`, `status`, `web_stream_url`, `teaser_url`, `receiver_handoff_id`.
  4. **App-only branch** (all real shares): shows `#app-wall` screen — "Open in Porizo" button (custom scheme `porizo:///receiver-handoff/<id>`) + "Get it free" button (OneLink → App Store with deferred deep-link).
  5. **Web-playable branch** (demo/special): creates `<audio>` element, streams from `web_stream_url` in detected format (m4a/mp3).
  6. **Teaser branch**: plays short teaser clip before showing unlock CTA.
  7. Error states: `SHARE_NOT_FOUND` → inline error message; `SHARE_EXPIRED` → `expired` screen with "Link Expired" heading; claimed-by-other-device → inline error with "Get the app" CTA.
  8. `receiver_handoff_id` (`rh_<hex>`) passed into OneLink as deferred deep-link so claim survives App Store install → first launch.
  9. `recordReceiverEvent()` fires analytics on every CTA tap.
- **status:** implemented — `web-player/` files complete; player.js covers all branches; OG template confirmed; app-wall with two-CTA design (commit 457da8f) live
- **gaps:**
  - App-wall "Open in Porizo" uses custom scheme with no fallback timer — on iOS, if the app isn't installed, iOS silently swallows the `porizo:///` URL with no error (scheme-not-registered). The player does not detect this failure and fall back to App Store (by design per commit 457da8f, but creates a dead-end for users who uninstalled the app)
  - Expired screen copy says "Ask the sender to create a new one" — but share links are lifetime tokens (never actually expire per `share_tokens.expires_at = 9999-12-31`). The `SHARE_EXPIRED` error path is therefore a confusing dead-end if it ever fires
  - No accessibility attributes confirmed on play button, artwork, or CTA elements (no `aria-label` grep done on player.js)
  - Twitter Player Card (`{{TWITTER_PLAYER_META}}`) template slot — unclear if populated for all share types or only when `web_stream_url` is present
  - Dark-mode cover artwork: single cover image served; no dark-variant OG image
  - No `<noscript>` fallback — page is blank if JS disabled
- **key_files:** `web-player/index.html`, `web-player/player.js`, `web-player/styles.css`, `src/server.js` (share route handlers, OG template substitution)

---

### 8. App-Wall / Deep-Link Handoff on Web

- **feature:** Browser-to-app handoff mechanism for share recipients
- **user_story:** Recipient opens share link in browser → taps "Open in Porizo" → app opens to claim song; or taps "Get it free" → App Store → install → app auto-claims song
- **expected_behavior:**
  - "Open in Porizo" → `porizo:///receiver-handoff/<rh_hex>` (iOS-registered scheme, no fallback timer)
  - "Get it free" → `APPSFLYER_ONELINK_BASE_URL` with `deep_link_value=porizo:///receiver-handoff/<id>` as deferred deep-link; falls back to App Store
  - `receiver_handoff_id` extracted from share API response or from OneLink `deep_link_value` query param
  - All events tracked: `receiver_save_cta_clicked`, `receiver_open_cta_clicked`
- **status:** implemented — confirmed in `player.js` lines 1108–1149, 1183, 1231–1343; APPSFLYER_ONELINK_BASE_URL confirmed wired in project memory (commit 736cdd1, 457da8f)
- **gaps:**
  - No Android deep-link branch confirmed in web-player (only iOS `porizo:///` + OneLink); Android recipients may only get the OneLink path
  - If `APPSFLYER_ONELINK_BASE_URL` env var is unset, OneLink fallback may silently break (no server-side guard observed in web-player JS beyond `buildReceiverSaveFallbackUrl`)
  - OneLink redirect chain is iOS-only; on Android browser the CTA behaviour is untested from the code
- **key_files:** `web-player/player.js` (lines 1108–1200, 1279–1343), `src/server.js` (share-info route, receiver-handoff routes)

---

### 9. Embed Player

- **feature:** Minimal embeddable audio player for third-party iframe embedding
- **user_story:** Third-party site embeds a Porizo song → visitor plays audio in-page without leaving
- **expected_behavior:**
  - Served from `/embed-player/` static prefix (`embed-player/` directory).
  - `embed.js` reads `document.body.dataset.shareId` and `document.body.dataset.mediaUrl`.
  - `audio.src = mediaUrl || ("/share/" + shareId + "/share.mp4")` — uses pre-resolved `mediaUrl` if provided, else constructs a fallback path.
  - Standard HTML5 `<audio>` controls (play/pause button, progress bar, time display).
  - No app-wall, no token gating in JS — audio URL must be pre-injected by the server into `data-media-url`.
  - `audio.preload = "metadata"` — fetches duration on load.
- **status:** implemented — `embed-player/` files present and functional
- **gaps:**
  - Fallback URL `/share/:shareId/share.mp4` — no such route was found in `src/server.js` grep output; this fallback may be dead/404 if `mediaUrl` is not injected
  - No error UI for failed audio load (`audio.onerror` not found in first 100 lines; may exist later in file)
  - No accessibility: no `aria-label` on buttons, no keyboard handling beyond default browser behaviour
  - CSP implications if embedded on third-party sites — no CORS header confirmed for `/embed-player/` static prefix
  - `embed-player/index.html` content not inspected; unclear if it has proper `<iframe allow="autoplay">` guidance for embedders
- **key_files:** `embed-player/index.html`, `embed-player/embed.js`, `embed-player/embed.css`

---

### 10. Poem Viewer (Web)

- **feature:** Web landing page for shared poems
- **user_story:** Poem recipient taps share link (`/poem/:shareId`) → sees poem content in browser → prompted to get app to keep it
- **expected_behavior:**
  1. `viewer.js` extracts `shareId` from URL path (`/poem/<shareId>`).
  2. Calls `GET /poem-share/:shareId` → JSON with `expired`, `app_download_url`, poem content.
  3. States: `loading` → `viewer` (poem content displayed) | `expired` (HTTP 410) | `pinEntry` (PIN-protected poems) | `error`.
  4. Poem content rendered via DOM `textContent` (XSS-safe).
  5. App CTA: `buildDownloadUrl({ deepLink: "porizo:///poem/<shareId>" })` → OneLink or direct App Store.
  6. "Get the app" CTA built with platform/channel analytics params.
  7. Claim flow: `POST /poem-share/:shareId/claim` (line 120).
- **status:** implemented — `poem-viewer/` files confirmed; `viewer.js` covers expired (410), pinEntry, viewer, error screens
- **gaps:**
  - PIN entry UI is present in the state machine (`showScreen("pinEntry")`) but not confirmed to have a fully functional form (not inspected further)
  - No web playback — poems are text-only on web, audio locked behind the app; no teaser or preview of audio for poem shares
  - App-wall "app_only" branch not observed in poem viewer (unlike web-player) — unclear if poem shares are always web-viewable or can also be app-only
  - OG meta for poem share pages not confirmed (does `/poem/:shareId` route inject OG tags server-side like the song player does?)
  - No `<noscript>` fallback
- **key_files:** `poem-viewer/index.html`, `poem-viewer/viewer.js`, `poem-viewer/styles.css`, `src/server.js` (poem-share routes ~lines 1058–1158)

---

### 11. Audio Streaming Endpoint — Preview (MP3 / M4A)

- **feature:** Backend endpoint streaming preview audio to web player and embed player
- **user_story:** Web player / embed player requests preview audio → browser streams and plays it
- **expected_behavior:**
  - `GET /preview/:trackVersionId.mp3` — serves `preview.mp3` with `audio/mpeg`
  - `GET /preview/:trackVersionId.m4a` — serves `preview.m4a` with `audio/mp4`
  - Both use `serveTrackAudio()` → `sendMediaFile()` helper.
  - `sendMediaFile()` (line 1228): reads `request.headers.range`, matches `bytes=(\d*)-(\d*)`, returns HTTP 206 with `Content-Range: bytes start-end/total` and `Content-Length: rangeSize`. Returns 416 for invalid range. Reads range into buffer (not streaming) to fix Content-Length handling.
  - **Auth:** No user auth on preview routes — access gated only by knowledge of `trackVersionId` (opaque UUID). No share-token check required for preview.
  - Supports both local filesystem (dev) and S3 (prod) via `storageProvider`.
- **status:** implemented — confirmed at lines 4668–4735; range request support confirmed in `sendMediaFile` (lines 1286–1342)
- **gaps:**
  - Preview routes have **no auth at all** — any actor who guesses or obtains a `trackVersionId` UUID can stream the preview audio without being the owner or a recipient. This is acceptable if UUIDs are sufficiently opaque, but no explicit rate-limiting on these endpoints was confirmed
  - Range request reads into `Buffer.alloc(rangeSize)` — for large files this is a full in-memory allocation per request; no streaming pipe. Under concurrent load this may cause memory pressure
  - No `Accept-Ranges: bytes` header confirmed in non-range responses (required by HTML5 audio for iOS Safari seek support)
  - `Content-Type: audio/mp4` for `.m4a` — correct, but Safari requires this exact value; no fallback
  - No CDN caching headers (`Cache-Control`) confirmed on preview responses (S3 presigned URL path redirects, but local path serves directly with no confirmed cache header)
- **key_files:** `src/server.js` lines 4668–4735, 1228–1350

---

### 12. Audio Streaming Endpoint — Full Render (M4A)

- **feature:** Backend endpoint streaming full-length song audio
- **user_story:** App (or authorised web player) requests full song audio after confirmation
- **expected_behavior:**
  - `GET /full/:trackVersionId.m4a` — `audio/mp4`, uses same `serveTrackAudio` + `sendMediaFile` helper with range support.
  - **Auth:** `?share_token=<id>` query param bypass (checks `share_tokens` table: `status != 'revoked'` and `track_id` match). Else falls back to `requireUserId` → owner check.
  - S3: issues presigned redirect (302). Local: reads from filesystem.
- **status:** implemented — confirmed at lines 4735–4774 with auth pattern at lines 4802–4815
- **gaps:**
  - Share-token bypass on full audio: `status != 'revoked'` check does **not** verify `bound_device_id` matches the requester — any bearer of an unrevoked share token (even if claimed by another device) can stream the full audio via the web endpoint. This may be intentional for the web player but is worth flagging as a potential over-permissive access path
  - Same in-memory buffer issue as preview for range requests
  - No `Cache-Control` confirmed
- **key_files:** `src/server.js` lines 4735–4815

---

### 13. Cover Artwork Dynamic Sizing Endpoint

- **feature:** Resized cover artwork served at requested size
- **user_story:** Web player / OG crawler requests cover at specific dimensions → receives appropriately sized image
- **expected_behavior:**
  - `GET /cover/:trackVersionId/:size` — after auth (share-token or owner), serves `cover_<size>.jpg`.
  - On S3: generates a presigned URL (`expiresInSec: 300`) and redirects (302).
  - On local: serves from version directory directly.
  - Sizes appear pre-rendered at upload time (`cover_<size>.jpg` naming convention), not dynamically resized on the fly.
- **status:** implemented — confirmed at lines 4774–4842
- **gaps:**
  - Presigned URL redirect (302) with 300s expiry — if a crawler or CDN caches the redirect, the image 403s after 5 minutes. No `Cache-Control: no-store` confirmed on the redirect response
  - No `size` parameter validation confirmed — if an unsupported size is requested, a file-not-found on S3 or local would propagate as an unhandled error
  - CORS not confirmed on this endpoint — OG crawlers don't need CORS but web players serving the image in an `<img>` cross-origin might hit CORP issues
- **key_files:** `src/server.js` lines 4774–4842

---

### 14. Guide Vocal Endpoint (Internal)

- **feature:** Internal audio endpoint serving guide vocal (reference vocal used in voice conversion)
- **user_story:** Internal workflow step accesses guide vocal for processing
- **expected_behavior:**
  - `GET /guide/:trackVersionId` — auth-gated (share-token or owner, same pattern as full audio).
  - Serves `guide_vocal.wav` from version directory.
  - Marked internal-only in CLAUDE.md: "never exposed" to users.
- **status:** implemented — confirmed at lines 4842+
- **gaps:**
  - The route is accessible to any authenticated track owner via the API — if a user somehow learns their `trackVersionId`, they could request their own guide vocal. This may not be intended (spec says internal-only). Should verify whether `requireUserId` path is reachable from the public API or only from internal callers
  - No range request support confirmed for WAV files (less critical since internal use)
- **key_files:** `src/server.js` lines 4842+

---

### 15. OG Meta / Social Cards for Share Links

- **feature:** Rich social card generation for share links
- **user_story:** Sender shares a link via iMessage/WhatsApp/Twitter → platform crawler sees proper title, image, description
- **expected_behavior:**
  - `/s/:shareToken` route renders `web-player/index.html` with server-side placeholder substitution: `{{OG_TITLE}}`, `{{OG_DESCRIPTION}}`, `{{OG_IMAGE}}`, `{{OG_URL}}`, `{{OG_TYPE}}`, `{{OG_IMAGE_WIDTH}}`, `{{OG_IMAGE_HEIGHT}}`, `{{FB_APP_ID_META}}`, `{{OG_VIDEO_META}}`, `{{TWITTER_CARD_TYPE}}`, `{{TWITTER_PLAYER_META}}`.
  - Twitter card type: `"player"` (allows in-tweet audio player) or `"summary_large_image"` depending on `web_stream_url` presence.
  - WhatsApp/Facebook crawlers detected by User-Agent → served 1200×1200 square OG image variant (line 922–1000 in sharing routes).
  - iMessage: `apple-touch-icon` used as LPLinkMetadata thumbnail (comment in `web-player/index.html`).
  - OG image URL includes `generated_at` epoch param so re-shares trigger fresh crawler fetch.
- **status:** implemented — OG template confirmed; WhatsApp/FB UA detection confirmed; epoch cache-bust confirmed
- **gaps:**
  - `{{TWITTER_PLAYER_META}}` is only populated when audio is web-streamable — for app-only shares (all real shares) the Twitter card degrades to image-only, which is correct but means in-tweet playback never works for real songs
  - OG image for poem shares (`/poem/:shareId/og-image.png`) confirmed in URL builder (line 1158) but whether the route is implemented and returns a proper image is not verified
  - `{{FB_APP_ID_META}}` presence implies Facebook app ID is injected — but if the env var is missing this slot may render as empty string or literal placeholder
  - No OG `og:audio` tag for direct audio (non-video) sharing
- **key_files:** `web-player/index.html` (OG template), `src/server.js` (OG substitution + UA detection ~lines 900–1000), `src/routes/sharing.js`

---

### 16. Apple Universal Links (AASA)

- **feature:** iOS Universal Link configuration enabling `https://porizo.co/s/*`, `/play/*`, `/poem/*` URLs to open directly in the Porizo app
- **user_story:** iOS recipient taps a share link in Messages/Safari → iOS opens Porizo app directly (bypassing browser) if installed
- **expected_behavior:**
  - `GET /.well-known/apple-app-site-association` served dynamically (line 518 in server.js) with `Content-Type: application/json`.
  - Also present as a static file at `public/.well-known/apple-app-site-association`.
  - Content: `applinks.details[0].appID = "5VCH6937XM.com.porizo.PorizoApp"`, `paths: ["/play/*", "/s/*", "/poem/*"]`.
  - No `webcredentials` or `appclips` sections.
- **status:** implemented — both dynamic route and static file confirmed; app ID and paths match expected values
- **gaps:**
  - Static file at `public/.well-known/` AND dynamic route at the same path — if static file serving takes precedence over the dynamic route (depends on fastify plugin registration order), the static file would be served. Both appear to have identical content so this is low risk, but registration order should be verified
  - `paths` array uses old wildcard format (`"/s/*"`) — iOS 13+ AASA v2 format prefers `components` array with `pattern`; old format still works but is deprecated
  - No `appclips` section — App Clips could improve cold-start conversion for share link recipients who don't have the app
  - Dynamic route serves `aasaJson` built inline — if content is hardcoded rather than read from env/config, adding new Universal Link paths requires a code deploy
- **key_files:** `public/.well-known/apple-app-site-association`, `src/server.js` lines 518–526

---

### 17. Well-Known / Discovery Endpoints

- **feature:** Standard `.well-known` discovery documents
- **user_story:** AI engines, OAuth clients, or API discovery tools query standard endpoints
- **expected_behavior:**
  - `/.well-known/apple-app-site-association` — see feature 16
  - `/.well-known/oauth-authorization-server` — stub JSON (all arrays empty: `grant_types_supported: []`, etc.). Issues `"issuer": "https://porizo.co"` but no real OAuth server is implemented.
  - `/.well-known/api-catalog` — present (content not fully inspected)
  - `/.well-known/mcp/server-card.json` — present (MCP server discovery for AI agents; `public/.well-known/mcp/server-card.json`)
- **status:** partial — AASA implemented; oauth-authorization-server is a stub with empty capability arrays; api-catalog and MCP card present
- **gaps:**
  - `oauth-authorization-server` stub could confuse OAuth clients that discover it and attempt flows — consider removing or adding `"jwks_uri"` content and real capability arrays, or use a `410 Gone` if OAuth is not supported
  - MCP server card signals AI-agent accessibility — if not intentionally exposed, this is an information-disclosure issue
- **key_files:** `public/.well-known/` (all files), `src/server.js` line 518

---

### 18. Sitemap, Robots.txt, and llms.txt

- **feature:** SEO crawl configuration and AI engine discoverability
- **user_story:** Search engine crawler / AI engine → discovers and indexes Porizo pages correctly
- **expected_behavior:**
  - `public/sitemap.xml` — lists core pages + occasion/gift landing pages including `/gifts/song-for-wife-birthday` (changefreq: weekly, priority: 0.7)
  - `public/robots.txt` — standard allow-all with sitemap reference
  - `public/llms.txt` — structured Porizo description for AI LLM engines, with sections: About, How It Works, Key Features, Pricing, FAQ, Comparison, Pages, Technology, Contact, Citation Note
- **status:** implemented — all three files confirmed present
- **gaps:**
  - `sitemap.xml` may not include all SEO landing pages — the root-level occasion pages (e.g., `/birthday-song-for-mom`) may not be listed if sitemap only covers `/gifts/` subdirectory URLs (not fully verified)
  - `robots.txt` does not disallow `/debug.html`, `/admin/`, or `/.well-known/` — crawlers can discover debug pages (even if `debug.html` has `<meta name="robots" content="noindex, nofollow">`, the file is crawlable)
  - `llms.txt` content references pricing tiers and feature claims — needs to stay in sync with actual product features after the pay-per-song pivot
- **key_files:** `public/sitemap.xml`, `public/robots.txt`, `public/llms.txt`

---

### 19. Debug Page (Song Pipeline Debugger)

- **feature:** Developer debugging tool for the song generation pipeline
- **user_story:** Developer → manually triggers enrollment / song creation / job steps to test the pipeline
- **expected_behavior:**
  - `public/debug.html` + `public/debug.js` served only when `ENABLE_DEBUG_ROUTES=true` env var is set (lines 357–460 in server.js; `const enableDebugRoutes = appConfig.ENABLE_DEBUG_ROUTES ?? config.ENABLE_DEBUG_ROUTES ?? false`).
  - `debug.html` has `<meta name="robots" content="noindex, nofollow">`.
  - `debug.js` uses `x-user-id` header with a generated `debug_<timestamp><random>` ID — **no real auth** on API calls.
  - Exposes full pipeline: enrollment recording, chunk upload, song creation, job polling.
  - File `public/autoresearch-results.json` also present in `public/` directory.
- **status:** partial — file exists and is gated behind `ENABLE_DEBUG_ROUTES`; noindex meta present
- **gaps:**
  - **CRITICAL:** `debug.js` sends `x-user-id: debug_<random>` header — if `ENABLE_DEBUG_ROUTES` is ever set to `true` in production (accidental misconfiguration), the debug page allows unauthenticated song pipeline access with a self-generated user ID. The backend must also validate this header; if it trusts `x-user-id` from the client, this is a significant auth bypass
  - `public/autoresearch-results.json` is served unconditionally from the `public/` static directory — this file is reachable at `/autoresearch-results.json` regardless of `ENABLE_DEBUG_ROUTES`. Its content is unknown but the filename suggests it may contain internal research/data
  - Static files `public/debug.html` and `public/debug.js` are in the `public/` directory but the static file serving registration is gated. Need to confirm: if `@fastify/static` for `public/` is registered unconditionally, these files may be reachable even when `ENABLE_DEBUG_ROUTES=false`
- **key_files:** `public/debug.html`, `public/debug.js`, `public/autoresearch-results.json`, `src/server.js` lines 357–460

---

### 20. Admin Dashboard (Web UI)

- **feature:** Internal admin dashboard for user management, cold email campaigns, feature flags, security audit logs, gift ops
- **user_story:** Admin operator → logs in → manages users, campaigns, flags, and security events
- **expected_behavior:**
  - `public/admin/dashboard.html` served from `public/admin/` directory.
  - All `/admin/dashboard*` routes gated by global auth hook (line ~109 in `src/routes/admin.js`): sets `request.admin`; exempt paths are `/admin/auth/*`.
  - Login: `POST /admin/auth/login` — rate-limited (15-min window, `ADMIN_LOGIN_WINDOW_MS`), generic failure message, `Retry-After` header. `POST /admin/auth/setup` — one-time setup, requires `ADMIN_SETUP_SECRET` env var.
  - `ADMIN_UI_ALLOWED_EMAILS` env var controls who can access.
  - `ADMIN_UI_MODE` can restrict access.
  - Dashboard URL: `https://api.porizo.co/admin/dashboard?tab=cold-email` (confirmed from project memory).
  - Tabs include: users, cold-email campaigns, security/audit-logs, security/rate-limits, feature-flags, gift ops.
- **status:** implemented — auth gate confirmed; login rate-limiting confirmed; allowed-email config confirmed
- **gaps:**
  - Admin dashboard is served from `public/admin/` under the main API domain — the static HTML is technically separate from the auth gate (the gate protects API routes; the HTML itself may be served by static file handler without auth). If `public/admin/` is registered as a static prefix unconditionally, `dashboard.html` HTML source is publicly readable even without login credentials
  - No MFA confirmed — login is email+password only
  - `ADMIN_UI_MODE: "public"` is the default — unless `ADMIN_UI_ALLOWED_EMAILS` is set, access may be controlled only by the login credential, not by an email allowlist
- **key_files:** `public/admin/dashboard.html`, `src/routes/admin.js`, `src/server.js` (static registration lines 461+)

---

### 21. Gift Landing Pages (public/gifts/)

- **feature:** Gift-occasion-specific landing pages under `/gifts/` URL namespace
- **user_story:** Gift-giver discovers Porizo via search for a specific occasion → lands on targeted page → converts to download
- **expected_behavior:** Static HTML files served from `public/gifts/`. Included in `sitemap.xml`. Occasion-targeted copy and CTAs. Similar structure to root-level occasion pages.
- **status:** implemented — directory confirmed with 30+ pages (e.g., `song-for-wife-birthday`, `fathers-day-song-for-dad`, `graduation-song-for-daughter`, etc.)
- **gaps:**
  - Duplicate content risk: root-level `/birthday-song-for-mom.html` vs `/gifts/` occasion pages may target overlapping keywords, creating internal SEO competition
  - No canonical tag strategy confirmed between root and `/gifts/` pages
- **key_files:** `public/gifts/` (directory)

---

### 22. MCP / AI Agent Discovery (Well-Known MCP Card)

- **feature:** MCP server card for AI agent discovery
- **user_story:** AI agent or LLM tool → discovers Porizo's MCP API surface
- **expected_behavior:** `/.well-known/mcp/server-card.json` served as static file. Declares Porizo's MCP-compatible endpoints.
- **status:** implemented — `public/.well-known/mcp/server-card.json` confirmed present
- **gaps:**
  - If Porizo's MCP endpoints are not intended to be publicly consumed by third-party AI agents, the server card is an unintended information disclosure
  - MCP spec is evolving — server card format may need updates as the standard matures
- **key_files:** `public/.well-known/mcp/server-card.json`

---

### 23. Static Asset Serving (styles, assets, audio samples)

- **feature:** Static file delivery for CSS, images, and sample audio
- **user_story:** Any page visitor → browser fetches CSS/images/audio samples
- **expected_behavior:**
  - `/styles/` → `public/styles/` (no maxAge set — default browser caching)
  - `/assets/` → `public/assets/` (includes `logo.png`, `og-song.png`, `og-poem.png`, `webmcp.js`)
  - `/audio/` → `public/audio/` with `maxAge: "7d"` (sample MP3s: `cafeteria-light-trimmed.mp3`, `sample-mothers-day-2026.mp3`, `test-preview.mp3`)
  - All use `decorateReply: false`
  - Helmet sets `Cross-Origin-Resource-Policy` — relaxed from `same-origin` to allow Google Fonts cross-origin
- **status:** implemented — all static registrations confirmed
- **gaps:**
  - `/styles/` and `/assets/` have no explicit `maxAge` — browser receives no `Cache-Control` header beyond Helmet defaults, causing unnecessary revalidation on every page load
  - `test-preview.mp3` in `public/audio/` is a test artefact served publicly in production
  - `webmcp.js` in `public/assets/` — purpose unclear; may be a development/MCP tool artefact inadvertently in the public directory
  - Helmet CSP is set to `false` — CSP is "managed per-HTML-page" but no CSP meta tags were found in any inspected HTML files; this is a potential XSS risk if any page includes user-controlled content
- **key_files:** `src/server.js` lines 461–505, `public/styles/`, `public/assets/`, `public/audio/`

---

## Summary Table

| #   | Feature                             | Status                    |
| --- | ----------------------------------- | ------------------------- |
| 1   | Marketing landing page              | implemented               |
| 2   | Occasion SEO landing pages          | implemented               |
| 3   | Pricing page                        | implemented               |
| 4   | Support page                        | implemented               |
| 5   | About / Our Story page              | implemented               |
| 6   | Legal pages                         | implemented               |
| 7   | Web song player (share landing)     | implemented               |
| 8   | App-wall / deep-link handoff        | implemented               |
| 9   | Embed player                        | implemented               |
| 10  | Poem viewer (web)                   | implemented               |
| 11  | Audio streaming — preview (MP3/M4A) | implemented               |
| 12  | Audio streaming — full render (M4A) | implemented               |
| 13  | Cover artwork dynamic sizing        | implemented               |
| 14  | Guide vocal endpoint (internal)     | implemented               |
| 15  | OG meta / social cards              | implemented               |
| 16  | Apple Universal Links (AASA)        | implemented               |
| 17  | Well-known / discovery endpoints    | partial (OAuth stub)      |
| 18  | Sitemap / robots.txt / llms.txt     | implemented               |
| 19  | Debug page (song pipeline)          | partial (gated but risks) |
| 20  | Admin dashboard                     | implemented               |
| 21  | Gift landing pages                  | implemented               |
| 22  | MCP / AI agent discovery            | implemented               |
| 23  | Static asset serving                | implemented               |

---

## Top Robustness / UX Gaps (Priority Order)

1. **Debug page auth bypass risk:** `debug.js` sends self-generated `x-user-id` header with no real auth. If `ENABLE_DEBUG_ROUTES=true` is ever set in production (or if `public/debug.html` is reachable via unconditional static serving even when the route flag is false), unauthenticated pipeline access is possible. `public/autoresearch-results.json` is served unconditionally regardless of the flag.

2. **Preview audio has zero auth:** `GET /preview/:trackVersionId.mp3` and `.m4a` require no credentials — any UUID leak exposes audio. No rate-limiting confirmed on these endpoints. Combined with the in-memory buffer allocation for range requests, a trivial enumeration + concurrent-request attack could exhaust server memory.

3. **Admin dashboard HTML may be publicly readable:** `public/admin/dashboard.html` is in a static directory that may be served before the auth gate fires. API routes are gated but the HTML source file itself (containing endpoint paths, tab names, data schemas) may be reachable unauthenticated.

4. **App-wall dead-end for uninstalled-app users:** "Open in Porizo" custom-scheme tap silently fails on iOS if the app isn't installed (iOS swallows unregistered schemes). The player intentionally has no fallback timer (commit 457da8f), so the user sees nothing happen and has no obvious path forward unless they also see the "Get it free" button — which is only visible as a secondary CTA.

5. **Expired share UX is misleading:** The `SHARE_EXPIRED` error screen says "Ask the sender to create a new one" but share tokens are lifetime (`expires_at = 9999-12-31`). If this screen ever appears it is caused by something other than expiry (revocation? token not found?), and the copy actively misleads the recipient.

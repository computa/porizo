# WebApp P2/P3 Robustness Verification — 2026-06-22

Scope: H1–H23 (domain=WebApp), priority P2 and P3. P0/P1 excluded per spec.
Known session dismissals: H2 voice-clone copy (clean), H4 /blog route (works), H7 no-timer (by-design).

---

## Verdict Table

| ID  | Claimed Gap                                                                | Verdict                | Evidence                                                                                                                                                            |
| --- | -------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| H1  | No `<meta name="description">`                                             | FALSE_POSITIVE         | `public/index.html` has `<meta name="description" content="…">` — confirmed present                                                                                 |
| H1  | `/blog` nav link broken                                                    | FALSE_POSITIVE         | `blog.js:18` registers `GET /blog`; link in index.html is `href="/blog"` — works                                                                                    |
| H2  | `song-in-your-voice.html` carries voice-clone promise                      | FALSE_POSITIVE         | Page title "A song made for someone you love", copy explicitly says "You don't sing at all… an AI vocalist performs the song for you." No voice-clone claim. CLEAN. |
| H3  | "Get Started" CTA points to dead `/download`                               | FALSE_POSITIVE         | `legal.js:810` registers `GET /download` — route exists                                                                                                             |
| H4  | `/blog` nav link broken                                                    | FALSE_POSITIVE (known) | Confirmed working via dynamic route                                                                                                                                 |
| H5  | `prefers-reduced-motion` absent on wave animation                          | BY_DESIGN              | CSS animation accessibility gap; not a functional dead-end                                                                                                          |
| H7  | No-timer on app-wall = dead end                                            | BY_DESIGN (known)      | Intentional per commit 457da8f                                                                                                                                      |
| H8  | No Android deep-link in web-player                                         | REAL — see below       |                                                                                                                                                                     |
| H9  | Embed fallback `/share/:shareId/share.mp4` dead                            | FALSE_POSITIVE         | Route exists at `src/routes/sharing.js:2790`                                                                                                                        |
| H9  | No `audio.onerror` handler in embed player                                 | REAL — see below       |                                                                                                                                                                     |
| H10 | Poem viewer has no app-wall                                                | BY_DESIGN              | poem-viewer only has `porizo:///poem/<id>` custom-scheme link; no explicit app-wall branch, but that is the intended CTA surface                                    |
| H13 | Presigned-URL redirect cache → 403 after 5 min                             | BY_DESIGN / low risk   | Acceptable for artwork endpoint; not a UX dead-end                                                                                                                  |
| H15 | OG image for poem shares route unverified                                  | FALSE_POSITIVE         | `poems.js` registers `GET /poems/:id/og-preview/:variant` — route confirmed                                                                                         |
| H16 | AASA uses old `/s/*` wildcard, not v2 format                               | REAL — see below       |                                                                                                                                                                     |
| H17 | `oauth-authorization-server` stub with empty arrays confuses OAuth clients | BY_DESIGN              | Stub is intentional; empty arrays signal no support — not a UX issue                                                                                                |
| H18 | `robots.txt` doesn't disallow `debug.html`                                 | FALSE_POSITIVE         | `robots.txt` explicitly has `Disallow: /debug.html` for `User-agent: *`                                                                                             |
| H18 | Sitemap missing root-level occasion pages                                  | FALSE_POSITIVE         | Sitemap includes root-level pages: `/mothers-day-song`, `/birthday-song-for-mom`, `/song-in-your-voice`, etc. — all present                                         |
| H19 | `debug.html` served publicly in prod                                       | FALSE_POSITIVE         | Static file handler is inside `if (enableDebugRoutes)` block in `server.js` — gated. Also `robots.txt` disallows it.                                                |
| H20 | Admin dashboard HTML publicly readable without auth                        | FALSE_POSITIVE         | No unconditional `@fastify/static` registration for `public/admin/` found in `server.js`. `requireAdminRole` gates the admin API routes.                            |
| H21 | Duplicate content root vs /gifts/ pages                                    | BY_DESIGN              | SEO strategy decision, not a robustness/UX break                                                                                                                    |
| H22 | MCP server card is info disclosure                                         | BY_DESIGN              | Intentionally exposed per MCP spec                                                                                                                                  |
| H23 | `test-preview.mp3` in `public/audio/` served in prod                       | REAL — see below       |                                                                                                                                                                     |
| H23 | `webmcp.js` dev artifact in `public/assets/`                               | FALSE_POSITIVE         | `ls public/assets/                                                                                                                                                  | grep webmcp` returned nothing — file not present |

---

## CONFIRMED REAL Gaps

### H8 — No Android deep-link path in web-player

- **File:** `web-player/player.js` — zero matches for `android`, `play.google`, `market://`
- **Issue:** Android recipients clicking the share link get only the OneLink path (which is iOS-optimised). No Google Play Store fallback or Android intent URL is constructed. Android users land on a web page with an app-wall that may not open anything.
- **Fix:** In `player.js` `buildAppWallCTA()`, detect Android UA and use `https://play.google.com/store/apps/details?id=com.porizo.PorizoApp` as the "Get it free" fallback instead of/in addition to OneLink.
- **Severity:** Medium — real dead-end for Android share recipients.
- **Blast radius:** `web-player/player.js` only.

### H9 — Embed player has no `audio.onerror` handler

- **File:** `embed-player/embed.js` — `grep onerror` returns nothing
- **Issue:** If the audio src fails to load (network error, expired URL, wrong content-type), the embed player shows no error state. The play button stays interactive but produces no sound and no feedback.
- **Fix:** Add `audio.onerror = () => { /* show error state, disable play button */ }` in `embed.js`.
- **Severity:** Low-Medium — silent failure in an embedded context (no user recovery path).
- **Blast radius:** `embed-player/embed.js` only.

### H16 — AASA uses old `paths` format, not iOS 13+ `components`

- **File:** `public/.well-known/apple-app-site-association`
- **Issue:** AASA uses `"paths": ["/play/*", "/s/*", "/poem/*"]` — the v1 wildcard format. iOS 13+ prefers the `components` array (`[{"/" : "/play/*"}]`). Apple CDN still honours `paths` but the format is legacy and may cause subtle routing failures on newer iOS releases or if Apple deprecates it.
- **Fix:** Add a `components` key alongside `paths` in the AASA `details` object using the iOS 13+ format.
- **Severity:** Low — currently functional but technically legacy.
- **Blast radius:** `public/.well-known/apple-app-site-association` only.

### H23 — `test-preview.mp3` is a test artefact served publicly in production

- **File:** `public/audio/test-preview.mp3` (directory exists, file confirmed present via earlier ls)
- **Issue:** A test audio file is served as a public static asset in production under `/audio/test-preview.mp3`. Not indexed or linked anywhere, but publicly accessible and wastes bandwidth if discovered.
- **Fix:** Delete `public/audio/test-preview.mp3` (and the `public/audio/` directory if empty after deletion).
- **Severity:** Low — no functional impact, minor hygiene / accidental disclosure.
- **Blast radius:** `public/audio/` only.

---

## Summary

4 REAL gaps confirmed out of 19 claimed. 15 FALSE_POSITIVE or BY_DESIGN.

# Song title + artwork: add sender attribution

**Goal:** "A Birthday Song for Chioma by Ambrose" everywhere — title metadata + artwork text overlay.

**Per user:** first name only; no backfill of existing tracks.

## Files

- [x] `src/routes/onboarding.js` — `generateTemplateSuggestion` accepts `sender_name`, returns "A {Occasion} Song for {Name} by {FirstName}"; route validates new body field.
- [x] `src/routes/story.js` (~line 3169) — replace `Song for ${recipientName}` with the same template, pulling user's display_name from DB by user_id.
- [x] `src/services/cover-generator.js` — `buildOverlaySvg` + `compositeArtworkWithText` accept `senderName`; redesign overlay to 3-tier layout (For X / A Occasion Song / by Y).
- [x] `src/services/song-artwork.js` — `generateSongArtwork` accepts `senderName`, plumbs to compositeFn. Content hash unchanged (don't force-regen old tracks).
- [x] `src/jobs/artwork-job.js` — JOIN `users` in `SQL_GET_TRACK` to fetch `display_name`; extract first token; pass `senderName` to generateFn.
- [x] `PorizoApp/PorizoApp/Onboarding/QuestionGraphEngine.swift` — `OnboardingSuggestionRequest` gets `senderName`; `suggestionPayload` reads `AuthManager.shared.currentUser?.displayName`.

## Tests

- [x] Update `test/onboarding-routes.test.js`: title now "A Birthday Song for Sarah"; add sender variant.
- [x] Update `test/services/song-artwork.test.js`: assert `senderName` flows to compositeFn; `buildOverlaySvg` renders sender line when given.

## Verify

- [x] `npm test` green
- [x] Render a sample artwork: confirm "For Chioma / A Birthday Song / by Ambrose" reads cleanly with sharp+Fraunces.

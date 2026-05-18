# Web Player — Letterbox Redesign · Implementation Plan

**Date:** 2026-05-18
**Direction chosen:** D — Letterbox (cinema projection, Velvet & Gold)
**Implementation correction:** one player only. Letterbox is a feature-flagged mode on the existing `#player`, not a duplicate player screen or alternate audio/share implementation.
**Mockup:** `~/.gstack/projects/computa-porizo/designs/player-redesign-20260518-0711/D-letterbox-final.html`
**Direction archived:** A — Quiet Devotion (`later-options/A-quiet-devotion-r3.html`)
**Enhancement record:** `~/.gstack/projects/computa-porizo/designs/player-redesign-20260518-0711/ENHANCEMENTS.md`

---

## Goal

Replace the visual treatment of the current Porizo web player at `/play/:shareId` with the Letterbox design. Achieve cinema-projection feel for received song-gifts while preserving the existing player’s single audio element, HLS setup, teaser fallback, error / expired / claim-locked states, share / save actions, post-play CTA, and oEmbed previews.

## Success criteria

- Pixel-faithful render of `D-letterbox-final.html` on desktop (`≥ 1024px`)
- Mobile (≤ 768px) preserves cinema feel via a "tall window" adaptation without crushing readability
- Zero regressions in: load / error / expired / teaser / claim-locked states
- HLS streaming continues to work on Chrome / Safari / Firefox / iOS Safari / Android Chrome
- All existing tests in `test/share-embed.test.js` pass; new tests added for chapter data
- `prefers-reduced-motion: reduce` disables: opening curtain, Ken Burns, play-marker pulse, reel-change cue dots
- Lighthouse: Performance ≥ 85, A11y ≥ 95 on a real share URL
- Active DB-backed feature flags returned in `/share/:shareId` allow instant rollback. The client also supports `?letterbox=1` for QA without enabling rollout.

## Scope

### In

- Additive Velvet & Gold CSS under `#player.letterbox`, while retaining the old player styles for rollback.
- Restructured internals of the existing `#player` screen only. No sibling `#player`, no second audio element, and no second share/save pipeline.
- Updated `web-player/player.js`: letterbox mode setup + frame counter + waveform generation + opening curtain + subtitle lyric pacing, all wired to the existing HLS, progress, share, and save handlers.
- New optional API field `chapter_markers` in `/share/:shareId` response, derived from `lyrics_json` sections when present
- Feature flags `web_player_letterbox_enabled` and `web_player_letterbox_rollout_percent` in `feature_flags` table
- Cache-bust `?v=20260518-letterbox`

### Out (deferred or rejected)

- Direction A (saved to `later-options/`)
- Backend audio waveform generation (the on-screen waveform stays procedural)
- iOS / Android in-app player UI
- Onboarding / signup changes
- Re-skinning loading / error / expired / teaser screens (they get a sympathetic Velvet & Gold token swap only — not a structural redesign)

---

## Architecture

### File map

| File                                          | Action                                                                                                                                      | Risk |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `web-player/index.html`                       | Add Letterbox-only helper elements inside the existing `#player`; reuse current button/progress/share/save elements                          | Low  |
| `web-player/styles.css`                       | Add Velvet & Gold token block and `#player.letterbox` styles. Old styles remain available when the flag is off                              | Low  |
| `web-player/player.js`                        | Add `applyLetterboxMode()` helpers. Existing player initialization, HLS, share handlers, and audio event binding remain the source of truth  | Med  |
| `src/routes/sharing.js`                       | Add `chapter_markers` and `feature_flags` fields to `/share/:shareId` JSON response. Helper `deriveChapterMarkers(lyricsJson, durationMs)`. | Low  |
| `src/services/feature-flags.js`               | Add web player feature flag defaults                                                                                                        | Low  |
| `test/share-embed.test.js`                    | Add test for `chapter_markers` presence + derivation                                                                                        | Low  |
| `migrations/pg/112_letterbox_player_flag.sql` | INSERT INTO feature_flags rows                                                                                                              | Low  |

### Data flow

```
GET /share/:shareId → JSON
   ↓
player.js readShareData():
   - trackInfo.player_artwork_url   ✓ exists
   - trackInfo.title                 ✓ exists
   - trackInfo.recipient_name        ✓ exists
   - trackInfo.occasion              ✓ exists (drives slate M.DAY / B.DAY / A.DAY mapping)
   - trackInfo.sender_name           ✓ exists (player.js:255, sharing.js:1586)
   - trackInfo.created_at            ✓ exists (drives slate REL. year)
   - trackInfo.duration_ms           ✓ exists (drives frame counter total + chapter math)
   - shareData.lyrics                ✓ exists (drives subtitle + chapter derivation)
   - trackInfo.chapter_markers       ★ NEW (optional; falls back to derivation)
   ↓
applyLetterboxMode(shareData):
   1. Add `.letterbox` to the existing `#player`. Set CSS var `--player-artwork-url`.
   2. Populate Letterbox helper nodes: slate, voice line, frame counter, subtitle band, burn-in timecode, waveform, chapter ticks.
   3. Reuse the current title, recipient, play button, progress bar, share buttons, Save link, toast, and post-play CTA nodes.
   4. Keep `setupAudioPlayer()` as the only place that attaches HLS and audio events.
   5. Update Letterbox visual-only state from existing audio events and `timeupdate`.
   6. On flag off, remove `.letterbox` and leave the existing player unchanged.
```

---

## Phases (sequenced, each independently testable)

### Phase 1 — Token foundation (1-2h)

- Add Velvet & Gold CSS custom properties at `:root`
- Import Playfair Display + DM Mono in `index.html` alongside existing fonts
- Define `--player-artwork-url` CSS var; set via JS at player init
- **Verify:** old player renders identically (no visual change yet, only tooling)

### Phase 2 — Letterbox shell behind feature flag (2-3h)

- In `index.html`, add Letterbox helper nodes inside the existing `#player`: `.letterbox-frame > .letterbox-top + .letterbox-cinema + .letterbox-bottom`
- The existing `#player` remains the only player and the existing chrome remains the default when the flag is off
- `applyLetterboxMode()` in player.js toggles the `letterbox` class based on `/share/:shareId` feature flags, rollout bucketing, or `?letterbox=1`
- Opening-curtain initial state via grid-template-rows transition
- **Verify:** flag off → old player. Flag on → letterbox shell loads with placeholder content.

### Phase 3 — Subtitle lyrics (2-3h)

- Replace the `.lyrics-stage > .lyrics-scroll` rendering (full-viewport scroll) with cinema subtitle band when letterbox is active
- Reuse `estimateLineTiming()` and `audio.timeupdate` events
- `.prev-line` shows the line that just ended; `.active-line` shows current with `SARAH —` speaker prefix
- Soft reading veil + 3-layer text-shadow + gold hairline marker beneath active
- **Verify:** lyrics update with audio progress, readable over the floral

### Phase 4 — Cinema chrome (1-2h)

- Slate: `POR · {occasionShort} · TRACK {NNN} · REL. {YYYY} · 24 FPS · STEREO`
  - `occasionShort` map: `mothers_day → M.DAY`, `birthday → B.DAY`, `anniversary → A.DAY`, `valentines → V.DAY`, `christmas → XMAS`, `wedding → WED.`, fallback → `ORIG`
  - `TRACK NNN` from `track_id` last 3 chars
- Indicator: gold play-marker (pulse only, no blink, no red), `In {sender_name}'s voice`, separator, frame counter
- SMPTE color bars (static, decorative)
- Anamorphic marker (rotated -90°)
- Reel-change cue dots (14s loop, blink ~280ms)
- Corner reticles (fade in after curtain opens)
- **Verify:** all chrome renders, frame counter ticks at 12fps, no recording-side language

### Phase 5 — Bottom transport (2h)

- Aperture play button (SVG concentric rings + triangle, hover rotates 45°)
- Progress bar + dot, scrubbable
- Waveform: SVG built via `createElementNS` + `DocumentFragment` (no innerHTML), 220 rects, two layers (base + clipped played-portion synced to progress%)
- Chapter ticks from `chapter_markers` field OR derived from lyrics section indices
- Burn-in timecode lower-right of cinema zone (SMPTE format `01:MM:SS:FF`)
- Share pills: Copy Link, WhatsApp, X, Save (Apple Wallet) — wire to existing handlers
- **Verify:** play/pause works, scrubber drags, chapter hover-labels appear, share buttons all hit correct URLs

### Phase 6 — Mobile adaptation (3-4h)

The letterbox metaphor is widescreen. Three mobile strategies considered:

| Strategy                                                                                      | Verdict                                              |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Tall window** — thin top + bottom black bars (~56px each), portrait-stacked content between | ✓ chosen — preserves cinema feel, adapts to portrait |
| Rotate-prompt                                                                                 | rejected — bad UX, most receivers won't rotate       |
| Different aesthetic on mobile                                                                 | rejected — inconsistent brand                        |

**Mobile-specific changes** (`@media (max-width: 768px)`):

- Letterbox bars compress: top `56px`, bottom `64px` (fixed px, not vh)
- Slate compresses to `POR · M.DAY` only (drops `TRACK` / `REL.` / `24 FPS` / `STEREO`)
- Indicator drops the frame counter (keeps play-marker + sender voice line)
- SMPTE bars hidden on mobile (luxury chrome — costs more than gives)
- Anamorphic marker hidden on mobile (rotated text loses meaning without widescreen)
- Reel-change cue dots stay (cinema-correct on any aspect)
- Cinema zone: artwork fills top 50%, title block + subtitle stack vertically in lower 50%
- Burn-in timecode: smaller, repositioned beneath the title
- Bottom bar: aperture play + scrubber + a single "Share" pill that opens a native share sheet (`navigator.share`)
- Subtitle font sizes: active 22px (down from 27px), prev 16px (down from 19px)

Sub-breakpoint (`@media (max-width: 480px)`): tighten paddings.

### Phase 7 — Backend `chapter_markers` (2h)

- `src/routes/sharing.js`: add `chapter_markers: [{label, t_ms}]` field to `/share/:shareId` response
- Implementation:
  - If `lyrics_json` has section markers (verse/chorus/bridge tags on lines), use line timing × FPS to compute t_ms for each section start
  - Else: derive heuristic — divide duration into 5 equal chapter buckets labeled `Intro / Verse / Chorus / Verse / Outro`
  - Cap at 6 chapters max
- Test: `test/share-embed.test.js` — assert field exists and is an array

### Phase 8 — Cleanup + a11y motion (1-2h)

- Do not strip old player CSS until Letterbox reaches 100% and old mode is deliberately removed. During this implementation, only hide atmosphere layers when `#player.letterbox` is active.
- `prefers-reduced-motion: reduce` overrides:
  - Opening curtain → fade-in only (no row-height animation)
  - Reel-change cue dots → static (no blink)
  - Ken Burns on artwork → static
  - Play-marker pulse → static at full opacity
  - Subtitle rise transition → instant
- Update cache-bust to `?v=20260518-letterbox`
- Audit color contrast: gold-on-black AA, ivory-on-floral AA via shadow halos

### Phase 9 — Testing + verification (2-3h)

- Local: full flow against `Rrm8PRM3tlwV` test share
- Viewports: 390×844, 320×568, 768×1024, 1024×768, 1280×800, 1920×1080
- Browsers: Chrome, Safari, Firefox, iOS Safari (simulator), Android Chrome (emulator)
- HLS playback verified
- All share pill destinations
- `navigator.share` sheet on mobile
- Apple Wallet `Save` pass
- Run `npm test`
- Production verification protocol: `curl -sI` and live browser session against `api.porizo.co/play/iqVdvGx8MteC?letterbox=1`

### Phase 10 — Gradual rollout (over 1 week)

- Day 0: feature flag on for internal accounts (1%)
- Day 2: 10% if no regressions
- Day 4: 50%
- Day 7: 100%
- Each step: check Railway error logs, Sentry, share access logs

---

## Implementation progress

- [x] (2026-05-18 15:45 AWST) Reviewed the original plan, mockup, current web player, feature flag service, share route, and tests.
- [x] (2026-05-18 16:05 AWST) Corrected the implementation plan to enforce a single existing player: no duplicate `#player`, no second audio element, and no parallel share/save path.
- [x] (2026-05-18 16:45 AWST) Implemented Letterbox as an additive mode on the current player, with feature flags, QA query override, subtitle band, waveform, chapter ticks, cinema chrome, mobile adaptation, and reduced-motion handling.
- [x] (2026-05-18 17:05 AWST) Added backend `chapter_markers`, web player rollout flags, migration `112_letterbox_player_flag.sql`, and route coverage.
- [x] (2026-05-18 17:22 AWST) Ran syntax checks, lint, `git diff --check`, and full `npm test`; all passed.
- [ ] Deploy and run live `agent-browser` QA against a real share using `?letterbox=1`.

---

## Risk register

| Risk                                                     | Likelihood | Impact | Mitigation                                                                             |
| -------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------- |
| HLS regression from chrome rewrite                       | Low        | High   | Phase 2 sets up parallel block; HLS init logic untouched                               |
| Subtitle lyrics feel less alive than scroll              | Med        | Med    | Gold hairline marker + fade transitions on active-line; A/B watch sender re-share rate |
| `lyrics_json` lacks section markers → chapter ticks fail | Med        | Low    | Heuristic fallback (5 equal buckets)                                                   |
| Mobile letterbox cramped                                 | Med        | High   | Phase 6 detailed strategy; QA at 320/390/768                                           |
| Frame counter / cue dots feel busy                       | Low        | Med    | Animations are slow (12fps counter, 14s cue loop); user can hide via reduced-motion    |
| Velvet & Gold palette too dark for some recipients       | Low        | Low    | A saved as later-options; could A/B in the future                                      |
| New cache-bust collides with `?v=20260517-artwork6`      | Low        | Low    | Sequential: `20260518-letterbox`                                                       |
| Backend chapter_markers adds DB query cost               | Low        | Low    | Derivation is in-memory from existing `lyrics_json`                                    |
| Feature flag rollout exposes bug to small fraction       | Low        | Med    | Flag allows instant 100% → 0% rollback                                                 |
| Opening curtain triggers on every page nav (annoying)    | Med        | Low    | Optional `sessionStorage` flag to play once per session                                |

---

## Locked implementation decisions

1. **Feature flag rollout** — default off, with DB-backed `web_player_letterbox_enabled` and deterministic `web_player_letterbox_rollout_percent`. Internal QA uses `?letterbox=1`.
2. **Opening curtain frequency** — once per share per browser session using `sessionStorage`; reduced-motion users skip the curtain.
3. **Mobile share button** — the existing Copy Link button becomes a single native Share button in Letterbox mobile mode when `navigator.share` exists. Desktop keeps Copy Link, WhatsApp, X, Download, and Save.
4. **Sender voice line** — use `In {sender}'s voice`; fall back to `A song for {recipient}`; fall back to `An original song`.
5. **Loading / error / expired / teaser screens** — unchanged in this pass. The redesign touches only the existing `#player` playback surface.

---

## Estimated effort

| Phase                        | Hours                                 |
| ---------------------------- | ------------------------------------- |
| 1. Token foundation          | 1-2                                   |
| 2. Letterbox shell + flag    | 2-3                                   |
| 3. Subtitle lyrics           | 2-3                                   |
| 4. Cinema chrome             | 1-2                                   |
| 5. Bottom transport          | 2                                     |
| 6. Mobile adaptation         | 3-4                                   |
| 7. Backend `chapter_markers` | 2                                     |
| 8. Cleanup + a11y            | 1-2                                   |
| 9. Testing + verification    | 2-3                                   |
| 10. Rollout monitoring       | bg over 1 week                        |
| **Total**                    | **16-23h** dev + 1 week rollout watch |

---

## File-level diff scope

### New files

- `migrations/pg/051_letterbox_player_flag.sql`

### Modified files

- `web-player/index.html` — add letterbox `#player.letterbox` block + new font imports
- `web-player/styles.css` — Velvet & Gold tokens block + new `.letterbox-*` selectors (additive, no deletions in Phase 1-6; deletions only in Phase 8 after flag is at 100%)
- `web-player/player.js` — `renderLetterbox()` function, `subtitleTick()`, `buildWaveform()`, `tickFrameCounter()`, slate / chapter derivation helpers, feature-flag gated init
- `src/routes/sharing.js` — `deriveChapterMarkers()`, `chapter_markers` in response
- `src/services/feature-flags.js` — `web_player_letterbox_enabled` flag default off and `web_player_letterbox_rollout_percent` default 0
- `test/share-embed.test.js` — `chapter_markers` test

Unchanged: HLS init, error / expired / teaser screens, share-bar handlers, post-play CTA, Apple Wallet pass.

# Web Player Living Artwork Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subtle playback-driven "living artwork" motion to the web player while keeping the canonical artwork asset static and uninterrupted.

**Architecture:** Artwork generation remains unchanged: one static image is still used for social cards, lock screen artwork, thumbnails, and player display. The web player applies runtime CSS motion classes to the existing artwork image and its behind-image aura only after real audio playback is confirmed, with default-off rollout, reduced-motion, and page-visibility safety gates.

**Tech Stack:** Vanilla JS (`web-player/player.js`), CSS animations (`web-player/styles.css`), existing Node test suite (`node --test`), `agent-browser` visual QA.

---

## Specialist Review Findings Applied

This plan was reviewed with Oracle as a specialist plan reviewer. The following findings are incorporated:

- **P0 fixed:** motion must be default-off. `?artwork_motion=1` enables QA only when the player is otherwise eligible.
- **P0 fixed:** motion state must follow confirmed audio events (`playing`, `pause`, `ended`, `error`), not an optimistic click-toggle state.
- **P1 fixed:** stale `artwork-motion*` classes must be cleaned on disabled letterbox, missing artwork, failed artwork, reduced motion, hidden tab, and ended playback.
- **P1 fixed:** cached image success must require `img.complete && img.naturalWidth > 0`.
- **P1 fixed:** full-screen blurred aura animation is disabled on mobile for v1.
- **P1 fixed:** helper tests move to a focused `test/web-player-motion-helpers.test.js` file instead of the heavy share/embed integration test.
- **P1 fixed:** reduced-motion listener uses `addEventListener` with `addListener` fallback for older Safari.
- **P2 fixed:** QA instructions explicitly avoid publishing/sharing QA URLs and confirm social metadata still uses static artwork.
- **Reviewed but not adopted:** the reviewer suggested not fixing unrelated full-suite failures. Repository instructions say full-repo validation failures are in-scope unless Ambrose explicitly says otherwise, so this plan keeps the stricter repo rule.

---

## File Structure

- Modify `web-player/player.js`
  - Add pure helper functions for motion profile selection, motion eligibility, and QA rollout gating.
  - Drive `isPlaying` from audio events via a single playback-state setter.
  - Toggle CSS classes on the existing `#player` element.
  - Add page visibility listener so motion pauses while the tab is hidden.
  - Use existing `letterbox-playing` plus new `artwork-motion*` classes; no duplicate player.

- Modify `web-player/styles.css`
  - Add CSS-only living artwork animations scoped to `#player.letterbox.letterbox-playing.artwork-motion`.
  - Animate only foreground `transform` and a low-opacity behind-image aura.
  - Disable blurred aura animation on mobile.
  - Disable all artwork motion in `prefers-reduced-motion`.

- Modify `web-player/index.html`
  - Bump CSS and JS asset query versions after implementation.

- Create `test/web-player-motion-helpers.test.js`
  - Focused unit tests for pure web-player helper functions.

- No changes to artwork generation, Open Graph images, share payloads, lock-screen metadata, or HLS/audio source setup.

---

## Product Contract

- Static artwork remains the master asset.
- Motion exists only in the web player runtime.
- Motion is off by default and only enabled with `?artwork_motion=1` in v1.
- Motion starts only after the audio element fires `playing`.
- Motion stops on `pause`, `ended`, `error`, hidden tab, missing/broken artwork, disabled letterbox, or reduced motion.
- The main artwork may slowly scale/drift, but no overlay may cover the flower/image.
- Behind-artwork aura may breathe on desktop only, with very low opacity.
- First version is CSS-only. No Web Audio analyser, canvas, Lottie, GIF, generated MP4, or per-track animated asset.

---

## Task 1: Add Focused Motion Helper Tests

**Files:**
- Create: `test/web-player-motion-helpers.test.js`
- Modify: `web-player/player.js`

- [ ] **Step 1: Create failing focused helper test file**

Create `test/web-player-motion-helpers.test.js`:

```js
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB_PLAYER_SCRIPT = path.join(__dirname, "..", "web-player", "player.js");

function extractWebPlayerFunction(name) {
  const source = fs.readFileSync(WEB_PLAYER_SCRIPT, "utf8");
  const match = source.match(
    new RegExp(`  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`),
  );
  assert.ok(match, `Expected to find ${name} in web-player/player.js`);
  return vm.runInNewContext(`${match[0]}\n${name};`);
}

describe("web player artwork motion helpers", () => {
  test("normalizeArtworkMotionProfile maps occasion-specific motion", () => {
    const normalizeArtworkMotionProfile = extractWebPlayerFunction(
      "normalizeArtworkMotionProfile",
    );

    assert.equal(normalizeArtworkMotionProfile("mothers_day"), "soft-breathe");
    assert.equal(normalizeArtworkMotionProfile("Mother Day"), "soft-breathe");
    assert.equal(normalizeArtworkMotionProfile("Mother's Day"), "soft-breathe");
    assert.equal(normalizeArtworkMotionProfile("birthday"), "warm-pulse");
    assert.equal(
      normalizeArtworkMotionProfile("anniversary"),
      "cinematic-drift",
    );
    assert.equal(
      normalizeArtworkMotionProfile("Valentine's Day"),
      "cinematic-drift",
    );
    assert.equal(normalizeArtworkMotionProfile("memorial"), "near-still");
    assert.equal(normalizeArtworkMotionProfile("apology"), "near-still");
    assert.equal(
      normalizeArtworkMotionProfile("unknown_custom"),
      "soft-breathe",
    );
  });

  test("shouldEnableArtworkMotion respects playback, artwork, accessibility, and visibility", () => {
    const shouldEnableArtworkMotion = extractWebPlayerFunction(
      "shouldEnableArtworkMotion",
    );

    const base = {
      letterboxEnabled: true,
      isPlaying: true,
      hasArtwork: true,
      prefersReducedMotion: false,
      documentHidden: false,
    };

    assert.equal(shouldEnableArtworkMotion(base), true);
    assert.equal(
      shouldEnableArtworkMotion({ ...base, letterboxEnabled: false }),
      false,
    );
    assert.equal(shouldEnableArtworkMotion({ ...base, isPlaying: false }), false);
    assert.equal(shouldEnableArtworkMotion({ ...base, hasArtwork: false }), false);
    assert.equal(
      shouldEnableArtworkMotion({ ...base, prefersReducedMotion: true }),
      false,
    );
    assert.equal(
      shouldEnableArtworkMotion({ ...base, documentHidden: true }),
      false,
    );
  });

  test("shouldAllowArtworkMotionByRollout is default-off unless overridden on", () => {
    const shouldAllowArtworkMotionByRollout = extractWebPlayerFunction(
      "shouldAllowArtworkMotionByRollout",
    );

    assert.equal(shouldAllowArtworkMotionByRollout(null), false);
    assert.equal(shouldAllowArtworkMotionByRollout(false), false);
    assert.equal(shouldAllowArtworkMotionByRollout(true), true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/web-player-motion-helpers.test.js
```

Expected: failure saying `Expected to find normalizeArtworkMotionProfile in web-player/player.js`.

- [ ] **Step 3: Add helper implementations**

Add these functions in `web-player/player.js` after `normalizeOccasionShort`:

```js
function normalizeArtworkMotionProfile(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const map = {
    mothers_day: "soft-breathe",
    mother_day: "soft-breathe",
    birthday: "warm-pulse",
    anniversary: "cinematic-drift",
    valentines: "cinematic-drift",
    valentines_day: "cinematic-drift",
    valentine: "cinematic-drift",
    valentine_day: "cinematic-drift",
    wedding: "cinematic-drift",
    memorial: "near-still",
    sympathy: "near-still",
    apology: "near-still",
  };
  return map[normalized] || "soft-breathe";
}

function shouldEnableArtworkMotion(state) {
  return Boolean(
    state &&
      state.letterboxEnabled &&
      state.isPlaying &&
      state.hasArtwork &&
      !state.prefersReducedMotion &&
      !state.documentHidden,
  );
}

function shouldAllowArtworkMotionByRollout(override) {
  return override === true;
}
```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
node --test test/web-player-motion-helpers.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web-player/player.js test/web-player-motion-helpers.test.js
git commit -m "Add living artwork motion helpers"
```

---

## Task 2: Make Playback State Event-Driven

**Files:**
- Modify: `web-player/player.js`

- [ ] **Step 1: Add a single playback-state setter**

Add this before `togglePlay()`:

```js
function setMainPlaybackState(nextIsPlaying) {
  isPlaying = Boolean(nextIsPlaying);
  updatePlayButton();
}
```

- [ ] **Step 2: Refactor `togglePlay()` so clicks request playback but do not assert playback**

Replace the existing `togglePlay()` body with:

```js
function togglePlay() {
  const audio = elements.audioPlayer;
  if (!audio) return;

  if (!audio.paused && !audio.ended) {
    audio.pause();
    return;
  }

  audio.play().catch((e) => {
    console.error("Playback error:", e);
    setMainPlaybackState(false);
    stopAtmosphere();
  });
}
```

- [ ] **Step 3: Move playback truth into audio events**

In `setupAudioPlayer()`, ensure these listeners exist and use `setMainPlaybackState()`:

```js
audio.addEventListener("playing", () => {
  setMainPlaybackState(true);
  hidePostPlayCta();
  if (!letterboxEnabled) startAtmosphere();
  if (!playStartedLogged) {
    playStartedLogged = true;
    safeRecordReceiverEvent("receiver_play_started", {
      placement: "player",
    });
  }
});

audio.addEventListener("pause", () => {
  setMainPlaybackState(false);
  stopAtmosphere();
});

audio.addEventListener("ended", () => {
  setMainPlaybackState(false);
  stopAtmosphere();
  elements.progressFill.style.width = "0%";
  updateLetterboxProgress(0, audio.duration);
  audio.currentTime = 0;
  activeLineIndex = -1;
  updateLetterboxSubtitle(-1);
  cachedLineEls.forEach((el) => {
    el.classList.remove("active");
    el.classList.remove("sung");
  });
  cachedLabelEls.forEach((el) => el.classList.remove("active-section"));
  const lyricsScroll = document.getElementById("lyrics-scroll");
  if (lyricsScroll) lyricsScroll.scrollTop = 0;
  showPostPlayCta();
  if (!playCompletedLogged) {
    playCompletedLogged = true;
    safeRecordReceiverEvent("receiver_play_completed", {
      placement: "player",
    });
  }
});

audio.addEventListener("error", (e) => {
  console.error("Audio error:", e);
  setMainPlaybackState(false);
  stopAtmosphere();
  showError("Unable to play this audio. Please try again.");
});
```

Delete the old `play`, `pause`, `ended`, and `error` listener bodies that conflict with these replacements. Keep the existing `loadedmetadata`, `timeupdate`, and progress-bar seek listeners.

- [ ] **Step 4: Run syntax check**

Run:

```bash
node --check web-player/player.js
```

Expected: no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add web-player/player.js
git commit -m "Drive web player playback state from audio events"
```

---

## Task 3: Wire Default-Off Artwork Motion State

**Files:**
- Modify: `web-player/player.js`

- [ ] **Step 1: Add motion state variables**

Near the existing letterbox state variables in `web-player/player.js`, add:

```js
let artworkMotionProfile = "soft-breathe";
let documentHidden = document.hidden;
```

- [ ] **Step 2: Add motion URL override helper**

Add this near `getLetterboxOverride()`:

```js
function getArtworkMotionOverride() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("artwork_motion");
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}
```

- [ ] **Step 3: Add artwork availability helper**

Add this after `applyLetterboxMode()`:

```js
function setPlayerArtworkAvailable(available) {
  if (!elements.player) return;
  elements.player.classList.toggle("has-player-artwork", Boolean(available));
  if (!available) {
    elements.player.style.removeProperty("--player-artwork-url");
  }
  updateArtworkMotionState();
}
```

- [ ] **Step 4: Add motion state updater**

Add this after `setPlayerArtworkAvailable()`:

```js
function updateArtworkMotionState() {
  if (!elements.player) return;

  const override = getArtworkMotionOverride();
  const hasArtwork = elements.player.classList.contains("has-player-artwork");
  const eligible = shouldEnableArtworkMotion({
    letterboxEnabled,
    isPlaying,
    hasArtwork,
    prefersReducedMotion,
    documentHidden,
  });
  const enabled = shouldAllowArtworkMotionByRollout(override) && eligible;

  elements.player.classList.toggle("artwork-motion", enabled);
  elements.player.classList.toggle(
    "artwork-motion-soft-breathe",
    enabled && artworkMotionProfile === "soft-breathe",
  );
  elements.player.classList.toggle(
    "artwork-motion-warm-pulse",
    enabled && artworkMotionProfile === "warm-pulse",
  );
  elements.player.classList.toggle(
    "artwork-motion-cinematic-drift",
    enabled && artworkMotionProfile === "cinematic-drift",
  );
  elements.player.classList.toggle(
    "artwork-motion-near-still",
    enabled && artworkMotionProfile === "near-still",
  );
}
```

- [ ] **Step 5: Set profile when track metadata loads**

Inside `setLetterboxMeta(trackInfo)`, after occasion/year/voice setup, add:

```js
artworkMotionProfile = normalizeArtworkMotionProfile(trackInfo.occasion);
```

- [ ] **Step 6: Make `applyLetterboxMode()` clean motion classes on every branch**

Ensure `applyLetterboxMode()` calls `updateArtworkMotionState()` before every return:

```js
function applyLetterboxMode() {
  letterboxEnabled = shouldUseLetterbox();
  if (!elements.player) return;

  elements.player.classList.toggle("letterbox", letterboxEnabled);
  syncDocumentChrome();

  if (!letterboxEnabled) {
    elements.player.classList.remove("letterbox-opened");
    elements.player.classList.remove("letterbox-playing");
    updateArtworkMotionState();
    return;
  }

  setLetterboxMeta();
  buildLetterboxWaveform();
  buildLetterboxChapters();
  updateLetterboxSubtitle(activeLineIndex);
  updateLetterboxProgress(0, getDurationSeconds(getTrackInfo()));
  markLetterboxCurtainOpened();
  updateArtworkMotionState();
}
```

- [ ] **Step 7: Use artwork availability helper in `applyPlayerArtwork()`**

Update `applyPlayerArtwork()` callbacks and cached-image branch:

```js
if (!elements.player || !elements.playerArtworkImage || !artworkUrl) {
  setPlayerArtworkAvailable(false);
  return;
}

elements.player.style.setProperty(
  "--player-artwork-url",
  `url(${JSON.stringify(artworkUrl)})`,
);

elements.playerArtworkImage.onload = function () {
  setPlayerArtworkAvailable(true);
};

elements.playerArtworkImage.onerror = function () {
  elements.playerArtworkImage.removeAttribute("src");
  setPlayerArtworkAvailable(false);
};

if (elements.playerArtworkImage.getAttribute("src") !== artworkUrl) {
  elements.playerArtworkImage.src = artworkUrl;
} else {
  setPlayerArtworkAvailable(
    elements.playerArtworkImage.complete &&
      elements.playerArtworkImage.naturalWidth > 0,
  );
}
```

- [ ] **Step 8: Recompute motion on play/pause UI updates**

At the end of `updatePlayButton()`, add:

```js
updateArtworkMotionState();
```

- [ ] **Step 9: Run focused helper tests**

Run:

```bash
node --test test/web-player-motion-helpers.test.js
node --check web-player/player.js
```

Expected: helper tests pass and syntax check passes.

- [ ] **Step 10: Commit**

```bash
git add web-player/player.js test/web-player-motion-helpers.test.js
git commit -m "Wire default-off artwork motion state"
```

---

## Task 4: Harden Reduced-Motion and Visibility Lifecycle

**Files:**
- Modify: `web-player/player.js`

- [ ] **Step 1: Extract reduced-motion handler with Safari fallback**

Replace the inline `motionQuery.addEventListener("change", ...)` setup with:

```js
function clearLegacyAtmosphereLayers() {
  var petalLayer = document.getElementById("petal-layer");
  var bokehLayer = document.getElementById("bokeh-layer");
  if (petalLayer) {
    while (petalLayer.firstChild) petalLayer.removeChild(petalLayer.firstChild);
  }
  if (bokehLayer) {
    while (bokehLayer.firstChild) bokehLayer.removeChild(bokehLayer.firstChild);
  }
}

function handleReducedMotionChange(e) {
  prefersReducedMotion = e.matches;
  if (e.matches) {
    stopAtmosphere();
    clearLegacyAtmosphereLayers();
  }
  updateArtworkMotionState();
}

if (motionQuery.addEventListener) {
  motionQuery.addEventListener("change", handleReducedMotionChange);
} else if (motionQuery.addListener) {
  motionQuery.addListener(handleReducedMotionChange);
}
```

- [ ] **Step 2: Add page visibility listener**

Near `bindEvents()`, add:

```js
function bindVisibilityEvents() {
  document.addEventListener("visibilitychange", function () {
    documentHidden = document.hidden;
    updateArtworkMotionState();
  });
}
```

Then in `init()`, before `initializePlayer();`, add:

```js
bindVisibilityEvents();
```

- [ ] **Step 3: Run syntax check**

Run:

```bash
node --check web-player/player.js
```

Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add web-player/player.js
git commit -m "Harden artwork motion lifecycle gates"
```

---

## Task 5: Add CSS-Only Living Artwork Animations

**Files:**
- Modify: `web-player/styles.css`

- [ ] **Step 1: Add conservative animation keyframes**

Add this near the existing letterbox CSS keyframes:

```css
@keyframes artworkSoftBreathe {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
  }
  50% {
    transform: translateX(-50%) translate3d(0, -0.25%, 0) scale(1.008);
  }
}

@keyframes artworkWarmPulse {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
  }
  45% {
    transform: translateX(-50%) translate3d(0, -0.25%, 0) scale(1.01);
  }
}

@keyframes artworkCinematicDrift {
  0% {
    transform: translateX(-50%) translate3d(0, 0.18%, 0) scale(1.002);
  }
  100% {
    transform: translateX(-50%) translate3d(0, -0.35%, 0) scale(1.012);
  }
}

@keyframes artworkNearStill {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
  }
  50% {
    transform: translateX(-50%) translate3d(0, -0.12%, 0) scale(1.004);
  }
}

@keyframes artworkAuraBreathe {
  0%,
  100% {
    opacity: 0.055;
    transform: scale(1.06);
  }
  50% {
    opacity: 0.085;
    transform: scale(1.08);
  }
}
```

- [ ] **Step 2: Add scoped motion classes guarded by playback**

Add these after the current `#player.letterbox .player-artwork-backdrop::after` rule:

```css
#player.letterbox.letterbox-playing.artwork-motion .player-artwork-image {
  will-change: transform;
}

#player.letterbox.letterbox-playing.artwork-motion .player-artwork-backdrop::before {
  animation: artworkAuraBreathe 34s ease-in-out infinite;
  will-change: transform, opacity;
}

#player.letterbox.letterbox-playing.artwork-motion-soft-breathe
  .player-artwork-image {
  animation: artworkSoftBreathe 38s ease-in-out infinite;
}

#player.letterbox.letterbox-playing.artwork-motion-warm-pulse
  .player-artwork-image {
  animation: artworkWarmPulse 30s ease-in-out infinite;
}

#player.letterbox.letterbox-playing.artwork-motion-cinematic-drift
  .player-artwork-image {
  animation: artworkCinematicDrift 46s ease-in-out alternate infinite;
}

#player.letterbox.letterbox-playing.artwork-motion-near-still
  .player-artwork-image {
  animation: artworkNearStill 52s ease-in-out infinite;
}
```

- [ ] **Step 3: Disable blurred aura animation on mobile**

Inside the existing `@media (max-width: 768px)` letterbox block, add:

```css
#player.letterbox.letterbox-playing.artwork-motion .player-artwork-backdrop::before {
  animation: none;
  will-change: auto;
}
```

- [ ] **Step 4: Keep reduced-motion authoritative**

Inside the existing `@media (prefers-reduced-motion: reduce)` block, add:

```css
#player.letterbox.artwork-motion .player-artwork-image {
  animation: none !important;
  transform: translateX(-50%) !important;
  will-change: auto !important;
}

#player.letterbox.artwork-motion .player-artwork-backdrop::before {
  animation: none !important;
  transform: scale(1.08) !important;
  opacity: 0.07 !important;
  will-change: auto !important;
}
```

- [ ] **Step 5: Run CSS diff check**

Run:

```bash
git diff --check -- web-player/styles.css
```

Expected: no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add web-player/styles.css
git commit -m "Add subtle artwork motion styles"
```

---

## Task 6: Bump Asset Versions and Guard Social Effects

**Files:**
- Modify: `web-player/index.html`

- [ ] **Step 1: Bump player asset version**

In `web-player/index.html`, change the stylesheet query to:

```html
<link rel="stylesheet" href="/web-player/styles.css?v=20260518-artmotion1">
```

If the script tag near the bottom includes `player.js?v=...`, change it to:

```html
<script src="/web-player/player.js?v=20260518-artmotion1"></script>
```

- [ ] **Step 2: Confirm stale asset version is gone**

Run:

```bash
rg "20260518-letterbox10" web-player/index.html
```

Expected: no matches.

- [ ] **Step 3: Confirm Open Graph image remains static artwork**

Run:

```bash
rg "og:image|twitter:image|apple-touch-icon|OG_IMAGE" web-player/index.html
```

Expected: those tags still reference `{{OG_IMAGE}}`; no animated asset, `artwork_motion`, or player CSS/JS URL appears in social metadata.

- [ ] **Step 4: Run diff check**

Run:

```bash
git diff --check -- web-player/index.html
```

Expected: no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add web-player/index.html
git commit -m "Bump web player artwork motion assets"
```

---

## Task 7: Browser QA Before Rollout

**Files:**
- No source edits unless QA finds a defect.

- [ ] **Step 1: Open production QA URL**

Do not publish or share this URL externally; query params may be cached by social crawlers if manually posted.

Run:

```bash
agent-browser --session porizo-artwork-motion open "https://api.porizo.co/play/iqVdvGx8MteC?letterbox=1&artwork_motion=1&codex_tag=artwork-motion"
```

Expected: player loads with letterbox mode and the current static flower artwork visible.

- [ ] **Step 2: Verify page identity, asset version, and no blank screen**

Run:

```bash
agent-browser --session porizo-artwork-motion eval "JSON.stringify({url: location.href, title: document.title, playerClass: document.getElementById('player')?.className, artworkSrc: document.getElementById('player-artwork-image')?.currentSrc || document.getElementById('player-artwork-image')?.src, css: [...document.styleSheets].map(s => s.href).filter(Boolean)})"
```

Expected:
- URL contains `letterbox=1`.
- `playerClass` contains `letterbox`.
- `artworkSrc` is non-empty.
- CSS URL includes `20260518-artmotion1`.

- [ ] **Step 3: Verify motion starts only after actual playback**

Click the play button in the browser session, wait two seconds, then run:

```bash
agent-browser --session porizo-artwork-motion eval "JSON.stringify({paused: document.getElementById('audio-player')?.paused, className: document.getElementById('player')?.className, transform: getComputedStyle(document.getElementById('player-artwork-image')).transform, animationName: getComputedStyle(document.getElementById('player-artwork-image')).animationName})"
```

Expected:
- `paused === false`.
- `className` contains `letterbox-playing`.
- `className` contains `artwork-motion`.
- `animationName` is one of `artworkSoftBreathe`, `artworkWarmPulse`, `artworkCinematicDrift`, or `artworkNearStill`.
- The artwork is visually centered and not covered by overlays.

- [ ] **Step 4: Verify pause stops motion**

Click the play button again to pause, wait one second, then run the same eval command.

Expected:
- `paused === true`.
- `className` does not contain `letterbox-playing`.
- `className` does not contain `artwork-motion`.
- `animationName` is `none`.

- [ ] **Step 5: Capture desktop screenshot**

Run:

```bash
agent-browser --session porizo-artwork-motion screenshot /tmp/porizo-artwork-motion-desktop.png
```

Expected: screenshot shows clean centered artwork, readable lyrics, and no side panels covering/subduing the image.

- [ ] **Step 6: Capture mobile screenshot**

Use agent-browser mobile viewport if available. If not, record that limitation and use the current browser viewport only. Do not add Playwright as a project dependency for this feature.

Expected:
- Artwork remains visible and centered.
- Lyrics remain readable.
- Transport controls do not overlap the artwork.
- Blurred aura is not animated on mobile.
- Motion is subtle enough that the frame does not feel busy.

- [ ] **Step 7: Verify reduced-motion behavior if tooling supports it**

If agent-browser supports reduced-motion emulation, enable it and reload the QA URL.

Expected:
- `artwork_motion=1` does not override reduced motion.
- `animationName` is `none`.

If the available tooling cannot emulate reduced motion, state that explicitly in the final handoff.

- [ ] **Step 8: Commit QA fixes if needed**

If QA finds style issues, make the smallest CSS/JS adjustment and commit:

```bash
git add web-player/styles.css web-player/player.js web-player/index.html
git commit -m "Tune artwork motion QA"
```

---

## Task 8: Final Validation and Rollout Decision

**Files:**
- No source edits unless validation fails.

- [ ] **Step 1: Run focused checks**

Run:

```bash
node --check web-player/player.js
node --test test/web-player-motion-helpers.test.js
npm run lint -- web-player/player.js test/web-player-motion-helpers.test.js
git diff --check -- web-player/index.html web-player/player.js web-player/styles.css test/web-player-motion-helpers.test.js
```

Expected:
- `node --check` passes.
- motion helper tests pass.
- lint passes.
- diff check passes.

- [ ] **Step 2: Run full repo test before handoff**

Run:

```bash
npm test
```

Expected: full suite passes. If pre-existing failures appear, repository instructions require treating them as in-scope unless Ambrose explicitly says otherwise.

- [ ] **Step 3: Push current branch**

Run:

```bash
git push
```

Expected: remote branch updated.

- [ ] **Step 4: Rollout recommendation**

Recommend this launch order:

1. Keep default behavior off unless `letterbox=1&artwork_motion=1`.
2. Verify production QA URL after deploy.
3. Show Ambrose desktop and mobile screenshots before enabling motion broadly.
4. Add a backend feature flag only after the QA version is accepted:
   - `web_player_artwork_motion_enabled`
   - `web_player_artwork_motion_rollout_percent`
5. Roll out separately from `web_player_letterbox_enabled`; do not piggyback on the letterbox flag.
6. Monitor player console/logs and share-click conversion before adding audio-reactive motion.

---

## Acceptance Criteria

- Static artwork URLs and generated image pipeline are unchanged.
- Web player adds motion via CSS classes only.
- Artwork motion is default-off without `?artwork_motion=1`.
- Artwork motion starts on confirmed `playing`, not on click.
- Artwork motion stops on pause/end/error/hidden/reduced-motion/missing-artwork.
- Foreground artwork remains centered and uninterrupted.
- No particles, text overlays, or panels cover the artwork.
- Lyrics remain readable during motion.
- Desktop and mobile screenshots show no visual regression.
- Focused tests, lint, syntax check, and full repo tests are run before handoff.

---

## Future Phase Not Included

Audio-reactive glow can be added later using Web Audio `AnalyserNode`, but only after CSS-only motion proves visually useful. The future version should drive a bounded CSS variable like `--audio-energy` behind the image, never on top of the artwork, update no faster than 24fps, and roll out behind a separate flag.

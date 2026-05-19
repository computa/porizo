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

    // Coverage lock: every backend occasion slug (see
    // src/services/artwork-vocab.js OCCASIONS) must have an explicit mapping.
    // A future backend occasion addition should fail this test so the motion
    // map is updated deliberately — silent fall-through to soft-breathe is
    // tonally wrong for somber occasions like bereavement.
    const BACKEND_OCCASION_MAP = {
      mothers_day: "soft-breathe",
      birthday: "warm-pulse",
      anniversary: "cinematic-drift",
      thank_you: "soft-breathe",
      i_love_you: "cinematic-drift",
      wedding: "cinematic-drift",
      graduation: "warm-pulse",
      celebration: "warm-pulse",
      apology: "near-still",
      encouragement: "soft-breathe",
      advice: "near-still",
      bereavement: "near-still",
      friendship: "soft-breathe",
      get_well: "near-still",
      custom: "soft-breathe",
    };
    for (const [slug, profile] of Object.entries(BACKEND_OCCASION_MAP)) {
      assert.equal(
        normalizeArtworkMotionProfile(slug),
        profile,
        `backend occasion "${slug}" must map to "${profile}"`,
      );
    }

    // Display-label and legacy-slug normalization paths
    assert.equal(normalizeArtworkMotionProfile("Mother Day"), "soft-breathe");
    assert.equal(normalizeArtworkMotionProfile("Mother's Day"), "soft-breathe");
    assert.equal(
      normalizeArtworkMotionProfile("Valentine's Day"),
      "cinematic-drift",
    );
    assert.equal(normalizeArtworkMotionProfile("memorial"), "near-still");
    assert.equal(normalizeArtworkMotionProfile("sympathy"), "near-still");

    // Unknown values fall back to soft-breathe (least-jarring default).
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
    assert.equal(
      shouldEnableArtworkMotion({ ...base, isPlaying: false }),
      false,
    );
    assert.equal(
      shouldEnableArtworkMotion({ ...base, hasArtwork: false }),
      false,
    );
    assert.equal(
      shouldEnableArtworkMotion({ ...base, prefersReducedMotion: true }),
      false,
    );
    assert.equal(
      shouldEnableArtworkMotion({ ...base, documentHidden: true }),
      false,
    );
  });

  test("shouldAllowArtworkMotionByRollout is default-on unless explicitly disabled", () => {
    // v2.2 cutover: motion is now default-on for every share. Only an
    // explicit `?artwork_motion=0` URL override turns it off. The other
    // motion gates (playback, artwork loaded, reduced-motion, hidden tab,
    // letterbox enabled) still apply at the outer eligibility layer.
    const shouldAllowArtworkMotionByRollout = extractWebPlayerFunction(
      "shouldAllowArtworkMotionByRollout",
    );

    assert.equal(shouldAllowArtworkMotionByRollout(null), true);
    assert.equal(shouldAllowArtworkMotionByRollout(undefined), true);
    assert.equal(shouldAllowArtworkMotionByRollout(true), true);
    assert.equal(shouldAllowArtworkMotionByRollout(false), false);
  });

  test("every backend occasion has a non-default motion mapping (synergy lock)", () => {
    // Cross-reference the backend's authoritative OCCASIONS list against the
    // motion map. If the backend adds an occasion (e.g. "new_year") and the
    // motion map doesn't, this fails — forcing a deliberate motion choice
    // instead of silently defaulting somber occasions to soft-breathe.
    const { OCCASIONS } = require("../src/services/artwork-vocab");
    const normalizeArtworkMotionProfile = extractWebPlayerFunction(
      "normalizeArtworkMotionProfile",
    );
    // Re-extract the inline map from player.js source via the same VM lookup
    // we use for the function — we want to assert "the slug appears as a key",
    // not "the function happens to return something."
    const source = fs.readFileSync(WEB_PLAYER_SCRIPT, "utf8");
    const fnMatch = source.match(
      /function normalizeArtworkMotionProfile\([^)]*\) \{[\s\S]*?\n  \}/,
    );
    assert.ok(fnMatch, "function block must exist");
    const fnBody = fnMatch[0];
    const missing = OCCASIONS.filter(
      (slug) => !new RegExp(`\\b${slug}\\s*:\\s*"`).test(fnBody),
    );
    assert.deepEqual(
      missing,
      [],
      `backend occasions missing explicit motion mapping in player.js#normalizeArtworkMotionProfile: ${missing.join(", ")}`,
    );
    // Spot check the bereavement fix (the original gap that motivated this lock).
    assert.equal(normalizeArtworkMotionProfile("bereavement"), "near-still");
  });
});

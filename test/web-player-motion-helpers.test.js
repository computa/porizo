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

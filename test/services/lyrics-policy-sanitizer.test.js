const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  scanLyricsForProviderPolicy,
  sanitizeLyricsForProviderPolicy,
} = require("../../src/services/lyrics-policy-sanitizer");

function buildLyrics(lines) {
  return {
    title: "Song for Osita",
    sections: [
      { name: "verse1", lines },
      { name: "chorus", lines: ["Osita, you keep us going"] },
    ],
    anchor_line: "Osita, you keep us going",
  };
}

describe("lyrics policy sanitizer", () => {
  test("flags artist/copyright style references for suno", () => {
    const lyrics = buildLyrics([
      "I want this to sound like Drake tonight",
      "Your light still guides us home",
    ]);

    const scan = scanLyricsForProviderPolicy({ lyrics, provider: "suno" });
    const violationCodes = scan.violations.map((entry) => entry.code);

    assert.ok(violationCodes.includes("POLICY_ARTIST_OR_COPYRIGHT_REFERENCE"));
    assert.equal(scan.provider, "suno");
  });

  test("rewrites risky terms and clears hard blocks deterministically", () => {
    const lyrics = buildLyrics([
      "You carried me from 21 years old to now",
      "I want this to sound like Taylor Swift and Metro Boomin",
      "Family over everything",
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "elevenlabs" });

    assert.equal(result.blocked, false);
    assert.equal(result.changed, true);
    assert.ok(result.change_count > 0);

    const rewritten = result.lyrics.sections[0].lines.join(" ");
    assert.ok(!rewritten.toLowerCase().includes("taylor swift"));
    assert.ok(!rewritten.toLowerCase().includes("metro boomin"));
    assert.ok(!/\b21\b/.test(rewritten));
    assert.ok(rewritten.length > 0);
  });

  test("keeps clean lyrics unchanged", () => {
    const lyrics = buildLyrics([
      "Through winter roads you never let me fall",
      "Your steady voice made every fear feel small",
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno" });

    assert.equal(result.changed, false);
    assert.equal(result.blocked, false);
    assert.deepEqual(result.violations, []);
  });

  test("returns safe no-op for malformed lyrics payload", () => {
    const result = sanitizeLyricsForProviderPolicy({
      lyrics: { title: "Broken payload" },
      provider: "elevenlabs",
    });

    assert.equal(result.changed, false);
    assert.equal(result.blocked, false);
    assert.deepEqual(result.violations, []);
  });
});

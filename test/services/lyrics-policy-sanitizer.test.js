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

  test("uses context-aware replacement when blocked term appears near place words", () => {
    const lyrics = buildLyrics([
      "We met at Madonna University, Okija",
      "Sun so bright that day",
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno" });

    assert.equal(result.changed, true);
    const rewritten = result.lyrics.sections[0].lines[0];
    assert.ok(!rewritten.toLowerCase().includes("madonna"), `Expected "madonna" removed, got: ${rewritten}`);
    assert.ok(rewritten.toLowerCase().includes("the campus"), `Expected "the campus" replacement, got: ${rewritten}`);
    assert.ok(rewritten.includes("Okija"), `Expected "Okija" preserved, got: ${rewritten}`);
  });

  test("uses context-aware replacement for street names", () => {
    const lyrics = buildLyrics([
      "Walking down Prince Street at midnight",
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno" });

    assert.equal(result.changed, true);
    const rewritten = result.lyrics.sections[0].lines[0];
    assert.ok(!rewritten.toLowerCase().includes("prince"), `Expected "prince" removed, got: ${rewritten}`);
    assert.ok(rewritten.toLowerCase().includes("the old road"), `Expected "the old road" replacement, got: ${rewritten}`);
  });

  test("falls back to generic replacement when no place context exists", () => {
    const lyrics = buildLyrics([
      "I want to sing like Madonna tonight",
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno" });

    assert.equal(result.changed, true);
    const rewritten = result.lyrics.sections[0].lines[0];
    assert.ok(!rewritten.toLowerCase().includes("madonna"), `Expected "madonna" removed, got: ${rewritten}`);
    assert.ok(rewritten.toLowerCase().includes("someone special"), `Expected generic "someone special", got: ${rewritten}`);
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

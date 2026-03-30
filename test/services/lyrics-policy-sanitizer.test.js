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

  test("rewrites object-format lines and preserves timing metadata", () => {
    const lyrics = buildLyrics([
      { text: "We met at Madonna University, Okija", startTime: 5.52, endTime: 11.78 },
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno" });

    assert.equal(result.changed, true);
    const rewritten = result.lyrics.sections[0].lines[0];
    assert.deepEqual(
      rewritten,
      { text: "We met at the campus, Okija", startTime: 5.52, endTime: 11.78 }
    );
  });

  test("normalizes merged tens in object-format lines and preserves metadata", () => {
    const lyrics = buildLyrics([
      { text: "twentyone candles were glowing", startTime: 1, endTime: 4 },
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno", maxPasses: 0 });

    assert.equal(result.changed, true);
    assert.deepEqual(
      result.lyrics.sections[0].lines[0],
      { text: "twenty one candles were glowing", startTime: 1, endTime: 4 }
    );
  });

  test("rewrites numeric ages in object-format lines and preserves metadata", () => {
    const lyrics = buildLyrics([
      { text: "She turned 30 years old that spring", startTime: 2, endTime: 6 },
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "elevenlabs" });

    assert.equal(result.changed, true);
    assert.deepEqual(
      result.lyrics.sections[0].lines[0],
      { text: "She turned thirty years old that spring", startTime: 2, endTime: 6 }
    );
  });

  test("handles mixed string and object lines consistently", () => {
    const lyrics = buildLyrics([
      "I want to sing like Madonna tonight",
      { text: "Walking down Prince Street at midnight", startTime: 3, endTime: 7 },
    ]);

    const result = sanitizeLyricsForProviderPolicy({ lyrics, provider: "suno" });

    assert.equal(result.changed, true);
    assert.match(result.lyrics.sections[0].lines[0], /someone special/i);
    assert.deepEqual(
      result.lyrics.sections[0].lines[1],
      { text: "Walking down the old road at midnight", startTime: 3, endTime: 7 }
    );
  });

  test("place context wins over recipient-name context", () => {
    const lyrics = buildLyrics([
      "Madonna University, Okija held all our first memories",
    ]);

    const result = sanitizeLyricsForProviderPolicy({
      lyrics,
      provider: "suno",
      recipientName: "Madonna",
    });

    const rewritten = result.lyrics.sections[0].lines[0];
    assert.match(rewritten, /the campus/i);
    assert.doesNotMatch(rewritten, /my love/i);
  });

  test("recipient name uses person-addressing context before generic fallback", () => {
    const lyrics = buildLyrics([
      "Dear Madonna, this is for you",
    ]);

    const result = sanitizeLyricsForProviderPolicy({
      lyrics,
      provider: "suno",
      recipientName: "Madonna",
    });

    assert.equal(result.changed, true);
    assert.equal(result.lyrics.sections[0].lines[0], "Dear my dear, this is for you");
  });

  test("recipient name falls back to affectionate generic wording", () => {
    const lyrics = buildLyrics([
      "Madonna forever in my heart",
    ]);

    const result = sanitizeLyricsForProviderPolicy({
      lyrics,
      provider: "suno",
      recipientName: "Madonna",
    });

    assert.equal(result.changed, true);
    assert.equal(result.lyrics.sections[0].lines[0], "my love forever in my heart");
  });
});

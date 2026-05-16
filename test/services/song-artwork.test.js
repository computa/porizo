/**
 * Unit tests for song-artwork orchestrator.
 *
 * Covers:
 *   - Stable style-variant selection
 *   - Content-hash idempotency (skip when unchanged, regenerate when recipient/occasion edits)
 *   - Library vs paid-tier branching
 *   - Moderation-refusal fallback to library
 *   - fitName 5-tier behavior
 *   - detectDirection LTR/RTL coverage
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const {
  generateSongArtwork,
  pickStyleVariant,
  computeContentHash,
  STYLE_LIST,
} = require("../../src/services/song-artwork");
const {
  fitName,
  buildOverlaySvg,
} = require("../../src/services/cover-generator");
const {
  detectDirection,
  localizedForPrefix,
} = require("../../src/utils/og-text-utils");
const {
  ModerationRefusalError,
} = require("../../src/services/image-providers");

// ---------- pickStyleVariant ----------

test("pickStyleVariant returns one of the three styles", () => {
  const got = pickStyleVariant({ trackId: "t1", userId: "u1" });
  assert.ok(STYLE_LIST.includes(got), `got=${got}`);
});

test("pickStyleVariant is stable for the same (user, track)", () => {
  const a = pickStyleVariant({ trackId: "t-abc", userId: "u-xyz" });
  const b = pickStyleVariant({ trackId: "t-abc", userId: "u-xyz" });
  assert.equal(a, b);
});

test("pickStyleVariant distributes across many tracks", () => {
  const counts = { "paper-art": 0, watercolor: 0, photographic: 0 };
  for (let i = 0; i < 600; i++) {
    counts[pickStyleVariant({ trackId: `t${i}`, userId: `u${i}` })] += 1;
  }
  // Each arm should hold ≥10% of traffic (very loose lower bound)
  for (const s of STYLE_LIST) {
    assert.ok(counts[s] > 60, `Style ${s} under-represented: ${counts[s]}`);
  }
});

// ---------- computeContentHash ----------

test("computeContentHash is stable across calls", () => {
  const a = computeContentHash({
    recipientName: "Sarah",
    occasion: "birthday",
    style: "paper-art",
  });
  const b = computeContentHash({
    recipientName: "Sarah",
    occasion: "birthday",
    style: "paper-art",
  });
  assert.equal(a, b);
});

test("computeContentHash changes when recipient changes", () => {
  const a = computeContentHash({
    recipientName: "Sarah",
    occasion: "birthday",
    style: "paper-art",
  });
  const b = computeContentHash({
    recipientName: "Sara",
    occasion: "birthday",
    style: "paper-art",
  });
  assert.notEqual(a, b);
});

test("computeContentHash changes when occasion changes", () => {
  const a = computeContentHash({
    recipientName: "Sarah",
    occasion: "birthday",
    style: "paper-art",
  });
  const b = computeContentHash({
    recipientName: "Sarah",
    occasion: "anniversary",
    style: "paper-art",
  });
  assert.notEqual(a, b);
});

test("computeContentHash trims whitespace in recipient", () => {
  const a = computeContentHash({
    recipientName: "Sarah",
    occasion: "birthday",
    style: "paper-art",
  });
  const b = computeContentHash({
    recipientName: "  Sarah  ",
    occasion: "birthday",
    style: "paper-art",
  });
  assert.equal(a, b);
});

// ---------- generateSongArtwork — idempotency ----------

test("generateSongArtwork skips when previousContentHash matches", async () => {
  const style = pickStyleVariant({ trackId: "t-skip", userId: "u-skip" });
  const sameHash = computeContentHash({
    recipientName: "Sarah",
    occasion: "birthday",
    style,
  });

  const result = await generateSongArtwork({
    userId: "u-skip",
    trackId: "t-skip",
    occasion: "birthday",
    recipientName: "Sarah",
    tier: "free",
    previousContentHash: sameHash,
    dependencies: {
      // Should never be called
      compositeFn: async () => {
        throw new Error("compositeFn must not be called on a skip");
      },
      libraryPathFn: () => "/dev/null/never-read.jpg",
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "unchanged");
});

test("generateSongArtwork regenerates when previousContentHash differs", async () => {
  let compositeCalls = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));

  const result = await generateSongArtwork({
    userId: "u-regen",
    trackId: "t-regen",
    occasion: "birthday",
    recipientName: "Sarah",
    tier: "free",
    previousContentHash: "STALE_HASH_DOES_NOT_MATCH",
    dependencies: {
      libraryPathFn: () => fakeBase,
      compositeFn: async ({ outputDir }) => {
        compositeCalls += 1;
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
    },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.source, "library");
  assert.equal(compositeCalls, 1);
  assert.match(result.artworkUrl, /\?v=\d+$/);
});

// ---------- generateSongArtwork — tier branching ----------

test("generateSongArtwork takes library path for free tier without calling provider", async () => {
  let providerCalls = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));

  const result = await generateSongArtwork({
    userId: "u-free",
    trackId: "t-free",
    occasion: "birthday",
    recipientName: "Sarah",
    tier: "free",
    dependencies: {
      libraryPathFn: () => fakeBase,
      providerFactory: () => ({
        generate: async () => {
          providerCalls += 1;
          throw new Error("free tier should never call provider");
        },
      }),
      compositeFn: async ({ outputDir }) => {
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
    },
  });

  assert.equal(result.source, "library");
  assert.equal(providerCalls, 0);
  assert.equal(result.provider, null);
});

test("generateSongArtwork calls provider for paid tier (pro)", async () => {
  let providerCalls = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));

  const result = await generateSongArtwork({
    userId: "u-pro",
    trackId: "t-pro",
    occasion: "birthday",
    recipientName: "Sarah",
    tier: "pro",
    dependencies: {
      libraryPathFn: () => fakeBase,
      providerFactory: () => ({
        generate: async () => {
          providerCalls += 1;
          return Buffer.alloc(16); // pretend png
        },
      }),
      compositeFn: async ({ outputDir }) => {
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
    },
  });

  assert.equal(result.source, "generated");
  assert.equal(providerCalls, 1);
  assert.equal(result.provider, "openai");
  assert.ok(result.prompt && result.prompt.length > 50);
});

test("generateSongArtwork falls back to library on moderation refusal", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));

  const result = await generateSongArtwork({
    userId: "u-mod",
    trackId: "t-mod",
    occasion: "birthday",
    recipientName: "Sarah",
    tier: "pro",
    dependencies: {
      libraryPathFn: () => fakeBase,
      providerFactory: () => ({
        generate: async () => {
          throw new ModerationRefusalError("blocked");
        },
      }),
      compositeFn: async ({ outputDir }) => {
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
    },
  });

  assert.equal(result.source, "fallback");
  assert.equal(result.moderationPassed, false);
  // Provider + prompt are recorded for audit even though we fell back
  assert.equal(result.provider, "openai");
  assert.ok(result.prompt);
});

// ---------- fitName tiers ----------

test("fitName T1: short name → standard size, single line", () => {
  const r = fitName("Sarah");
  assert.deepEqual(r.lines, ["Sarah"]);
  assert.equal(r.fontSizeFraction, 0.07);
});

test("fitName T2: 13-18 chars → shrink, single line", () => {
  const r = fitName("Bartholomew");
  assert.deepEqual(r.lines, ["Bartholomew"]); // 11 chars, T1 — boundary check
  const r2 = fitName("Christopher M."); // 14 chars → T2
  assert.equal(r2.lines.length, 1);
  assert.equal(r2.fontSizeFraction, 0.055);
});

test("fitName T3: 19-28 chars with space → two lines", () => {
  const r = fitName("Maria Fernanda Lopez"); // 20 chars, has space
  assert.equal(r.lines.length, 2);
  assert.equal(r.fontSizeFraction, 0.05);
});

test("fitName T4: >28 chars → truncate at 26 + ellipsis", () => {
  const r = fitName("Anne-Marie de la Croix de Lorraine");
  assert.equal(r.lines.length, 1);
  assert.ok(r.lines[0].endsWith("…"));
  assert.equal(r.lines[0].length, 27); // 26 + ellipsis
});

test("fitName T5: >18 chars no space → truncate at 16 + ellipsis", () => {
  const r = fitName("Maximilliananerexor"); // 19 chars, no space
  assert.equal(r.lines.length, 1);
  assert.ok(r.lines[0].endsWith("…"));
  assert.equal(r.lines[0].length, 17); // 16 + ellipsis
});

test("fitName empty input is safe", () => {
  const r = fitName("");
  assert.deepEqual(r.lines, []);
  const r2 = fitName(null);
  assert.deepEqual(r2.lines, []);
});

// ---------- fitName boundary conditions ----------

test("fitName boundary at 12 chars: T1 (still standard size)", () => {
  const r = fitName("a".repeat(12));
  assert.equal(r.lines.length, 1);
  assert.equal(r.fontSizeFraction, 0.07);
});

test("fitName boundary at 13 chars: T2 (shrink)", () => {
  const r = fitName("a".repeat(13));
  assert.equal(r.lines.length, 1);
  assert.equal(r.fontSizeFraction, 0.055);
});

test("fitName boundary at 18 chars with no space: T2 (still single line)", () => {
  const r = fitName("a".repeat(18));
  assert.equal(r.lines.length, 1);
  assert.equal(r.fontSizeFraction, 0.055);
});

test("fitName boundary at 19 chars with space: T3 (two lines)", () => {
  const r = fitName("Maria Fernanda Lopz"); // 19 chars, has space
  assert.equal(r.lines.length, 2);
  assert.equal(r.fontSizeFraction, 0.05);
});

test("fitName boundary at 28 chars: T3 (still in two-line range)", () => {
  const r = fitName("Anne Marie de la Croix Brio"); // 27 chars, has space
  assert.equal(r.lines.length, 2);
  assert.equal(r.fontSizeFraction, 0.05);
});

test("fitName boundary at 29 chars: T4 (truncate)", () => {
  const r = fitName("a".repeat(29));
  assert.equal(r.lines.length, 1);
  assert.ok(r.lines[0].endsWith("…"));
});

// ---------- detectDirection ----------

test("detectDirection identifies LTR for Latin names", () => {
  assert.equal(detectDirection("Sarah"), "ltr");
  assert.equal(detectDirection("Maria Fernanda"), "ltr");
  assert.equal(detectDirection(""), "ltr");
});

test("detectDirection identifies RTL for Arabic", () => {
  assert.equal(detectDirection("سارة"), "rtl");
});

test("detectDirection identifies RTL for Hebrew", () => {
  assert.equal(detectDirection("שרה"), "rtl");
});

test("localizedForPrefix returns Arabic prefix for Arabic", () => {
  assert.equal(localizedForPrefix("سارة"), "لـ ");
});

test("localizedForPrefix returns Hebrew prefix for Hebrew", () => {
  assert.equal(localizedForPrefix("שרה"), "לְ ");
});

test("localizedForPrefix returns 'For ' for Latin", () => {
  assert.equal(localizedForPrefix("Sarah"), "For ");
});

// ---------- buildOverlaySvg structural ----------

test("buildOverlaySvg renders valid-ish XML containing the name", () => {
  const svg = buildOverlaySvg({
    width: 1024,
    height: 1536,
    recipientName: "Sarah",
    occasion: "birthday",
  });
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg[^>]*width="1024"/);
  assert.match(svg, /For Sarah/);
  assert.match(svg, /Birthday/);
  assert.match(svg, /porizo/);
});

test("buildOverlaySvg escapes XML-special chars in recipient name", () => {
  const svg = buildOverlaySvg({
    width: 1024,
    height: 1536,
    recipientName: "M&M's",
    occasion: "birthday",
  });
  // Should not contain raw & or '
  assert.ok(!/[^&]&[^a-z#]/.test(svg), "raw & found");
  assert.match(svg, /M&amp;M&apos;s|M&amp;M&#39;s|M&amp;M's/); // ampersand escaped; apostrophe may be left as-is in SVG
});

test("buildOverlaySvg flips text direction for RTL names", () => {
  const svg = buildOverlaySvg({
    width: 1024,
    height: 1536,
    recipientName: "سارة",
    occasion: "birthday",
  });
  assert.match(svg, /direction="rtl"/);
});

test("buildOverlaySvg keeps LTR by default", () => {
  const svg = buildOverlaySvg({
    width: 1024,
    height: 1536,
    recipientName: "Sarah",
    occasion: "birthday",
  });
  assert.ok(!/direction="rtl"/.test(svg));
});

// ---------- buildPrompt allowlist + content invariants ----------

const {
  buildPrompt,
  VALID_OCCASIONS,
  VALID_STYLES,
} = require("../../src/services/artwork-prompts");

test("buildPrompt rejects unknown occasion", () => {
  assert.throws(
    () => buildPrompt({ occasion: "haxx", style: "paper-art" }),
    /Invalid occasion/,
  );
});

test("buildPrompt rejects unknown style", () => {
  assert.throws(
    () => buildPrompt({ occasion: "birthday", style: "stained-glass" }),
    /Invalid style/,
  );
});

test("buildPrompt never includes recipient name (PII containment)", () => {
  // Defense against future refactors that accidentally weave names into prompts.
  // The signature is intentionally `{occasion, style}` only — no recipient
  // surface to leak. This test pins the structural invariant + the frame
  // guardrails on every prompt.
  for (const occasion of VALID_OCCASIONS) {
    for (const style of VALID_STYLES) {
      const prompt = buildPrompt({ occasion, style });
      assert.ok(
        !/\brecipient(_name|Name)?\b/i.test(prompt),
        `${occasion}/${style} leaked recipient token`,
      );
      assert.match(prompt, /no text/);
      assert.match(prompt, /no people, no faces/);
      assert.match(prompt, /no logos/);
    }
  }
});

test("buildPrompt ignores extraneous recipientName arg if a caller wires it incorrectly", () => {
  const prompt = buildPrompt({
    occasion: "birthday",
    style: "paper-art",
    recipientName: "Sarah-LEAK-CHECK",
  });
  assert.ok(!prompt.includes("Sarah-LEAK-CHECK"));
});

test("buildPrompt produces a distinct prompt for every (occasion, style) pair", () => {
  const seen = new Set();
  for (const occasion of VALID_OCCASIONS) {
    for (const style of VALID_STYLES) {
      const prompt = buildPrompt({ occasion, style });
      assert.ok(!seen.has(prompt), `duplicate prompt for ${occasion}/${style}`);
      seen.add(prompt);
    }
  }
  assert.equal(seen.size, VALID_OCCASIONS.size * VALID_STYLES.size);
});

// ---------- generateSongArtwork — additional coverage ----------

test("generateSongArtwork rejects invalid occasion early", async () => {
  await assert.rejects(
    () =>
      generateSongArtwork({
        userId: "u-1",
        trackId: "t-1",
        occasion: "definitely-not-real",
        recipientName: "Sarah",
        tier: "free",
      }),
    /Invalid occasion/,
  );
});

test("generateSongArtwork surfaces LIBRARY_NOT_BOOTSTRAPPED as permanent", async () => {
  // No fakeBase exists; libraryPathFn points at /dev/null/missing
  await assert.rejects(async () => {
    try {
      await generateSongArtwork({
        userId: "u-perm",
        trackId: "t-perm",
        occasion: "birthday",
        recipientName: "Sarah",
        tier: "free",
        dependencies: {
          libraryPathFn: () => "/dev/null/this-path-does-not-exist.jpg",
        },
      });
    } catch (err) {
      // Confirm permanent-error contract
      assert.equal(err.code, "LIBRARY_NOT_BOOTSTRAPPED");
      assert.equal(err.permanent, true);
      throw err;
    }
  }, /Artwork base missing/);
});

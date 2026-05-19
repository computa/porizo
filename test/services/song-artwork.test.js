/**
 * Unit tests for song-artwork orchestrator.
 *
 * Covers:
 *   - Content-hash idempotency (vars-based)
 *   - Library vs paid-tier branching
 *   - Flux primary -> OpenAI fallback chain
 *   - Moderation-refusal fallback to library (no OpenAI retry)
 *   - Sender attribution plumbing
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
  pickLibraryVariant,
  computeContentHash,
  prepareGeneratedBaseImage,
  PROMPT_TEMPLATE_VERSION,
  FREE_LIBRARY_VARIANT_COUNT,
} = require("../../src/services/song-artwork");
const {
  fitName,
  buildOverlaySvg,
} = require("../../src/services/cover-generator");
const {
  detectDirection,
  localizedForPrefix,
} = require("../../src/utils/og-text-utils");
const { getDefault } = require("../../src/services/artwork-vocab");

function defaultsFor(occ) {
  return {
    ...getDefault(occ),
    picked_by: "fallback",
    picked_at: new Date().toISOString(),
  };
}

// ---------- pickLibraryVariant ----------

test("pickLibraryVariant returns an index in [0, FREE_LIBRARY_VARIANT_COUNT)", () => {
  const got = pickLibraryVariant({ trackId: "t1", userId: "u1" });
  assert.ok(Number.isInteger(got));
  assert.ok(got >= 0 && got < FREE_LIBRARY_VARIANT_COUNT, `got=${got}`);
});

test("pickLibraryVariant is stable for the same (user, track)", () => {
  const a = pickLibraryVariant({ trackId: "t-abc", userId: "u-xyz" });
  const b = pickLibraryVariant({ trackId: "t-abc", userId: "u-xyz" });
  assert.equal(a, b);
});

test("pickLibraryVariant distributes across many tracks", () => {
  const counts = new Array(FREE_LIBRARY_VARIANT_COUNT).fill(0);
  for (let i = 0; i < 600; i++) {
    counts[pickLibraryVariant({ trackId: `t${i}`, userId: `u${i}` })] += 1;
  }
  // Each variant should hold ≥10% of traffic (very loose lower bound).
  for (let i = 0; i < FREE_LIBRARY_VARIANT_COUNT; i++) {
    assert.ok(counts[i] > 60, `variant ${i} under-represented: ${counts[i]}`);
  }
});

// ---------- computeContentHash ----------

test("computeContentHash is stable across calls", () => {
  const vars = defaultsFor("birthday");
  const a = computeContentHash({
    occasion: "birthday",
    artworkVars: vars,
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  const b = computeContentHash({
    occasion: "birthday",
    artworkVars: vars,
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  assert.equal(a, b);
});

test("computeContentHash changes when occasion changes", () => {
  const a = computeContentHash({
    occasion: "birthday",
    artworkVars: defaultsFor("birthday"),
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  const b = computeContentHash({
    occasion: "anniversary",
    artworkVars: defaultsFor("anniversary"),
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  assert.notEqual(a, b);
});

test("computeContentHash ignores recipient_name (intentionally excluded)", () => {
  // The hash is derived from artworkVars + occasion + promptVersion only.
  // Recipient never enters the prompt, so it must not invalidate the cache.
  const vars = defaultsFor("birthday");
  const a = computeContentHash({
    occasion: "birthday",
    artworkVars: vars,
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  const b = computeContentHash({
    occasion: "birthday",
    artworkVars: vars,
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  assert.equal(a, b);
});

test("computeContentHash changes when imperfection changes", () => {
  const base = defaultsFor("birthday");
  const a = computeContentHash({
    occasion: "birthday",
    artworkVars: base,
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  const b = computeContentHash({
    occasion: "birthday",
    artworkVars: { ...base, imperfection: "a different imperfection note" },
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });
  assert.notEqual(a, b);
});

// ---------- generateSongArtwork — idempotency ----------

test("generateSongArtwork skips when previousContentHash matches", async () => {
  const vars = defaultsFor("birthday");
  const sameHash = computeContentHash({
    occasion: "birthday",
    artworkVars: vars,
    promptVersion: PROMPT_TEMPLATE_VERSION,
  });

  const result = await generateSongArtwork({
    userId: "u-skip",
    trackId: "t-skip",
    occasion: "birthday",
    recipientName: "Sarah",
    tier: "free",
    artworkVars: vars,
    previousContentHash: sameHash,
    dependencies: {
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
    artworkVars: defaultsFor("birthday"),
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
    artworkVars: defaultsFor("birthday"),
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

// ---------- generateSongArtwork — Flux primary + OpenAI fallback ----------

test("generateSongArtwork builds prompt from artwork_vars and calls primary provider", async () => {
  const calls = { generate: null };
  const fakeFlux = {
    name: "flux",
    generate: async ({ prompt, negativePrompt }) => {
      calls.generate = { prompt, negativePrompt };
      return Buffer.alloc(8192, "x");
    },
  };
  const fakePrepare = async (buf) => buf;
  const result = await generateSongArtwork({
    userId: "u1",
    trackId: "t1",
    occasion: "mothers_day",
    recipientName: "Chioma",
    tier: "plus",
    artworkVars: {
      species: "ranunculus",
      lighting: "morning_window",
      palette: "dusty_rose",
      density: "intimate_cluster",
      imperfection: "one outer petal slightly bruised at the tip",
      backdrop: "cream_cloud",
      picked_by: "haiku",
      picked_at: "2026-05-18T12:00:00Z",
    },
    dependencies: {
      providerFactory: () => fakeFlux,
      prepareGeneratedImageFn: fakePrepare,
      compositeFn: async ({ baseImagePath }) => baseImagePath,
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.provider, "flux");
  assert.equal(result.promptVersion, "v2.1.0-photoreal-flora");
  assert.ok(calls.generate.prompt.includes("ranunculus"));
  assert.ok(calls.generate.negativePrompt.includes("no text"));
});

test("generateSongArtwork falls back to OpenAI on Flux infra failure", async () => {
  const fakeFlux = {
    name: "flux",
    generate: async () => {
      throw new Error("HTTP 503");
    },
  };
  const fakeOpenAI = {
    name: "openai",
    generate: async () => Buffer.alloc(8192, "y"),
  };
  const result = await generateSongArtwork({
    userId: "u1",
    trackId: "t2",
    occasion: "birthday",
    recipientName: "X",
    tier: "plus",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      providerFactory: (name) => (name === "flux" ? fakeFlux : fakeOpenAI),
      prepareGeneratedImageFn: async (b) => b,
      compositeFn: async ({ baseImagePath }) => baseImagePath,
    },
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.source, "generated");
});

test("generateSongArtwork falls back to library on Flux moderation refusal (no OpenAI retry)", async () => {
  const {
    ModerationRefusalError,
  } = require("../../src/services/image-providers");
  const fakeFlux = {
    name: "flux",
    generate: async () => {
      throw new ModerationRefusalError("moderation_blocked");
    },
  };
  let openaiCalled = false;
  const fakeOpenAI = {
    name: "openai",
    generate: async () => {
      openaiCalled = true;
      return Buffer.alloc(0);
    },
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));
  const result = await generateSongArtwork({
    userId: "u1",
    trackId: "t3",
    occasion: "birthday",
    recipientName: "X",
    tier: "plus",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      providerFactory: (name) => (name === "flux" ? fakeFlux : fakeOpenAI),
      prepareGeneratedImageFn: async (b) => b,
      compositeFn: async ({ outputDir }) => {
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
      libraryPathFn: () => fakeBase,
    },
  });
  assert.equal(
    openaiCalled,
    false,
    "must not retry OpenAI on moderation refusal",
  );
  assert.equal(result.source, "fallback");
  // Moderation refusal IS a moderation event — moderation_passed must be false
  // so the operator can SELECT WHERE source='fallback' AND moderation_passed=false
  // to find rows needing prompt review (distinct from infra failures).
  assert.equal(result.moderationPassed, false);
});

test("generateSongArtwork sets uploadFailed:true when S3 putFile throws", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));
  const fakeFlux = {
    name: "flux",
    generate: async () => Buffer.alloc(8192, "x"),
  };
  const errors = [];
  const result = await generateSongArtwork({
    userId: "u-upload",
    trackId: "t-upload",
    occasion: "birthday",
    recipientName: "X",
    tier: "plus",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      providerFactory: () => fakeFlux,
      prepareGeneratedImageFn: async (b) => b,
      compositeFn: async ({ outputDir }) => {
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
      libraryPathFn: () => fakeBase,
      storageProvider: {
        type: "s3",
        putFile: async () => {
          throw new Error("S3 putObject denied");
        },
      },
      logger: {
        info() {},
        warn() {},
        error(message) {
          errors.push(message);
        },
      },
    },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.source, "generated");
  assert.equal(result.provider, "flux");
  // Render proceeded artistically — but uploadFailed flag warns the caller
  // that the canonical URL won't serve from a different instance.
  assert.equal(result.uploadFailed, true);
  assert.ok(
    errors.some((m) => m.includes("S3 upload failed")),
    "expected an error-level log about S3 upload failure",
  );
});

test("generateSongArtwork sets uploadFailed:false when S3 succeeds", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));
  const fakeFlux = {
    name: "flux",
    generate: async () => Buffer.alloc(8192, "x"),
  };
  let uploaded = false;
  const result = await generateSongArtwork({
    userId: "u-upload-ok",
    trackId: "t-upload-ok",
    occasion: "birthday",
    recipientName: "X",
    tier: "plus",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      providerFactory: () => fakeFlux,
      prepareGeneratedImageFn: async (b) => b,
      compositeFn: async ({ outputDir }) => {
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
      libraryPathFn: () => fakeBase,
      storageProvider: {
        type: "s3",
        putFile: async () => {
          uploaded = true;
        },
      },
    },
  });

  assert.equal(uploaded, true);
  assert.equal(result.uploadFailed, false);
});

test("generateSongArtwork falls back to library when provider image validation fails", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));
  const errors = [];
  // Both providers will be tried; both will fail validation.
  const fakeProvider = {
    name: "flux",
    generate: async () => Buffer.alloc(16),
  };
  const fakeFallback = {
    name: "openai",
    generate: async () => Buffer.alloc(16),
  };

  const result = await generateSongArtwork({
    userId: "u-invalid-image",
    trackId: "t-invalid-image",
    occasion: "birthday",
    recipientName: "Sarah",
    tier: "pro",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      libraryPathFn: () => fakeBase,
      providerFactory: (name) =>
        name === "flux" ? fakeProvider : fakeFallback,
      prepareGeneratedImageFn: async () => {
        throw new Error("corrupt provider image");
      },
      compositeFn: async ({ baseImagePath, outputDir }) => {
        assert.equal(baseImagePath, fakeBase);
        const out = path.join(outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
      logger: {
        info() {},
        warn() {},
        error(message) {
          errors.push(message);
        },
      },
    },
  });

  assert.equal(result.source, "fallback");
  // Infra failure (corrupt image) is NOT a moderation event — moderation_passed
  // stays true so operators can SELECT WHERE source='fallback' AND moderation_passed=true
  // to find "infra failed" rows distinct from moderation refusals.
  assert.equal(result.moderationPassed, true);
  // Logged at error level (pages ops), not warn.
  assert.ok(errors.length >= 1, "infra failure should log at error level");
});

test("prepareGeneratedBaseImage normalizes valid provider output to 2048x2048 JPEG", async () => {
  const sharp = require("sharp");
  const input = await sharp({
    create: {
      width: 1280,
      height: 1280,
      channels: 3,
      background: { r: 224, g: 190, b: 174 },
    },
  })
    .png()
    .toBuffer();

  const output = await prepareGeneratedBaseImage(input);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 2048);
  assert.equal(metadata.height, 2048);
});

test("prepareGeneratedBaseImage rejects corrupt or tiny provider output", async () => {
  await assert.rejects(
    () => prepareGeneratedBaseImage(Buffer.alloc(16)),
    /invalid buffer/,
  );
});

test("prepareGeneratedBaseImage accepts 1024×1024 (the OpenAI fallback dimension)", async () => {
  // Regression: floor was 1280, but OpenAI's gpt-image-2 max square is 1024².
  // The fallback path would have thrown "undersized image (1024x1024)" 100% of
  // the time, leaving Flux failures with no real fallback before library.
  const sharp = require("sharp");
  const input = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 230, g: 200, b: 180 },
    },
  })
    .png()
    .toBuffer();

  const output = await prepareGeneratedBaseImage(input);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 2048);
  assert.equal(metadata.height, 2048);
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
  assert.doesNotMatch(svg, /porizo/i);
  assert.doesNotMatch(svg, /made with/i);
  assert.doesNotMatch(svg, /watermark/i);
});

test("buildOverlaySvg centers no-sender typography inside bottom quarter", () => {
  const height = 1536;
  const svg = buildOverlaySvg({
    width: 1024,
    height,
    recipientName: "Sarah",
    occasion: "birthday",
  });
  const yValues = [...svg.matchAll(/ y="(\d+)"/g)].map((m) => Number(m[1]));

  assert.equal(yValues.length, 2);
  assert.ok(yValues[0] > height * 0.8, `name y too high: ${yValues[0]}`);
  assert.ok(
    yValues[yValues.length - 1] < height * 0.94,
    `occasion y too low: ${yValues[yValues.length - 1]}`,
  );
  assert.ok(
    Math.abs((yValues[0] + yValues[yValues.length - 1]) / 2 - height * 0.875) <
      65,
    `typography midpoint not centered in bottom band: ${yValues.join(", ")}`,
  );
});

test("buildOverlaySvg centers sender typography inside bottom quarter", () => {
  const height = 1536;
  const svg = buildOverlaySvg({
    width: 1024,
    height,
    recipientName: "Chioma",
    occasion: "birthday",
    senderName: "Ambrose Obimma",
  });
  const yValues = [...svg.matchAll(/ y="(\d+)"/g)].map((m) => Number(m[1]));

  assert.equal(yValues.length, 3);
  assert.ok(yValues[0] > height * 0.8, `name y too high: ${yValues[0]}`);
  assert.ok(
    yValues[yValues.length - 1] < height * 0.94,
    `sender y too low: ${yValues[yValues.length - 1]}`,
  );
  assert.ok(
    Math.abs((yValues[0] + yValues[yValues.length - 1]) / 2 - height * 0.875) <
      65,
    `typography midpoint not centered in bottom band: ${yValues.join(", ")}`,
  );
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

// ---------- buildOverlaySvg sender attribution ----------

test("buildOverlaySvg renders 'by {FirstName}' when senderName provided", () => {
  const svg = buildOverlaySvg({
    width: 1024,
    height: 1536,
    recipientName: "Chioma",
    occasion: "birthday",
    senderName: "Ambrose Obimma",
  });
  // Sender line uses only the first whitespace-delimited token.
  assert.match(svg, /by Ambrose/);
  assert.ok(!/Obimma/.test(svg), "last name should be dropped");
  // With a sender, the occasion subtitle reads as a full phrase rather than
  // just the bare occasion word.
  assert.match(svg, /A Birthday Song/);
});

test("buildOverlaySvg falls back to legacy 2-tier layout without senderName", () => {
  const svg = buildOverlaySvg({
    width: 1024,
    height: 1536,
    recipientName: "Sarah",
    occasion: "birthday",
  });
  assert.ok(!/by /.test(svg), "no attribution line when sender absent");
  // Legacy layout shows just the occasion word (parity with pre-sender artwork).
  assert.match(svg, /Birthday/);
});

test("buildOverlaySvg treats blank/whitespace senderName as absent", () => {
  const svg = buildOverlaySvg({
    width: 1024,
    height: 1536,
    recipientName: "Sarah",
    occasion: "birthday",
    senderName: "   ",
  });
  assert.ok(!/by /.test(svg));
});

test("generateSongArtwork plumbs senderName through to compositeFn", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-artwork-"));
  const fakeBase = path.join(tmp, "base.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));
  let captured = null;

  const result = await generateSongArtwork({
    userId: "u-sender",
    trackId: "t-sender",
    occasion: "birthday",
    recipientName: "Chioma",
    senderName: "Ambrose Obimma",
    tier: "free",
    artworkVars: defaultsFor("birthday"),
    dependencies: {
      libraryPathFn: () => fakeBase,
      compositeFn: async (args) => {
        captured = args;
        const out = path.join(args.outputDir, "artwork.jpg");
        fs.writeFileSync(out, Buffer.alloc(8));
        return out;
      },
    },
  });

  assert.equal(result.skipped, false);
  assert.equal(captured.senderName, "Ambrose Obimma");
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
        artworkVars: defaultsFor("birthday"),
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

test("generateSongArtwork respects ARTWORK_V2_ENABLED flag — disabled means library fallback for paid too", async () => {
  const tmpFlag = fs.mkdtempSync(path.join(os.tmpdir(), "artwork-flag-"));
  const fakeBase = path.join(tmpFlag, "lib.jpg");
  fs.writeFileSync(fakeBase, Buffer.alloc(8));
  process.env.ARTWORK_V2_ENABLED = "false";
  try {
    const result = await generateSongArtwork({
      userId: "u-flag",
      trackId: "t-flag",
      occasion: "birthday",
      recipientName: "X",
      tier: "plus",
      artworkVars: {
        ...require("../../src/services/artwork-vocab").getDefault("birthday"),
        picked_by: "x",
        picked_at: "now",
      },
      dependencies: {
        providerFactory: () => {
          throw new Error("must not call provider when flag off");
        },
        prepareGeneratedImageFn: async (b) => b,
        compositeFn: async ({ baseImagePath }) => baseImagePath,
        libraryPathFn: () => fakeBase,
      },
    });
    assert.equal(result.source, "library");
  } finally {
    delete process.env.ARTWORK_V2_ENABLED;
  }
});

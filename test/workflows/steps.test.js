const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { createStepRegistry } = require("../../src/workflows/steps");
const { createLyricsSteps } = require("../../src/workflows/steps/lyrics");
const { createModerationSteps } = require("../../src/workflows/steps/moderation");

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

describe("workflow step registry", () => {
  test("creates a lookup map from step factories", () => {
    const registry = createStepRegistry({
      ...createModerationSteps({
        moderationCheck: () => ({ allowed: true }),
        parseJson,
      }),
    });

    assert.equal(typeof registry.get("moderation"), "function");
    assert.equal(registry.get("missing"), undefined);
  });
});

describe("moderation step", () => {
  test("returns existing moderation status without rechecking content", () => {
    let called = false;
    const { moderation } = createModerationSteps({
      moderationCheck: () => {
        called = true;
        return { allowed: true };
      },
      parseJson,
    });

    const result = moderation({
      track: {},
      trackVersion: { moderation_status: "passed" },
    });

    assert.deepEqual(result, { moderation_status: "passed" });
    assert.equal(called, false);
  });

  test("blocks disallowed content", () => {
    const { moderation } = createModerationSteps({
      moderationCheck: () => ({ allowed: false, reason: "policy" }),
      parseJson,
    });

    assert.deepEqual(
      moderation({
        track: { title: "x", recipient_name: "y", message: "z" },
        trackVersion: { lyrics_json: JSON.stringify({ sections: [] }) },
      }),
      {
        moderation_status: "blocked",
        moderation_reason: "policy",
        status_override: "blocked",
      },
    );
  });
});

describe("lyrics step", () => {
  function createLyricsStep(overrides = {}) {
    const calls = [];
    const { lyrics } = createLyricsSteps({
      assertPolicySanitizerPreservedStoryDetails: (args) => {
        calls.push({ name: "assertPolicy", args });
      },
      buildLyricsContext: (track) => ({ trackId: track.id }),
      generateLyrics: async () => ({
        lyrics: { title: "Song", sections: [{ name: "v", lines: ["hi"] }] },
        lyrics_status: "generated",
        provider: "test-provider",
        model: "test-model",
        quality_score: 88,
        acceptance_reason: "ok",
      }),
      mergeProvenanceJson: (_existing, patch) => JSON.stringify(patch),
      nowIso: () => "2026-06-28T00:00:00.000Z",
      parseJson,
      sanitizeLyricsForAllMusicProviders: (lyricsValue) => ({
        lyrics: lyricsValue,
        changed: false,
        blocked: false,
        change_count: 0,
        reports: [],
      }),
      summarizeLyricsContextForLog: (context) => context,
      toJson: JSON.stringify,
      ...overrides,
    });
    return { lyrics, calls };
  }

  test("returns existing lyrics without regenerating", async () => {
    let generated = false;
    const { lyrics } = createLyricsStep({
      generateLyrics: async () => {
        generated = true;
        return {};
      },
    });

    const result = await lyrics({
      track: { id: "track_1" },
      trackVersion: {
        lyrics_json: JSON.stringify({ title: "Existing" }),
        provenance_json: JSON.stringify({ lyrics: { provider: "cached" } }),
      },
    });

    assert.deepEqual(result, {
      lyrics_json: JSON.stringify({ title: "Existing" }),
    });
    assert.equal(generated, false);
  });

  test("generates lyrics and provenance", async () => {
    const { lyrics } = createLyricsStep();

    const result = await lyrics({
      track: { id: "track_1", recipient_name: "Sam" },
      trackVersion: { lyrics_json: null, provenance_json: null },
    });

    assert.equal(result.lyrics_status, "generated");
    assert.equal(
      result.lyrics_json,
      JSON.stringify({ title: "Song", sections: [{ name: "v", lines: ["hi"] }] }),
    );
    const provenance = JSON.parse(result.provenance_json);
    assert.equal(provenance.lyrics.provider, "test-provider");
    assert.equal(provenance.timeline.length, 0);
  });

  test("maps provider availability errors to stable workflow error", async () => {
    const { lyrics } = createLyricsStep({
      generateLyrics: async () => {
        const err = new Error("AI_UNAVAILABLE");
        err.code = "AI_UNAVAILABLE";
        throw err;
      },
    });

    await assert.rejects(
      () =>
        lyrics({
          track: { id: "track_1" },
          trackVersion: { lyrics_json: null, provenance_json: null },
        }),
      /E201_LYRICS_ERROR: AI_UNAVAILABLE/,
    );
  });
});

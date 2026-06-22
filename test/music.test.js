/**
 * Music Provider Tests
 *
 * Tests for style-aware music planning and generation
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  STYLES,
  getStyleProfile,
  normalizeStyle,
  getStylePrompt,
  selectBpm,
  selectKey,
  calculateSections,
  buildMusicPlan,
} = require("../src/providers/music");

describe("Style Profiles", () => {
  describe("STYLES constant", () => {
    it("includes Western pop styles", () => {
      assert.ok(STYLES.pop, "Should have pop");
      assert.ok(STYLES.acoustic, "Should have acoustic");
      assert.ok(STYLES.soul, "Should have soul");
      assert.ok(STYLES.folk, "Should have folk");
      assert.ok(STYLES.jazz, "Should have jazz");
      assert.ok(STYLES.rnb, "Should have R&B");
      assert.ok(STYLES.rock, "Should have rock");
      assert.ok(STYLES.country, "Should have country");
      assert.ok(STYLES.ballad, "Should have ballad");
    });

    it("includes African music styles", () => {
      assert.ok(STYLES.afrobeats, "Should have Afrobeats");
      assert.ok(STYLES.highlife, "Should have Highlife");
      assert.ok(STYLES.ogene, "Should have Ogene");
      assert.ok(STYLES.juju, "Should have Jùjú");
      assert.ok(STYLES.fuji, "Should have Fuji");
      assert.ok(STYLES.afropop, "Should have Afropop");
    });

    it("includes Latin/South American styles", () => {
      assert.ok(STYLES.reggaeton, "Should have Reggaeton");
      assert.ok(STYLES.salsa, "Should have Salsa");
      assert.ok(STYLES.bossa_nova, "Should have Bossa Nova");
      assert.ok(STYLES.cumbia, "Should have Cumbia");
      assert.ok(STYLES.bachata, "Should have Bachata");
      assert.ok(STYLES.samba, "Should have Samba");
      assert.ok(STYLES.latin_pop, "Should have Latin Pop");
    });

    it("each profile has required properties", () => {
      for (const [name, profile] of Object.entries(STYLES)) {
        assert.ok(
          Array.isArray(profile.bpmRange),
          `${name} should have bpmRange array`,
        );
        assert.strictEqual(
          profile.bpmRange.length,
          2,
          `${name} bpmRange should have 2 values`,
        );
        assert.ok(
          profile.bpmRange[0] < profile.bpmRange[1],
          `${name} min BPM < max BPM`,
        );
        assert.ok(
          Array.isArray(profile.keys),
          `${name} should have keys array`,
        );
        assert.ok(
          profile.keys.length > 0,
          `${name} should have at least one key`,
        );
        assert.ok(
          ["low", "medium", "high"].includes(profile.energy),
          `${name} energy should be low/medium/high`,
        );
      }
    });

    it("BPM ranges are genre-appropriate", () => {
      // Ballads should be slower
      assert.ok(
        STYLES.ballad.bpmRange[1] <= 90,
        "Ballad max BPM should be slow",
      );
      // Dance music should be faster
      assert.ok(STYLES.salsa.bpmRange[0] >= 150, "Salsa should be fast");
      // Reggaeton has characteristic mid-tempo
      assert.ok(
        STYLES.reggaeton.bpmRange[0] >= 80,
        "Reggaeton should be mid-tempo",
      );
      assert.ok(
        STYLES.reggaeton.bpmRange[1] <= 110,
        "Reggaeton should be mid-tempo",
      );
    });
  });

  describe("getStyleProfile", () => {
    it("returns profile for known style", () => {
      const profile = getStyleProfile("pop");
      assert.deepStrictEqual(profile.bpmRange, [100, 130]);
      assert.ok(profile.keys.includes("C"));
      assert.strictEqual(profile.energy, "medium");
    });

    it("is case-insensitive", () => {
      const upper = getStyleProfile("POP");
      const lower = getStyleProfile("pop");
      assert.deepStrictEqual(upper, lower);
    });

    it("returns default profile for unknown style", () => {
      const profile = getStyleProfile("unknown_style");
      assert.deepStrictEqual(profile.bpmRange, [100, 120]);
      assert.ok(profile.keys.includes("C"));
    });

    it("handles null/undefined", () => {
      const nullProfile = getStyleProfile(null);
      const undefinedProfile = getStyleProfile(undefined);
      assert.deepStrictEqual(nullProfile.bpmRange, [100, 120]);
      assert.deepStrictEqual(undefinedProfile.bpmRange, [100, 120]);
    });
  });

  describe("normalizeStyle", () => {
    it("normalizes aliases to canonical style keys", () => {
      assert.strictEqual(normalizeStyle("R&B"), "rnb");
      assert.strictEqual(normalizeStyle("latin pop"), "latin_pop");
      assert.strictEqual(normalizeStyle("Bossa-Nova"), "bossa_nova");
    });
  });

  describe("selectBpm", () => {
    it("returns BPM within profile range", () => {
      const profile = { bpmRange: [100, 130], keys: ["C"], energy: "medium" };
      for (let i = 0; i < 100; i++) {
        const bpm = selectBpm(profile);
        assert.ok(bpm >= 100, `BPM ${bpm} should be >= 100`);
        assert.ok(bpm <= 130, `BPM ${bpm} should be <= 130`);
        assert.strictEqual(Math.floor(bpm), bpm, "BPM should be integer");
      }
    });

    it("handles narrow range", () => {
      const profile = { bpmRange: [120, 120], keys: ["C"], energy: "medium" };
      const bpm = selectBpm(profile);
      assert.strictEqual(bpm, 120);
    });
  });

  describe("selectKey", () => {
    it("returns key from profile keys", () => {
      const profile = {
        bpmRange: [100, 130],
        keys: ["C", "G", "D"],
        energy: "medium",
      };
      for (let i = 0; i < 50; i++) {
        const key = selectKey(profile);
        assert.ok(
          ["C", "G", "D"].includes(key),
          `Key ${key} should be in profile`,
        );
      }
    });

    it("handles single key", () => {
      const profile = { bpmRange: [100, 130], keys: ["Am"], energy: "medium" };
      const key = selectKey(profile);
      assert.strictEqual(key, "Am");
    });
  });
});

describe("Section Calculation", () => {
  describe("calculateSections", () => {
    it("returns chorus only for preview (≤30s)", () => {
      const sections = calculateSections(25, 120);
      assert.strictEqual(sections.length, 1);
      assert.strictEqual(sections[0].name, "chorus");
      assert.ok(sections[0].bars <= 8);
    });

    it("returns verse-chorus-verse-chorus for short songs (31-60s)", () => {
      const sections = calculateSections(60, 120);
      assert.strictEqual(sections.length, 4);
      assert.strictEqual(sections[0].name, "verse1");
      assert.strictEqual(sections[1].name, "chorus");
      assert.strictEqual(sections[2].name, "verse2");
      assert.strictEqual(sections[3].name, "chorus2");
    });

    it("returns full structure with bridge for long songs (>60s)", () => {
      const sections = calculateSections(90, 120);
      assert.strictEqual(sections.length, 6);
      assert.strictEqual(sections[0].name, "verse1");
      assert.strictEqual(sections[1].name, "chorus");
      assert.strictEqual(sections[2].name, "verse2");
      assert.strictEqual(sections[3].name, "chorus2");
      assert.strictEqual(sections[4].name, "bridge");
      assert.strictEqual(sections[5].name, "chorus3");
    });

    it("adjusts bar counts based on BPM", () => {
      // Slower BPM = more bars fit in same duration
      const slowSections = calculateSections(30, 60);
      const fastSections = calculateSections(30, 180);
      // Both should have chorus only for preview
      assert.strictEqual(slowSections[0].name, "chorus");
      assert.strictEqual(fastSections[0].name, "chorus");
    });
  });
});

describe("buildMusicPlan", () => {
  it("creates plan with style-appropriate BPM", () => {
    const plan = buildMusicPlan({ style: "ballad", durationTarget: 60 });
    assert.ok(plan.bpm >= 60, "Ballad BPM should be >= 60");
    assert.ok(plan.bpm <= 80, "Ballad BPM should be <= 80");
  });

  it("creates plan with style-appropriate key", () => {
    const plan = buildMusicPlan({ style: "afrobeats", durationTarget: 60 });
    assert.ok(
      ["Eb", "Bb", "F", "Ab"].includes(plan.key),
      "Should use Afrobeats keys",
    );
  });

  it("includes energy level", () => {
    const rockPlan = buildMusicPlan({ style: "rock", durationTarget: 60 });
    const balladPlan = buildMusicPlan({ style: "ballad", durationTarget: 60 });
    assert.strictEqual(rockPlan.energy, "high");
    assert.strictEqual(balladPlan.energy, "low");
  });

  it("includes sections array", () => {
    const plan = buildMusicPlan({ style: "pop", durationTarget: 60 });
    assert.ok(Array.isArray(plan.sections));
    assert.ok(plan.sections.length >= 1);
    assert.ok(plan.sections.every((s) => s.name && typeof s.bars === "number"));
  });

  it("defaults to 60s duration if not specified", () => {
    const plan = buildMusicPlan({ style: "pop" });
    assert.strictEqual(plan.duration_sec, 60);
  });

  it("defaults to pop style if not specified", () => {
    const plan = buildMusicPlan({ durationTarget: 45 });
    assert.strictEqual(plan.style, "pop");
    assert.ok(plan.bpm >= 100 && plan.bpm <= 130);
  });

  it("handles unknown style with default profile", () => {
    const plan = buildMusicPlan({ style: "unknown_genre", durationTarget: 60 });
    assert.strictEqual(plan.style, "unknown_genre");
    assert.ok(plan.bpm >= 100 && plan.bpm <= 120); // Default range
  });

  it("adds a style prompt guide for downstream providers", () => {
    const plan = buildMusicPlan({ style: "ogene", durationTarget: 60 });
    assert.ok(plan.style_prompt, "style_prompt should be set");
    assert.ok(plan.style_prompt_compact, "style_prompt_compact should be set");
    assert.equal(
      plan.plan_schema_version,
      2,
      "music plan should use compact schema version",
    );
    // Prompts are now descriptive of the SOUND rather than echoing the literal
    // genre name (e.g. ogene -> "Igbo ceremonial festival music, iron gong...").
    assert.ok(
      plan.style_prompt.toLowerCase().includes("igbo"),
      "style_prompt should reflect the selected style intent descriptively",
    );
  });

  it("renders a descriptive provider prompt for weak-support styles", () => {
    // The literal genre name + "Avoid:" negative constraints were dropped in
    // favour of descriptive sound prompts; verify the style identity is still
    // reflected descriptively for a weak-support style (ogene on suno).
    const prompt = getStylePrompt("ogene", "suno");
    assert.ok(
      prompt.toLowerCase().includes("igbo"),
      "Prompt should reflect the style identity descriptively",
    );
  });

  it("builds deterministic plans when seed is provided", () => {
    const first = buildMusicPlan({
      style: "ogene",
      durationTarget: 60,
      provider: "elevenlabs",
      seed: "track:123:v1",
    });
    const second = buildMusicPlan({
      style: "ogene",
      durationTarget: 60,
      provider: "elevenlabs",
      seed: "track:123:v1",
    });
    assert.equal(first.bpm, second.bpm);
    assert.equal(first.key, second.key);
    assert.equal(first.style_prompt, second.style_prompt);
    assert.equal(first.style_prompt_compact, second.style_prompt_compact);
    assert.equal(first.provider_style_hint, second.provider_style_hint);
  });

  it("attaches structured style_intent to the music plan", () => {
    const plan = buildMusicPlan({
      style: "ogene",
      durationTarget: 60,
      provider: "elevenlabs",
    });
    assert.ok(plan.style_intent, "style_intent should be present");
    assert.equal(plan.style_intent.style, "ogene");
    assert.ok(
      Array.isArray(plan.style_intent.instrument_palette) &&
        plan.style_intent.instrument_palette.length > 0,
      "style_intent should include instrument palette",
    );
  });

  it("applies style overrides into style intent prompting", () => {
    const plan = buildMusicPlan({
      style: "ogene",
      durationTarget: 60,
      provider: "suno",
      styleOverrides: {
        ogene: {
          suno: {
            instruction_override:
              "Focus on slit-drum ostinato and ceremonial chant cadence.",
            negative_constraints: ["avoid afropop synth topline"],
          },
        },
      },
    });
    assert.ok(
      plan.style_prompt.includes("slit-drum ostinato"),
      "style prompt should include override instruction",
    );
    assert.ok(
      plan.style_prompt.includes("avoid afropop synth topline"),
      "style prompt should include override negative constraints",
    );
  });

  it("creates preview-appropriate plan for short durations", () => {
    const plan = buildMusicPlan({ style: "pop", durationTarget: 25 });
    assert.strictEqual(plan.sections.length, 1);
    assert.strictEqual(plan.sections[0].name, "chorus");
  });

  it("creates full song structure for target durations", () => {
    const plan = buildMusicPlan({ style: "soul", durationTarget: 90 });
    assert.ok(
      plan.sections.length >= 5,
      "Should have verse/chorus/bridge structure",
    );
    assert.ok(
      plan.sections.some((s) => s.name === "bridge"),
      "Should have bridge",
    );
  });
});

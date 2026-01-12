/**
 * Beat Strength Schema Tests
 *
 * Tests that beats use numeric strength (0-1) instead of categorical status.
 * This enables holistic LLM assessment rather than formula-based scoring.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("Beat Strength Schema", () => {
  const { generateBeatsForEvent, getStatusFromStrength, normalizeEventType } = require("../../../src/writer/v2/beats");

  describe("generateBeatsForEvent", () => {
    it("should initialize beats with strength 0", () => {
      const beats = generateBeatsForEvent({ type: "birthday" });

      for (const beat of beats) {
        assert.strictEqual(typeof beat.strength, "number", `Beat ${beat.id} should have numeric strength`);
        assert.strictEqual(beat.strength, 0, `Beat ${beat.id} should start at strength 0`);
      }
    });

    it("should NOT have categorical status field on new beats", () => {
      const beats = generateBeatsForEvent({ type: "birthday" });

      for (const beat of beats) {
        // New beats should use strength, not status
        assert.strictEqual(beat.status, undefined, `Beat ${beat.id} should not have status field`);
      }
    });

    it("should initialize beats with empty evidence array", () => {
      const beats = generateBeatsForEvent({ type: "anniversary" });

      for (const beat of beats) {
        assert.ok(Array.isArray(beat.evidence), `Beat ${beat.id} should have evidence array`);
        assert.strictEqual(beat.evidence.length, 0, `Beat ${beat.id} should start with empty evidence`);
      }
    });

    it("should preserve required and purpose fields", () => {
      const beats = generateBeatsForEvent({ type: "loss" });

      for (const beat of beats) {
        assert.ok(beat.id, "Beat should have id");
        assert.ok(beat.purpose, "Beat should have purpose");
        assert.strictEqual(typeof beat.required, "boolean", "Beat should have required boolean");
      }
    });

    it("should generate correct beats for each event type", () => {
      const eventTypes = ["birth", "loss", "illness", "anniversary", "birthday", "celebration", "gratitude", "farewell"];

      for (const type of eventTypes) {
        const beats = generateBeatsForEvent({ type });
        assert.ok(beats.length > 0, `Should generate beats for ${type}`);

        // All should have strength
        for (const beat of beats) {
          assert.strictEqual(typeof beat.strength, "number");
        }
      }
    });

    it("should fallback to default beats for unknown event type", () => {
      const beats = generateBeatsForEvent({ type: "unknown_event" });

      assert.ok(beats.length > 0, "Should have default beats");
      assert.ok(beats.some(b => b.id === "scene"), "Should have scene beat");
      assert.ok(beats.some(b => b.id === "meaning"), "Should have meaning beat");
    });
  });

  describe("getStatusFromStrength (backward compatibility)", () => {
    it("should return 'missing' for strength 0", () => {
      assert.strictEqual(getStatusFromStrength(0), "missing");
    });

    it("should return 'missing' for strength < 0.3", () => {
      assert.strictEqual(getStatusFromStrength(0.1), "missing");
      assert.strictEqual(getStatusFromStrength(0.2), "missing");
      assert.strictEqual(getStatusFromStrength(0.29), "missing");
    });

    it("should return 'weak' for strength 0.3-0.59", () => {
      assert.strictEqual(getStatusFromStrength(0.3), "weak");
      assert.strictEqual(getStatusFromStrength(0.4), "weak");
      assert.strictEqual(getStatusFromStrength(0.5), "weak");
      assert.strictEqual(getStatusFromStrength(0.59), "weak");
    });

    it("should return 'covered' for strength >= 0.6", () => {
      assert.strictEqual(getStatusFromStrength(0.6), "covered");
      assert.strictEqual(getStatusFromStrength(0.7), "covered");
      assert.strictEqual(getStatusFromStrength(0.8), "covered");
      assert.strictEqual(getStatusFromStrength(0.9), "covered");
      assert.strictEqual(getStatusFromStrength(1.0), "covered");
    });

    it("should handle edge cases", () => {
      assert.strictEqual(getStatusFromStrength(undefined), "missing");
      assert.strictEqual(getStatusFromStrength(null), "missing");
      assert.strictEqual(getStatusFromStrength(-0.5), "missing");
      assert.strictEqual(getStatusFromStrength(1.5), "covered"); // clamp to covered
    });
  });

  describe("Strength value constraints", () => {
    it("should allow strength values between 0 and 1", () => {
      const beats = generateBeatsForEvent({ type: "birthday" });

      // Modify beat strength (as engine would do)
      beats[0].strength = 0.65;

      assert.ok(beats[0].strength >= 0 && beats[0].strength <= 1);
    });

    it("should support decimal precision", () => {
      const beats = generateBeatsForEvent({ type: "birthday" });

      beats[0].strength = 0.73;
      assert.strictEqual(beats[0].strength, 0.73);
    });
  });
});

describe("State Integration with Strength", () => {
  const { createInitialState } = require("../../../src/writer/v2/state");
  const { generateBeatsForEvent } = require("../../../src/writer/v2/beats");

  it("should work with state initialization", () => {
    const state = createInitialState({
      recipientName: "Dad",
      occasion: "birthday",
      initialPrompt: "My dad is amazing",
    });

    // State starts with empty beats - they get set separately
    assert.ok(Array.isArray(state.beats));
  });

  it("should allow beat strength updates in state", () => {
    const state = createInitialState({
      recipientName: "Mom",
      occasion: "anniversary",
      initialPrompt: "Our 25th anniversary",
    });

    // Generate and set beats with strength
    const beats = generateBeatsForEvent({ type: state.event.occasion });
    state.beats = beats;

    // Update beat strength
    state.beats[0].strength = 0.8;

    assert.strictEqual(state.beats[0].strength, 0.8);
    assert.strictEqual(state.beats[0].status, undefined); // No categorical status
  });
});

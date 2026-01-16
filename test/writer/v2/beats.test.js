/**
 * V2 Beat Generation Tests
 * Tests for dynamic beat schema generation
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  generateBeatsForEvent,
  normalizeEventType,
  hasMinimumBeats,
  DEFAULT_BEATS,
} = require("../../../src/writer/v2/beats");

describe("V2 Beat Generation", () => {
  describe("generateBeatsForEvent", () => {
    it("should generate birth-specific beats for birth event", () => {
      const beats = generateBeatsForEvent({
        type: "birth",
        title: "Birth of twins",
      });

      const beatIds = beats.map(b => b.id);
      assert.ok(beatIds.includes("discovery"), "Should have discovery beat");
      assert.ok(beatIds.includes("birth_moment"), "Should have birth_moment beat");
      assert.ok(beats.length >= 5, "Should have at least 5 beats");
    });

    it("should generate loss-specific beats for loss/illness event", () => {
      const beats = generateBeatsForEvent({
        type: "loss",
        title: "Grandmother's passing",
      });

      const beatIds = beats.map(b => b.id);
      assert.ok(beatIds.includes("memory"), "Should have memory beat");
      assert.ok(beatIds.includes("meaning"), "Should have meaning beat");
    });

    it("should use default beats for unknown event types", () => {
      const beats = generateBeatsForEvent({
        type: "unknown",
        title: "Some event",
      });

      assert.ok(beats.length >= 4, "Should have at least 4 default beats");
    });

    it("should mark required beats correctly", () => {
      const beats = generateBeatsForEvent({
        type: "celebration",
        title: "Birthday",
      });

      const requiredBeats = beats.filter(b => b.required);
      assert.ok(requiredBeats.length >= 3, "Should have at least 3 required beats");
    });

    it("should initialize all beats with strength 0", () => {
      const beats = generateBeatsForEvent({
        type: "birthday",
        title: "First birthday",
      });

      const allZeroStrength = beats.every(b => b.strength === 0);
      assert.ok(allZeroStrength, "All beats should start with strength 0");
    });

    it("should initialize all beats with empty evidence array", () => {
      const beats = generateBeatsForEvent({
        type: "anniversary",
        title: "10 year anniversary",
      });

      const allEmptyEvidence = beats.every(b => Array.isArray(b.evidence) && b.evidence.length === 0);
      assert.ok(allEmptyEvidence, "All beats should have empty evidence array");
    });

    it("should return empty array for 'custom' event type (LLM generates beats)", () => {
      const beats = generateBeatsForEvent({
        type: "custom",
        title: "Career change story",
      });

      assert.strictEqual(beats.length, 0, "Custom event should return empty beats for LLM to generate");
    });

    it("should treat 'other' as custom event type", () => {
      const beats = generateBeatsForEvent({
        type: "other",
        title: "Unique story",
      });

      assert.strictEqual(beats.length, 0, "Other event type should return empty beats");
    });

    it("should treat 'unique' as custom event type", () => {
      const beats = generateBeatsForEvent({
        type: "unique",
        title: "One-of-a-kind story",
      });

      assert.strictEqual(beats.length, 0, "Unique event type should return empty beats");
    });
  });

  describe("normalizeEventType", () => {
    it("should map birth-related terms to birth", () => {
      assert.strictEqual(normalizeEventType("birth"), "birth");
      assert.strictEqual(normalizeEventType("baby"), "birth");
      assert.strictEqual(normalizeEventType("pregnancy"), "birth");
      assert.strictEqual(normalizeEventType("twins"), "birth");
    });

    it("should map loss-related terms to loss", () => {
      assert.strictEqual(normalizeEventType("death"), "loss");
      assert.strictEqual(normalizeEventType("loss"), "loss");
      assert.strictEqual(normalizeEventType("passing"), "loss");
      assert.strictEqual(normalizeEventType("memorial"), "loss");
    });

    it("should map illness-related terms to illness", () => {
      assert.strictEqual(normalizeEventType("sick"), "illness");
      assert.strictEqual(normalizeEventType("cancer"), "illness");
      assert.strictEqual(normalizeEventType("surgery"), "illness");
    });

    it("should return default for unknown types", () => {
      assert.strictEqual(normalizeEventType("random"), "default");
      assert.strictEqual(normalizeEventType("xyz"), "default");
    });

    it("should handle null/undefined gracefully", () => {
      assert.strictEqual(normalizeEventType(null), "default");
      assert.strictEqual(normalizeEventType(undefined), "default");
    });

    it("should be case insensitive", () => {
      assert.strictEqual(normalizeEventType("BIRTH"), "birth");
      assert.strictEqual(normalizeEventType("Birthday"), "birthday");
      assert.strictEqual(normalizeEventType("LOSS"), "loss");
    });

    it("should map custom-related terms to custom", () => {
      assert.strictEqual(normalizeEventType("custom"), "custom");
      assert.strictEqual(normalizeEventType("other"), "custom");
      assert.strictEqual(normalizeEventType("unique"), "custom");
      assert.strictEqual(normalizeEventType("CUSTOM"), "custom");
    });
  });

  describe("hasMinimumBeats", () => {
    it("should return true when scene, stakes, turning_point, meaning are covered", () => {
      const beats = [
        { id: "scene", status: "covered" },
        { id: "stakes", status: "covered" },
        { id: "turning_point", status: "covered" },
        { id: "meaning", status: "covered" },
      ];

      assert.strictEqual(hasMinimumBeats(beats), true);
    });

    it("should accept equivalent beats (discovery for scene, etc.)", () => {
      const beats = [
        { id: "discovery", status: "covered" }, // equivalent to scene
        { id: "scare", status: "covered" },     // equivalent to stakes
        { id: "birth_moment", status: "covered" }, // equivalent to turning_point
        { id: "meaning", status: "covered" },
      ];

      assert.strictEqual(hasMinimumBeats(beats), true);
    });

    it("should return false when required beats are missing", () => {
      const beats = [
        { id: "scene", status: "covered" },
        { id: "stakes", status: "missing" },
        { id: "turning_point", status: "covered" },
        { id: "meaning", status: "covered" },
      ];

      assert.strictEqual(hasMinimumBeats(beats), false);
    });

    it("should return false when meaning is missing", () => {
      const beats = [
        { id: "scene", status: "covered" },
        { id: "stakes", status: "covered" },
        { id: "turning_point", status: "covered" },
        { id: "meaning", status: "weak" }, // weak != covered
      ];

      assert.strictEqual(hasMinimumBeats(beats), false);
    });

    it("should return false for LLM-generated beats with custom IDs (documented behavior)", () => {
      // LLM-generated beats for custom events may use non-standard IDs
      // that don't map to the hardcoded equivalents.
      // For custom events, trust the LLM's CONFIRM decision instead.
      const llmGeneratedBeats = [
        { id: "career_shift", strength: 0.9 },   // Doesn't map to "scene"
        { id: "mentor_moment", strength: 0.8 }, // Doesn't map to "stakes"
        { id: "breakthrough", strength: 0.7 },  // Doesn't map to "turning_point"
        { id: "meaning", strength: 0.85 },      // This one matches!
      ];

      // Expected: false - only "meaning" maps correctly
      // This is documented behavior - use LLM CONFIRM for custom events
      assert.strictEqual(hasMinimumBeats(llmGeneratedBeats), false);
    });
  });

  describe("DEFAULT_BEATS", () => {
    it("should have the four required story elements", () => {
      const beatIds = DEFAULT_BEATS.map(b => b.id);

      assert.ok(beatIds.includes("scene"), "Should have scene");
      assert.ok(beatIds.includes("stakes"), "Should have stakes");
      assert.ok(beatIds.includes("turning_point"), "Should have turning_point");
      assert.ok(beatIds.includes("meaning"), "Should have meaning");
    });
  });
});

/**
 * Trust LLM Beat Assessment Tests
 *
 * Tests that the engine trusts LLM strength assessments without
 * char-count overrides. The harness only validates structural integrity.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { reconcileBeats } = require("../../../src/writer/v2/engine");

describe("Trust LLM Beat Assessment", () => {
  describe("reconcileBeats with strength", () => {
    it("should trust LLM strength even for short evidence", () => {
      const existingBeats = [
        { id: "meaning", purpose: "what it means", required: true, strength: 0, evidence: [] },
      ];

      const llmBeats = [
        { id: "meaning", strength: 0.8, evidence: ["f1"] }, // LLM says strong
      ];

      const facts = [
        { id: "f1", text: "He died" }, // Only 7 chars but meaningful
      ];

      const result = reconcileBeats(existingBeats, llmBeats, facts);

      // Should trust LLM's 0.8 strength, NOT demote based on char count
      assert.strictEqual(result[0].strength, 0.8, "Should trust LLM strength");
      assert.deepStrictEqual(result[0].evidence, ["f1"], "Should preserve valid evidence");
    });

    it("should validate that evidence IDs exist", () => {
      const existingBeats = [
        { id: "scene", purpose: "where it happened", required: true, strength: 0, evidence: [] },
      ];

      const llmBeats = [
        { id: "scene", strength: 0.9, evidence: ["f1", "f99"] }, // f99 doesn't exist
      ];

      const facts = [
        { id: "f1", text: "At the lake" },
      ];

      const result = reconcileBeats(existingBeats, llmBeats, facts);

      // Should filter invalid evidence but TRUST the LLM's strength
      assert.deepStrictEqual(result[0].evidence, ["f1"], "Should filter invalid evidence IDs");
      assert.strictEqual(result[0].strength, 0.9, "Should trust LLM strength even with filtered evidence");
    });

    it("should preserve existing beat metadata", () => {
      const existingBeats = [
        { id: "stakes", purpose: "what was at risk", required: true, strength: 0.2, evidence: ["old1"] },
      ];

      const llmBeats = [
        { id: "stakes", strength: 0.7, evidence: ["f1", "f2"] },
      ];

      const facts = [
        { id: "f1", text: "Dad was sick" },
        { id: "f2", text: "Doctors said weeks" },
      ];

      const result = reconcileBeats(existingBeats, llmBeats, facts);

      assert.strictEqual(result[0].purpose, "what was at risk", "Should preserve purpose");
      assert.strictEqual(result[0].required, true, "Should preserve required flag");
      assert.strictEqual(result[0].strength, 0.7, "Should use LLM strength");
      assert.deepStrictEqual(result[0].evidence, ["f1", "f2"], "Should use LLM evidence");
    });

    it("should handle beat with no evidence", () => {
      const existingBeats = [
        { id: "sensory", purpose: "sensory detail", required: false, strength: 0, evidence: [] },
      ];

      const llmBeats = [
        { id: "sensory", strength: 0.5, evidence: [] }, // LLM says partially covered, no evidence
      ];

      const facts = [];

      const result = reconcileBeats(existingBeats, llmBeats, facts);

      // Trust LLM even with no evidence - it may have assessed from narrative
      assert.strictEqual(result[0].strength, 0.5, "Should trust LLM strength");
      assert.deepStrictEqual(result[0].evidence, [], "Should preserve empty evidence");
    });

    it("should work with legacy status field for backward compatibility", () => {
      const existingBeats = [
        { id: "meaning", purpose: "what it means", required: true, status: "missing", evidence: [] },
      ];

      const llmBeats = [
        { id: "meaning", status: "covered", evidence: ["f1"] }, // Old-style status
      ];

      const facts = [
        { id: "f1", text: "Short" }, // Only 5 chars
      ];

      const result = reconcileBeats(existingBeats, llmBeats, facts);

      // Should NOT demote based on char count anymore
      // Legacy status should be preserved as-is
      assert.strictEqual(result[0].status, "covered", "Should not demote legacy status based on char count");
    });
  });

  describe("edge cases", () => {
    it("should handle empty llmBeats array", () => {
      const existingBeats = [
        { id: "meaning", strength: 0.5, evidence: [] },
      ];

      const result = reconcileBeats(existingBeats, [], []);

      assert.strictEqual(result.length, 0, "Should return empty array for empty llmBeats");
    });

    it("should handle null/undefined inputs gracefully", () => {
      const result = reconcileBeats(null, [], []);
      assert.strictEqual(result.length, 0);

      // V3: Return existing beats (empty array) instead of null for safety
      const result2 = reconcileBeats([], null, []);
      assert.deepStrictEqual(result2, [], "Should return empty array for null llmBeats");

      // With existing beats, should preserve them when llmBeats is null
      const existing = [{ id: "scene", strength: 0.5 }];
      const result3 = reconcileBeats(existing, null, []);
      assert.deepStrictEqual(result3, existing, "Should return existing beats for null llmBeats");
    });
  });
});

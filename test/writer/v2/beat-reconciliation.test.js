/**
 * V2 Beat Reconciliation Tests
 *
 * Tests that beat assessments are validated against extracted facts,
 * preventing beats from being marked "covered" without valid evidence.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("V2 Beat Reconciliation", () => {
  const { reconcileBeats } = require("../../../src/writer/v2/engine");

  it("should mark beat as covered only if evidence exists in facts", () => {
    const existingBeats = [
      { id: "scene", status: "missing", evidence: [], required: true },
      { id: "meaning", status: "missing", evidence: [], required: true },
      { id: "turning_point", status: "missing", evidence: [], required: true },
    ];

    const facts = [
      { id: "f1", text: "Dad taught me to fish at the lake every summer" },
      { id: "f2", text: "He's my hero and always believed in me" },
    ];

    const llmBeats = [
      { id: "scene", status: "covered", evidence: ["f1"] },         // Valid - f1 exists
      { id: "meaning", status: "covered", evidence: ["f2"] },       // Valid - f2 exists
      { id: "turning_point", status: "covered", evidence: ["f99"] }, // Invalid - f99 doesn't exist
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    // scene and meaning should be covered (valid evidence)
    assert.strictEqual(reconciled.find(b => b.id === "scene").status, "covered");
    assert.strictEqual(reconciled.find(b => b.id === "meaning").status, "covered");

    // turning_point should NOT be covered (invalid evidence)
    assert.strictEqual(reconciled.find(b => b.id === "turning_point").status, "missing");
  });

  it("should demote beat to weak if evidence is thin", () => {
    const existingBeats = [
      { id: "meaning", status: "missing", evidence: [], required: true },
    ];

    const facts = [
      { id: "f1", text: "ok" }, // Very short fact (< 20 chars total)
    ];

    const llmBeats = [
      { id: "meaning", status: "covered", evidence: ["f1"] },
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    // Should be "weak" not "covered" because evidence is thin
    assert.strictEqual(reconciled.find(b => b.id === "meaning").status, "weak");
  });

  it("should preserve required and purpose from existing beats", () => {
    const existingBeats = [
      { id: "scene", status: "missing", evidence: [], required: true, purpose: "where it happened" },
    ];

    const facts = [
      { id: "f1", text: "It happened at the lake in summer" },
    ];

    const llmBeats = [
      { id: "scene", status: "covered", evidence: ["f1"] },
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    const sceneBeat = reconciled.find(b => b.id === "scene");
    assert.strictEqual(sceneBeat.required, true);
    assert.strictEqual(sceneBeat.purpose, "where it happened");
  });

  it("should handle empty evidence array", () => {
    const existingBeats = [
      { id: "stakes", status: "missing", evidence: [], required: false },
    ];

    const facts = [
      { id: "f1", text: "The stakes were high" },
    ];

    const llmBeats = [
      { id: "stakes", status: "covered", evidence: [] }, // No evidence provided
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    // Should be "missing" because no evidence was provided
    assert.strictEqual(reconciled.find(b => b.id === "stakes").status, "missing");
  });

  it("should strip invalid evidence IDs from the result", () => {
    const existingBeats = [
      { id: "character", status: "missing", evidence: [], required: true },
    ];

    const facts = [
      { id: "f1", text: "Dad is kind and patient" },
    ];

    const llmBeats = [
      { id: "character", status: "covered", evidence: ["f1", "f99", "f100"] }, // f99 and f100 invalid
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    const charBeat = reconciled.find(b => b.id === "character");
    // Only valid evidence should remain
    assert.deepStrictEqual(charBeat.evidence, ["f1"]);
  });
});

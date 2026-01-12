/**
 * V2 Beat Reconciliation Tests
 *
 * V3 Update: Reconciliation now trusts LLM assessments.
 * The harness only validates structural integrity (evidence IDs exist).
 * No char-count overrides or status demotion based on evidence quality.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("V2 Beat Reconciliation", () => {
  const { reconcileBeats } = require("../../../src/writer/v2/engine");

  it("should filter invalid evidence IDs but trust LLM status", () => {
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
      { id: "turning_point", status: "covered", evidence: ["f99"] }, // Invalid evidence - f99 doesn't exist
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    // V3: Trust LLM status, but filter invalid evidence
    assert.strictEqual(reconciled.find(b => b.id === "scene").status, "covered");
    assert.strictEqual(reconciled.find(b => b.id === "meaning").status, "covered");

    // V3: Trust LLM status even when evidence was invalid (filtered)
    // The LLM may have assessed from narrative, not just facts
    assert.strictEqual(reconciled.find(b => b.id === "turning_point").status, "covered");
    assert.deepStrictEqual(reconciled.find(b => b.id === "turning_point").evidence, []);
  });

  it("should trust LLM status regardless of evidence length (v3 - no char-count override)", () => {
    const existingBeats = [
      { id: "meaning", status: "missing", evidence: [], required: true },
    ];

    const facts = [
      { id: "f1", text: "ok" }, // Very short fact (< 20 chars)
    ];

    const llmBeats = [
      { id: "meaning", status: "covered", evidence: ["f1"] },
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    // V3: Trust LLM - no demotion based on char count
    assert.strictEqual(reconciled.find(b => b.id === "meaning").status, "covered");
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

  it("should trust LLM status even with empty evidence (v3)", () => {
    const existingBeats = [
      { id: "stakes", status: "missing", evidence: [], required: false },
    ];

    const facts = [
      { id: "f1", text: "The stakes were high" },
    ];

    const llmBeats = [
      { id: "stakes", status: "covered", evidence: [] }, // No evidence but LLM says covered
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    // V3: Trust LLM - it may have assessed from narrative not facts
    assert.strictEqual(reconciled.find(b => b.id === "stakes").status, "covered");
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
    // Only valid evidence should remain (structural check)
    assert.deepStrictEqual(charBeat.evidence, ["f1"]);
    // But status is trusted
    assert.strictEqual(charBeat.status, "covered");
  });

  it("should work with strength-based beats (v3 schema)", () => {
    const existingBeats = [
      { id: "memory", strength: 0, evidence: [], required: true },
    ];

    const facts = [
      { id: "f1", text: "Short" }, // Short evidence
    ];

    const llmBeats = [
      { id: "memory", strength: 0.85, evidence: ["f1"] },
    ];

    const reconciled = reconcileBeats(existingBeats, llmBeats, facts);

    // V3: Trust LLM strength - no char-count demotion
    assert.strictEqual(reconciled.find(b => b.id === "memory").strength, 0.85);
  });
});

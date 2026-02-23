/**
 * V2 Monitoring Tests
 *
 * Tests for observability and anomaly detection.
 * Monitoring observes without affecting behavior.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  checkForAnomalies,
  detectStuckPattern,
  calculateHealthScore,
  ANOMALY_THRESHOLDS,
} = require("../../../src/writer/v3/monitor");

describe("V2 Monitoring - checkForAnomalies", () => {
  it("should flag high turn count with low content", () => {
    const state = {
      turn_count: 12,
      facts: [{ text: "one fact" }],
      narrative: "Short.",
    };

    const anomalies = checkForAnomalies(state);

    assert.ok(anomalies.some((a) => a.type === "high_turn_low_content"));
    const anomaly = anomalies.find((a) => a.type === "high_turn_low_content");
    assert.ok(anomaly.severity === "warning" || anomaly.severity === "critical");
  });

  it("should not flag high turn count with adequate content", () => {
    const state = {
      turn_count: 12,
      facts: [
        { text: "fact one" },
        { text: "fact two" },
        { text: "fact three" },
        { text: "fact four" },
        { text: "fact five" },
      ],
      narrative:
        "This is a detailed narrative with plenty of content about the recipient and their story.",
    };

    const anomalies = checkForAnomalies(state);

    assert.ok(!anomalies.some((a) => a.type === "high_turn_low_content"));
  });

  it("should flag very low content ratio", () => {
    const state = {
      turn_count: 8,
      facts: [],
      narrative: "",
    };

    const anomalies = checkForAnomalies(state);

    assert.ok(anomalies.some((a) => a.type === "low_content_ratio"));
  });

  it("should return empty array for healthy state", () => {
    const state = {
      turn_count: 4,
      facts: [{ text: "fact one" }, { text: "fact two" }, { text: "fact three" }],
      narrative: "A good amount of narrative content here.",
      beats: [
        { purpose: "relationship", strength: 0.7 },
        { purpose: "personality", strength: 0.6 },
      ],
    };

    const anomalies = checkForAnomalies(state);

    assert.strictEqual(anomalies.length, 0);
  });

  it("should handle missing or undefined state fields gracefully", () => {
    const anomalies = checkForAnomalies({});

    // Should not throw, may or may not flag based on implementation
    assert.ok(Array.isArray(anomalies));
  });

  it("should flag near-maximum turns", () => {
    const state = {
      turn_count: 18,
      facts: [{ text: "f1" }, { text: "f2" }],
      narrative: "Some content",
    };

    const anomalies = checkForAnomalies(state);

    assert.ok(anomalies.some((a) => a.type === "approaching_max_turns"));
  });
});

describe("V2 Monitoring - detectStuckPattern", () => {
  it("should detect repeated questions on same beat", () => {
    const history = [
      { action: "ASK", beat_target: "relationship" },
      { action: "ASK", beat_target: "relationship" },
      { action: "ASK", beat_target: "relationship" },
    ];

    const stuck = detectStuckPattern(history);

    assert.ok(stuck.isStuck);
    assert.strictEqual(stuck.stuckOn, "relationship");
    assert.strictEqual(stuck.count, 3);
  });

  it("should not flag varied beat progression", () => {
    const history = [
      { action: "ASK", beat_target: "relationship" },
      { action: "ASK", beat_target: "personality" },
      { action: "ASK", beat_target: "memory" },
    ];

    const stuck = detectStuckPattern(history);

    assert.ok(!stuck.isStuck);
  });

  it("should handle empty history", () => {
    const stuck = detectStuckPattern([]);

    assert.ok(!stuck.isStuck);
  });

  it("should handle history with non-ASK actions", () => {
    const history = [
      { action: "ASK", beat_target: "relationship" },
      { action: "CLARIFY", beat_target: null },
      { action: "ASK", beat_target: "relationship" },
    ];

    const stuck = detectStuckPattern(history);

    // CLARIFY breaks the stuck pattern
    assert.ok(!stuck.isStuck);
  });

  it("should only consider recent history", () => {
    const history = [
      { action: "ASK", beat_target: "relationship" },
      { action: "ASK", beat_target: "relationship" },
      { action: "ASK", beat_target: "relationship" },
      { action: "ASK", beat_target: "personality" },
      { action: "ASK", beat_target: "memory" },
      { action: "ASK", beat_target: "occasion" },
    ];

    const stuck = detectStuckPattern(history);

    // The stuck pattern is old, recent history is varied
    assert.ok(!stuck.isStuck);
  });
});

describe("V2 Monitoring - calculateHealthScore", () => {
  it("should return high score for ideal state", () => {
    const state = {
      turn_count: 5,
      facts: [{ text: "f1" }, { text: "f2" }, { text: "f3" }, { text: "f4" }],
      // 100+ chars narrative for full score
      narrative:
        "A substantial narrative with good detail about the person, their hobbies, their family, and their special moments together.",
      beats: [
        { purpose: "relationship", strength: 0.8 },
        { purpose: "personality", strength: 0.7 },
        { purpose: "memory", strength: 0.6 },
      ],
    };

    const score = calculateHealthScore(state);

    // With 4 facts, 100+ chars narrative, 0.7 avg beat strength, good efficiency
    // Expected: ~91 (40 content + 21 beats + 30 efficiency)
    assert.ok(score >= 85, `Expected score >= 85, got ${score}`);
  });

  it("should return lower score for sparse content", () => {
    const state = {
      turn_count: 8,
      facts: [{ text: "one" }],
      narrative: "Short",
      beats: [{ purpose: "relationship", strength: 0.3 }],
    };

    const score = calculateHealthScore(state);

    assert.ok(score < 50);
  });

  it("should penalize high turns with low progress", () => {
    const lowTurns = {
      turn_count: 3,
      facts: [{ text: "one" }],
      narrative: "Short",
    };
    const highTurns = {
      turn_count: 10,
      facts: [{ text: "one" }],
      narrative: "Short",
    };

    const lowScore = calculateHealthScore(lowTurns);
    const highScore = calculateHealthScore(highTurns);

    // Same content, more turns = lower health
    assert.ok(highScore < lowScore);
  });

  it("should return 0-100 range", () => {
    const states = [
      {},
      { turn_count: 0 },
      { turn_count: 20, facts: [], narrative: "" },
      { turn_count: 5, facts: [{ text: "x" }] },
    ];

    for (const state of states) {
      const score = calculateHealthScore(state);
      assert.ok(score >= 0, `Score ${score} should be >= 0`);
      assert.ok(score <= 100, `Score ${score} should be <= 100`);
    }
  });
});

describe("V2 Monitoring - ANOMALY_THRESHOLDS", () => {
  it("should export threshold constants", () => {
    assert.ok(typeof ANOMALY_THRESHOLDS === "object");
    assert.ok(typeof ANOMALY_THRESHOLDS.highTurnThreshold === "number");
    assert.ok(typeof ANOMALY_THRESHOLDS.minContentPerTurn === "number");
    assert.ok(typeof ANOMALY_THRESHOLDS.stuckThreshold === "number");
  });

  it("should have reasonable default values", () => {
    // High turn threshold should be below safety max (20)
    assert.ok(ANOMALY_THRESHOLDS.highTurnThreshold <= 15);

    // Stuck threshold should require 3+ repetitions
    assert.ok(ANOMALY_THRESHOLDS.stuckThreshold >= 3);
  });
});

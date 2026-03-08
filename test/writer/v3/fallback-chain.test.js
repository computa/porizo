const { describe, it } = require("node:test");
const assert = require("node:assert");

const { reasonWithFallback } = require("../../../src/writer/v3/reasoner");

function createState(overrides = {}) {
  return {
    recipient_name: "Chioma",
    event: { occasion: "mother's day", type: "mothers_day" },
    narrative: "Chioma keeps the home steady.",
    facts: [
      { id: "f1", text: "She carries the home" },
      { id: "f2", text: "She stayed strong in a high-risk pregnancy" },
    ],
    beats: [
      { id: "setting", purpose: "where it happened", strength: 0.5, required: true },
      { id: "moment", purpose: "the turning moment", strength: 0.7, required: true },
    ],
    conversation: [],
    turn_count: 2,
    dials: {},
    ...overrides,
  };
}

describe("V3 fallback chain", () => {
  it("recovers from primary JSON parse failure with lightweight fallback", async () => {
    let callCount = 0;
    const result = await reasonWithFallback(createState(), "I will never forget the high-risk pregnancy.", {
      _generateTextFn: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            text: "{\"action\":\"ASK\",\"question\":\"broken\"",
          };
        }
        return {
          text: "{\"action\":\"CONFIRM\",\"message\":\"This already feels complete.\"}",
        };
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.tier, "lightweight");
    assert.strictEqual(result.fallback, true);
    assert.strictEqual(result.data.action, "CONFIRM");
    assert.strictEqual(callCount, 2);
  });
});

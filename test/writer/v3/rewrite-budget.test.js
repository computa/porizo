const test = require("node:test");
const assert = require("node:assert/strict");

const { __internal } = require("../../../src/writer/v3");

test("confirmation rewrite refuses oversized prose instead of building a huge LLM prompt", async () => {
  const longProse = "This is an important family story with many details. ".repeat(160);
  const rewritten = await __internal.rewriteNarrativeWithMissingDetails(
    longProse,
    ["a required missing detail"],
    "Chioma"
  );

  assert.equal(rewritten, null);
});

// test/services/artwork-vars-extractor.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractArtworkVars,
  parseHaikuResponse,
} = require("../../src/services/artwork-vars-extractor");

test("parseHaikuResponse parses valid JSON with all slots", () => {
  const raw = JSON.stringify({
    species: "ranunculus",
    lighting: "morning_window",
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  });
  const parsed = parseHaikuResponse(raw, "mothers_day");
  assert.equal(parsed.species, "ranunculus");
  assert.equal(parsed.lighting, "morning_window");
});

test("parseHaikuResponse falls back to occasion defaults on invalid lighting", () => {
  const raw = JSON.stringify({
    species: "ranunculus",
    lighting: "neon_dance_floor", // invalid
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  });
  const parsed = parseHaikuResponse(raw, "mothers_day");
  assert.equal(parsed.lighting, "morning_window"); // default for mothers_day
  assert.equal(parsed.species, "ranunculus"); // unchanged
});

test("parseHaikuResponse falls back to occasion defaults on cross-occasion species", () => {
  const raw = JSON.stringify({
    species: "white calla lily", // valid for bereavement, not mothers_day
    lighting: "morning_window",
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  });
  const parsed = parseHaikuResponse(raw, "mothers_day");
  assert.equal(parsed.species, "ranunculus"); // mothers_day default
});

test("parseHaikuResponse returns full defaults on completely malformed JSON", () => {
  const parsed = parseHaikuResponse("not even json {{{", "mothers_day");
  assert.equal(parsed.species, "ranunculus");
  assert.equal(parsed.lighting, "morning_window");
  assert.equal(parsed.palette, "dusty_rose");
});

test("extractArtworkVars stubs Haiku and returns picks", async () => {
  const fakeHaiku = async ({ prompt, systemPrompt }) => {
    assert.ok(prompt.includes("I knew you as a young girl"));
    assert.ok(systemPrompt.includes("artwork variables"));
    return {
      text: JSON.stringify({
        species: "ranunculus",
        lighting: "morning_window",
        palette: "dusty_rose",
        density: "intimate_cluster",
        imperfection: "one outer petal slightly bruised at the tip",
        backdrop: "cream_cloud",
      }),
    };
  };
  const result = await extractArtworkVars({
    lyrics: "I knew you as a young girl but I watched you grow",
    occasion: "mothers_day",
    haikuClient: fakeHaiku,
  });
  assert.equal(result.species, "ranunculus");
  assert.equal(result.picked_by, "haiku");
  assert.ok(result.picked_at);
});

test("extractArtworkVars falls back to defaults on Haiku failure", async () => {
  const failingHaiku = async () => {
    throw new Error("503 service unavailable");
  };
  const result = await extractArtworkVars({
    lyrics: "any lyrics",
    occasion: "mothers_day",
    haikuClient: failingHaiku,
  });
  assert.equal(result.species, "ranunculus"); // default
  assert.equal(result.picked_by, "fallback_occasion_default");
});

test("extractArtworkVars falls back on Haiku timeout", async () => {
  const slowHaiku = () =>
    new Promise((r) => setTimeout(() => r({ text: "{}" }), 30000));
  const result = await extractArtworkVars({
    lyrics: "any",
    occasion: "mothers_day",
    haikuClient: slowHaiku,
    timeoutMs: 50,
  });
  assert.equal(result.picked_by, "fallback_occasion_default");
});

test("vars_extractor lane routes to Haiku 4.5 (spec §6.4)", () => {
  // Regression guard: a prior session shipped this on taskType:"simple"
  // (Haiku 3) by accident — fixed in commit 10fa049. The dedicated lane MUST
  // resolve to Haiku 4.5; that explicit assertion is the real protection.
  //
  // NOTE: the anthropic "simple" lane is currently ALSO Haiku 4.5 ("kept in
  // sync", llm-provider.js), so distinctness can't be asserted by model string.
  // If the simple lane is moved off Haiku 4.5 (a stashed change does exactly
  // that), re-add: assert.notEqual(varsLane, simpleLane).
  const { resolveProviderModel } = require("../../src/services/llm-provider");
  const varsLane = resolveProviderModel("anthropic", "vars_extractor");
  assert.equal(
    varsLane,
    "claude-haiku-4-5-20251001",
    "vars extractor must run on Haiku 4.5",
  );
});

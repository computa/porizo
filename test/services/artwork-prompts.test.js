// test/services/artwork-prompts.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROMPT_TEMPLATE_VERSION,
  assemblePrompt,
  assembleNegativePrompt,
} = require("../../src/services/artwork-prompts");

test("PROMPT_TEMPLATE_VERSION is a non-empty string", () => {
  assert.ok(typeof PROMPT_TEMPLATE_VERSION === "string");
  assert.ok(PROMPT_TEMPLATE_VERSION.length > 0);
});

test("assemblePrompt produces a deterministic string from valid vars", () => {
  const vars = {
    species: "ranunculus",
    lighting: "morning_window",
    palette: "dusty_rose",
    density: "intimate_cluster",
    imperfection: "one outer petal slightly bruised at the tip",
    backdrop: "cream_cloud",
  };
  const out = assemblePrompt({ occasion: "mothers_day", vars });
  assert.ok(out.includes("ranunculus"), "missing species");
  assert.ok(out.includes("small loose cluster"), "missing density phrase");
  assert.ok(out.includes("north-facing window"), "missing lighting phrase");
  assert.ok(out.includes("#F2D7D5"), "missing palette hex");
  assert.ok(out.includes("Fuji X-T5"), "missing camera language");
  assert.ok(out.includes("bruised at the tip"), "missing imperfection");
  assert.ok(out.includes("cream cloud backdrop"), "missing backdrop");
});

test("assemblePrompt is deterministic — same input yields same output", () => {
  const vars = {
    species: "peony",
    lighting: "golden_hour",
    palette: "warm_cream",
    density: "single_bloom",
    imperfection: "left edge of the composition slightly out of focus",
    backdrop: "garden_bokeh",
  };
  const a = assemblePrompt({ occasion: "birthday", vars });
  const b = assemblePrompt({ occasion: "birthday", vars });
  assert.equal(a, b);
});

test("assembleNegativePrompt returns the full negative list", () => {
  const neg = assembleNegativePrompt();
  for (const banned of [
    "no text",
    "no people",
    "no faces",
    "no hands",
    "no vases",
    "no AI-render gloss",
    "no plastic finish",
    "no symmetrical perfection",
  ]) {
    assert.ok(neg.includes(banned), `negative prompt missing "${banned}"`);
  }
});

test("assemblePrompt throws on unknown occasion", () => {
  const vars = {
    species: "peony",
    lighting: "morning_window",
    palette: "warm_cream",
    density: "single_bloom",
    imperfection: IMPERF_0(),
    backdrop: "cream_cloud",
  };
  assert.throws(
    () => assemblePrompt({ occasion: "halloween", vars }),
    /unknown occasion/i,
  );
});

test("assemblePrompt throws on invalid slot value", () => {
  const vars = {
    species: "peony",
    lighting: "neon_dance_floor",
    palette: "warm_cream",
    density: "single_bloom",
    imperfection: IMPERF_0(),
    backdrop: "cream_cloud",
  };
  assert.throws(
    () => assemblePrompt({ occasion: "birthday", vars }),
    /invalid lighting/i,
  );
});

function IMPERF_0() {
  return "one outer petal slightly bruised at the tip";
}

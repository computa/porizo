const test = require("node:test");
const assert = require("node:assert/strict");

const { extractFirstJsonObject } = require("../../src/utils/common");

test("extractFirstJsonObject returns null for empty / non-string / no-brace input", () => {
  assert.equal(extractFirstJsonObject(""), null);
  assert.equal(extractFirstJsonObject(null), null);
  assert.equal(extractFirstJsonObject(undefined), null);
  assert.equal(extractFirstJsonObject("plain prose with no JSON"), null);
});

test("extractFirstJsonObject extracts a plain top-level object", () => {
  const out = extractFirstJsonObject('{"action":"ASK","question":"go on"}');
  assert.equal(out, '{"action":"ASK","question":"go on"}');
  assert.deepEqual(JSON.parse(out), { action: "ASK", question: "go on" });
});

test("extractFirstJsonObject strips ```json fences wrapping the entire payload", () => {
  const fenced = '```json\n{"action":"CONFIRM"}\n```';
  assert.equal(extractFirstJsonObject(fenced), '{"action":"CONFIRM"}');
});

test("extractFirstJsonObject strips bare ``` fences (no language tag)", () => {
  const fenced = '```\n{"x":1}\n```';
  assert.equal(extractFirstJsonObject(fenced), '{"x":1}');
});

test("extractFirstJsonObject ignores prose preceding the JSON", () => {
  const text = 'Here is the response:\n\n{"action":"ASK","question":"continue"}';
  assert.equal(extractFirstJsonObject(text), '{"action":"ASK","question":"continue"}');
});

test("extractFirstJsonObject returns ONLY the first object when LLM echoes input alongside output", () => {
  // The greedy `/{[\s\S]*}/` regex would concatenate both blobs into a string
  // that fails JSON.parse. The balanced-brace walk must stop at the first close.
  const text = '{"prior":"input"}\n\nresponse:\n{"action":"CONFIRM"}';
  const out = extractFirstJsonObject(text);
  assert.equal(out, '{"prior":"input"}');
  assert.deepEqual(JSON.parse(out), { prior: "input" });
});

test("extractFirstJsonObject handles nested objects and arrays", () => {
  const text = '{"a":{"b":[1,{"c":2}]},"d":3}';
  const out = extractFirstJsonObject(text);
  assert.equal(out, text);
  assert.deepEqual(JSON.parse(out), { a: { b: [1, { c: 2 }] }, d: 3 });
});

test("extractFirstJsonObject does not break on braces inside string values", () => {
  // Braces inside quoted strings must not affect the depth counter, and the
  // closing-quote escape must be honored so escaped quotes inside strings
  // don't end the string state prematurely.
  const text = '{"msg":"value with } and { and \\"quoted\\" parts","ok":true}';
  const out = extractFirstJsonObject(text);
  assert.equal(out, text);
  assert.deepEqual(JSON.parse(out), {
    msg: 'value with } and { and "quoted" parts',
    ok: true,
  });
});

test("extractFirstJsonObject returns null on unterminated JSON", () => {
  assert.equal(extractFirstJsonObject('{"a":1, "b":'), null);
});

test("extractFirstJsonObject handles trailing prose after the object", () => {
  const text = '{"action":"ASK"}\n\nLet me know if you need more.';
  assert.equal(extractFirstJsonObject(text), '{"action":"ASK"}');
});

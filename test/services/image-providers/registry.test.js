const test = require("node:test");
const assert = require("node:assert/strict");
const { getImageProvider } = require("../../../src/services/image-providers");

test("getImageProvider('openai') returns the OpenAI adapter", () => {
  const p = getImageProvider("openai");
  assert.equal(p.name, "openai");
});

test("getImageProvider('flux') returns the Flux adapter", () => {
  const p = getImageProvider("flux");
  assert.equal(p.name, "flux");
  assert.equal(typeof p.generate, "function");
});

test("getImageProvider() honours IMAGE_PROVIDER env var", () => {
  const saved = process.env.IMAGE_PROVIDER;
  process.env.IMAGE_PROVIDER = "flux";
  const p = getImageProvider();
  assert.equal(p.name, "flux");
  if (saved == null) delete process.env.IMAGE_PROVIDER;
  else process.env.IMAGE_PROVIDER = saved;
});

test("getImageProvider throws on unknown", () => {
  assert.throws(() => getImageProvider("midjourney"), /Unknown image provider/);
});

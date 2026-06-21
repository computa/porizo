const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isAppContext } = require("../src/utils/request-context");

describe("isAppContext", () => {
  it("is true when x-device-token header is present", () => {
    assert.equal(isAppContext({ headers: { "x-device-token": "abc" } }), true);
  });
  it("is true when x-device-id + x-platform headers are present", () => {
    assert.equal(
      isAppContext({ headers: { "x-device-id": "dev1", "x-platform": "ios" } }),
      true,
    );
  });
  it("is true for a PorizoApp User-Agent", () => {
    assert.equal(
      isAppContext({ headers: { "user-agent": "PorizoApp/1.6.0 (42; iOS)" } }),
      true,
    );
  });
  it("is false when only x-device-id is present (requires both id + platform)", () => {
    assert.equal(isAppContext({ headers: { "x-device-id": "dev1" } }), false);
    assert.equal(isAppContext({ headers: { "x-platform": "ios" } }), false);
  });
  it("is false for a plain browser request", () => {
    assert.equal(
      isAppContext({ headers: { "user-agent": "Mozilla/5.0 (iPhone)" } }),
      false,
    );
  });
  it("is false with no headers", () => {
    assert.equal(isAppContext({}), false);
    assert.equal(isAppContext({ headers: {} }), false);
  });
});

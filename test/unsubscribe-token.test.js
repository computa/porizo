const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

// Set a deterministic secret before requiring the util (it reads env lazily).
process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";

const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} = require("../src/utils/unsubscribe-token");

describe("unsubscribe token", () => {
  test("a freshly signed token verifies for the same user", () => {
    const token = signUnsubscribeToken("user_123");
    assert.ok(token.length > 0);
    assert.equal(verifyUnsubscribeToken("user_123", token), true);
  });

  test("a token for one user does not verify for another", () => {
    const token = signUnsubscribeToken("user_123");
    assert.equal(verifyUnsubscribeToken("user_456", token), false);
  });

  test("a tampered token is rejected", () => {
    const token = signUnsubscribeToken("user_123");
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    assert.equal(verifyUnsubscribeToken("user_123", tampered), false);
  });

  test("empty user id or token is rejected", () => {
    assert.equal(verifyUnsubscribeToken("", "x"), false);
    assert.equal(verifyUnsubscribeToken("user_123", ""), false);
    assert.equal(verifyUnsubscribeToken("user_123", undefined), false);
  });

  test("buildUnsubscribeUrl produces a verifiable u/t pair", () => {
    const url = buildUnsubscribeUrl("https://porizo.co", "user_123");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/unsubscribe");
    assert.equal(parsed.searchParams.get("u"), "user_123");
    assert.equal(
      verifyUnsubscribeToken("user_123", parsed.searchParams.get("t")),
      true,
    );
  });
});

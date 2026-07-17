"use strict";

process.env.NODE_ENV = "test";

const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveStripeSecret } = require("../../src/services/stripe-service");

const SK_TEST = "sk_test_deadbeef";
const SK_LIVE = "sk_live_deadbeef";

describe("resolveStripeSecret boot guard", () => {
  afterEach(() => {
    delete process.env.STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION;
  });

  it("accepts a live key in production", () => {
    assert.equal(
      resolveStripeSecret({ secretKey: SK_LIVE, environment: "production" }),
      SK_LIVE,
    );
  });

  it("rejects a test key in production by default (boot-fatal)", () => {
    assert.throws(
      () =>
        resolveStripeSecret({ secretKey: SK_TEST, environment: "production" }),
      /test secret keys are forbidden in production/i,
    );
  });

  it("allows a test key in production when explicitly opted in via option", () => {
    assert.equal(
      resolveStripeSecret({
        secretKey: SK_TEST,
        environment: "production",
        allowTestKeys: true,
      }),
      SK_TEST,
    );
  });

  it("allows a test key in production when STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION=true", () => {
    process.env.STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION = "true";
    assert.equal(
      resolveStripeSecret({ secretKey: SK_TEST, environment: "production" }),
      SK_TEST,
    );
  });

  it("still rejects a test key in production for any non-'true' flag value", () => {
    for (const val of ["false", "1", "yes", "TRUE", ""]) {
      process.env.STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION = val;
      assert.throws(
        () =>
          resolveStripeSecret({
            secretKey: SK_TEST,
            environment: "production",
          }),
        /forbidden in production/i,
        `flag=${JSON.stringify(val)} must not open the escape hatch`,
      );
    }
  });

  it("accepts a test key outside production regardless of the flag", () => {
    assert.equal(
      resolveStripeSecret({ secretKey: SK_TEST, environment: "development" }),
      SK_TEST,
    );
  });

  it("returns null when no key is configured in production (not boot-fatal)", () => {
    assert.equal(
      resolveStripeSecret({ secretKey: "", environment: "production" }),
      null,
    );
  });
});

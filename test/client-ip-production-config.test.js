"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertTrustedClientIpConfig,
} = require("../src/utils/client-ip");

describe("production client IP trust configuration", () => {
  it("fails closed until Cloudflare client IP trust is explicit", () => {
    const previous = process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    try {
      assert.throws(
        () => assertTrustedClientIpConfig("production"),
        /TRUST_CLOUDFLARE_CLIENT_IP=true is required/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
      } else {
        process.env.TRUST_CLOUDFLARE_CLIENT_IP = previous;
      }
    }
  });
});

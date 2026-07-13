"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildMagicLoginUrl } = require("../src/services/email-service");

describe("magic login email links", () => {
  it("uses the deployment's configured web origin", () => {
    assert.equal(
      buildMagicLoginUrl({
        webOrigin: "https://auth.staging.porizo.co/",
        transactionId: "transaction/id",
        platform: "ios",
        linkSecret: "secret value",
      }),
      "https://auth.staging.porizo.co/auth/magic/ios?transaction_id=transaction%2Fid#secret=secret%20value",
    );
  });
});

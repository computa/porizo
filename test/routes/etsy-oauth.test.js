"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fastify = require("fastify");
const { registerEtsyOAuthRoutes } = require("../../src/routes/etsy-oauth");

function appWith(authorization) {
  const app = fastify({ logger: false });
  registerEtsyOAuthRoutes(app, {
    authorization,
    sendError: (reply, status, error, message) => reply.code(status).send({ error, message }),
  });
  return app;
}

describe("Etsy OAuth callback", () => {
  it("exchanges a valid callback and redirects to the admin queue", async () => {
    const calls = [];
    const app = appWith({ complete: async (value) => calls.push(value) });
    const response = await app.inject("/integrations/etsy/callback?state=state-value&code=grant-code");
    await app.close();
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "/admin/etsy?etsy=connected");
    assert.deepEqual(calls, [{ state: "state-value", code: "grant-code" }]);
    assert.equal(response.headers["cache-control"], "no-store");
  });

  it("does not exchange a buyer-cancelled authorization", async () => {
    const app = appWith({ complete: async () => assert.fail("must not exchange") });
    const response = await app.inject("/integrations/etsy/callback?error=access_denied");
    await app.close();
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "ETSY_OAUTH_DENIED");
  });
});

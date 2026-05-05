require("dotenv/config");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  before,
  after,
  beforeEach,
  afterEach,
  describe,
  test,
} = require("node:test");
const fastify = require("fastify");

const {
  registerInternalSunoCallbackRoutes,
} = require("../../src/routes/internal-suno-callback");

const TEST_SECRET = "test_hmac_secret_abc123";

function signBody(secret, body) {
  return crypto
    .createHmac("sha256", secret)
    .update(body, "utf-8")
    .digest("hex");
}

function buildApp({ secret = TEST_SECRET } = {}) {
  const app = fastify({ logger: false });
  registerInternalSunoCallbackRoutes(app, {
    appConfig: { SUNO_CALLBACK_HMAC_SECRET: secret },
  });
  return app;
}

describe("POST /internal/suno/callback (U18)", () => {
  let originalEnvSecret;

  beforeEach(() => {
    originalEnvSecret = process.env.SUNO_CALLBACK_HMAC_SECRET;
    delete process.env.SUNO_CALLBACK_HMAC_SECRET;
  });

  afterEach(() => {
    if (originalEnvSecret == null) {
      delete process.env.SUNO_CALLBACK_HMAC_SECRET;
    } else {
      process.env.SUNO_CALLBACK_HMAC_SECRET = originalEnvSecret;
    }
  });

  test("returns 503 when SUNO_CALLBACK_HMAC_SECRET is unset", async () => {
    const app = fastify({ logger: false });
    registerInternalSunoCallbackRoutes(app, { appConfig: {} });
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/suno/callback",
        payload: { hello: "world" },
      });
      assert.equal(res.statusCode, 503);
      assert.equal(JSON.parse(res.payload).error, "CALLBACK_NOT_CONFIGURED");
    } finally {
      await app.close();
    }
  });

  test("returns 401 when callback auth is missing", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/suno/callback",
        headers: { "content-type": "application/json" },
        payload: { hello: "world" },
      });
      assert.equal(res.statusCode, 401);
      assert.equal(JSON.parse(res.payload).error, "INVALID_CALLBACK_AUTH");
    } finally {
      await app.close();
    }
  });

  test("returns 401 when callback auth does not match", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const body = JSON.stringify({ hello: "world" });
      const res = await app.inject({
        method: "POST",
        url: "/internal/suno/callback",
        headers: {
          "content-type": "application/json",
          "x-suno-signature": "deadbeef",
        },
        payload: body,
      });
      assert.equal(res.statusCode, 401);
      assert.equal(JSON.parse(res.payload).error, "INVALID_CALLBACK_AUTH");
    } finally {
      await app.close();
    }
  });

  test("returns 200 when callback query token is valid; does not mutate state", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/internal/suno/callback?token=${encodeURIComponent(TEST_SECRET)}`,
        headers: { "content-type": "application/json" },
        payload: {
          taskId: "task_test",
          callbackType: "complete",
        },
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.payload), { received: true });
    } finally {
      await app.close();
    }
  });

  test("returns 200 when signature is valid; does not mutate state", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const body = JSON.stringify({
        taskId: "task_test",
        callbackType: "complete",
      });
      const sig = signBody(TEST_SECRET, body);
      const res = await app.inject({
        method: "POST",
        url: "/internal/suno/callback",
        headers: {
          "content-type": "application/json",
          "x-suno-signature": sig,
        },
        payload: body,
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.payload), { received: true });
    } finally {
      await app.close();
    }
  });

  test("returns 401 when signature is wrong-length hex (timing-safe compare must not crash)", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const body = JSON.stringify({ hello: "world" });
      const res = await app.inject({
        method: "POST",
        url: "/internal/suno/callback",
        headers: {
          "content-type": "application/json",
          "x-suno-signature": "abcd", // far too short
        },
        payload: body,
      });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  test("env-var SUNO_CALLBACK_HMAC_SECRET is honored when appConfig has none", async () => {
    process.env.SUNO_CALLBACK_HMAC_SECRET = TEST_SECRET;
    const app = fastify({ logger: false });
    registerInternalSunoCallbackRoutes(app, { appConfig: {} });
    await app.ready();
    try {
      const body = JSON.stringify({ env_path: true });
      const sig = signBody(TEST_SECRET, body);
      const res = await app.inject({
        method: "POST",
        url: "/internal/suno/callback",
        headers: {
          "content-type": "application/json",
          "x-suno-signature": sig,
        },
        payload: body,
      });
      assert.equal(res.statusCode, 200);
    } finally {
      await app.close();
    }
  });
});

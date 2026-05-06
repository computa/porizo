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
const path = require("node:path");

const {
  registerInternalSunoCallbackRoutes,
} = require("../../src/routes/internal-suno-callback");
const { initDb } = require("../../src/db");

const TEST_SECRET = "test_hmac_secret_abc123_32_chars_min";

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

async function createCallbackStateDb() {
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run("callback_user", now);
  await db
    .prepare(
      `INSERT INTO voice_profiles (
        id, user_id, status, quality_score, model_version, consent_version, created_at
      ) VALUES (?, ?, 'active', 90, 'test', 'voice_suno_persona_v1', ?)`,
    )
    .run("callback_voice", "callback_user", now);
  await db
    .prepare(
      `INSERT INTO voice_provider_profiles (
        id, voice_profile_id, user_id, provider, status, source_task_id,
        consent_scope, created_at, updated_at
      ) VALUES (?, ?, ?, 'suno', 'cover_submitted', 'task_test',
        'voice_suno_persona_v1', ?, ?)`,
    )
    .run("callback_profile", "callback_voice", "callback_user", now, now);
  await db
    .prepare(
      `INSERT INTO voice_provider_jobs (
        id, voice_profile_id, user_id, provider, voice_provider_profile_id,
        status, step, attempts, max_attempts, step_data, created_at, updated_at
      ) VALUES (?, ?, ?, 'suno', ?, 'running', 'generate_persona', 1, 3, '{}', ?, ?)`,
    )
    .run("callback_job", "callback_voice", "callback_user", "callback_profile", now, now);
  return db;
}

function snapshotCallbackState(db) {
  return {
    profile: db
      .prepare("SELECT * FROM voice_provider_profiles WHERE id = ?")
      .get("callback_profile"),
    job: db
      .prepare("SELECT * FROM voice_provider_jobs WHERE id = ?")
      .get("callback_job"),
    profileCount: db
      .prepare("SELECT COUNT(*) AS count FROM voice_provider_profiles")
      .get().count,
    jobCount: db.prepare("SELECT COUNT(*) AS count FROM voice_provider_jobs").get()
      .count,
  };
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
    const db = await createCallbackStateDb();
    const before = snapshotCallbackState(db);
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
      assert.deepEqual(snapshotCallbackState(db), before);
    } finally {
      await app.close();
      db.close();
    }
  });

  test("returns 200 when signature is valid; does not mutate state", async () => {
    const app = buildApp();
    await app.ready();
    const db = await createCallbackStateDb();
    const before = snapshotCallbackState(db);
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
      assert.deepEqual(snapshotCallbackState(db), before);
    } finally {
      await app.close();
      db.close();
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

  test("returns 401 when signature is empty or non-hex", async () => {
    const app = buildApp();
    await app.ready();
    try {
      for (const signature of ["", "not-hex"]) {
        const body = JSON.stringify({ hello: "world", signature });
        const res = await app.inject({
          method: "POST",
          url: "/internal/suno/callback",
          headers: {
            "content-type": "application/json",
            "x-suno-signature": signature,
          },
          payload: body,
        });
        assert.equal(res.statusCode, 401);
      }
    } finally {
      await app.close();
    }
  });

  test("returns 401 when signature has correct length but wrong bytes", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const body = JSON.stringify({ hello: "world" });
      const wrongSig = "f".repeat(64);
      const res = await app.inject({
        method: "POST",
        url: "/internal/suno/callback",
        headers: {
          "content-type": "application/json",
          "x-suno-signature": wrongSig,
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

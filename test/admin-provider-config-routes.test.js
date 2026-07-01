require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

function buildTestApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
      ELEVENLABS_API_KEY: "test-elevenlabs-key",
      SUNO_API_KEY: "test-suno-key",
    },
    storage: {
      put: async () => {},
      get: async () => null,
      exists: async () => false,
      delete: async () => {},
      getSignedUrl: async (key) => `http://localhost/${key}`,
    },
  });
}

async function loginAdmin(app, email = "admin@porizo.app") {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email, password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

describe("admin provider config routes", () => {
  let db;
  let app;
  let superadminHeaders;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    superadminHeaders = await loginAdmin(app);
    const created = await adminAuthService.createAdmin(
      "provider-config-admin@example.com",
      "admin123",
      "Provider Config Admin",
      "admin",
    );
    assert.equal(created.success, true);
    adminHeaders = await loginAdmin(app, "provider-config-admin@example.com");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("returns STT config for authenticated admins", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/admin/dashboard/stt/config",
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/stt/config",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().primary_provider, "whisperkit");
    assert.equal(response.json().fallback_provider, "openai");
    assert.equal(response.json().whisperkit_model, "small");
  });

  test("updates STT config only for superadmins and maps validation errors", async () => {
    const forbidden = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/stt/config",
      headers: adminHeaders,
      payload: { primary_provider: "apple" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const invalid = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/stt/config",
      headers: superadminHeaders,
      payload: { primary_provider: "invalid_provider" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error, "INVALID_CONFIG");

    const response = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/stt/config",
      headers: superadminHeaders,
      payload: { primary_provider: "apple", whisperkit_model: "large" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().config.primary_provider, "apple");
    assert.equal(response.json().config.whisperkit_model, "large");
  });

  test("returns music config with route-level available provider metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/music/config",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().default_provider, "suno");
    assert.deepEqual(response.json().available_providers, {
      elevenlabs: true,
      suno: true,
    });
    assert.deepEqual(response.json().available_suno_models, [
      "V4_5",
      "V5",
      "V5_5",
    ]);
  });

  test("updates music config only for superadmins and keeps route validation", async () => {
    const forbidden = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/music/config",
      headers: adminHeaders,
      payload: { suno_model: "V5_5" },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const empty = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/music/config",
      headers: superadminHeaders,
      payload: {},
    });
    assert.equal(empty.statusCode, 400, empty.body);
    assert.equal(empty.json().error, "INVALID_CONFIG");

    const invalidProvider = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/music/config",
      headers: superadminHeaders,
      payload: { default_provider: "elevenlabs" },
    });
    assert.equal(invalidProvider.statusCode, 400, invalidProvider.body);
    assert.equal(invalidProvider.json().error, "INVALID_CONFIG");

    const response = await app.inject({
      method: "PUT",
      url: "/admin/dashboard/music/config",
      headers: superadminHeaders,
      payload: {
        suno_model: "V5_5",
        quality_threshold: 81,
        max_rerolls: 2,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().config.suno_model, "V5_5");
    assert.equal(response.json().config.quality_threshold, 81);
    assert.equal(response.json().config.max_rerolls, 2);
  });
});

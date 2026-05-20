require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function createStorage() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

function buildTestApp(db, config = {}) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "https://api.porizo.co",
      SHARE_PUBLIC_BASE_URL: "https://porizo.co",
      STREAM_BASE_URL: "https://api.porizo.co",
      HOST_ALLOWLIST: "api.porizo.co,porizo.co",
      HOST_ALLOWLIST_MODE: "off",
      ADMIN_UI_MODE: "public",
      ...config,
    },
    storage: createStorage(),
  });
}

describe("production hosting hardening controls", () => {
  let db;
  let app;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
  });

  afterEach(async () => {
    await app?.close();
    await db?.close?.();
    app = null;
    db = null;
  });

  test("host allowlist report mode observes but does not block unknown hosts", async () => {
    app = buildTestApp(db, { HOST_ALLOWLIST_MODE: "report" });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: "porizo-production.up.railway.app" },
    });

    assert.equal(response.statusCode, 200);
  });

  test("host allowlist enforce mode blocks direct Railway service domain", async () => {
    app = buildTestApp(db, { HOST_ALLOWLIST_MODE: "enforce" });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: "porizo-production.up.railway.app" },
    });

    assert.equal(response.statusCode, 421);
    assert.equal(response.json().error, "MISDIRECTED_REQUEST");
  });

  test("host allowlist enforce mode allows configured production hosts", async () => {
    app = buildTestApp(db, { HOST_ALLOWLIST_MODE: "enforce" });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: "api.porizo.co" },
    });

    assert.equal(response.statusCode, 200);
  });

  test("admin UI defaults to public for lockout-safe rollout", async () => {
    app = buildTestApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { host: "api.porizo.co" },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/html/);
  });

  test("admin UI public mode still serves static files without Fastify static bypass", async () => {
    app = buildTestApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/admin/vite.svg",
      headers: { host: "api.porizo.co" },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /image\/svg\+xml/);
  });

  test("admin UI cloudflare_access mode blocks missing Access identity", async () => {
    app = buildTestApp(db, { ADMIN_UI_MODE: "cloudflare_access" });

    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { host: "api.porizo.co" },
    });

    assert.equal(response.statusCode, 403);
  });

  test("admin UI cloudflare_access mode blocks static assets without Access identity", async () => {
    app = buildTestApp(db, { ADMIN_UI_MODE: "cloudflare_access" });

    const response = await app.inject({
      method: "GET",
      url: "/admin/vite.svg",
      headers: { host: "api.porizo.co" },
    });

    assert.equal(response.statusCode, 403);
  });

  test("admin UI cloudflare_access mode allows configured Access identity", async () => {
    app = buildTestApp(db, {
      ADMIN_UI_MODE: "cloudflare_access",
      ADMIN_UI_ALLOWED_EMAILS: "ambrose@example.com",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: {
        host: "api.porizo.co",
        "cf-access-authenticated-user-email": "Ambrose@Example.com",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/html/);
  });

  test("admin UI off mode hides the SPA without disabling admin API auth", async () => {
    app = buildTestApp(db, { ADMIN_UI_MODE: "off" });

    const uiResponse = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { host: "api.porizo.co" },
    });
    assert.equal(uiResponse.statusCode, 404);

    const apiResponse = await app.inject({
      method: "GET",
      url: "/admin/auth/me",
      headers: { host: "api.porizo.co" },
    });
    assert.equal(apiResponse.statusCode, 401);
  });
});

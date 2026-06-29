process.env.NODE_ENV = "test";
process.env.ALLOW_ANON_USER_ID = "true";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");

const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

describe("runtime OpenAPI contract", () => {
  let app;
  let db;

  before(async () => {
    const config = {
      ALLOW_ANON_USER_ID: true,
      ENABLE_DEBUG_ROUTES: false,
      STORAGE_DIR: os.tmpdir(),
      STORAGE_PROVIDER: "local",
      STREAM_BASE_URL: "http://localhost:3000",
      UPLOAD_SIGNING_SECRET: "test-openapi-secret",
    };
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config,
      storage: createStorageProvider(config),
    });
  });

  after(async () => {
    await app.close();
    db.close();
  });

  test("GET /openapi.json serves generated public API and discovery paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/openapi.json",
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /application\/openapi\+json/);

    const document = response.json();
    const paths = document.paths || {};

    assert.equal(document.openapi, "3.0.3");
    assert.equal(document.info.title, "Porizo API");
    assert.ok(paths["/health"]);
    assert.ok(paths["/mcp"]);
    assert.ok(paths["/voice/enrollment/start"]);
    assert.ok(paths["/tracks"]);
    assert.ok(paths["/share/{shareId}/claim"]);
    assert.ok(paths["/poems"]);
    assert.ok(paths["/story/start"]);
    assert.ok(paths["/billing/receipt/apple/consumable"]);
    assert.ok(document.components.schemas.ErrorEnvelope);
    assert.ok(document.components.securitySchemes.bearerAuth);
  });

  test("GET /openapi.json excludes internal, admin, debug, and marketing pages", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/openapi.json",
    });
    const paths = Object.keys(response.json().paths || {});

    assert.equal(paths.some((routePath) => routePath.startsWith("/admin")), false);
    assert.equal(paths.some((routePath) => routePath.startsWith("/internal")), false);
    assert.equal(paths.some((routePath) => routePath.startsWith("/debug")), false);
    assert.equal(paths.includes("/pricing"), false);
    assert.equal(paths.includes("/birthday-song-maker"), false);
    assert.equal(paths.includes("/gifts/"), false);
    assert.equal(paths.includes("/gifts/{slug}"), false);
  });
});

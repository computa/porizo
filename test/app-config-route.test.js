require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

describe("public app config route", () => {
  let db;
  let app;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("GET /app/config is public but only exposes the safe client contract", async () => {
    await db
      .prepare(
        `UPDATE security_config
         SET ios_auto_recommended_version = 1,
             ios_last_app_store_version = '1.5.0',
             ios_last_app_store_sync_at = '2026-06-27T10:00:00.000Z',
             ios_app_store_sync_error = 'Internal App Store Connect auth failure'
         WHERE id = 'default'`,
      )
      .run();
    await db.prepare("DELETE FROM gift_bundles").run();
    await db
      .prepare(
        `INSERT INTO gift_bundles
          (product_id, token_count, price_cents, display_name, sort_order, is_active)
         VALUES
          ('bundle_hidden', 9, 9999, 'Hidden', 0, 0),
          ('bundle_public', 1, 499, '1 Gift', 10, 1)`,
      )
      .run();

    const response = await app.inject({ method: "GET", url: "/app/config" });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(Object.keys(body).sort(), [
      "analytics",
      "app_update",
      "flags",
      "gift_bundles",
      "music",
      "onboarding",
      "stt",
    ]);
    assert.equal(body.app_update.recommended_version, "1.5.0");
    assert.equal(Object.hasOwn(body.app_update, "last_app_store_sync_error"), false);
    assert.deepEqual(body.gift_bundles, [
      {
        product_id: "bundle_public",
        token_count: 1,
        display_name: "1 Gift",
        sort_order: 10,
      },
    ]);
  });
});

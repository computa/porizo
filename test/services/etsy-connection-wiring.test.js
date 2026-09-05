"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-etsy-wiring-32-bytes";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const {
  clearCache,
  setFeatureFlag,
} = require("../../src/services/feature-flags");
const {
  decryptValue,
  encryptValue,
} = require("../../src/services/etsy-secrets");

const ETSY_ENV_KEYS = [
  "ETSY_ACCESS_TOKEN",
  "ETSY_DATA_ENCRYPTION_KEY",
  "ETSY_KEYSTRING",
  "ETSY_REFRESH_TOKEN",
  "ETSY_SHARED_SECRET",
  "ETSY_SHOP_ID",
  "ETSY_TOKEN_GENERATION",
];

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    json: async () => body,
  };
}

function storageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

describe("Etsy connection server wiring", () => {
  let originalEnv;
  let originalFetch;
  const openApps = new Set();
  const openDatabases = new Set();
  const tempDirectories = new Set();

  beforeEach(() => {
    originalEnv = Object.fromEntries(
      ETSY_ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    originalFetch = globalThis.fetch;
    process.env.ETSY_DATA_ENCRYPTION_KEY =
      "test-etsy-wiring-encryption-key-at-least-32-bytes";
    process.env.ETSY_KEYSTRING = "etsy-key";
    process.env.ETSY_SHARED_SECRET = "etsy-secret";
    process.env.ETSY_SHOP_ID = "shop_wiring";
    delete process.env.ETSY_ACCESS_TOKEN;
    delete process.env.ETSY_REFRESH_TOKEN;
    delete process.env.ETSY_TOKEN_GENERATION;
    clearCache();
  });

  afterEach(async () => {
    for (const app of openApps) {
      await app.close();
      openApps.delete(app);
    }
    for (const db of openDatabases) {
      await db.close();
      openDatabases.delete(db);
    }
    for (const directory of tempDirectories) {
      await fs.rm(directory, { recursive: true, force: true });
      tempDirectories.delete(directory);
    }
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearCache();
  });

  async function openDatabase(dbPath = ":memory:") {
    const db = await initDb({ dbPath });
    openDatabases.add(db);
    await setFeatureFlag(db, "etsy_fulfilment_mode", "off", "test");
    return db;
  }

  async function closeDatabase(db) {
    openDatabases.delete(db);
    await db.close();
  }

  async function openServer(db, storageDir = "/tmp/test-storage") {
    const app = buildServer({
      db,
      config: { STORAGE_DIR: storageDir },
      storage: storageStub(),
    });
    openApps.add(app);
    await app.ready();
    return app;
  }

  async function closeServer(app) {
    openApps.delete(app);
    await app.close();
  }

  async function seedConnection(
    db,
    {
      accessToken,
      refreshToken,
      status = "connected",
      tokenVersion = 1,
      bootstrapGeneration = null,
    },
  ) {
    const fingerprint = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");
    await db
      .prepare(
        `INSERT INTO etsy_connections
          (shop_id, access_token_encrypted, refresh_token_encrypted,
           status, token_version, bootstrap_token_fingerprint,
           bootstrap_generation, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(
        process.env.ETSY_SHOP_ID,
        encryptValue(accessToken),
        encryptValue(refreshToken),
        status,
        tokenVersion,
        fingerprint,
        bootstrapGeneration,
      );
  }

  it("loads stored tokens in off mode, persists refresh, and reuses it after restart", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "porizo-etsy-wiring-"),
    );
    tempDirectories.add(directory);
    const dbPath = path.join(directory, "etsy.sqlite");
    let db = await openDatabase(dbPath);
    await seedConnection(db, {
      accessToken: "stored-expired-access",
      refreshToken: "stored-refresh",
      tokenVersion: 7,
      bootstrapGeneration: 7,
    });
    process.env.ETSY_ACCESS_TOKEN = "environment-access-must-not-win";
    process.env.ETSY_REFRESH_TOKEN = "environment-refresh-must-not-win";
    process.env.ETSY_TOKEN_GENERATION = "8";

    const authorizations = [];
    let oauthRefreshes = 0;
    globalThis.fetch = async (url, options) => {
      if (url.includes("/oauth/token")) {
        oauthRefreshes += 1;
        assert.equal(options.body.get("refresh_token"), "stored-refresh");
        return response(200, {
          access_token: "persisted-fresh-access",
          refresh_token: "persisted-fresh-refresh",
          expires_in: 3600,
        });
      }
      authorizations.push(options.headers.authorization);
      if (options.headers.authorization === "Bearer stored-expired-access") {
        return response(401, {});
      }
      assert.equal(
        options.headers.authorization,
        "Bearer persisted-fresh-access",
      );
      return response(200, { receipt_id: "receipt-1" });
    };

    let app = await openServer(db, directory);
    const firstReceipt = await app.etsyClient.getReceipt("receipt-1");
    assert.equal(firstReceipt.receipt_id, "receipt-1");
    assert.deepEqual(authorizations, [
      "Bearer stored-expired-access",
      "Bearer persisted-fresh-access",
    ]);
    assert.equal(oauthRefreshes, 1);

    const refreshed = await db
      .prepare(
        `SELECT access_token_encrypted, refresh_token_encrypted, token_version
           FROM etsy_connections WHERE shop_id = ?`,
      )
      .get(process.env.ETSY_SHOP_ID);
    assert.equal(
      decryptValue(refreshed.access_token_encrypted),
      "persisted-fresh-access",
    );
    assert.equal(
      decryptValue(refreshed.refresh_token_encrypted),
      "persisted-fresh-refresh",
    );
    assert.equal(Number(refreshed.token_version), 8);

    await closeServer(app);
    await closeDatabase(db);
    clearCache();
    authorizations.length = 0;

    db = await openDatabase(dbPath);
    app = await openServer(db, directory);
    const restartedReceipt = await app.etsyClient.getReceipt("receipt-2");
    assert.equal(restartedReceipt.receipt_id, "receipt-1");
    assert.deepEqual(authorizations, ["Bearer persisted-fresh-access"]);
    assert.equal(oauthRefreshes, 1);
  });

  it("bootstraps environment credentials into the database while mode is off", async () => {
    process.env.ETSY_ACCESS_TOKEN = "bootstrap-access";
    process.env.ETSY_REFRESH_TOKEN = "bootstrap-refresh";
    process.env.ETSY_TOKEN_GENERATION = "1";
    const db = await openDatabase();
    let authorization;
    globalThis.fetch = async (_url, options) => {
      authorization = options.headers.authorization;
      return response(200, { receipt_id: "receipt-bootstrap" });
    };
    const app = await openServer(db);

    await app.etsyClient.getReceipt("receipt-bootstrap");

    assert.equal(authorization, "Bearer bootstrap-access");
    const connection = await db
      .prepare(
        `SELECT access_token_encrypted, refresh_token_encrypted, status
           FROM etsy_connections WHERE shop_id = ?`,
      )
      .get(process.env.ETSY_SHOP_ID);
    assert.equal(connection.status, "connected");
    assert.equal(
      decryptValue(connection.access_token_encrypted),
      "bootstrap-access",
    );
    assert.equal(
      decryptValue(connection.refresh_token_encrypted),
      "bootstrap-refresh",
    );
  });

  it("fails closed before network access when no connected credentials exist", async () => {
    const db = await openDatabase();
    let networkCalls = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).hostname.endsWith(".etsy.com")) networkCalls += 1;
      return response(200, { receipt_id: "must-not-load" });
    };
    const app = await openServer(db);

    await assert.rejects(app.etsyClient.getReceipt("missing"), {
      code: "ETSY_API_UNCONFIGURED",
    });
    assert.equal(networkCalls, 0);
  });

  it("does not fall back to revoked environment tokens", async () => {
    process.env.ETSY_ACCESS_TOKEN = "revoked-environment-access";
    process.env.ETSY_REFRESH_TOKEN = "revoked-environment-refresh";
    process.env.ETSY_TOKEN_GENERATION = "4";
    const db = await openDatabase();
    await seedConnection(db, {
      accessToken: process.env.ETSY_ACCESS_TOKEN,
      refreshToken: process.env.ETSY_REFRESH_TOKEN,
      status: "reconnect_required",
      tokenVersion: 4,
      bootstrapGeneration: 4,
    });
    let networkCalls = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).hostname.endsWith(".etsy.com")) networkCalls += 1;
      return response(200, { receipt_id: "must-not-load" });
    };
    const app = await openServer(db);

    await assert.rejects(app.etsyClient.getReceipt("revoked"), {
      code: "ETSY_API_UNCONFIGURED",
    });
    assert.equal(networkCalls, 0);
    const connection = await db
      .prepare("SELECT status FROM etsy_connections WHERE shop_id = ?")
      .get(process.env.ETSY_SHOP_ID);
    assert.equal(connection.status, "reconnect_required");
  });
});

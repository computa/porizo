"use strict";

// Env must exist BEFORE requiring src/server (auth.js asserts JWT_SECRET at
// require time); ambient-shell env is not guaranteed in CI.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-jwt-secret-web-etsy-route-32-bytes!!";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const { buildServer } = require("../../src/server");
const authService = require("../../src/services/auth-service");
const {
  createGiftWalletRepository,
} = require("../../src/database/gift-wallet-repository");
const {
  createEtsyRedemptionService,
} = require("../../src/services/etsy-redemption-service");
const {
  setFeatureFlag,
  clearCache,
} = require("../../src/services/feature-flags");

function storageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

async function seedGuestWithToken(db, userId) {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, CURRENT_TIMESTAMP, 'low', 'guest')",
    )
    .run(userId);
  const session = await authService.createSession(userId, {
    platform: "web",
    authMethod: "web_guest",
  });
  return authService.generateAccessToken(userId, { sessionId: session.id });
}

describe("Etsy redemption routes", () => {
  let db;
  let app;
  let wallet;
  let etsy;

  beforeEach(async () => {
    process.env.JWT_SECRET = "test-jwt-secret-web-etsy-route-32-bytes!!";
    process.env.TRUST_CLOUDFLARE_CLIENT_IP = "true";
    clearCache();
    db = await initDb();
    await setFeatureFlag(db, "web_funnel_enabled", true, "test");
    wallet = createGiftWalletRepository(db);
    etsy = createEtsyRedemptionService({ db, giftWalletRepository: wallet });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: storageStub(),
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) await db.close();
    clearCache();
    delete process.env.TRUST_CLOUDFLARE_CLIENT_IP;
  });

  it("redeems a valid code for the current guest session and grants one credit", async () => {
    const token = await seedGuestWithToken(db, "guest_a");
    const [code] = await etsy.mintBatch({
      batchLabel: "route-happy",
      count: 1,
    });

    const res = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers: {
        authorization: `Bearer ${token}`,
        "cf-connecting-ip": "203.0.113.20",
      },
      payload: { code },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.redeemed, true);
    assert.strictEqual(body.idempotent, false);
    assert.strictEqual(body.balance_after, 1);
    assert.strictEqual(await wallet.getBalance("guest_a"), 1);
  });

  it("is idempotent for the same buyer re-submitting the same code", async () => {
    const token = await seedGuestWithToken(db, "guest_a");
    const [code] = await etsy.mintBatch({ batchLabel: "route-idem", count: 1 });
    const headers = {
      authorization: `Bearer ${token}`,
      "cf-connecting-ip": "203.0.113.21",
    };

    const first = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers,
      payload: { code },
    });
    const second = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers,
      payload: { code },
    });

    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(second.statusCode, 200, second.body);
    assert.strictEqual(second.json().idempotent, true);
    assert.strictEqual(
      await wallet.getBalance("guest_a"),
      1,
      "a retry must never grant a second credit",
    );
  });

  it("401s when there is no session", async () => {
    const [code] = await etsy.mintBatch({ batchLabel: "route-anon", count: 1 });
    const res = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers: { "cf-connecting-ip": "203.0.113.22" },
      payload: { code },
    });
    assert.strictEqual(res.statusCode, 401, res.body);
  });

  it("404s an unknown code", async () => {
    const token = await seedGuestWithToken(db, "guest_a");
    const res = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers: {
        authorization: `Bearer ${token}`,
        "cf-connecting-ip": "203.0.113.23",
      },
      payload: { code: "PZ-XXXX-XXXX" },
    });
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(res.json().error, "CODE_NOT_FOUND");
  });

  it("409s a code already redeemed by a different buyer", async () => {
    const tokenA = await seedGuestWithToken(db, "guest_a");
    const tokenB = await seedGuestWithToken(db, "guest_b");
    const [code] = await etsy.mintBatch({
      batchLabel: "route-taken",
      count: 1,
    });

    await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "cf-connecting-ip": "203.0.113.24",
      },
      payload: { code },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "cf-connecting-ip": "203.0.113.25",
      },
      payload: { code },
    });
    assert.strictEqual(conflict.statusCode, 409, conflict.body);
    assert.strictEqual(conflict.json().error, "CODE_ALREADY_REDEEMED");
    assert.strictEqual(await wallet.getBalance("guest_b"), 0);
  });

  it("410s a voided code", async () => {
    const token = await seedGuestWithToken(db, "guest_a");
    const [code] = await etsy.mintBatch({ batchLabel: "route-void", count: 1 });
    await etsy.voidCode({ code, reason: "etsy order refunded" });

    const res = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers: {
        authorization: `Bearer ${token}`,
        "cf-connecting-ip": "203.0.113.26",
      },
      payload: { code },
    });
    assert.strictEqual(res.statusCode, 410, res.body);
    assert.strictEqual(res.json().error, "CODE_VOID");
  });

  it("429s brute-force attempts from one IP after the cap", async () => {
    const token = await seedGuestWithToken(db, "guest_a");
    const headers = {
      authorization: `Bearer ${token}`,
      "cf-connecting-ip": "203.0.113.27",
    };
    let capped;
    // 10/hour cap: the 11th attempt from the same IP must be rejected.
    for (let attempt = 0; attempt < 11; attempt += 1) {
      capped = await app.inject({
        method: "POST",
        url: "/web/etsy/redeem",
        headers,
        payload: { code: "PZ-XXXX-XXXX" },
      });
    }
    assert.strictEqual(capped.statusCode, 429, capped.body);
    assert.strictEqual(capped.json().error, "ETSY_REDEEM_LIMIT_REACHED");
  });

  it("404s when the web funnel flag is off", async () => {
    const token = await seedGuestWithToken(db, "guest_a");
    await setFeatureFlag(db, "web_funnel_enabled", false, "test");
    const [code] = await etsy.mintBatch({ batchLabel: "route-flag", count: 1 });
    const res = await app.inject({
      method: "POST",
      url: "/web/etsy/redeem",
      headers: {
        authorization: `Bearer ${token}`,
        "cf-connecting-ip": "203.0.113.28",
      },
      payload: { code },
    });
    assert.strictEqual(res.statusCode, 404, res.body);
  });

  it("GET /web/etsy/code/:code pre-checks validity without side effects", async () => {
    const [code] = await etsy.mintBatch({
      batchLabel: "route-check",
      count: 1,
    });

    const valid = await app.inject({
      method: "GET",
      url: `/web/etsy/code/${code}`,
      headers: { "cf-connecting-ip": "203.0.113.29" },
    });
    assert.strictEqual(valid.statusCode, 200, valid.body);
    assert.deepEqual(valid.json(), { valid: true, status: "unredeemed" });

    const unknown = await app.inject({
      method: "GET",
      url: "/web/etsy/code/PZ-XXXX-XXXX",
      headers: { "cf-connecting-ip": "203.0.113.30" },
    });
    assert.strictEqual(unknown.statusCode, 200, unknown.body);
    assert.deepEqual(unknown.json(), { valid: false, status: "not_found" });

    // validate must not have burned the code.
    assert.deepEqual(await etsy.validate(code), {
      valid: true,
      status: "unredeemed",
    });
  });
});

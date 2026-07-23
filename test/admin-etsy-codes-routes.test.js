require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function buildTestApp(db) {
  return buildServer({
    db,
    config: {
      STORAGE_DIR: "/tmp/test-storage",
      PUBLIC_BASE_URL: "http://public.local",
      STREAM_BASE_URL: "http://stream.local",
      ALLOW_ANON_USER_ID: true,
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

async function loginAdmin(app) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth/login",
    payload: { email: "admin@porizo.app", password: "admin123" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { Authorization: `Bearer ${response.json().token}` };
}

describe("admin etsy redemption-code routes", () => {
  let db;
  let app;
  let adminHeaders;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    adminHeaders = await loginAdmin(app);
    await db
      .prepare(
        "INSERT INTO users (id, created_at, account_status) VALUES (?, CURRENT_TIMESTAMP, 'guest')",
      )
      .run("etsy_buyer_route");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  // ---- mint ----

  test("mint returns codes and echoes the batch label", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "route-launch", count: 5 },
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.batch_label, "route-launch");
    assert.equal(body.codes.length, 5);
    assert.equal(new Set(body.codes).size, 5, "codes must be unique");
    for (const code of body.codes) {
      assert.match(code, /^PZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    }
  });

  test("mint rejects a count outside 1-1000 with 400", async () => {
    const tooMany = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "route-bad", count: 1001 },
    });
    assert.equal(tooMany.statusCode, 400, tooMany.body);

    const tooFew = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "route-bad", count: 0 },
    });
    assert.equal(tooFew.statusCode, 400, tooFew.body);
  });

  test("mint requires an admin session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      payload: { batch_label: "route-launch", count: 5 },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  // ---- list ----

  test("list returns rows filtered by batch with per-status counts (the Gate A number)", async () => {
    // Two batches so the batch filter is meaningful.
    const minted = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "gate-a", count: 4 },
    });
    const gateACodes = minted.json().codes;
    await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "other-batch", count: 3 },
    });

    // Redeem one, void one — leaves 2 unredeemed in gate-a.
    await db
      .prepare(
        "UPDATE etsy_redemption_codes SET status = 'redeemed', redeemed_by_user_id = ?, redeemed_at = CURRENT_TIMESTAMP WHERE code = ?",
      )
      .run("etsy_buyer_route", gateACodes[0]);
    await db
      .prepare(
        "UPDATE etsy_redemption_codes SET status = 'void', void_reason = 'refund' WHERE code = ?",
      )
      .run(gateACodes[1]);

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/etsy/codes?batch_label=gate-a&limit=50&offset=0",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();

    assert.equal(body.codes.length, 4, "only gate-a rows are listed");
    for (const row of body.codes) {
      assert.equal(row.batch_label, "gate-a");
      assert.ok("code" in row);
      assert.ok("status" in row);
      assert.ok("redeemed_by_user_id" in row);
      assert.ok("redeemed_at" in row);
      assert.ok("created_at" in row);
    }
    assert.deepEqual(body.counts, { unredeemed: 2, redeemed: 1, void: 1 });

    const redeemedRow = body.codes.find((r) => r.status === "redeemed");
    assert.equal(redeemedRow.redeemed_by_user_id, "etsy_buyer_route");
  });

  test("list can filter by status", async () => {
    const minted = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "status-filter", count: 3 },
    });
    const codes = minted.json().codes;
    await db
      .prepare(
        "UPDATE etsy_redemption_codes SET status = 'redeemed', redeemed_by_user_id = ?, redeemed_at = CURRENT_TIMESTAMP WHERE code = ?",
      )
      .run("etsy_buyer_route", codes[0]);

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/etsy/codes?batch_label=status-filter&status=redeemed",
      headers: adminHeaders,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.codes.length, 1);
    assert.equal(body.codes[0].status, "redeemed");
    // Counts remain per-status for the whole batch, independent of the status filter.
    assert.deepEqual(body.counts, { unredeemed: 2, redeemed: 1, void: 0 });
  });

  test("list requires an admin session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/etsy/codes?batch_label=gate-a",
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });

  // ---- void ----

  test("void marks an unredeemed code void", async () => {
    const minted = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "void-batch", count: 1 },
    });
    const [code] = minted.json().codes;

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/void",
      headers: adminHeaders,
      payload: { code, reason: "etsy order refunded" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { voided: true, code });

    const row = await db
      .prepare("SELECT status FROM etsy_redemption_codes WHERE code = ?")
      .get(code);
    assert.equal(row.status, "void");
  });

  test("voiding an already-redeemed code is a 409", async () => {
    const minted = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "void-409", count: 1 },
    });
    const [code] = minted.json().codes;
    await db
      .prepare(
        "UPDATE etsy_redemption_codes SET status = 'redeemed', redeemed_by_user_id = ?, redeemed_at = CURRENT_TIMESTAMP WHERE code = ?",
      )
      .run("etsy_buyer_route", code);

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/void",
      headers: adminHeaders,
      payload: { code, reason: "too late" },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "CODE_NOT_VOIDABLE");
  });

  test("void requires an admin session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/void",
      payload: { code: "PZ-XXXX-XXXX", reason: "nope" },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "UNAUTHORIZED");
  });
});

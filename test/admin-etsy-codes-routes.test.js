require("dotenv/config");
process.env.NODE_ENV = "test";
process.env.ETSY_SHOP_ID = "shop_123";
process.env.ETSY_LISTING_IDS = "listing_1";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const {
  createGiftWalletRepository,
} = require("../src/database/gift-wallet-repository");
const {
  createEtsyRedemptionService,
} = require("../src/services/etsy-redemption-service");
const { clearCache: clearFeatureFlagCache } = require("../src/services/feature-flags");

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
  let legacyCodes;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildTestApp(db);
    adminHeaders = await loginAdmin(app);
    legacyCodes = createEtsyRedemptionService({
      db,
      giftWalletRepository: createGiftWalletRepository(db),
    });
    await db
      .prepare(
        "INSERT INTO users (id, created_at, account_status) VALUES (?, CURRENT_TIMESTAMP, 'guest')",
      )
      .run("etsy_buyer_route");
    await db
      .prepare(
        `UPDATE feature_flags
         SET value = '"code"', updated_at = CURRENT_TIMESTAMP
         WHERE id = 'etsy_fulfilment_mode'`,
      )
      .run();
    clearFeatureFlagCache();
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  // ---- mint ----

  test("mint is retired so unassigned paid-equivalent inventory cannot be created", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "route-launch", count: 5 },
    });
    assert.equal(response.statusCode, 410, response.body);
    assert.equal(response.json().error, "ETSY_UNASSIGNED_MINT_RETIRED");
  });

  test("mint stays retired regardless of requested count", async () => {
    const tooMany = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "route-bad", count: 1001 },
    });
    assert.equal(tooMany.statusCode, 410, tooMany.body);

    const tooFew = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/mint",
      headers: adminHeaders,
      payload: { batch_label: "route-bad", count: 0 },
    });
    assert.equal(tooFew.statusCode, 410, tooFew.body);
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

  test("issues one audited code per receipt and marks its delivery", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/issue",
      headers: {
        ...adminHeaders,
        "idempotency-key": "issue-receipt-445",
      },
      payload: {
        receipt_id: "receipt-445",
        listing_id: "listing_1",
        batch_label: "manual-july",
      },
    });
    assert.equal(issued.statusCode, 201, issued.body);
    const code = issued.json().code;
    assert.match(code, /^PZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const duplicate = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/issue",
      headers: {
        ...adminHeaders,
        "idempotency-key": "issue-receipt-445-again",
      },
      payload: {
        receipt_id: "receipt-445",
        listing_id: "listing_1",
        batch_label: "manual-july",
      },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(duplicate.json().error, "RECEIPT_ALREADY_ASSIGNED");

    const revealed = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/receipt-445/reveal",
      headers: {
        ...adminHeaders,
        "idempotency-key": "reveal-receipt-445",
      },
    });
    assert.equal(revealed.statusCode, 200, revealed.body);
    assert.equal(revealed.json().code, code);

    const delivered = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/receipt-445/delivered",
      headers: {
        ...adminHeaders,
        "idempotency-key": "deliver-receipt-445",
      },
      payload: { delivery_reference: "etsy-message-884" },
    });
    assert.equal(delivered.statusCode, 200, delivered.body);
    assert.equal(delivered.json().state, "delivered");

    const revealAfterDelivery = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/receipt-445/reveal",
      headers: {
        ...adminHeaders,
        "idempotency-key": "reveal-receipt-445-after-delivery",
      },
    });
    assert.equal(revealAfterDelivery.statusCode, 409, revealAfterDelivery.body);

    const audits = await db
      .prepare(
        `SELECT action, metadata_json
         FROM audit_logs
         WHERE resource_id = ?
         ORDER BY created_at ASC`,
      )
      .all("receipt-445");
    assert.deepEqual(
      audits.map((row) => row.action),
      ["etsy_code_assigned", "etsy_code_revealed", "etsy_code_delivered"],
    );
    assert.ok(
      audits.every((row) => !String(row.metadata_json).includes(code)),
      "audit metadata must never contain the complete bearer code",
    );
  });

  test("manual issuance fails closed outside code mode", async () => {
    await db
      .prepare(
        `UPDATE feature_flags
         SET value = '"api"', updated_at = CURRENT_TIMESTAMP
         WHERE id = 'etsy_fulfilment_mode'`,
      )
      .run();
    clearFeatureFlagCache();
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/issue",
      headers: {
        ...adminHeaders,
        "idempotency-key": "issue-api-mode",
      },
      payload: {
        receipt_id: "receipt-api",
        batch_label: "manual-july",
      },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "ETSY_CODE_MODE_REQUIRED");
  });

  test("reverses an assigned code only with Etsy refund evidence", async () => {
    const issued = await legacyCodes.issueForReceipt({
      receiptId: "receipt-refund-route",
      batchLabel: "manual-july",
      adminId: "admin-route",
    });
    const missingEvidence = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/receipt-refund-route/local-reversal",
      headers: {
        ...adminHeaders,
        "idempotency-key": "refund-receipt-route-missing",
      },
      payload: { reason: "buyer canceled" },
    });
    assert.equal(missingEvidence.statusCode, 400, missingEvidence.body);

    const reversed = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/receipt-refund-route/local-reversal",
      headers: {
        ...adminHeaders,
        "idempotency-key": "refund-receipt-route",
      },
      payload: {
        reason: "buyer canceled",
        etsy_refund_evidence: "etsy-case-991",
      },
    });
    assert.equal(reversed.statusCode, 200, reversed.body);
    assert.deepEqual(reversed.json(), {
      receipt_id: "receipt-refund-route",
      state: "refunded",
      entitlement_reversed: true,
      manual_review: false,
      money_refunded: false,
    });
    assert.deepEqual(await legacyCodes.validate(issued.code), {
      valid: false,
      status: "void",
    });
  });

  // ---- list ----

  test("list returns rows filtered by batch with per-status counts (the Gate A number)", async () => {
    // Two batches so the batch filter is meaningful.
    const gateACodes = await legacyCodes.mintBatch({
      batchLabel: "gate-a",
      count: 4,
    });
    await legacyCodes.mintBatch({ batchLabel: "other-batch", count: 3 });

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
      assert.ok("code_last4" in row);
      assert.ok(!("code" in row));
      assert.ok("status" in row);
      assert.ok(!("redeemed_by_user_id" in row));
      assert.ok("redeemed_at" in row);
      assert.ok("created_at" in row);
    }
    assert.deepEqual(body.legacy_inventory_counts, {
      unredeemed: 2,
      redeemed: 1,
      void: 1,
    });

    assert.ok(body.codes.some((row) => row.status === "redeemed"));
  });

  test("list can filter by status", async () => {
    const codes = await legacyCodes.mintBatch({
      batchLabel: "status-filter",
      count: 3,
    });
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
    assert.deepEqual(body.legacy_inventory_counts, {
      unredeemed: 2,
      redeemed: 1,
      void: 0,
    });
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
    const [code] = await legacyCodes.mintBatch({
      batchLabel: "void-batch",
      count: 1,
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/codes/void",
      headers: adminHeaders,
      payload: { code, reason: "etsy order refunded" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      voided: true,
      code_last4: code.slice(-4),
    });

    const row = await db
      .prepare("SELECT status FROM etsy_redemption_codes WHERE code = ?")
      .get(code);
    assert.equal(row.status, "void");
  });

  test("voiding an already-redeemed code is a 409", async () => {
    const [code] = await legacyCodes.mintBatch({
      batchLabel: "void-409",
      count: 1,
    });
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

  test("retires the misleading refund route and requires Etsy evidence for local reversal", async () => {
    await app.etsyOrderService.ingestPaidReceipt({
      shop_id: "shop_123",
      receipt_id: "808080",
      buyer_email: "buyer@example.com",
      is_paid: true,
      status: "paid",
      transactions: [
        {
          transaction_id: "transaction_admin_reversal",
          listing_id: "listing_1",
          quantity: 1,
        },
      ],
    });

    const retired = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/orders/808080/refund",
      headers: adminHeaders,
      payload: { reason: "buyer refunded" },
    });
    assert.equal(retired.statusCode, 410, retired.body);
    assert.equal(retired.json().error, "ETSY_REFUND_ROUTE_RETIRED");
    assert.equal(retired.headers["cache-control"], "no-store");

    const missingEvidence = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/orders/808080/local-reversal",
      headers: adminHeaders,
      payload: { reason: "buyer refunded" },
    });
    assert.equal(missingEvidence.statusCode, 400, missingEvidence.body);
    assert.equal(
      missingEvidence.json().error,
      "ETSY_REFUND_EVIDENCE_REQUIRED",
    );

    const reversed = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/orders/808080/local-reversal",
      headers: adminHeaders,
      payload: {
        reason: "buyer refunded in Etsy",
        etsy_refund_evidence: "etsy-case-123",
      },
    });
    assert.equal(reversed.statusCode, 200, reversed.body);
    assert.deepEqual(reversed.json(), {
      entitlement_reversed: true,
      money_refunded: false,
      reversed: 0,
    });
    assert.equal(reversed.headers["cache-control"], "no-store");

    const replay = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/orders/808080/local-reversal",
      headers: adminHeaders,
      payload: {
        reason: "buyer refunded in Etsy",
        etsy_refund_evidence: "etsy-case-123",
      },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    const audit = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
          WHERE action = 'etsy_order_entitlement_reversal_requested'
            AND resource_id = '808080'`,
      )
      .get();
    assert.equal(Number(audit.count), 1);
  });

  test("requires per-operation idempotency keys for replay and reconciliation", async () => {
    const retryWithoutKey = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/orders/missing/retry-mp3",
      headers: adminHeaders,
    });
    assert.equal(retryWithoutKey.statusCode, 400, retryWithoutKey.body);
    assert.equal(
      retryWithoutKey.json().error,
      "IDEMPOTENCY_KEY_REQUIRED",
    );

    const retryWithKey = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/orders/missing/retry-mp3",
      headers: { ...adminHeaders, "idempotency-key": "retry-attempt-1" },
    });
    assert.equal(retryWithKey.statusCode, 404, retryWithKey.body);

    const reconcileWithoutKey = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/reconcile",
      headers: adminHeaders,
    });
    assert.equal(reconcileWithoutKey.statusCode, 400, reconcileWithoutKey.body);
    assert.equal(
      reconcileWithoutKey.json().error,
      "IDEMPOTENCY_KEY_REQUIRED",
    );

    const reconcileInCodeMode = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/reconcile",
      headers: {
        ...adminHeaders,
        "idempotency-key": "reconcile-code-mode",
      },
    });
    assert.equal(reconcileInCodeMode.statusCode, 409, reconcileInCodeMode.body);
    assert.equal(
      reconcileInCodeMode.json().error,
      "ETSY_API_MODE_REQUIRED",
    );
  });
});

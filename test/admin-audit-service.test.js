process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminAuditService,
  generateAuditId,
} = require("../src/services/admin/audit-service");

describe("AdminAuditService", () => {
  test("writes normalized admin audit payloads through EventsRepository", async () => {
    let auditPayload;
    const service = createAdminAuditService({
      eventsRepository: {
        async insertAuditLog(payload) {
          auditPayload = payload;
          return { changes: 1 };
        },
      },
      generateId: () => "audit_fixed",
      now: () => new Date("2026-06-29T09:10:11.000Z"),
    });

    const result = await service.audit(
      "admin_1",
      "admin_update_user",
      "user",
      "user_1",
      { reason: "risk review" },
    );

    assert.deepEqual(result, { changes: 1 });
    assert.deepEqual(auditPayload, {
      id: "audit_fixed",
      userId: "admin_1",
      action: "admin_update_user",
      resourceType: "user",
      resourceId: "user_1",
      metadataJson: JSON.stringify({
        actor: "admin",
        admin_id: "admin_1",
        reason: "risk review",
      }),
      createdAt: "2026-06-29T09:10:11.000Z",
    });
  });

  test("requires an events repository boundary", () => {
    assert.throws(
      () => createAdminAuditService(),
      /eventsRepository with insertAuditLog is required/,
    );
  });

  test("uses one deterministic audit ID for a retried admin mutation", async () => {
    const payloads = [];
    const service = createAdminAuditService({
      eventsRepository: {
        async insertAuditLog(payload) {
          payloads.push(payload);
          return { changes: payloads.length === 1 ? 1 : 0 };
        },
      },
      now: () => "2026-06-29T09:10:11.000Z",
    });

    await service.auditOnce(
      "etsy-reversal:receipt-1:evidence-1",
      "admin_1",
      "etsy_order_entitlement_reversal_requested",
      "etsy_receipt",
      "receipt-1",
      { money_refunded: false },
    );
    await service.auditOnce(
      "etsy-reversal:receipt-1:evidence-1",
      "admin_1",
      "etsy_order_entitlement_reversal_requested",
      "etsy_receipt",
      "receipt-1",
      { money_refunded: false },
    );

    assert.equal(payloads[0].id, payloads[1].id);
    assert.match(payloads[0].id, /^audit_[a-f0-9]{24}$/);
  });

  test("generates audit-prefixed random IDs", () => {
    assert.match(generateAuditId(), /^audit_[a-f0-9]{24}$/);
  });
});

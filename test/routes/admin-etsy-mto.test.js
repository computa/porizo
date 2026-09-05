"use strict";

const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { afterEach, beforeEach, describe, test } = require("node:test");
const { registerAdminEtsyMtoRoutes } = require("../../src/routes/admin/etsy-mto");

describe("admin Etsy MTO routes", () => {
  let app;
  let calls;

  beforeEach(async () => {
    calls = [];
    app = Fastify();
    registerAdminEtsyMtoRoutes(app, {
      repository: {
        listItems: async () => [],
        findItemById: async () => null,
      },
      orderFiles: { exportOrder: async (receiptId) => ({ receipt_id: receiptId, items: [] }) },
      pipeline: {
        preview: async (file) => ({ order: { receipt_id: "123" }, units: [], file }),
        importOrder: async (file, acknowledged, key) => {
          calls.push({ file, acknowledged, key });
          return { items: [{ id: "mto_1", state: "received" }] };
        },
      },
      service: {
        intake: async (input) => {
          calls.push(input);
          return { item: { id: "mto_1", state: "lyrics_review" }, idempotent: false };
        },
        approveLyrics: async () => ({ item: { id: "mto_1" } }),
        reconcileArtifact: async () => ({ promoted: false }),
        attestCompletion: async () => ({ item: { id: "mto_1" }, artifact: { id: "artifact_1" } }),
        findArtifact: async () => null,
      },
      storageProvider: { downloadToFile: async () => {} },
      requireAdminRole: async (request, reply) => {
        if (request.headers.authorization === "Bearer allowed") return { adminId: "admin_1" };
        reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      },
      auditService: { auditOnce: async () => {} },
      sendError: (reply, status, code, message) => reply.code(status).send({ error: code, message }),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("requires a superadmin session before exposing MTO data", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/dashboard/etsy/mto" });
    assert.equal(response.statusCode, 403);
  });

  test("requires an idempotency key before accepting intake", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/mto/import",
      headers: { authorization: "Bearer allowed" },
      payload: {},
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "IDEMPOTENCY_KEY_REQUIRED");
    assert.equal(calls.length, 0);
  });

  test("forwards a verified intake only to the protected service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/etsy/mto/import",
      headers: { authorization: "Bearer allowed", "idempotency-key": "intake-key-1" },
      payload: {
        identity: { shopId: "shop", receiptId: "receipt", transactionId: "tx", ordinal: 0, listingId: "listing" },
        brief: { recipient_name: "Maya", occasion: "birthday", specific_memory: "Jetty", relationship: "daughter", style: "acoustic" },
        evidence_reference: "restricted://receipt",
      },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, "intake-key-1");
  });

  test("exports an authenticated per-order JSON attachment without generation", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/dashboard/etsy/mto/export/123", headers: { authorization: "Bearer allowed" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-disposition"], 'attachment; filename="etsy-order-123.json"');
    assert.equal(calls.length, 0);
  });

  test("preview is read-only and obsolete manual intake is unavailable", async () => {
    const headers = { authorization: "Bearer allowed" };
    const response = await app.inject({ method: "POST", url: "/admin/dashboard/etsy/mto/import/preview", headers, payload: { file: "{}" } });
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 0);
    assert.equal((await app.inject({ method: "POST", url: "/admin/dashboard/etsy/mto", headers, payload: {} })).statusCode, 404);
  });
});

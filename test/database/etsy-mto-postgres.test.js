"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../../src/database");
const { createEtsyMtoRepository } = require("../../src/database/etsy-mto-repository");
const { createEtsyMtoPipeline } = require("../../src/services/etsy-mto-pipeline");
const { normalizeBrief } = require("../../src/services/etsy-mto-order-file");

test("PostgreSQL concurrent imports and fenced claims preserve one durable unit", { skip: process.env.DB_PROVIDER !== "postgres" }, async (t) => {
  const db = await getDatabase({ provider: "postgres" });
  t.after(() => db.close());
  const repository = createEtsyMtoRepository(db);
  const brief = normalizeBrief({ recipient_name: "Maya", relationship: "daughter", occasion: "birthday", style: "acoustic", specific_memory: "The jetty" });
  const order = { schema_version: 1, exported_at: new Date().toISOString(), shop_id: "991", receipt_id: "1231", items: [{ transaction_id: "4561", listing_id: "7891", quantity: 1, brief }] };
  const pipeline = createEtsyMtoPipeline({ repository, orderFiles: { verifyFile: async () => order }, production: {}, assertConfigured: async () => {}, checkRender: async () => {}, recoverRender: async () => false });
  const results = await Promise.all([pipeline.importOrder("file", true, "pg-import-1"), pipeline.importOrder("file", true, "pg-import-2")]);
  const item = results[0].items[0];
  assert.equal(results[1].items[0].id, item.id);
  assert.equal((await repository.listItems()).length, 1);
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 60000).toISOString();
  const claims = await Promise.all([repository.claimItem(item.id, "first", now, until), repository.claimItem(item.id, "second", now, until)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const winner = claims[0] ? "first" : "second";
  await repository.assertClaim(item.id, winner, now);
  await assert.rejects(repository.assertClaim(item.id, "stale", now), { code: "ETSY_CLAIM_LOST" });
  assert.equal((await repository.transitionItem({ itemId: item.id, fromStates: ["received"], state: "verified_paid", updatedAt: now, leaseToken: "stale" })).changes, 0);
  assert.equal((await repository.transitionItem({ itemId: item.id, fromStates: ["received"], state: "verified_paid", updatedAt: now, leaseToken: winner })).changes, 1);
  await repository.releaseItem(item.id, winner, now);
  assert.equal((await repository.transitionItem({ itemId: item.id, fromStates: ["verified_paid"], state: "needs_attention", updatedAt: now })).changes, 1);
});

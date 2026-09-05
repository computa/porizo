"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../../src/database/sqlite");
const { createEtsyMtoRepository } = require("../../src/database/etsy-mto-repository");
const { createEtsyMtoPipeline } = require("../../src/services/etsy-mto-pipeline");
const { normalizeBrief } = require("../../src/services/etsy-mto-order-file");

async function fixture(t) {
  const db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(__dirname, "../../migrations") });
  t.after(() => db.close());
  const repository = createEtsyMtoRepository(db);
  const brief = normalizeBrief({ recipient_name: "Maya", relationship: "daughter", occasion: "birthday", style: "acoustic", specific_memory: "The jetty" });
  const order = { schema_version: 1, exported_at: "2026-09-05T00:00:00.000Z", shop_id: "1", receipt_id: "2", items: [{ transaction_id: "3", listing_id: "4", quantity: 1, brief }] };
  const calls = [];
  let ticks = 0;
  const now = () => new Date(Date.UTC(2026, 8, 5) + ticks++ * 1000).toISOString();
  const production = {
    intake: async ({ identity }) => {
      calls.push("lyrics");
      const item = await repository.findItemByIdentity(identity);
      await repository.transitionItem({ itemId: item.id, fromStates: ["verified_paid"], state: "lyrics_review", updatedAt: now() });
    },
    approveLyrics: async ({ itemId }) => {
      calls.push("render");
      await repository.transitionItem({ itemId, fromStates: ["lyrics_review"], state: "rendering", updatedAt: now() });
    },
    reconcileArtifact: async ({ itemId }) => {
      calls.push(`check:${itemId}`);
    },
  };
  const orderFiles = { verifyFile: async () => structuredClone(order), exportOrder: async () => structuredClone(order) };
  const options = { repository, orderFiles, production, assertConfigured: async () => {}, checkRender: async () => {}, recoverRender: async () => false, now };
  return { db, repository, order, calls, production, options, pipeline: createEtsyMtoPipeline(options) };
}

test("preview makes no writes; repeated import creates one durable unit and generates once", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.pipeline.preview("file")).units[0].status, "new");
  assert.equal((await f.repository.listItems()).length, 0);
  assert.deepEqual(f.calls, []);
  const first = await f.pipeline.importOrder("file", true, "import-1");
  const replay = await f.pipeline.importOrder("file", true, "import-2");
  assert.equal(first.items[0].id, replay.items[0].id);
  assert.equal((await f.pipeline.preview("file")).units[0].status, "existing");
  assert.deepEqual(f.calls, []);
  await Promise.all([f.pipeline.processDue(), createEtsyMtoPipeline(f.options).processDue()]);
  assert.deepEqual(f.calls, ["lyrics", "render"]);
  assert.equal((await f.repository.listItems())[0].state, "rendering");
});

test("import requires acknowledgement and conflicts never replace the persisted brief", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.pipeline.importOrder("file", false, "import-1"), { code: "ETSY_IMPORT_ACKNOWLEDGEMENT_REQUIRED" });
  await f.pipeline.importOrder("file", true, "import-1");
  f.order.items[0].brief.specific_memory = "Changed";
  await assert.rejects(f.pipeline.importOrder("file", true, "import-2"), { code: "ETSY_UNIT_CONFLICT" });
  assert.equal(JSON.parse((await f.repository.listItems())[0].brief_json).specific_memory, "The jetty");
});

test("answers changed after import fail before any provider call", async (t) => {
  const f = await fixture(t);
  await f.pipeline.importOrder("file", true, "import-1");
  f.order.items[0].brief.specific_memory = "Changed";
  await f.pipeline.processDue();
  assert.deepEqual(f.calls, []);
  assert.equal((await f.repository.listItems())[0].last_error, "ETSY_UNIT_CONFLICT");
});

test("restart resumes received work and isolates provider failure without retrying charges", async (t) => {
  const f = await fixture(t);
  await f.pipeline.importOrder("file", true, "import-1");
  f.production.intake = async () => { f.calls.push("failed lyrics"); throw Object.assign(new Error("private story must not be saved in error"), { code: "GENERATION_BLOCKED" }); };
  const restarted = createEtsyMtoPipeline(f.options);
  await restarted.processDue();
  await restarted.processDue();
  const item = (await f.repository.listItems())[0];
  assert.equal(item.state, "needs_attention");
  assert.equal(item.last_error, "GENERATION_BLOCKED");
  assert.equal(item.lease_token, null);
  assert.deepEqual(f.calls, ["failed lyrics"]);
});

test("interrupted production is held for review, while expired claims on received work recover", async (t) => {
  const f = await fixture(t);
  const { items: [item] } = await f.pipeline.importOrder("file", true, "import-1");
  assert.equal(await f.repository.claimItem(item.id, "old", "2026-01-01", "2026-01-02"), true);
  await f.repository.transitionItem({ itemId: item.id, fromStates: ["received"], state: "verified_paid", updatedAt: "2026-01-01" });
  await f.pipeline.processDue();
  assert.equal((await f.repository.listItems())[0].last_error, "ETSY_INTERRUPTED_PRODUCTION");
  assert.deepEqual(f.calls, []);
});

test("render reconciliation rotates through more than ten pending units", async (t) => {
  const f = await fixture(t);
  f.order.items = Array.from({ length: 11 }, (_, index) => ({ ...f.order.items[0], transaction_id: String(index + 10) }));
  const { items } = await f.pipeline.importOrder("file", true, "import-1");
  for (const item of items) await f.repository.transitionItem({ itemId: item.id, fromStates: ["received"], state: "rendering", updatedAt: "2026-01-01" });
  await f.pipeline.processDue();
  await f.pipeline.processDue();
  assert.equal(new Set(f.calls).size, 11);
});

test("delivery verification refuses refunded orders after generation", async (t) => {
  const f = await fixture(t);
  const { items: [item] } = await f.pipeline.importOrder("file", true, "import-1");
  f.options.orderFiles.exportOrder = async () => { throw Object.assign(new Error("Refunded"), { code: "ETSY_ORDER_REFUNDED" }); };
  await assert.rejects(f.pipeline.verifyItem(item), { code: "ETSY_ORDER_REFUNDED" });
});

test("a known render job recovers after enqueue interruption without generating again", async (t) => {
  const f = await fixture(t);
  const { items: [item] } = await f.pipeline.importOrder("file", true, "import-1");
  await f.repository.transitionItem({ itemId: item.id, fromStates: ["received"], state: "lyrics_review", updatedAt: "2026-01-01" });
  const restarted = createEtsyMtoPipeline({ ...f.options, recoverRender: async () => true });
  await restarted.processDue();
  assert.equal((await f.repository.listItems())[0].state, "rendering");
  assert.deepEqual(f.calls, []);
});

test("expired worker cannot mutate an item after another worker claims it", async (t) => {
  const f = await fixture(t);
  const { items: [item] } = await f.pipeline.importOrder("file", true, "import-1");
  await f.repository.claimItem(item.id, "stale", "2026-01-01", "2026-01-02");
  await f.repository.claimItem(item.id, "current", "2026-02-01", "2026-03-01");
  await assert.rejects(f.repository.assertClaim(item.id, "stale", "2026-02-01"), { code: "ETSY_CLAIM_LOST" });
  await f.repository.transitionItem({ itemId: item.id, fromStates: ["received"], state: "lyrics_review", updatedAt: "2026-02-01", leaseToken: "stale" });
  await f.repository.linkTrack({ itemId: item.id, trackId: "stale-track", updatedAt: "2026-02-01", leaseToken: "stale" });
  const current = await f.repository.findItemById({ itemId: item.id });
  assert.equal(current.state, "received");
  assert.equal(current.track_id, null);
});

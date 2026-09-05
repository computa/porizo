const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../../src/database/sqlite.js");
const { createEtsyMtoRepository } = require("../../src/database/etsy-mto-repository.js");

const createdAt = "2026-09-05T00:00:00.000Z";

async function createRepository() {
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(__dirname, "../../migrations"),
  });
  return { db, repository: createEtsyMtoRepository(db) };
}

function order(id = "order-1") {
  return {
    id,
    shopId: "shop-1",
    receiptId: "receipt-1",
    createdAt,
    updatedAt: createdAt,
  };
}

function item(id = "item-1", transactionId = "transaction-1", ordinal = 0) {
  return {
    id,
    transactionId,
    ordinal,
    listingId: "listing-1",
    briefJson: '{"occasion":"birthday"}',
    rawPersonalizationHash: "brief-hash-1",
    createdAt,
    updatedAt: createdAt,
  };
}

test("creates an isolated receipt aggregate and item identity", async () => {
  const { db, repository } = await createRepository();
  const first = await repository.createOrderAndItem({ order: order(), item: item() });
  const replay = await repository.createOrderAndItem({
    order: order("another-order-id"),
    item: item("another-item-id"),
  });
  const secondItem = await repository.createOrderAndItem({
    order: order("ignored-order-id"),
    item: item("item-2", "transaction-2"),
  });

  assert.equal(first.order.id, "order-1");
  assert.equal(first.item.id, "item-1");
  assert.equal(replay.order.id, "order-1");
  assert.equal(replay.item.id, "item-1");
  assert.equal(secondItem.order.id, "order-1");
  assert.equal(secondItem.item.id, "item-2");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM etsy_mto_orders").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM etsy_mto_items").get().count, 2);
  await db.close();
});

test("records idempotency events exactly once per MTO item", async () => {
  const { db, repository } = await createRepository();
  const stored = await repository.createOrderAndItem({ order: order(), item: item() });
  const first = await repository.recordIdempotencyEvent({
    id: "event-1",
    itemId: stored.item.id,
    eventType: "brief_received",
    idempotencyKey: "request-1",
    requestHash: "request-hash-1",
    createdAt,
  });
  const replay = await repository.recordIdempotencyEvent({
    id: "event-2",
    itemId: stored.item.id,
    eventType: "brief_received",
    idempotencyKey: "request-1",
    requestHash: "request-hash-1",
    createdAt,
  });

  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.event.id, "event-1");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM etsy_mto_events").get().count, 1);
  await db.close();
});

test("only applies item transitions from explicitly allowed states", async () => {
  const { db, repository } = await createRepository();
  const stored = await repository.createOrderAndItem({ order: order(), item: item() });
  const first = await repository.transitionItem({
    itemId: stored.item.id,
    fromStates: ["received"],
    state: "verified_paid",
    updatedAt: "2026-09-05T00:01:00.000Z",
  });
  const stale = await repository.transitionItem({
    itemId: stored.item.id,
    fromStates: ["received"],
    state: "canceled",
    updatedAt: "2026-09-05T00:02:00.000Z",
  });

  assert.equal(first.changes, 1);
  assert.equal(stale.changes, 0);
  assert.equal((await repository.findItemById({ itemId: stored.item.id })).state, "verified_paid");
  await assert.rejects(
    repository.transitionItem({
      itemId: stored.item.id,
      fromStates: [],
      state: "canceled",
      updatedAt: createdAt,
    }),
    /source state/,
  );
  await db.close();
});

test("migration adds the unique nullable Etsy MTO track marker", async () => {
  const { db } = await createRepository();
  const columns = db.prepare("PRAGMA table_info(tracks)").all();
  assert.ok(columns.some((column) => column.name === "etsy_mto_item_id"));
  await db.close();
});

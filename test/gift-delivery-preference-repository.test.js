process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");
const { createSqliteAdapter } = require("../src/database/sqlite");
const { createGiftDeliveryPreferenceRepository } = require("../src/database/gift-delivery-preference-repository");

describe("GiftDeliveryPreferenceRepository", () => {
  let db;
  let repository;
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    db.exec(`
      CREATE TABLE gift_reservations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
      CREATE TABLE gift_delivery_preferences (
        gift_reservation_id TEXT PRIMARY KEY, mode TEXT NOT NULL, channels_json TEXT NOT NULL,
        recipient_phone TEXT, recipient_email TEXT, sender_display_name TEXT, sender_timezone TEXT,
        send_at TEXT, message TEXT, expires_in_days INTEGER NOT NULL, revision INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO gift_reservations (id, user_id) VALUES ('reservation_1', 'owner_1');
    `);
    repository = createGiftDeliveryPreferenceRepository(db);
  });
  afterEach(async () => db.close?.());

  test("owner upsert uses optimistic revision and rejects another owner", async () => {
    const first = await repository.upsertOwned({
      reservationId: "reservation_1", userId: "owner_1", expectedRevision: 0,
      preference: { mode: "manual", channels: [] }, timestamp: "2026-07-18T00:00:00Z",
    });
    assert.equal(Number(first.revision), 1);
    const stale = await repository.upsertOwned({
      reservationId: "reservation_1", userId: "owner_1", expectedRevision: 0,
      preference: { mode: "immediate", channels: ["email"] }, timestamp: "2026-07-18T00:01:00Z",
    });
    assert.equal(stale, null);
    assert.equal(await repository.findOwned({ reservationId: "reservation_1", userId: "other" }), undefined);
  });
});

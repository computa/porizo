process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");

const {
  createGiftReservationRepository,
} = require("../src/database/gift-reservation-repository");
const { createSqliteAdapter } = require("../src/database/sqlite");

let db;
let repository;

function createSchema(database) {
  database.exec(`
    CREATE TABLE gift_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      content_type TEXT,
      content_id TEXT,
      version_num INTEGER,
      token_transaction_id TEXT,
      refund_transaction_id TEXT,
      gift_order_id TEXT,
      idempotency_key TEXT,
      expires_at TEXT,
      cancel_reason TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      gift_reservation_id TEXT
    );
  `);
}

async function seedReservation({
  id,
  userId = "gift_reservation_user",
  status = "reserved",
  contentType = null,
  contentId = null,
  versionNum = null,
  tokenTransactionId = "reserve_tx",
  refundTransactionId = null,
  giftOrderId = null,
  idempotencyKey = null,
  expiresAt = "2026-06-28T05:00:00.000Z",
  cancelReason = null,
  createdAt = "2026-06-28T04:00:00.000Z",
  updatedAt = "2026-06-28T04:00:00.000Z",
}) {
  await db
    .prepare(
      `INSERT INTO gift_reservations (
        id,
        user_id,
        status,
        content_type,
        content_id,
        version_num,
        token_transaction_id,
        refund_transaction_id,
        gift_order_id,
        idempotency_key,
        expires_at,
        cancel_reason,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      status,
      contentType,
      contentId,
      versionNum,
      tokenTransactionId,
      refundTransactionId,
      giftOrderId,
      idempotencyKey,
      expiresAt,
      cancelReason,
      createdAt,
      updatedAt,
    );
}

async function seedTrack({ id, reservationId }) {
  await db
    .prepare("INSERT INTO tracks (id, gift_reservation_id) VALUES (?, ?)")
    .run(id, reservationId);
}

describe("GiftReservationRepository", () => {
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    createSchema(db);
    repository = createGiftReservationRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("createReservation inserts a reserved row retrievable by idempotency key", async () => {
    await repository.createReservation({
      id: "gres_created",
      userId: "gift_reservation_user",
      tokenTransactionId: "tx_created",
      idempotencyKey: "idem_created",
      expiresAt: "2026-06-28T05:00:00.000Z",
      createdAt: "2026-06-28T04:00:00.000Z",
    });

    const row = await repository.findByIdempotencyKey({
      userId: "gift_reservation_user",
      idempotencyKey: "idem_created",
    });

    assert.deepEqual(
      {
        id: row.id,
        status: row.status,
        token_transaction_id: row.token_transaction_id,
        content_type: row.content_type,
        gift_order_id: row.gift_order_id,
      },
      {
        id: "gres_created",
        status: "reserved",
        token_transaction_id: "tx_created",
        content_type: null,
        gift_order_id: null,
      },
    );
  });

  test("findActiveForUser returns latest active reservation only", async () => {
    await seedReservation({
      id: "gres_old",
      createdAt: "2026-06-28T04:00:00.000Z",
    });
    await seedReservation({
      id: "gres_ready",
      status: "content_ready",
      createdAt: "2026-06-28T04:02:00.000Z",
    });
    await seedReservation({
      id: "gres_cancelled",
      status: "cancelled",
      createdAt: "2026-06-28T04:03:00.000Z",
    });

    const row = await repository.findActiveForUser("gift_reservation_user");

    assert.equal(row.id, "gres_ready");
  });

  test("listExpiredActive returns only active expired rows ordered by expiry", async () => {
    await seedReservation({
      id: "gres_expired_later",
      expiresAt: "2026-06-28T03:30:00.000Z",
    });
    await seedReservation({
      id: "gres_expired_first",
      status: "content_ready",
      expiresAt: "2026-06-28T03:00:00.000Z",
    });
    await seedReservation({
      id: "gres_cancelled_expired",
      status: "cancelled",
      expiresAt: "2026-06-28T02:00:00.000Z",
    });
    await seedReservation({
      id: "gres_future",
      expiresAt: "2026-06-28T05:00:00.000Z",
    });

    const rows = await repository.listExpiredActive({
      now: "2026-06-28T04:00:00.000Z",
      limit: 10,
    });

    assert.deepEqual(
      rows.map((row) => row.id),
      ["gres_expired_first", "gres_expired_later"],
    );
  });

  test("getActiveForTrack returns only spend-valid reservation statuses", async () => {
    await seedReservation({
      id: "gres_track_active",
      status: "finalized",
    });
    await seedReservation({
      id: "gres_track_cancelled",
      status: "cancelled",
    });
    await seedTrack({
      id: "track_active",
      reservationId: "gres_track_active",
    });
    await seedTrack({
      id: "track_cancelled",
      reservationId: "gres_track_cancelled",
    });

    await db.transaction(async (query) => {
      const active = await repository.getActiveForTrack({
        trackId: "track_active",
        query,
      });
      const cancelled = await repository.getActiveForTrack({
        trackId: "track_cancelled",
        query,
      });

      assert.deepEqual(active, {
        id: "gres_track_active",
        status: "finalized",
      });
      assert.equal(cancelled, undefined);
    });
  });

  test("markRefunded preserves an existing refund transaction id", async () => {
    await seedReservation({
      id: "gres_refunded",
      refundTransactionId: "existing_refund",
    });

    await repository.markRefunded({
      reservationId: "gres_refunded",
      status: "cancelled",
      refundTransactionId: null,
      cancelReason: "user_cancelled",
      updatedAt: "2026-06-28T04:20:00.000Z",
    });

    const row = await repository.getById("gres_refunded");

    assert.deepEqual(
      {
        status: row.status,
        refund_transaction_id: row.refund_transaction_id,
        cancel_reason: row.cancel_reason,
        updated_at: row.updated_at,
      },
      {
        status: "cancelled",
        refund_transaction_id: "existing_refund",
        cancel_reason: "user_cancelled",
        updated_at: "2026-06-28T04:20:00.000Z",
      },
    );
  });

  test("attachContent marks reservation content ready", async () => {
    await seedReservation({ id: "gres_attach" });

    await repository.attachContent({
      reservationId: "gres_attach",
      contentType: "song",
      contentId: "track_attach",
      versionNum: 2,
      updatedAt: "2026-06-28T04:30:00.000Z",
    });

    const row = await repository.getById("gres_attach");

    assert.deepEqual(
      {
        status: row.status,
        content_type: row.content_type,
        content_id: row.content_id,
        version_num: row.version_num,
      },
      {
        status: "content_ready",
        content_type: "song",
        content_id: "track_attach",
        version_num: 2,
      },
    );
  });

  test("markFinalized participates in caller transaction rollback", async () => {
    await seedReservation({ id: "gres_finalize" });

    await assert.rejects(
      db.transaction(async (query) => {
        await repository.markFinalized({
          reservationId: "gres_finalize",
          giftOrderId: "gift_rollback",
          updatedAt: "2026-06-28T04:40:00.000Z",
          query,
        });
        throw new Error("rollback");
      }),
      /rollback/,
    );

    const rolledBack = await repository.getById("gres_finalize");
    assert.equal(rolledBack.status, "reserved");
    assert.equal(rolledBack.gift_order_id, null);

    await db.transaction(async (query) => {
      await repository.markFinalized({
        reservationId: "gres_finalize",
        giftOrderId: "gift_commit",
        updatedAt: "2026-06-28T04:41:00.000Z",
        query,
      });
    });

    const committed = await repository.getById("gres_finalize");
    assert.equal(committed.status, "finalized");
    assert.equal(committed.gift_order_id, "gift_commit");
  });
});

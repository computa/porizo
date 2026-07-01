process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  deleteGiftFundedReservationContent,
  findGiftFundingContent,
  validateGiftFundingReservation,
} = require("../src/services/gift-funding");

const USER_ID = "gift_funding_repo_user";
const NOW = "2026-06-27T10:00:00.000Z";
const FUTURE = "9999-12-31T23:59:59.000Z";

let db;

async function insertUser() {
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, ?)")
    .run(USER_ID, NOW, "low");
}

async function insertReservation({
  id = "gift_funding_reservation",
  userId = USER_ID,
  status = "reserved",
  contentType = null,
  contentId = null,
  versionNum = null,
  giftOrderId = null,
  expiresAt = FUTURE,
} = {}) {
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
        gift_order_id,
        expires_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      status,
      contentType,
      contentId,
      versionNum,
      `${id}_tx`,
      giftOrderId,
      expiresAt,
      NOW,
      NOW,
    );
}

async function insertFundedTrack({
  id = "gift_funding_track",
  reservationId = "gift_funding_reservation",
  shareTokenId = "gift_funding_track_share",
  updatedAt = NOW,
} = {}) {
  await db
    .prepare(
      `INSERT INTO tracks (
        id,
        user_id,
        status,
        title,
        latest_version,
        funding_source,
        gift_reservation_id,
        share_token_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      USER_ID,
      "draft",
      "Gift-funded Track",
      3,
      "gift_token",
      reservationId,
      shareTokenId,
      NOW,
      updatedAt,
    );
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(shareTokenId, id, `${id}:3`, USER_ID, "active", FUTURE, NOW);
  await db
    .prepare(
      `INSERT INTO track_library_entries (
        user_id, track_id, origin, share_token_id, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(USER_ID, id, "created", shareTokenId, NOW, NOW);
}

async function insertFundedPoem({
  id = "gift_funding_poem",
  reservationId = "gift_funding_reservation",
  shareTokenId = "gift_funding_poem_share",
  updatedAt = NOW,
} = {}) {
  await db
    .prepare(
      `INSERT INTO poems (
        id,
        user_id,
        title,
        recipient_name,
        occasion,
        tone,
        verses,
        status,
        funding_source,
        gift_reservation_id,
        share_token_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      USER_ID,
      "Gift-funded Poem",
      "Jamie",
      "birthday",
      "heartfelt",
      JSON.stringify(["line one"]),
      "draft",
      "gift_token",
      reservationId,
      shareTokenId,
      NOW,
      updatedAt,
    );
  await db
    .prepare(
      `INSERT INTO poem_share_tokens (
        id, poem_id, creator_id, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(shareTokenId, id, USER_ID, "active", FUTURE, NOW);
  await db
    .prepare(
      `INSERT INTO poem_library_entries (
        user_id, poem_id, origin, share_token_id, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(USER_ID, id, "created", shareTokenId, NOW, NOW);
}

describe("gift funding repository boundary", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    await insertUser();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("validateGiftFundingReservation returns active owned reservations and rejects existing content", async () => {
    await insertReservation();

    const reservation = await validateGiftFundingReservation(db, {
      userId: USER_ID,
      reservationId: "gift_funding_reservation",
      contentType: "song",
    });
    assert.equal(reservation.id, "gift_funding_reservation");

    await insertFundedTrack();

    await assert.rejects(
      validateGiftFundingReservation(db, {
        userId: USER_ID,
        reservationId: "gift_funding_reservation",
        contentType: "song",
      }),
      { code: "GIFT_RESERVATION_CONTENT_ALREADY_CREATED" },
    );
  });

  test("findGiftFundingContent returns latest funded song or poem for a reservation", async () => {
    await insertReservation();
    await insertFundedTrack({
      id: "gift_funding_track_new",
      shareTokenId: "gift_funding_track_new_share",
      updatedAt: "2026-06-27T09:30:00.000Z",
    });
    await insertFundedPoem({
      id: "gift_funding_poem_only",
      shareTokenId: "gift_funding_poem_only_share",
      updatedAt: "2026-06-27T09:45:00.000Z",
    });

    assert.deepEqual(await findGiftFundingContent(db, {
      reservationId: "gift_funding_reservation",
    }), {
      contentType: "song",
      contentId: "gift_funding_track_new",
      versionNum: 3,
      status: "draft",
      updatedAt: "2026-06-27T09:30:00.000Z",
    });

    assert.deepEqual(await findGiftFundingContent(db, {
      reservationId: "gift_funding_reservation",
      contentType: "poem",
    }), {
      contentType: "poem",
      contentId: "gift_funding_poem_only",
      versionNum: null,
      status: "draft",
      updatedAt: "2026-06-27T09:45:00.000Z",
    });
  });

  test("deleteGiftFundedReservationContent soft-deletes content, removes library rows, and revokes shares", async () => {
    await insertReservation();
    await insertFundedTrack();
    await insertFundedPoem();

    const result = await deleteGiftFundedReservationContent(
      db,
      "gift_funding_reservation",
      NOW,
    );
    assert.deepEqual(result, { tracksDeleted: 1, poemsDeleted: 1 });

    const track = await db
      .prepare("SELECT deleted_at FROM tracks WHERE id = ?")
      .get("gift_funding_track");
    assert.equal(track.deleted_at, NOW);
    const trackShare = await db
      .prepare("SELECT status, web_stream_allowed, dispatched_at FROM share_tokens WHERE id = ?")
      .get("gift_funding_track_share");
    assert.equal(trackShare.status, "revoked");
    assert.equal(Number(trackShare.web_stream_allowed), 0);
    assert.equal(trackShare.dispatched_at, null);
    const trackLibrary = await db
      .prepare("SELECT removed_at FROM track_library_entries WHERE track_id = ?")
      .get("gift_funding_track");
    assert.equal(trackLibrary.removed_at, NOW);

    const poem = await db
      .prepare("SELECT deleted_at FROM poems WHERE id = ?")
      .get("gift_funding_poem");
    assert.equal(poem.deleted_at, NOW);
    const poemShare = await db
      .prepare("SELECT status, dispatched_at FROM poem_share_tokens WHERE id = ?")
      .get("gift_funding_poem_share");
    assert.equal(poemShare.status, "revoked");
    assert.equal(poemShare.dispatched_at, null);
    const poemLibrary = await db
      .prepare("SELECT removed_at FROM poem_library_entries WHERE poem_id = ?")
      .get("gift_funding_poem");
    assert.equal(poemLibrary.removed_at, NOW);
  });
});

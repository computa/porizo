"use strict";

process.env.NODE_ENV = "test";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const { mergeGuestIntoUser } = require("../../src/services/guest-merge");

const NOW = "2026-07-16T10:00:00.000Z";

async function seedUser(db, id, accountStatus = "active") {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, ?, 'low', ?)",
    )
    .run(id, NOW, accountStatus);
  await db
    .prepare(
      "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
    )
    .run(id, NOW);
}

async function seedTrack(db, { trackId, userId, shareId }) {
  await db
    .prepare(
      `INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at, share_token_id)
       VALUES (?, ?, 'complete', 'Song', 'i_love_you', 'Sarah', 'acoustic', ?, ?, ?)`,
    )
    .run(trackId, userId, NOW, NOW, shareId || null);
  await db
    .prepare(
      `INSERT INTO track_library_entries (user_id, track_id, origin, share_token_id, added_at, updated_at)
       VALUES (?, ?, 'created', ?, ?, ?)`,
    )
    .run(userId, trackId, shareId || null, NOW, NOW);
  if (shareId) {
    await db
      .prepare(
        `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, share_type, web_stream_allowed, app_save_allowed, expires_at, created_at, access_count)
         VALUES (?, ?, ?, ?, 'unbound', 'gift', 1, 1, '9999-12-31T00:00:00.000Z', ?, 0)`,
      )
      .run(shareId, trackId, `${trackId}_v1`, userId, NOW);
  }
}

describe("mergeGuestIntoUser", () => {
  let db;

  beforeEach(async () => {
    db = await initDb();
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  it("moves all guest content to the target and soft-deletes the guest (Latifat regression)", async () => {
    await seedUser(db, "guest", "guest");
    await seedUser(db, "existing", "active");
    await seedTrack(db, { trackId: "trk_g", userId: "guest", shareId: "sh_g" });
    await db
      .prepare("UPDATE gift_wallet SET balance = 1 WHERE user_id = 'guest'")
      .run();
    await db
      .prepare(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES ('a1', 'guest', 'created', 'track', 'trk_g', '{}', ?)",
      )
      .run(NOW);
    await db
      .prepare(
        `INSERT INTO etsy_orders
          (id, shop_id, receipt_id, is_paid, is_canceled, state, owner_user_id,
           created_at, updated_at)
         VALUES ('etsy_o1', 'shop', '123', 1, 0, 'claimed', 'guest', ?, ?)`,
      )
      .run(NOW, NOW);
    await db
      .prepare(
        `INSERT INTO etsy_order_units
          (id, etsy_order_id, transaction_id, listing_id, ordinal, state,
           owner_user_id, created_at, updated_at)
         VALUES ('etsy_u1', 'etsy_o1', 'txn', 'listing', 1, 'claimed',
                 'guest', ?, ?)`,
      )
      .run(NOW, NOW);
    await db
      .prepare(
        `INSERT INTO etsy_redemption_codes
          (code, batch_label, status, redeemed_by_user_id, redeemed_at, created_at)
         VALUES ('PZ-ABCD-2345', 'legacy', 'redeemed', 'guest', ?, ?)`,
      )
      .run(NOW, NOW);

    await db.transaction((query) =>
      mergeGuestIntoUser(query, {
        guestUserId: "guest",
        targetUserId: "existing",
      }),
    );

    const track = await db.query(
      "SELECT user_id FROM tracks WHERE id = 'trk_g'",
    );
    assert.equal(track.rows[0].user_id, "existing");

    const lib = await db.query(
      "SELECT user_id FROM track_library_entries WHERE track_id = 'trk_g'",
    );
    assert.equal(lib.rows.length, 1);
    assert.equal(lib.rows[0].user_id, "existing", "no orphan library entry");

    const share = await db.query(
      "SELECT creator_id FROM share_tokens WHERE id = 'sh_g'",
    );
    assert.equal(share.rows[0].creator_id, "existing");

    const audit = await db.query(
      "SELECT user_id FROM audit_logs WHERE id = 'a1'",
    );
    assert.equal(audit.rows[0].user_id, "existing");

    const targetWallet = await db.query(
      "SELECT balance FROM gift_wallet WHERE user_id = 'existing'",
    );
    assert.equal(
      Number(targetWallet.rows[0].balance),
      1,
      "wallet balance moved",
    );
    const guestWallet = await db.query(
      "SELECT balance FROM gift_wallet WHERE user_id = 'guest'",
    );
    assert.equal(Number(guestWallet.rows[0].balance), 0);

    const etsy = await db.query(
      `SELECT o.owner_user_id AS order_owner,
              u.owner_user_id AS unit_owner,
              c.redeemed_by_user_id AS code_owner
         FROM etsy_orders o
         JOIN etsy_order_units u ON u.etsy_order_id = o.id
         JOIN etsy_redemption_codes c ON c.code = 'PZ-ABCD-2345'
        WHERE o.id = 'etsy_o1'`,
    );
    assert.deepEqual(etsy.rows[0], {
      order_owner: "existing",
      unit_owner: "existing",
      code_owner: "existing",
    });

    const guest = await db.query(
      "SELECT deleted_at FROM users WHERE id = 'guest'",
    );
    assert.ok(guest.rows[0].deleted_at, "guest soft-deleted");
  });

  it("dedupes a library entry the target already owns for the same track", async () => {
    await seedUser(db, "guest", "guest");
    await seedUser(db, "existing", "active");
    await seedTrack(db, { trackId: "trk_dup", userId: "guest" });
    // Target already has an entry for the same track id (collision case).
    await db
      .prepare(
        `INSERT INTO track_library_entries (user_id, track_id, origin, added_at, updated_at)
         VALUES ('existing', 'trk_dup', 'received', ?, ?)`,
      )
      .run(NOW, NOW);

    await db.transaction((query) =>
      mergeGuestIntoUser(query, {
        guestUserId: "guest",
        targetUserId: "existing",
      }),
    );

    const entries = await db.query(
      "SELECT user_id, origin FROM track_library_entries WHERE track_id = 'trk_dup'",
    );
    assert.equal(entries.rows.length, 1, "no duplicate PK, guest row removed");
    assert.equal(entries.rows[0].user_id, "existing");
  });

  it("rolls back fully when a statement fails mid-merge (atomicity)", async () => {
    await seedUser(db, "guest", "guest");
    await seedUser(db, "existing", "active");
    await seedTrack(db, { trackId: "trk_a", userId: "guest", shareId: "sh_a" });

    await assert.rejects(
      db.transaction(async (query) => {
        await mergeGuestIntoUser(query, {
          guestUserId: "guest",
          targetUserId: "existing",
        });
        throw new Error("boom after merge");
      }),
      /boom after merge/,
    );

    // Everything must be untouched.
    const track = await db.query(
      "SELECT user_id FROM tracks WHERE id = 'trk_a'",
    );
    assert.equal(track.rows[0].user_id, "guest");
    const guest = await db.query(
      "SELECT deleted_at FROM users WHERE id = 'guest'",
    );
    assert.equal(guest.rows[0].deleted_at, null);
  });
});

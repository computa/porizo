const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { initDb } = require("../src/db");
const { createOrGetShareToken, ensurePoemShareToken } = require("../src/services/share-service");

describe("Share service adapter compatibility", () => {
  let db;

  beforeEach(async () => {
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  it("createOrGetShareToken works with a query-only adapter", async () => {
    await db.query(
      "INSERT INTO users (id, created_at) VALUES (?, ?)",
      ["user_share_service", new Date().toISOString()]
    );
    await db.query(
      "INSERT INTO tracks (id, user_id, status, title, recipient_name, occasion, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "track_share_service",
        "user_share_service",
        "completed",
        "Adapter Test",
        "Ambrose",
        "birthday",
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );
    await db.query(
      "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "version_share_service",
        "track_share_service",
        1,
        "ready",
        "full",
        "params_hash_share_service",
        new Date().toISOString(),
      ]
    );

    const queryOnlyDb = {
      query: db.query,
    };

    const created = await createOrGetShareToken({
      db: queryOnlyDb,
      trackId: "track_share_service",
      trackVersionId: "version_share_service",
      userId: "user_share_service",
      buildShareUrl: (shareId) => `https://api.porizo.co/play/${shareId}`,
    });

    assert.equal(created.existing, false);
    assert.match(created.shareUrl, /\/play\//);
    assert.equal(created.claimPin.length, 6);

    const shareRow = await db.query(
      "SELECT id, track_id, track_version_id FROM share_tokens WHERE id = ?",
      [created.shareId]
    );
    assert.equal(shareRow.rows.length, 1);
    assert.equal(shareRow.rows[0].track_id, "track_share_service");
    assert.equal(shareRow.rows[0].track_version_id, "version_share_service");
  });

  it("ensurePoemShareToken works with a query-only adapter", async () => {
    await db.query(
      "INSERT INTO users (id, created_at) VALUES (?, ?)",
      ["user_poem_share_service", new Date().toISOString()]
    );
    await db.query(
      "INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "poem_share_service",
        "user_poem_share_service",
        "Poem Adapter Test",
        "Ambrose",
        "birthday",
        "heartfelt",
        JSON.stringify([{ text: "A gift for you." }]),
        "A gift for you.",
        "draft",
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );

    const queryOnlyDb = {
      query: db.query,
    };

    const created = await ensurePoemShareToken({
      db: queryOnlyDb,
      poemId: "poem_share_service",
      userId: "user_poem_share_service",
      buildShareUrl: (shareId) => `https://api.porizo.co/play/${shareId}`,
    });

    assert.equal(created.existing, false);
    assert.match(created.shareUrl, /\/play\//);
    assert.equal(created.claimPin.length, 6);

    const shareRow = await db.query(
      "SELECT id, poem_id FROM poem_share_tokens WHERE id = ?",
      [created.shareId]
    );
    assert.equal(shareRow.rows.length, 1);
    assert.equal(shareRow.rows[0].poem_id, "poem_share_service");
  });
});

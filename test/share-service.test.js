const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { initDb } = require("../src/db");
const {
  createOrGetShareToken,
  ensurePoemShareToken,
  scheduleShareFollowups,
} = require("../src/services/share-service");

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
    await db.query("INSERT INTO users (id, created_at) VALUES (?, ?)", [
      "user_share_service",
      new Date().toISOString(),
    ]);
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
      ],
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
      ],
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
      [created.shareId],
    );
    assert.equal(shareRow.rows.length, 1);
    assert.equal(shareRow.rows[0].track_id, "track_share_service");
    assert.equal(shareRow.rows[0].track_version_id, "version_share_service");
  });

  it("ensurePoemShareToken works with a query-only adapter", async () => {
    await db.query("INSERT INTO users (id, created_at) VALUES (?, ?)", [
      "user_poem_share_service",
      new Date().toISOString(),
    ]);
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
      ],
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
      [created.shareId],
    );
    assert.equal(shareRow.rows.length, 1);
    assert.equal(shareRow.rows[0].poem_id, "poem_share_service");
  });

  it("creating a share schedules 3 follow-up rows for the sender", async () => {
    await db.query("INSERT INTO users (id, created_at) VALUES (?, ?)", [
      "user_followup",
      new Date().toISOString(),
    ]);
    await db.query(
      "INSERT INTO tracks (id, user_id, status, title, recipient_name, occasion, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "track_followup",
        "user_followup",
        "completed",
        "Followup Test",
        "Ambrose",
        "birthday",
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    await db.query(
      "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "version_followup",
        "track_followup",
        1,
        "ready",
        "full",
        "params_hash_followup",
        new Date().toISOString(),
      ],
    );

    const created = await createOrGetShareToken({
      db,
      trackId: "track_followup",
      trackVersionId: "version_followup",
      userId: "user_followup",
      buildShareUrl: (shareId) => `https://api.porizo.co/play/${shareId}`,
    });

    const followups = await db.query(
      "SELECT stage FROM share_followups WHERE share_token_id = ? ORDER BY send_at ASC",
      [created.shareId],
    );

    assert.equal(followups.rows.length, 3);
    assert.deepEqual(
      followups.rows.map((r) => r.stage),
      ["sender_24h", "sender_72h", "sender_7d"],
    );
  });

  it("scheduleShareFollowups is idempotent — calling twice does not duplicate rows", async () => {
    await db.query("INSERT INTO users (id, created_at) VALUES (?, ?)", [
      "user_idempotent",
      new Date().toISOString(),
    ]);
    await db.query(
      "INSERT INTO tracks (id, user_id, status, title, recipient_name, occasion, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "track_idempotent",
        "user_idempotent",
        "completed",
        "Idempotent Test",
        "Ambrose",
        "birthday",
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    await db.query(
      "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "version_idempotent",
        "track_idempotent",
        1,
        "ready",
        "full",
        "params_hash_idempotent",
        new Date().toISOString(),
      ],
    );

    const created = await createOrGetShareToken({
      db,
      trackId: "track_idempotent",
      trackVersionId: "version_idempotent",
      userId: "user_idempotent",
      buildShareUrl: (shareId) => `https://api.porizo.co/play/${shareId}`,
    });

    // Run scheduling a second time — should be a no-op via UNIQUE constraint
    await scheduleShareFollowups(db, created.shareId, "user_idempotent");

    const count = await db.query(
      "SELECT COUNT(*) AS n FROM share_followups WHERE share_token_id = ?",
      [created.shareId],
    );
    const n = count.rows[0].n ?? count.rows[0].N ?? count.rows[0]["COUNT(*)"];
    assert.equal(Number(n), 3);
  });
});

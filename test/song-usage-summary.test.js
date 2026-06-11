const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");

test("user_song_usage_summary separates drafts, charged renders, and gift spend", async () => {
  const db = await getDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const userId = `summary_user_${suffix}`;
  const readyTrack = `summary_track_ready_${suffix}`;
  const draftTrack = `summary_track_draft_${suffix}`;
  const readyVersion = `summary_version_ready_${suffix}`;
  const draftVersion = `summary_version_draft_${suffix}`;
  const now = new Date().toISOString();

  try {
    await db.query("INSERT INTO users (id, created_at) VALUES (?, ?)", [userId, now]);
    await db.query(
      `INSERT INTO entitlements (
         user_id, tier, songs_remaining, songs_used_total, gift_songs_used_total, updated_at
       ) VALUES (?, 'free', 0, 2, 1, ?)`,
      [userId, now],
    );
    await db.query(
      "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
      [userId, now],
    );
    await db.query(
      "INSERT INTO tracks (id, user_id, status, created_at, updated_at) VALUES (?, ?, 'ready', ?, ?)",
      [readyTrack, userId, now, now],
    );
    await db.query(
      "INSERT INTO tracks (id, user_id, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)",
      [draftTrack, userId, now, now],
    );
    await db.query(
      `INSERT INTO track_versions (
         id, track_id, version_num, status, render_type, params_hash, created_at, song_entitlement_consumed_at
       ) VALUES (?, ?, 1, 'full_ready', 'preview', 'h1', ?, ?)`,
      [readyVersion, readyTrack, now, now],
    );
    await db.query(
      `INSERT INTO track_versions (
         id, track_id, version_num, status, render_type, params_hash, created_at
       ) VALUES (?, ?, 1, 'draft', 'preview', 'h2', ?)`,
      [draftVersion, draftTrack, now],
    );

    const result = await db.query("SELECT * FROM user_song_usage_summary WHERE user_id = ?", [
      userId,
    ]);

    assert.equal(result.rows.length, 1);
    assert.equal(Number(result.rows[0].tracks_total), 2);
    assert.equal(Number(result.rows[0].draft_tracks_total), 1);
    assert.equal(Number(result.rows[0].versions_total), 2);
    assert.equal(Number(result.rows[0].charged_versions_total), 1);
    assert.equal(Number(result.rows[0].ready_versions_total), 1);
    assert.equal(Number(result.rows[0].gift_wallet_balance), 0);
    assert.equal(Number(result.rows[0].songs_used_total), 2);
    assert.equal(Number(result.rows[0].gift_songs_used_total), 1);
    assert.equal(Number(result.rows[0].non_gift_songs_used_total), 1);
  } finally {
    if (typeof db.close === "function") {
      await db.close();
    }
  }
});

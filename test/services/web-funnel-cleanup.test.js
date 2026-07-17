"use strict";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const {
  cleanupExpiredWebFunnelState,
} = require("../../src/services/web-funnel-cleanup");

describe("web funnel cleanup", () => {
  let db;

  beforeEach(async () => {
    db = await initDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("reaps expired empty guests and old counters but preserves guests with songs", async () => {
    const old = "2025-01-01T00:00:00.000Z";
    const now = "2026-07-17T00:00:00.000Z";
    await db
      .prepare(
        "INSERT INTO users (id, created_at, account_status) VALUES (?, ?, 'guest'), (?, ?, 'guest')",
      )
      .run("guest_empty", old, "guest_song", old);
    await db
      .prepare(
        `INSERT INTO tracks
         (id, user_id, status, voice_mode, latest_version, created_at, updated_at)
         VALUES ('track_kept', 'guest_song', 'draft', 'ai_voice', 0, ?, ?)`,
      )
      .run(old, old);
    await db
      .prepare(
        `INSERT INTO rate_limits
         (user_id, action_type, window_start_ms, window_seconds, count, limit_count)
         VALUES
           ('global:web_funnel', 'web_provider_global_daily', 1, 86400, 1, 100),
           ('guest_song', 'web_preview_guest_lifetime', 1, 315360000, 1, 2)`,
      )
      .run();

    await cleanupExpiredWebFunnelState(db, {
      now,
      rateLimitNowMs: 86_400_002,
    });

    assert.equal(
      Number(
        (
          await db
            .prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'guest_empty'")
            .get()
        ).count,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await db
            .prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'guest_song'")
            .get()
        ).count,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS count FROM rate_limits WHERE action_type = 'web_provider_global_daily'",
            )
            .get()
        ).count,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await db
            .prepare(
              "SELECT count FROM rate_limits WHERE action_type = 'web_preview_guest_lifetime'",
            )
            .get()
        ).count,
      ),
      1,
      "the lifetime cap must outlive routine cleanup",
    );
  });
});

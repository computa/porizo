process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createShareFollowupRepository,
} = require("../src/database/share-followup-repository");

let db;
let repository;

async function seedShare({
  userId = "followup_user",
  shareId = "share_followup",
  trackId = "track_followup",
  email = null,
  displayName = "Sender",
  shareStatus = "unbound",
  unsubscribedAt = null,
} = {}) {
  const now = "2026-06-25T10:00:00.000Z";
  const senderEmail = email || `${userId}@example.com`;
  await db
    .prepare(
      "INSERT INTO users (id, email, display_name, unsubscribed_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(userId, senderEmail, displayName, unsubscribedAt, now);
  await db
    .prepare(
      "INSERT INTO tracks (id, user_id, status, title, recipient_name, occasion, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      trackId,
      userId,
      "completed",
      "Followup Song",
      "Ambrose",
      "birthday",
      now,
      now,
    );
  await db
    .prepare(
      "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(`version_${trackId}`, trackId, 1, "ready", "full", `hash_${trackId}`, now);
  await db
    .prepare(
      "INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      shareId,
      trackId,
      `version_${trackId}`,
      userId,
      shareStatus,
      "9999-12-31T23:59:59.000Z",
      now,
    );
  return { userId, shareId, trackId };
}

async function insertFollowup({
  id,
  shareId = "share_followup",
  userId = "followup_user",
  stage,
  sendAt,
  sentAt = null,
  skipReason = null,
}) {
  await db
    .prepare(
      `INSERT INTO share_followups (
         id, share_token_id, sender_user_id, stage, send_at, sent_at, skip_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, shareId, userId, stage, sendAt, sentAt, skipReason);
}

describe("ShareFollowupRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createShareFollowupRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("scheduleFollowups is idempotent by share token and stage", async () => {
    const { userId, shareId } = await seedShare();
    const rows = [
      {
        id: "sf_24h_a",
        shareTokenId: shareId,
        senderUserId: userId,
        stage: "sender_24h",
        sendAt: "2026-06-26T10:00:00.000Z",
      },
      {
        id: "sf_72h_a",
        shareTokenId: shareId,
        senderUserId: userId,
        stage: "sender_72h",
        sendAt: "2026-06-28T10:00:00.000Z",
      },
    ];

    await repository.scheduleFollowups(rows);
    await repository.scheduleFollowups(
      rows.map((row) => ({ ...row, id: `${row.id}_duplicate` })),
    );

    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM share_followups WHERE share_token_id = ?")
      .get(shareId);
    assert.equal(Number(count.n), 2);
  });

  test("listDueFollowups filters pending due rows and joins sender/share/track fields", async () => {
    await seedShare({ email: "sender@example.com" });
    await seedShare({
      userId: "followup_user_sent",
      shareId: "share_followup_sent",
      trackId: "track_followup_sent",
    });
    await seedShare({
      userId: "followup_user_skipped",
      shareId: "share_followup_skipped",
      trackId: "track_followup_skipped",
    });
    await seedShare({
      userId: "followup_user_future",
      shareId: "share_followup_future",
      trackId: "track_followup_future",
    });
    await insertFollowup({
      id: "sf_due_1",
      stage: "sender_24h",
      sendAt: "2026-06-26T08:00:00.000Z",
    });
    await insertFollowup({
      id: "sf_due_2",
      stage: "sender_72h",
      sendAt: "2026-06-26T09:00:00.000Z",
    });
    await insertFollowup({
      id: "sf_sent",
      shareId: "share_followup_sent",
      userId: "followup_user_sent",
      stage: "sender_7d",
      sendAt: "2026-06-26T07:00:00.000Z",
      sentAt: "2026-06-26T07:30:00.000Z",
    });
    await insertFollowup({
      id: "sf_skipped",
      shareId: "share_followup_skipped",
      userId: "followup_user_skipped",
      stage: "sender_7d",
      sendAt: "2026-06-26T07:30:00.000Z",
      skipReason: "unsubscribed",
    });
    await insertFollowup({
      id: "sf_future",
      shareId: "share_followup_future",
      userId: "followup_user_future",
      stage: "sender_7d",
      sendAt: "2026-06-27T08:00:00.000Z",
    });

    const rows = await repository.listDueFollowups(
      "2026-06-26T10:00:00.000Z",
      10,
    );

    assert.deepEqual(
      rows.map((row) => row.id),
      ["sf_due_1", "sf_due_2"],
    );
    assert.equal(rows[0].sender_email, "sender@example.com");
    assert.equal(rows[0].sender_name, "Sender");
    assert.equal(rows[0].share_status, "unbound");
    assert.equal(rows[0].recipient_name, "Ambrose");
  });

  test("listDueFollowups honors limit after ordering by send_at", async () => {
    await seedShare();
    await insertFollowup({
      id: "sf_due_1",
      stage: "sender_24h",
      sendAt: "2026-06-26T08:00:00.000Z",
    });
    await insertFollowup({
      id: "sf_due_2",
      stage: "sender_72h",
      sendAt: "2026-06-26T09:00:00.000Z",
    });

    const rows = await repository.listDueFollowups(
      "2026-06-26T10:00:00.000Z",
      1,
    );

    assert.deepEqual(rows.map((row) => row.id), ["sf_due_1"]);
  });

  test("markSent and markSkipped persist exact delivery state", async () => {
    await seedShare();
    await insertFollowup({
      id: "sf_sent",
      stage: "sender_24h",
      sendAt: "2026-06-26T08:00:00.000Z",
    });
    await insertFollowup({
      id: "sf_skip",
      stage: "sender_72h",
      sendAt: "2026-06-26T09:00:00.000Z",
    });

    await repository.markSent(
      "sf_sent",
      "resend_123",
      "2026-06-26T10:00:00.000Z",
    );
    await repository.markSkipped("sf_skip", "share_revoked");

    const sent = await db
      .prepare("SELECT sent_at, resend_email_id FROM share_followups WHERE id = ?")
      .get("sf_sent");
    assert.equal(sent.sent_at, "2026-06-26T10:00:00.000Z");
    assert.equal(sent.resend_email_id, "resend_123");

    const skipped = await db
      .prepare("SELECT skip_reason FROM share_followups WHERE id = ?")
      .get("sf_skip");
    assert.equal(skipped.skip_reason, "share_revoked");
  });

  test("getTrackTitle returns the title row for the joined track", async () => {
    const { trackId } = await seedShare();

    const title = await repository.getTrackTitle(trackId);

    assert.deepEqual(title, { title: "Followup Song" });
  });
});

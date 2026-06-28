process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createReceiverSessionRepository,
} = require("../src/database/receiver-session-repository");

let db;
let repository;

async function seedReceiverSession({
  id,
  receiverHandoffId = null,
  handoffExpiresAt = "2026-06-28T10:00:00.000Z",
  handoffResolvedAt = null,
  downloadAttributedAt = null,
  matchedUserId = null,
  firstIpAddress = null,
  lastIpAddress = null,
  createdAt = "2026-06-27T10:00:00.000Z",
  updatedAt = "2026-06-27T10:00:00.000Z",
} = {}) {
  await db
    .prepare(
      `INSERT INTO receiver_sessions (
        id, share_id, content_kind, receiver_handoff_id, handoff_expires_at,
        handoff_resolved_at, download_attributed_at, matched_user_id,
        first_event_name, last_event_name, first_ip_address, last_ip_address,
        created_at, updated_at
      ) VALUES (?, ?, 'song', ?, ?, ?, ?, ?,
        'receiver_save_cta_clicked', 'receiver_save_cta_clicked', ?, ?, ?, ?)`,
    )
    .run(
      id,
      `share_${id}`,
      receiverHandoffId,
      handoffExpiresAt,
      handoffResolvedAt,
      downloadAttributedAt,
      matchedUserId,
      firstIpAddress,
      lastIpAddress,
      createdAt,
      updatedAt,
    );
}

describe("ReceiverSessionRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createReceiverSessionRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("markDownloadAttributedByHandoff is one-shot and guarded by handoff identity", async () => {
    await seedReceiverSession({
      id: "rs_111111111111111111111111",
      receiverHandoffId: "rh_aaaaaaaaaaaaaaaaaaaaaaaa",
    });
    await seedReceiverSession({
      id: "rs_222222222222222222222222",
      receiverHandoffId: "rh_bbbbbbbbbbbbbbbbbbbbbbbb",
      handoffResolvedAt: "2026-06-27T09:00:00.000Z",
    });
    await seedReceiverSession({
      id: "rs_333333333333333333333333",
      receiverHandoffId: "rh_cccccccccccccccccccccccc",
      handoffExpiresAt: "2026-06-26T10:00:00.000Z",
    });

    const now = "2026-06-27T10:30:00.000Z";
    const first = await repository.markDownloadAttributedByHandoff({
      receiverSessionId: "rs_111111111111111111111111",
      receiverHandoffId: "rh_aaaaaaaaaaaaaaaaaaaaaaaa",
      now,
    });
    assert.equal(first.changes, 1);

    const replay = await repository.markDownloadAttributedByHandoff({
      receiverSessionId: "rs_111111111111111111111111",
      receiverHandoffId: "rh_aaaaaaaaaaaaaaaaaaaaaaaa",
      now: "2026-06-27T10:31:00.000Z",
    });
    assert.equal(replay.changes, 0);

    const mismatched = await repository.markDownloadAttributedByHandoff({
      receiverSessionId: "rs_111111111111111111111111",
      receiverHandoffId: "rh_bbbbbbbbbbbbbbbbbbbbbbbb",
      now,
    });
    assert.equal(mismatched.changes, 0);

    const resolved = await repository.markDownloadAttributedByHandoff({
      receiverSessionId: "rs_222222222222222222222222",
      receiverHandoffId: "rh_bbbbbbbbbbbbbbbbbbbbbbbb",
      now,
    });
    assert.equal(resolved.changes, 0);

    const expired = await repository.markDownloadAttributedByHandoff({
      receiverSessionId: "rs_333333333333333333333333",
      receiverHandoffId: "rh_cccccccccccccccccccccccc",
      now,
    });
    assert.equal(expired.changes, 0);

    const row = await db
      .prepare(
        "SELECT download_attributed_at, updated_at FROM receiver_sessions WHERE id = ?",
      )
      .get("rs_111111111111111111111111");
    assert.equal(row.download_attributed_at, now);
    assert.equal(row.updated_at, now);
  });

  test("matchRecentUnmatchedSessionByIp attributes the newest eligible same-IP session once", async () => {
    await seedReceiverSession({
      id: "rs_old_same_ip_111111111111",
      firstIpAddress: "203.0.113.10",
      lastIpAddress: "203.0.113.10",
      updatedAt: "2026-06-27T09:00:00.000Z",
    });
    await seedReceiverSession({
      id: "rs_new_same_ip_222222222222",
      firstIpAddress: "203.0.113.10",
      lastIpAddress: "203.0.113.10",
      updatedAt: "2026-06-27T11:00:00.000Z",
    });
    await seedReceiverSession({
      id: "rs_different_ip_333333333",
      firstIpAddress: "198.51.100.10",
      lastIpAddress: "198.51.100.10",
      updatedAt: "2026-06-27T12:00:00.000Z",
    });
    await seedReceiverSession({
      id: "rs_already_matched_444444",
      firstIpAddress: "203.0.113.10",
      lastIpAddress: "203.0.113.10",
      matchedUserId: "existing_user",
      updatedAt: "2026-06-27T13:00:00.000Z",
    });
    await seedReceiverSession({
      id: "rs_stale_same_ip_55555555",
      firstIpAddress: "203.0.113.10",
      lastIpAddress: "203.0.113.10",
      createdAt: "2026-06-20T10:00:00.000Z",
      updatedAt: "2026-06-28T10:00:00.000Z",
    });

    const result = await repository.matchRecentUnmatchedSessionByIp({
      userId: "new_user",
      clientIp: "203.0.113.10",
      cutoff: "2026-06-26T10:00:00.000Z",
      now: "2026-06-28T10:00:00.000Z",
    });
    assert.equal(result.changes, 1);
    assert.equal(result.attributed, true);

    const rows = await db
      .prepare(
        "SELECT id, matched_user_id FROM receiver_sessions ORDER BY id",
      )
      .all();
    assert.deepEqual(
      rows.filter((row) => row.matched_user_id === "new_user").map((row) => row.id),
      ["rs_new_same_ip_222222222222"],
    );

    const replay = await repository.matchRecentUnmatchedSessionByIp({
      userId: "second_user",
      clientIp: "198.51.100.99",
      cutoff: "2026-06-26T10:00:00.000Z",
      now: "2026-06-28T10:01:00.000Z",
    });
    assert.equal(replay.changes, 0);
  });
});

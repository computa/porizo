process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminTrackTransferRepository,
} = require("../src/database/admin-track-transfer-repository");

const NOW = "2026-06-27T10:00:00.000Z";

let db;
let repository;

async function seedUser({
  id,
  email = `${id}@example.com`,
  displayName = id,
  deletedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, risk_level, deleted_at)
       VALUES (?, ?, ?, ?, 'low', ?)`,
    )
    .run(id, email, displayName, NOW, deletedAt);
}

async function seedTransferGraph({
  sourceUserId = "source_user",
  targetUserId = "target_user",
  trackId = "transfer_track",
  versionId = "transfer_track_v1",
  shareId = "transfer_share",
} = {}) {
  await seedUser({
    id: sourceUserId,
    email: "source@example.com",
    displayName: "Source User",
  });
  await seedUser({
    id: targetUserId,
    email: "target@example.com",
    displayName: "Target User",
  });
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, 'complete', 'Transfer Song', 'birthday', 'Ada', 'pop', ?, ?)`,
    )
    .run(trackId, sourceUserId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', 'full', ?, ?)`,
    )
    .run(versionId, trackId, `${trackId}_hash`, NOW);
  await db
    .prepare(
      `INSERT INTO track_library_entries (
        user_id, track_id, origin, added_at, updated_at
      ) VALUES (?, ?, 'created', ?, ?)`,
    )
    .run(sourceUserId, trackId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, bound_device_id,
        bound_device_platform, bound_app_version, bound_user_id, bound_at,
        claim_pin, claim_attempts, expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'claimed', 'old-device', 'ios', '1.0.0', 'recipient_user', ?, '123456', 4, ?, ?)`,
    )
    .run(
      shareId,
      trackId,
      versionId,
      sourceUserId,
      "2026-06-27T09:00:00.000Z",
      "2026-07-27T10:00:00.000Z",
      NOW,
    );
  await seedUser({
    id: "recipient_user",
    email: "recipient@example.com",
    displayName: "Recipient User",
  });
  await db
    .prepare(
      `INSERT INTO track_library_entries (
        user_id, track_id, origin, share_token_id, added_at, updated_at
      ) VALUES ('recipient_user', ?, 'received', ?, ?, ?)`,
    )
    .run(trackId, shareId, NOW, NOW);

  return { sourceUserId, targetUserId, trackId, versionId, shareId };
}

describe("AdminTrackTransferRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAdminTrackTransferRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("finds transfer candidates and active jobs with policy-relevant fields", async () => {
    const graph = await seedTransferGraph();
    await db
      .prepare("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run("2026-06-27T10:05:00.000Z", graph.targetUserId);
    await db
      .prepare(
        `INSERT INTO jobs (
          id, track_version_id, workflow_type, status, created_at, updated_at
        ) VALUES ('active_transfer_job', ?, 'song_render', 'queued', ?, ?)`,
      )
      .run(graph.versionId, NOW, NOW);

    assert.deepEqual(await repository.findTransferTrack(graph.trackId), {
      id: graph.trackId,
      user_id: graph.sourceUserId,
      title: "Transfer Song",
    });
    assert.deepEqual(await repository.findTransferTargetUser(graph.targetUserId), {
      id: graph.targetUserId,
      email: "target@example.com",
      display_name: "Target User",
      deleted_at: "2026-06-27T10:05:00.000Z",
    });
    assert.deepEqual(await repository.findActiveTrackJob(graph.trackId), {
      id: "active_transfer_job",
    });
  });

  test("transfers ownership, moves library membership, resets share state, and audits", async () => {
    const graph = await seedTransferGraph();

    await repository.transferTrackOwnership({
      trackId: graph.trackId,
      sourceUserId: graph.sourceUserId,
      targetUserId: graph.targetUserId,
      adminId: "adm_initial",
      adminEmail: "admin@porizo.app",
      transferId: "transfer_audit",
      now: "2026-06-27T10:10:00.000Z",
    });

    assert.deepEqual(
      await db
        .prepare("SELECT user_id, updated_at FROM tracks WHERE id = ?")
        .get(graph.trackId),
      {
        user_id: graph.targetUserId,
        updated_at: "2026-06-27T10:10:00.000Z",
      },
    );
    assert.equal(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM track_library_entries WHERE track_id = ? AND user_id = ?",
        )
        .get(graph.trackId, graph.sourceUserId).count,
      0,
    );
    assert.deepEqual(
      await db
        .prepare(
          "SELECT user_id, origin, removed_at FROM track_library_entries WHERE track_id = ? AND user_id = ?",
        )
        .get(graph.trackId, graph.targetUserId),
      {
        user_id: graph.targetUserId,
        origin: "created",
        removed_at: null,
      },
    );
    assert.deepEqual(
      await db
        .prepare(
          `SELECT creator_id, status, bound_device_id, bound_device_platform,
                  bound_app_version, bound_user_id, bound_at, claim_pin, claim_attempts
           FROM share_tokens WHERE id = ?`,
        )
        .get(graph.shareId),
      {
        creator_id: graph.targetUserId,
        status: "unbound",
        bound_device_id: null,
        bound_device_platform: null,
        bound_app_version: null,
        bound_user_id: null,
        bound_at: null,
        claim_pin: "123456",
        claim_attempts: 0,
      },
    );
    assert.deepEqual(
      await db
        .prepare(
          "SELECT origin, removed_at FROM track_library_entries WHERE track_id = ? AND user_id = 'recipient_user'",
        )
        .get(graph.trackId),
      {
        origin: "received",
        removed_at: "2026-06-27T10:10:00.000Z",
      },
    );

    const audit = await db
      .prepare(
        "SELECT user_id, action, resource_type, resource_id, metadata_json FROM audit_logs WHERE id = ?",
      )
      .get("transfer_audit");
    assert.equal(audit.user_id, "adm_initial");
    assert.equal(audit.action, "track_transferred");
    assert.equal(audit.resource_type, "track");
    assert.equal(audit.resource_id, graph.trackId);
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      admin_email: "admin@porizo.app",
      from_user: graph.sourceUserId,
      to_user: graph.targetUserId,
    });

    assert.deepEqual(
      await repository.getTransferVerification({
        trackId: graph.trackId,
        sourceUserId: graph.sourceUserId,
        targetUserId: graph.targetUserId,
      }),
      {
        track_owner: graph.targetUserId,
        library_owner: graph.targetUserId,
        library_origin: "created",
        source_library_entries: 0,
        active_received_entries: 0,
        share_creator: graph.targetUserId,
        share_status: "unbound",
        share_bound_device_id: null,
        share_bound_device_platform: null,
        share_bound_app_version: null,
        share_bound_user_id: null,
        share_bound_at: null,
      },
    );
  });

  test("rejects active jobs inside the transfer transaction", async () => {
    const graph = await seedTransferGraph();
    await db
      .prepare(
        `INSERT INTO jobs (
          id, track_version_id, workflow_type, status, created_at, updated_at
        ) VALUES ('active_running_job', ?, 'song_render', 'running', ?, ?)`,
      )
      .run(graph.versionId, NOW, NOW);

    await assert.rejects(
      () =>
        repository.transferTrackOwnership({
          trackId: graph.trackId,
          sourceUserId: graph.sourceUserId,
          targetUserId: graph.targetUserId,
          adminId: "adm_initial",
          adminEmail: "admin@porizo.app",
          transferId: "active_job_transfer",
          now: "2026-06-27T10:15:00.000Z",
        }),
      /ACTIVE_JOB/,
    );

    assert.equal(
      await db
        .prepare("SELECT user_id FROM tracks WHERE id = ?")
        .get(graph.trackId).user_id,
      graph.sourceUserId,
    );
    assert.equal(
      await db
        .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE id = ?")
        .get("active_job_transfer").count,
      0,
    );
  });

  test("rolls back all writes when optimistic ownership check fails", async () => {
    const graph = await seedTransferGraph();
    await db
      .prepare("UPDATE tracks SET user_id = ? WHERE id = ?")
      .run("different_owner", graph.trackId);

    await assert.rejects(
      () =>
        repository.transferTrackOwnership({
          trackId: graph.trackId,
          sourceUserId: graph.sourceUserId,
          targetUserId: graph.targetUserId,
          adminId: "adm_initial",
          adminEmail: "admin@porizo.app",
          transferId: "failed_transfer",
          now: "2026-06-27T10:20:00.000Z",
        }),
      /CONCURRENT_TRANSFER/,
    );

    assert.equal(
      await db
        .prepare("SELECT creator_id FROM share_tokens WHERE id = ?")
        .get(graph.shareId).creator_id,
      graph.sourceUserId,
    );
    assert.equal(
      await db
        .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE id = ?")
        .get("failed_transfer").count,
      0,
    );
  });
});

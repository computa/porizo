require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");
const adminAuthService = require("../src/services/admin-auth-service");

const NOW = "2026-06-27T10:00:00.000Z";

async function seedUser(db, id) {
  await db
    .prepare(
      "INSERT INTO users (id, email, display_name, created_at, risk_level) VALUES (?, ?, ?, ?, 'low')",
    )
    .run(id, `${id}@example.com`, id, NOW);
}

async function seedTrackShare(
  db,
  {
    userId = "share_route_user",
    trackId = "share_route_track",
    versionId = `${trackId}_v1`,
    shareId = `${trackId}_share`,
    title = "Admin Share Song",
    status = "claimed",
    boundDeviceId = "old-device",
    streamKey = "stream-secret",
    createdAt = NOW,
  } = {},
) {
  await seedUser(db, userId);
  await db
    .prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, created_at, updated_at
      ) VALUES (?, ?, 'complete', ?, 'birthday', 'Ada', 'pop', ?, ?)`,
    )
    .run(trackId, userId, title, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO track_versions (
        id, track_id, version_num, status, render_type, params_hash, created_at
      ) VALUES (?, ?, 1, 'complete', 'full', ?, ?)`,
    )
    .run(versionId, trackId, `${trackId}_hash`, NOW);
  await db
    .prepare(
      `INSERT INTO share_tokens (
        id, track_id, track_version_id, creator_id, status, bound_device_id,
        stream_key, expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 7)`,
    )
    .run(
      shareId,
      trackId,
      versionId,
      userId,
      status,
      boundDeviceId,
      streamKey,
      "2026-07-27T10:00:00.000Z",
      createdAt,
    );
  return { userId, trackId, versionId, shareId };
}

async function seedPoemShare(
  db,
  {
    userId = "poem_share_route_user",
    poemId = "poem_share_route_poem",
    shareId = `${poemId}_share`,
    status = "active",
    claimAttempts = 4,
    createdAt = NOW,
  } = {},
) {
  await seedUser(db, userId);
  await db
    .prepare(
      `INSERT INTO poems (
        id, user_id, title, recipient_name, occasion, tone, verses, status, created_at, updated_at
      ) VALUES (?, ?, 'Admin Poem', 'Ada', 'birthday', 'warm', '[]', 'complete', ?, ?)`,
    )
    .run(poemId, userId, NOW, NOW);
  await db
    .prepare(
      `INSERT INTO poem_share_tokens (
        id, poem_id, creator_id, status, claim_pin, claim_attempts, allow_save,
        claim_policy, expires_at, created_at, access_count
      ) VALUES (?, ?, ?, ?, '123456', ?, 1, 'default', ?, ?, 3)`,
    )
    .run(
      shareId,
      poemId,
      userId,
      status,
      claimAttempts,
      "2026-07-27T10:00:00.000Z",
      createdAt,
    );
  return { userId, poemId, shareId };
}

describe("admin share routes", () => {
  let db;
  let app;
  let adminToken;
  let viewerToken;

  async function loginAdmin(email = "admin@porizo.app", password = "admin123") {
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token;
  }

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: {
        STORAGE_DIR: "/tmp/test-storage",
        PUBLIC_BASE_URL: "http://public.local",
      },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
    adminToken = await loginAdmin();
    const createdViewer = await adminAuthService.createAdmin(
      "share-viewer@example.com",
      "admin123",
      "Share Viewer",
      "viewer",
    );
    assert.equal(createdViewer.success, true);
    viewerToken = await loginAdmin("share-viewer@example.com", "admin123");
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("lists song shares with filters and existing response fields", async () => {
    const first = await seedTrackShare(db, {
      userId: "share_owner_a",
      trackId: "share_track_a",
      shareId: "share_token_a",
      status: "claimed",
      streamKey: "stream-a",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await seedTrackShare(db, {
      userId: "share_owner_b",
      trackId: "share_track_b",
      shareId: "share_token_b",
      status: "unbound",
      streamKey: "stream-b",
      createdAt: "2026-06-27T10:01:00.000Z",
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/dashboard/shares?status=claimed&trackId=${first.trackId}&userId=${first.userId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.shares.length, 1);
    assert.deepEqual(body.shares[0], {
      id: first.shareId,
      track_id: first.trackId,
      status: "claimed",
      access_count: 7,
      bound_device_id: "old-device",
      stream_key: "stream-a",
      created_at: NOW,
      expires_at: "2026-07-27T10:00:00.000Z",
      track_title: "Admin Share Song",
    });
  });

  test("rebinds a song share device and writes an audit row", async () => {
    const share = await seedTrackShare(db, {
      shareId: "share_rebind_token",
      boundDeviceId: "old-device",
    });

    const response = await app.inject({
      method: "POST",
      url: `/admin/dashboard/share/${share.shareId}/rebind`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { newDeviceId: "new-device", reason: "support request" },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      success: true,
      oldDeviceId: "old-device",
      newDeviceId: "new-device",
    });
    const updated = await db
      .prepare("SELECT bound_device_id FROM share_tokens WHERE id = ?")
      .get(share.shareId);
    assert.equal(updated.bound_device_id, "new-device");
    const audit = await db
      .prepare(
        "SELECT user_id, action, resource_type, resource_id, metadata_json FROM audit_logs WHERE action = 'share_rebound'",
      )
      .get();
    assert.equal(audit.user_id, "adm_initial");
    assert.equal(audit.resource_type, "share_token");
    assert.equal(audit.resource_id, share.shareId);
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      actor: "admin",
      admin_id: "adm_initial",
      oldDeviceId: "old-device",
      newDeviceId: "new-device",
      reason: "support request",
    });
  });

  test("blocks viewer admins from share and poem-share mutations", async () => {
    const songShare = await seedTrackShare(db, { shareId: "share_viewer_token" });
    const poemShare = await seedPoemShare(db, {
      shareId: "poem_share_viewer_token",
    });

    for (const request of [
      {
        method: "POST",
        url: `/admin/dashboard/share/${songShare.shareId}/rebind`,
        payload: { newDeviceId: "viewer-device" },
      },
      {
        method: "POST",
        url: `/admin/dashboard/poem-share/${poemShare.shareId}/reset-attempts`,
        payload: { reason: "viewer" },
      },
      {
        method: "POST",
        url: `/admin/dashboard/poem-share/${poemShare.shareId}/revoke`,
        payload: { reason: "viewer" },
      },
    ]) {
      const response = await app.inject({
        ...request,
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      assert.equal(response.statusCode, 403, response.body);
    }
  });

  test("preserves share mutation error envelopes", async () => {
    const missingDevice = await app.inject({
      method: "POST",
      url: "/admin/dashboard/share/missing/rebind",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "missing device" },
    });
    assert.equal(missingDevice.statusCode, 400, missingDevice.body);
    assert.equal(missingDevice.json().error, "INVALID_PARAMS");

    const missingShare = await app.inject({
      method: "POST",
      url: "/admin/dashboard/share/missing/rebind",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { newDeviceId: "new-device" },
    });
    assert.equal(missingShare.statusCode, 400, missingShare.body);
    assert.equal(missingShare.json().error, "REBIND_ERROR");

    const missingPoemShare = await app.inject({
      method: "POST",
      url: "/admin/dashboard/poem-share/missing/reset-attempts",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "missing share" },
    });
    assert.equal(missingPoemShare.statusCode, 400, missingPoemShare.body);
    assert.equal(missingPoemShare.json().error, "RESET_ERROR");

    const revoked = await seedPoemShare(db, {
      shareId: "already_revoked_poem_share",
      status: "revoked",
    });
    const alreadyRevoked = await app.inject({
      method: "POST",
      url: `/admin/dashboard/poem-share/${revoked.shareId}/revoke`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "already revoked" },
    });
    assert.equal(alreadyRevoked.statusCode, 400, alreadyRevoked.body);
    assert.equal(alreadyRevoked.json().error, "REVOKE_ERROR");
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'poem_share_revoked'",
        )
        .get().count,
      0,
    );
  });

  test("lists poem shares with filters and existing response fields", async () => {
    const first = await seedPoemShare(db, {
      userId: "poem_owner_a",
      poemId: "poem_share_a",
      shareId: "poem_share_token_a",
      status: "active",
      claimAttempts: 5,
    });
    await seedPoemShare(db, {
      userId: "poem_owner_b",
      poemId: "poem_share_b",
      shareId: "poem_share_token_b",
      status: "revoked",
      createdAt: "2026-06-27T10:01:00.000Z",
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/dashboard/poem-shares?status=active&poemId=${first.poemId}&userId=${first.userId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.shares.length, 1);
    assert.deepEqual(body.shares[0], {
      id: first.shareId,
      poem_id: first.poemId,
      creator_id: first.userId,
      status: "active",
      claim_pin: "123456",
      claim_attempts: 5,
      access_count: 3,
      bound_user_id: null,
      allow_save: 1,
      claim_policy: "default",
      created_at: NOW,
      expires_at: "2026-07-27T10:00:00.000Z",
      poem_title: "Admin Poem",
      recipient_name: "Ada",
    });
  });

  test("resets and revokes poem shares with audit logging", async () => {
    const share = await seedPoemShare(db, {
      shareId: "poem_share_mutation_token",
      status: "active",
      claimAttempts: 6,
    });

    const resetResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/poem-share/${share.shareId}/reset-attempts`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "recipient locked out" },
    });

    assert.equal(resetResponse.statusCode, 200, resetResponse.body);
    assert.deepEqual(resetResponse.json(), {
      success: true,
      oldAttempts: 6,
    });
    assert.equal(
      db
        .prepare("SELECT claim_attempts FROM poem_share_tokens WHERE id = ?")
        .get(share.shareId).claim_attempts,
      0,
    );

    const revokeResponse = await app.inject({
      method: "POST",
      url: `/admin/dashboard/poem-share/${share.shareId}/revoke`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { reason: "support revoke" },
    });

    assert.equal(revokeResponse.statusCode, 200, revokeResponse.body);
    assert.deepEqual(revokeResponse.json(), {
      success: true,
      oldStatus: "active",
    });
    assert.equal(
      db
        .prepare("SELECT status FROM poem_share_tokens WHERE id = ?")
        .get(share.shareId).status,
      "revoked",
    );

    const audits = await db
      .prepare(
        "SELECT action, resource_type, resource_id, metadata_json FROM audit_logs ORDER BY created_at ASC",
      )
      .all();
    assert.deepEqual(
      audits.map((audit) => audit.action),
      ["poem_share_attempts_reset", "poem_share_revoked"],
    );
    assert.equal(audits[0].resource_type, "poem_share_token");
    assert.equal(audits[0].resource_id, share.shareId);
    assert.equal(JSON.parse(audits[0].metadata_json).oldAttempts, 6);
    assert.equal(JSON.parse(audits[1].metadata_json).oldStatus, "active");
  });
});

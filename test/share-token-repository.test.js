process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createShareTokenRepository,
} = require("../src/database/share-token-repository");

let db;
let repository;

async function insertUser(id) {
  await db
    .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
    .run(id, "2026-06-27T00:00:00.000Z");
}

async function insertTrack(id, userId) {
  await db
    .prepare(
      `INSERT INTO tracks (
         id, user_id, status, title, recipient_name, occasion, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      "completed",
      `Track ${id}`,
      "Ambrose",
      "birthday",
      "2026-06-27T00:00:00.000Z",
      "2026-06-27T00:00:00.000Z",
    );
}

async function insertTrackVersion(id, trackId) {
  await db
    .prepare(
      `INSERT INTO track_versions (
         id, track_id, version_num, status, render_type, params_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      trackId,
      1,
      "ready",
      "full",
      `${id}_params`,
      "2026-06-27T00:00:00.000Z",
    );
}

async function insertRawSongShare({
  id,
  trackId,
  creatorId,
  createdAt,
  deliverySource = "manual",
  status = "unbound",
}) {
  await db
    .prepare(
      `INSERT INTO share_tokens (
         id, track_id, track_version_id, creator_id, status, share_type,
         web_stream_allowed, app_save_allowed, expires_at, created_at,
         access_count, stream_key_id, stream_key, claim_pin, claim_attempts,
         delivery_source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      trackId,
      `${trackId}_version`,
      creatorId,
      status,
      "lifetime",
      1,
      1,
      "9999-12-31T23:59:59.000Z",
      createdAt,
      0,
      `${id}_stream_key_id`,
      `${id}_stream_key`,
      "123456",
      0,
      deliverySource,
    );
}

describe("ShareTokenRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createShareTokenRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("creates a song share token and attaches it to the track", async () => {
    await insertUser("user_share_repo");
    await insertTrack("track_share_repo", "user_share_repo");
    await insertTrackVersion("version_share_repo", "track_share_repo");

    await repository.insertSongShareToken({
      id: "share_repo_created",
      trackId: "track_share_repo",
      trackVersionId: "version_share_repo",
      creatorId: "user_share_repo",
      status: "unbound",
      shareType: "lifetime",
      boundDeviceId: null,
      boundDevicePlatform: null,
      boundAppVersion: null,
      boundAt: null,
      webStreamAllowed: true,
      appSaveAllowed: true,
      expiresAt: "9999-12-31T23:59:59.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      lastAccessedAt: null,
      accessCount: 0,
      streamKeyId: "stream_key_id",
      streamKey: "stream_key",
      claimPin: "123456",
      claimAttempts: 0,
      utmSource: "sms",
      utmMedium: "share",
      utmCampaign: "birthday",
      referrer: "https://example.test",
      createdIp: "127.0.0.1",
      createdUserAgent: "repo-test",
    });
    await repository.setTrackShareToken({
      trackId: "track_share_repo",
      shareTokenId: "share_repo_created",
      updatedAt: "2026-06-27T00:01:00.000Z",
    });

    const pointer = await repository.getTrackSharePointer("track_share_repo");
    const share = await repository.getSongShareTokenById("share_repo_created");

    assert.equal(pointer.share_token_id, "share_repo_created");
    assert.equal(share.utm_source, "sms");
    assert.equal(share.claim_pin, "123456");
  });

  test("reads gift share binding inside caller transaction", async () => {
    await insertUser("user_gift_share_repo");
    await insertTrack("track_gift_share_repo", "user_gift_share_repo");
    await insertTrackVersion(
      "track_gift_share_repo_version",
      "track_gift_share_repo",
    );
    await insertRawSongShare({
      id: "share_gift_binding",
      trackId: "track_gift_share_repo",
      creatorId: "user_gift_share_repo",
      createdAt: "2026-06-27T00:00:00.000Z",
      deliverySource: "gift",
    });
    await db
      .prepare(
        "UPDATE share_tokens SET gift_order_id = ?, dispatch_at = ? WHERE id = ?",
      )
      .run(
        "gift_binding",
        "2026-06-30T12:00:00.000Z",
        "share_gift_binding",
      );

    const binding = await db.transaction((query) =>
      repository.getGiftShareBinding({
        contentType: "song",
        shareTokenId: "share_gift_binding",
        query,
      }),
    );

    assert.deepEqual(binding, {
      id: "share_gift_binding",
      gift_order_id: "gift_binding",
      delivery_source: "gift",
      dispatch_at: "2026-06-30T12:00:00.000Z",
    });
  });

  test("revokes and reschedules gift song shares", async () => {
    await insertUser("user_gift_share_mutation_repo");
    await insertTrack(
      "track_gift_share_mutation_repo",
      "user_gift_share_mutation_repo",
    );
    await insertTrackVersion(
      "track_gift_share_mutation_repo_version",
      "track_gift_share_mutation_repo",
    );
    await insertRawSongShare({
      id: "share_gift_revoke",
      trackId: "track_gift_share_mutation_repo",
      creatorId: "user_gift_share_mutation_repo",
      createdAt: "2026-06-27T00:00:00.000Z",
      deliverySource: "gift",
    });
    await insertRawSongShare({
      id: "share_gift_schedule",
      trackId: "track_gift_share_mutation_repo",
      creatorId: "user_gift_share_mutation_repo",
      createdAt: "2026-06-27T00:01:00.000Z",
      deliverySource: "gift",
    });
    await db
      .prepare(
        "UPDATE share_tokens SET gift_order_id = ?, dispatch_at = ?, dispatched_at = ? WHERE id IN (?, ?)",
      )
      .run(
        "gift_mutation",
        "2026-06-30T12:00:00.000Z",
        "2026-06-30T12:05:00.000Z",
        "share_gift_revoke",
        "share_gift_schedule",
      );

    const revoked = await repository.revokeGiftShare({
      contentType: "song",
      shareTokenId: "share_gift_revoke",
      giftOrderId: "gift_mutation",
      expiresAt: "2026-06-28T10:00:00.000Z",
    });
    assert.equal(revoked.changes, 1);

    const revokeRow = await repository.getSongShareTokenById(
      "share_gift_revoke",
    );
    assert.equal(revokeRow.status, "revoked");
    assert.equal(Number(revokeRow.web_stream_allowed), 0);
    assert.equal(revokeRow.expires_at, "2026-06-28T10:00:00.000Z");
    assert.equal(revokeRow.dispatched_at, null);

    const scheduled = await repository.updateGiftShareSchedule({
      contentType: "song",
      shareTokenId: "share_gift_schedule",
      giftOrderId: "gift_mutation",
      dispatchAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-31T12:00:00.000Z",
    });
    assert.equal(scheduled.changes, 1);

    const scheduleRow = await repository.getSongShareTokenById(
      "share_gift_schedule",
    );
    assert.equal(scheduleRow.dispatch_at, "2026-07-01T12:00:00.000Z");
    assert.equal(scheduleRow.expires_at, "2026-07-31T12:00:00.000Z");
    assert.equal(scheduleRow.dispatched_at, null);
  });

  test("marks gift shares dispatched and revokes delivery failures", async () => {
    await insertUser("user_gift_dispatch_share_repo");
    await insertTrack(
      "track_gift_dispatch_share_repo",
      "user_gift_dispatch_share_repo",
    );
    await insertTrackVersion(
      "track_gift_dispatch_share_repo_version",
      "track_gift_dispatch_share_repo",
    );
    await insertRawSongShare({
      id: "share_gift_dispatched",
      trackId: "track_gift_dispatch_share_repo",
      creatorId: "user_gift_dispatch_share_repo",
      createdAt: "2026-06-27T00:00:00.000Z",
      deliverySource: "gift",
    });
    await insertRawSongShare({
      id: "share_gift_delivery_revoke",
      trackId: "track_gift_dispatch_share_repo",
      creatorId: "user_gift_dispatch_share_repo",
      createdAt: "2026-06-27T00:01:00.000Z",
      deliverySource: "gift",
    });
    await db
      .prepare("UPDATE share_tokens SET gift_order_id = ? WHERE id IN (?, ?)")
      .run(
        "gift_dispatch_share",
        "share_gift_dispatched",
        "share_gift_delivery_revoke",
      );

    const dispatched = await repository.markGiftShareDispatched({
      contentType: "song",
      shareTokenId: "share_gift_dispatched",
      giftOrderId: "gift_dispatch_share",
      dispatchedAt: "2026-06-30T12:05:00.000Z",
      scheduledAt: "2026-06-30T12:00:00.000Z",
    });
    assert.equal(dispatched.changes, 1);

    const dispatchedRow = await repository.getSongShareTokenById(
      "share_gift_dispatched",
    );
    assert.equal(dispatchedRow.dispatched_at, "2026-06-30T12:05:00.000Z");
    assert.equal(dispatchedRow.dispatch_at, "2026-06-30T12:00:00.000Z");
    assert.equal(dispatchedRow.gift_order_id, "gift_dispatch_share");

    const revoked = await repository.revokeGiftDeliveryShare({
      contentType: "song",
      shareTokenId: "share_gift_delivery_revoke",
      giftOrderId: "gift_dispatch_share",
    });
    assert.equal(revoked.changes, 1);

    const revokedRow = await repository.getSongShareTokenById(
      "share_gift_delivery_revoke",
    );
    assert.equal(revokedRow.status, "revoked");
    assert.equal(Number(revokedRow.web_stream_allowed), 0);
    assert.equal(revokedRow.dispatched_at, null);
  });

  test("latest manual lookup excludes gift-delivery shares", async () => {
    await insertUser("user_manual_repo");
    await insertTrack("track_manual_repo", "user_manual_repo");
    await insertTrackVersion("track_manual_repo_version", "track_manual_repo");
    await insertRawSongShare({
      id: "share_manual_old",
      trackId: "track_manual_repo",
      creatorId: "user_manual_repo",
      createdAt: "2026-06-27T00:00:00.000Z",
      deliverySource: "manual",
    });
    await insertRawSongShare({
      id: "share_gift_new",
      trackId: "track_manual_repo",
      creatorId: "user_manual_repo",
      createdAt: "2026-06-27T00:05:00.000Z",
      deliverySource: "gift",
    });

    const share = await repository.getLatestManualSongShare({
      trackId: "track_manual_repo",
      creatorId: "user_manual_repo",
    });

    assert.equal(share.id, "share_manual_old");
  });

  test("supports share route hydration, analytics, and atomic claim updates", async () => {
    await insertUser("user_route_support_repo");
    await insertUser("recipient_route_support");
    await insertTrack("track_route_support_repo", "user_route_support_repo");
    await insertTrackVersion(
      "track_route_support_repo_version",
      "track_route_support_repo",
    );
    await insertRawSongShare({
      id: "share_route_support",
      trackId: "track_route_support_repo",
      creatorId: "user_route_support_repo",
      createdAt: "2026-06-27T00:00:00.000Z",
    });
    await db
      .prepare(
        "INSERT INTO share_access_log (id, share_token_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
      )
      .run(
        "access_route_support_1",
        "share_route_support",
        "link_opened",
        '{"source":"qr"}',
        "2026-06-27T00:01:00.000Z",
        "access_route_support_2",
        "share_route_support",
        "link_opened",
        '{"source":"web"}',
        "2026-06-27T00:02:00.000Z",
      );

    const { track, trackVersion } = await repository.getShareTrackPair({
      trackId: "track_route_support_repo",
      trackVersionId: "track_route_support_repo_version",
    });
    assert.equal(track.id, "track_route_support_repo");
    assert.equal(trackVersion.id, "track_route_support_repo_version");

    const incremented = await repository.incrementSongShareAccess({
      shareTokenId: "share_route_support",
      accessedAt: "2026-06-27T00:03:00.000Z",
    });
    assert.equal(incremented.changes, 1);
    const incrementedShare = await repository.getSongShareTokenById(
      "share_route_support",
    );
    assert.equal(Number(incrementedShare.access_count), 1);
    assert.equal(
      incrementedShare.last_accessed_at,
      "2026-06-27T00:03:00.000Z",
    );

    const summary = await repository.getShareAccessSummary(
      "share_route_support",
    );
    assert.deepEqual(summary, [
      {
        event_type: "link_opened",
        count: 2,
        last_at: "2026-06-27T00:02:00.000Z",
      },
    ]);

    const recent = await repository.getRecentShareAccessActivity(
      "share_route_support",
    );
    assert.equal(recent.length, 2);
    assert.equal(recent[0].metadata, '{"source":"web"}');

    const claim = await repository.claimSongShare({
      shareTokenId: "share_route_support",
      deviceId: "device_route_support",
      platform: "ios",
      appVersion: "1.0.0",
      claimUserId: "recipient_route_support",
      claimAt: "2026-06-27T00:04:00.000Z",
      webStreamAllowed: true,
    });
    assert.equal(claim.changes, 1);

    const deviceState = await repository.getSongShareDeviceState(
      "share_route_support",
    );
    assert.equal(deviceState.status, "claimed");
    assert.equal(deviceState.bound_device_id, "device_route_support");
    assert.equal(deviceState.bound_device_platform, "ios");

    const race = await repository.claimSongShare({
      shareTokenId: "share_route_support",
      deviceId: "device_route_support_2",
      platform: "ios",
      appVersion: "1.0.0",
      claimUserId: "recipient_route_support",
      claimAt: "2026-06-27T00:05:00.000Z",
      webStreamAllowed: true,
    });
    assert.equal(race.changes, 0);
  });

  test("status updates validate the share-token table name", async () => {
    await assert.rejects(
      () => repository.updateShareStatus("users", "share_id", "expired"),
      /Unsupported share token table/,
    );
  });
});

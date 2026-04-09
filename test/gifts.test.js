require("dotenv/config");
const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const { clearCache: clearFeatureFlagCache } = require("../src/services/feature-flags");
const { startGiftDispatchJob } = require("../src/jobs/gift-dispatch");

describe("Gift scheduling and wallet", () => {
  let app;
  let db;
  let storageDir;

  const userId = "gift_test_user";
  const nowIso = () => new Date().toISOString();

  const appleValidatorStub = {
    isConfigured() {
      return true;
    },
    async verifyTransaction(transactionId) {
      return {
        valid: true,
        type: "one_time_purchase",
        transactionId,
        originalTransactionId: transactionId,
        productId: "com.porizo.gift_token_oneoff",
        purchaseDate: new Date(),
        environment: "sandbox",
      };
    },
    decodeJWS() {
      return null;
    },
  };

  before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-gifts-test-"));
    db = await initDb({
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });

    const appConfig = {
      PREVIEW_ONLY: false,
      STREAM_BASE_URL: "http://stream.local",
      PUBLIC_BASE_URL: "http://public.local",
      STORAGE_DIR: storageDir,
      STORAGE_PROVIDER: "local",
      ALLOW_ANON_USER_ID: true,
      ALLOW_DEVICE_TOKEN_FALLBACK: true,
      GIFT_TOKEN_PRODUCT_ID: "com.porizo.gift_token_oneoff",
      UPLOAD_SIGNING_SECRET: "test-upload-secret",
      UPLOAD_URL_TTL_SEC: 900,
    };
    const storage = createStorageProvider(appConfig);
    app = buildServer({
      db,
      config: appConfig,
      storage,
      billingServices: { appleValidator: appleValidatorStub },
    });

    db.prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)"
    ).run(userId, nowIso(), "low");
  });

  async function createRenderedTrack() {
    const createTrackRes = await app.inject({
      method: "POST",
      url: "/tracks",
      headers: { "x-user-id": userId },
      payload: {
        title: `Gift Track ${Date.now()}`,
        recipient_name: "Jamie",
        occasion: "birthday",
        style: "pop",
        message: "A gift from me to you",
      },
    });
    assert.ok(
      createTrackRes.statusCode === 200 || createTrackRes.statusCode === 201,
      `Unexpected create track status: ${createTrackRes.statusCode}`
    );
    const createdTrack = JSON.parse(createTrackRes.body);

    const createVersionRes = await app.inject({
      method: "POST",
      url: `/tracks/${createdTrack.track_id}/versions`,
      headers: { "x-user-id": userId },
      payload: {},
    });
    assert.ok(
      createVersionRes.statusCode === 200 || createVersionRes.statusCode === 201,
      `Unexpected create version status: ${createVersionRes.statusCode}`
    );
    const createdVersion = JSON.parse(createVersionRes.body);

    db.prepare(
      "UPDATE track_versions SET preview_url = ? WHERE track_id = ? AND version_num = ?"
    ).run(
      "http://stream.local/test-preview.m3u8",
      createdTrack.track_id,
      createdVersion.version_num
    );

    return {
      trackId: createdTrack.track_id,
      versionNum: createdVersion.version_num,
    };
  }

  async function creditGiftToken(transactionId) {
    const res = await app.inject({
      method: "POST",
      url: "/billing/receipt/apple/consumable",
      headers: { "x-user-id": userId },
      payload: { transactionId },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    return body;
  }

  function setFeatureFlag(flagId, value) {
    db.prepare(
      `INSERT OR REPLACE INTO feature_flags (id, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)`
    ).run(flagId, JSON.stringify(value), nowIso(), "test");
    clearFeatureFlagCache();
  }

  function createGeneratedPoem({ title = "Gift Poem", verses = [["Line one", "Line two"]] } = {}) {
    const poemId = `poem_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      poemId,
      userId,
      title,
      "Jamie",
      "birthday",
      "heartfelt",
      JSON.stringify(verses),
      "msg",
      "generated",
      nowIso(),
      nowIso()
    );
    return { poemId, verses };
  }

  it("credits wallet from consumable purchase idempotently", async () => {
    const first = await creditGiftToken("gift_tx_1");
    assert.strictEqual(first.already_processed, false);
    assert.strictEqual(first.balance, 1);

    const second = await creditGiftToken("gift_tx_1");
    assert.strictEqual(second.already_processed, true);
    assert.strictEqual(second.balance, 1);
  });

  it("creates and dispatches an immediate song gift with app-only share", async () => {
    await creditGiftToken("gift_tx_2");
    const { trackId, versionNum } = await createRenderedTrack();

    const createGiftRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "immediate",
        sender_timezone: "America/New_York",
        channels: ["email"],
        recipient_email: "recipient@example.com",
        message: "Happy birthday!",
      },
    });

    assert.strictEqual(createGiftRes.statusCode, 200, createGiftRes.body);
    const createGiftBody = JSON.parse(createGiftRes.body);
    assert.ok(createGiftBody.gift?.id);
    assert.strictEqual(createGiftBody.gift.status, "dispatched");
    assert.strictEqual(createGiftBody.gift.claim_policy, "app_only");
    assert.strictEqual(createGiftBody.wallet_balance, 1);

    const shareId = createGiftBody.gift.share_token_id;
    assert.ok(shareId);

    const shareInfoRes = await app.inject({
      method: "GET",
      url: `/share/${shareId}`,
    });
    assert.strictEqual(shareInfoRes.statusCode, 200, shareInfoRes.body);
    const shareInfo = JSON.parse(shareInfoRes.body);
    assert.strictEqual(shareInfo.app_required, true);
    assert.strictEqual(shareInfo.web_stream_url, null);

    const streamRes = await app.inject({
      method: "GET",
      url: `/share/${shareId}/stream`,
    });
    assert.strictEqual(streamRes.statusCode, 403);
    const streamErr = JSON.parse(streamRes.body);
    assert.ok(
      streamErr.error === "APP_CLAIM_REQUIRED" || streamErr.error === "WEB_STREAM_NOT_ALLOWED",
      `Unexpected stream error code: ${streamErr.error}`
    );
  });

  it("supports scheduled gift cancellation with automatic token refund", async () => {
    await creditGiftToken("gift_tx_3");
    const { trackId, versionNum } = await createRenderedTrack();
    const sendAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const createGiftRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: sendAt,
        sender_timezone: "America/New_York",
        channels: ["sms", "email"],
        recipient_phone: "+12025550123",
        recipient_email: "recipient@example.com",
        message: "Scheduled gift",
      },
    });
    assert.strictEqual(createGiftRes.statusCode, 200, createGiftRes.body);
    const gift = JSON.parse(createGiftRes.body).gift;
    assert.strictEqual(gift.status, "scheduled");

    const cancelRes = await app.inject({
      method: "POST",
      url: `/gifts/${gift.id}/cancel`,
      headers: { "x-user-id": userId },
    });
    assert.strictEqual(cancelRes.statusCode, 200, cancelRes.body);
    const cancelled = JSON.parse(cancelRes.body);
    assert.strictEqual(cancelled.cancelled, true);
    assert.strictEqual(cancelled.gift.status, "cancelled");
    assert.ok(cancelled.wallet_balance >= 2);
  });

  it("creates immutable per-gift share tokens for the same song", async () => {
    await creditGiftToken(`gift_tx_multi_song_1_${Date.now()}`);
    await creditGiftToken(`gift_tx_multi_song_2_${Date.now()}`);
    const { trackId, versionNum } = await createRenderedTrack();
    const sendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const createGift = () => app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: sendAt,
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: `multi-${Math.random().toString(16).slice(2)}@example.com`,
      },
    });

    const firstRes = await createGift();
    const secondRes = await createGift();
    assert.strictEqual(firstRes.statusCode, 200, firstRes.body);
    assert.strictEqual(secondRes.statusCode, 200, secondRes.body);

    const firstGift = JSON.parse(firstRes.body).gift;
    const secondGift = JSON.parse(secondRes.body).gift;

    assert.notStrictEqual(firstGift.share_token_id, secondGift.share_token_id);
    const track = db.prepare("SELECT share_token_id FROM tracks WHERE id = ?").get(trackId);
    assert.notStrictEqual(track.share_token_id, firstGift.share_token_id);
    assert.notStrictEqual(track.share_token_id, secondGift.share_token_id);
  });

  it("reserves token before creation and finalizes without double debit", async () => {
    await creditGiftToken("gift_tx_reserve_1");
    const { trackId, versionNum } = await createRenderedTrack();

    const reserveRes = await app.inject({
      method: "POST",
      url: "/gifts/reservations",
      headers: {
        "x-user-id": userId,
        "idempotency-key": `reserve_${Date.now()}`,
      },
      payload: { flow_type: "gift" },
    });
    assert.strictEqual(reserveRes.statusCode, 200, reserveRes.body);
    const reserveBody = JSON.parse(reserveRes.body);
    assert.ok(reserveBody.reservation?.id);
    assert.strictEqual(reserveBody.reservation.status, "reserved");

    const attachRes = await app.inject({
      method: "POST",
      url: `/gifts/reservations/${reserveBody.reservation.id}/content`,
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
      },
    });
    assert.strictEqual(attachRes.statusCode, 200, attachRes.body);
    const attachBody = JSON.parse(attachRes.body);
    assert.strictEqual(attachBody.reservation.status, "content_ready");

    const finalizeRes = await app.inject({
      method: "POST",
      url: `/gifts/reservations/${reserveBody.reservation.id}/finalize`,
      headers: {
        "x-user-id": userId,
        "idempotency-key": `finalize_${Date.now()}`,
      },
      payload: {
        delivery_mode: "immediate",
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "reservation-finalize@example.com",
      },
    });
    assert.strictEqual(finalizeRes.statusCode, 200, finalizeRes.body);
    const finalizeBody = JSON.parse(finalizeRes.body);
    assert.ok(finalizeBody.gift?.id);
    assert.ok(finalizeBody.gift.status === "dispatched" || finalizeBody.gift.status === "scheduled");
    assert.strictEqual(finalizeBody.wallet_balance, reserveBody.wallet_balance);

    const finalizedReservation = db.prepare(
      "SELECT status, gift_order_id FROM gift_reservations WHERE id = ?"
    ).get(reserveBody.reservation.id);
    assert.strictEqual(finalizedReservation.status, "finalized");
    assert.strictEqual(finalizedReservation.gift_order_id, finalizeBody.gift.id);
  });

  it("refunds reservation token on cancellation", async () => {
    await creditGiftToken("gift_tx_reserve_cancel_1");

    const reserveRes = await app.inject({
      method: "POST",
      url: "/gifts/reservations",
      headers: {
        "x-user-id": userId,
        "idempotency-key": `reserve_cancel_${Date.now()}`,
      },
      payload: { flow_type: "gift" },
    });
    assert.strictEqual(reserveRes.statusCode, 200, reserveRes.body);
    const reserveBody = JSON.parse(reserveRes.body);

    const cancelRes = await app.inject({
      method: "POST",
      url: `/gifts/reservations/${reserveBody.reservation.id}/cancel`,
      headers: { "x-user-id": userId },
    });
    assert.strictEqual(cancelRes.statusCode, 200, cancelRes.body);
    const cancelBody = JSON.parse(cancelRes.body);
    assert.strictEqual(cancelBody.cancelled, true);
    assert.strictEqual(cancelBody.reservation.status, "cancelled");
    assert.ok(cancelBody.wallet_balance >= reserveBody.wallet_balance + 1);
  });

  it("deletes gift-funded content when a reservation is cancelled", async () => {
    await creditGiftToken("gift_tx_reserve_cancel_funded_1");

    const reserveRes = await app.inject({
      method: "POST",
      url: "/gifts/reservations",
      headers: {
        "x-user-id": userId,
        "idempotency-key": `reserve_cancel_funded_${Date.now()}`,
      },
      payload: { flow_type: "gift" },
    });
    assert.strictEqual(reserveRes.statusCode, 200, reserveRes.body);
    const reserveBody = JSON.parse(reserveRes.body);

    const trackId = `track_gift_funded_${Date.now()}`;
    const addedAt = nowIso();
    db.prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, voice_mode,
        latest_version, funding_source, gift_reservation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      trackId,
      userId,
      "draft",
      "Gift-funded Track",
      "birthday",
      "Jamie",
      "pop",
      "ai_voice",
      1,
      "gift_token",
      reserveBody.reservation.id,
      addedAt,
      addedAt
    );
    db.prepare(
      `INSERT INTO track_library_entries (user_id, track_id, origin, share_token_id, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      trackId,
      "created",
      null,
      addedAt,
      addedAt
    );

    const cancelRes = await app.inject({
      method: "POST",
      url: `/gifts/reservations/${reserveBody.reservation.id}/cancel`,
      headers: { "x-user-id": userId },
    });
    assert.strictEqual(cancelRes.statusCode, 200, cancelRes.body);

    const trackRow = db.prepare("SELECT deleted_at FROM tracks WHERE id = ?").get(trackId);
    assert.ok(trackRow.deleted_at, "Gift-funded track should be soft-deleted");
    const libraryRow = db.prepare(
      "SELECT removed_at FROM track_library_entries WHERE track_id = ? AND user_id = ?"
    ).get(trackId, userId);
    assert.ok(libraryRow.removed_at, "Gift-funded track library entry should be removed");
  });

  it("deletes gift-funded content when a reservation expires", async () => {
    await creditGiftToken("gift_tx_reserve_expire_funded_1");

    const reserveRes = await app.inject({
      method: "POST",
      url: "/gifts/reservations",
      headers: {
        "x-user-id": userId,
        "idempotency-key": `reserve_expire_funded_${Date.now()}`,
      },
      payload: { flow_type: "gift" },
    });
    assert.strictEqual(reserveRes.statusCode, 200, reserveRes.body);
    const reserveBody = JSON.parse(reserveRes.body);

    const trackId = `track_gift_expire_${Date.now()}`;
    const addedAt = nowIso();
    db.prepare(
      `INSERT INTO tracks (
        id, user_id, status, title, occasion, recipient_name, style, voice_mode,
        latest_version, funding_source, gift_reservation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      trackId,
      userId,
      "draft",
      "Expiring Gift-funded Track",
      "birthday",
      "Jamie",
      "pop",
      "ai_voice",
      1,
      "gift_token",
      reserveBody.reservation.id,
      addedAt,
      addedAt
    );
    db.prepare(
      `INSERT INTO track_library_entries (user_id, track_id, origin, share_token_id, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      trackId,
      "created",
      null,
      addedAt,
      addedAt
    );

    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    db.prepare(
      "UPDATE gift_reservations SET expires_at = ?, updated_at = ? WHERE id = ?"
    ).run(expiredAt, expiredAt, reserveBody.reservation.id);

    const result = await app.expireGiftReservations({ limit: 10 });
    assert.strictEqual(result.processed, 1);

    const reservationRow = db.prepare(
      "SELECT status, refund_transaction_id FROM gift_reservations WHERE id = ?"
    ).get(reserveBody.reservation.id);
    assert.strictEqual(reservationRow.status, "expired");
    assert.ok(reservationRow.refund_transaction_id, "Expired reservation should refund the token");

    const trackRow = db.prepare("SELECT deleted_at FROM tracks WHERE id = ?").get(trackId);
    assert.ok(trackRow.deleted_at, "Expired reservation should soft-delete gift-funded track");
    const libraryRow = db.prepare(
      "SELECT removed_at FROM track_library_entries WHERE track_id = ? AND user_id = ?"
    ).get(trackId, userId);
    assert.ok(libraryRow.removed_at, "Expired reservation should remove gift-funded library entry");
  });

  it("enforces prepay when gift_prepay_enforced flag is enabled", async () => {
    setFeatureFlag("gift_prepay_enforced", true);
    try {
      await creditGiftToken("gift_tx_prepay_enforced_1");
      const { trackId, versionNum } = await createRenderedTrack();

      const createGiftRes = await app.inject({
        method: "POST",
        url: "/gifts",
        headers: { "x-user-id": userId },
        payload: {
          content_type: "song",
          content_id: trackId,
          version_num: versionNum,
          delivery_mode: "immediate",
          sender_timezone: "UTC",
          channels: ["email"],
          recipient_email: "prepay-enforced@example.com",
        },
      });
      assert.strictEqual(createGiftRes.statusCode, 409, createGiftRes.body);
      const createGiftBody = JSON.parse(createGiftRes.body);
      assert.strictEqual(createGiftBody.error, "GIFT_PREPAY_REQUIRED");
    } finally {
      setFeatureFlag("gift_prepay_enforced", false);
    }
  });

  // ─── New validation tests (Phase 3) ───

  it("resolves sender display name in delivery message", async () => {
    // Set display name on the test user
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run("Alex Kim", userId);

    await creditGiftToken("gift_tx_name_1");
    const { trackId, versionNum } = await createRenderedTrack();

    const res = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "immediate",
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "name-test@example.com",
        message: "From Alex!",
      },
    });
    assert.strictEqual(res.statusCode, 200, res.body);

    // Verify the dispatch attempt recorded a successful email
    const gift = JSON.parse(res.body).gift;
    const attempt = db.prepare(
      "SELECT * FROM gift_dispatch_attempts WHERE gift_order_id = ? AND channel = 'email' AND status = 'success'"
    ).get(gift.id);
    assert.ok(attempt, "Should have a successful email dispatch attempt");

    // Clean up display_name to avoid affecting other tests
    db.prepare("UPDATE users SET display_name = NULL WHERE id = ?").run(userId);
  });

  it("auto-refunds token on permanent dispatch failure", async () => {
    await creditGiftToken("gift_tx_refund_1");
    setFeatureFlag("gift_sms_enabled", false);

    try {
      const walletBefore = db.prepare("SELECT balance FROM gift_wallet WHERE user_id = ?").get(userId);
      const balanceBefore = Number(walletBefore.balance);

      // Create a scheduled gift, then manually set it to dispatch_retry with max-1 attempts
      const { trackId, versionNum } = await createRenderedTrack();
      const sendAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      const res = await app.inject({
        method: "POST",
        url: "/gifts",
        headers: { "x-user-id": userId },
        payload: {
          content_type: "song",
          content_id: trackId,
          version_num: versionNum,
          delivery_mode: "scheduled",
          send_at: sendAt,
          sender_timezone: "UTC",
          channels: ["sms"], // SMS disabled by test feature flag
          recipient_phone: "+15551234567",
        },
      });
      assert.strictEqual(res.statusCode, 200, res.body);
      const gift = JSON.parse(res.body).gift;

      // Set the outbox row to max-1 attempts so the next channel failure exhausts retries.
      const dueNow = new Date(Date.now() - 1000).toISOString();
      db.prepare("UPDATE gift_orders SET status = 'dispatch_retry', dispatch_attempts = 4, next_retry_at = ? WHERE id = ?").run(dueNow, gift.id);
      db.prepare("UPDATE gift_delivery_outbox SET status = 'failed', attempt_count = 4, next_retry_at = ? WHERE gift_order_id = ?").run(dueNow, gift.id);

      // Call dispatchGiftById directly
      await app.dispatchGiftById(gift.id);

      // Check gift is now 'failed' with a refund
      const updatedGift = db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
      assert.strictEqual(updatedGift.status, "failed");
      assert.ok(updatedGift.refund_transaction_id, "Should have a refund transaction ID");

      // Verify wallet balance was restored
      const walletAfter = db.prepare("SELECT balance FROM gift_wallet WHERE user_id = ?").get(userId);
      assert.strictEqual(Number(walletAfter.balance), balanceBefore, "Token should be refunded");
    } finally {
      setFeatureFlag("gift_sms_enabled", true);
    }
  });

  it("recovers from dispatching stuck state on unexpected error", async () => {
    await creditGiftToken("gift_tx_stuck_1");
    const { trackId, versionNum } = await createRenderedTrack();

    const res = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "stuck@example.com",
      },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const gift = JSON.parse(res.body).gift;

    // Remove outbox rows and corrupt channels_json so bootstrap cannot rebuild delivery rows.
    db.prepare("DELETE FROM gift_delivery_outbox WHERE gift_order_id = ?").run(gift.id);
    db.prepare("UPDATE gift_orders SET status = 'scheduled', channels_json = 'INVALID_JSON' WHERE id = ?").run(gift.id);

    // dispatchGiftById should throw but recover the row
    try {
      await app.dispatchGiftById(gift.id);
    } catch {
      // Expected to throw
    }

    const updatedGift = db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(gift.id);
    assert.strictEqual(updatedGift.status, "dispatch_retry", "Should recover to dispatch_retry, not stay stuck in dispatching");
    assert.ok(Number(updatedGift.dispatch_attempts) > 0, "Attempts should be incremented");
  });

  it("rescheduling a gift updates delivery token timing", async () => {
    await creditGiftToken(`gift_tx_resched_${Date.now()}`);
    const { trackId, versionNum } = await createRenderedTrack();
    const originalSendAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const createRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: originalSendAt,
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "resched@example.com",
      },
    });
    assert.strictEqual(createRes.statusCode, 200, createRes.body);
    const gift = JSON.parse(createRes.body).gift;

    const nextSendAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/gifts/${gift.id}`,
      headers: { "x-user-id": userId },
      payload: { send_at: nextSendAt },
    });
    assert.strictEqual(updateRes.statusCode, 200, updateRes.body);

    const share = db.prepare("SELECT dispatch_at, expires_at FROM share_tokens WHERE id = ?").get(gift.share_token_id);
    assert.strictEqual(share.dispatch_at, nextSendAt);
    assert.ok(new Date(share.expires_at).getTime() > new Date(nextSendAt).getTime());
  });

  it("cancelling a scheduled gift revokes its delivery token", async () => {
    await creditGiftToken(`gift_tx_cancel_revoke_${Date.now()}`);
    const { trackId, versionNum } = await createRenderedTrack();
    const sendAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const createRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: sendAt,
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "cancel-revoke@example.com",
      },
    });
    assert.strictEqual(createRes.statusCode, 200, createRes.body);
    const gift = JSON.parse(createRes.body).gift;

    const cancelRes = await app.inject({
      method: "POST",
      url: `/gifts/${gift.id}/cancel`,
      headers: { "x-user-id": userId },
    });
    assert.strictEqual(cancelRes.statusCode, 200, cancelRes.body);

    const share = db.prepare("SELECT status FROM share_tokens WHERE id = ?").get(gift.share_token_id);
    assert.strictEqual(share.status, "revoked");
  });

  it("finalizing the same reservation twice returns the original gift", async () => {
    await creditGiftToken(`gift_tx_finalize_once_${Date.now()}`);
    const { trackId, versionNum } = await createRenderedTrack();

    const reserveRes = await app.inject({
      method: "POST",
      url: "/gifts/reservations",
      headers: { "x-user-id": userId, "idempotency-key": `reserve_${Date.now()}` },
    });
    assert.strictEqual(reserveRes.statusCode, 200, reserveRes.body);
    const reservation = JSON.parse(reserveRes.body).reservation;

    const attachRes = await app.inject({
      method: "POST",
      url: `/gifts/reservations/${reservation.id}/content`,
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
      },
    });
    assert.strictEqual(attachRes.statusCode, 200, attachRes.body);

    const finalizePayload = {
      delivery_mode: "scheduled",
      send_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      sender_timezone: "UTC",
      channels: ["email"],
      recipient_email: "idempotent@example.com",
    };

    const firstFinalize = await app.inject({
      method: "POST",
      url: `/gifts/reservations/${reservation.id}/finalize`,
      headers: { "x-user-id": userId, "idempotency-key": `finalize_a_${Date.now()}` },
      payload: finalizePayload,
    });
    assert.strictEqual(firstFinalize.statusCode, 200, firstFinalize.body);
    const firstGift = JSON.parse(firstFinalize.body).gift;

    const secondFinalize = await app.inject({
      method: "POST",
      url: `/gifts/reservations/${reservation.id}/finalize`,
      headers: { "x-user-id": userId, "idempotency-key": `finalize_b_${Date.now()}` },
      payload: finalizePayload,
    });
    assert.strictEqual(secondFinalize.statusCode, 200, secondFinalize.body);
    const secondBody = JSON.parse(secondFinalize.body);

    assert.strictEqual(secondBody.idempotent, true);
    assert.strictEqual(secondBody.gift.id, firstGift.id);

    const giftScheduledLogs = db.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'gift_scheduled' AND resource_id = ?"
    ).get(firstGift.id);
    assert.strictEqual(Number(giftScheduledLogs.count), 1, "gift_scheduled audit should only be written once");
  });

  it("blocks edit and cancel once any gift delivery channel has already been sent", async () => {
    await creditGiftToken(`gift_tx_partial_lock_${Date.now()}`);
    setFeatureFlag("gift_sms_enabled", false);

    try {
      const { trackId, versionNum } = await createRenderedTrack();
      const createRes = await app.inject({
        method: "POST",
        url: "/gifts",
        headers: { "x-user-id": userId },
        payload: {
          content_type: "song",
          content_id: trackId,
          version_num: versionNum,
          delivery_mode: "immediate",
          sender_timezone: "UTC",
          channels: ["email", "sms"],
          recipient_email: "partial@example.com",
          recipient_phone: "+15551234567",
        },
      });
      assert.strictEqual(createRes.statusCode, 200, createRes.body);
      const gift = JSON.parse(createRes.body).gift;
      assert.ok(
        gift.dispatch_status === "partial_retry" || gift.dispatch_status === "partial",
        `Unexpected dispatch status ${gift.dispatch_status}`
      );

      const editRes = await app.inject({
        method: "PATCH",
        url: `/gifts/${gift.id}`,
        headers: { "x-user-id": userId },
        payload: { recipient_email: "new@example.com" },
      });
      assert.strictEqual(editRes.statusCode, 409, editRes.body);

      const cancelRes = await app.inject({
        method: "POST",
        url: `/gifts/${gift.id}/cancel`,
        headers: { "x-user-id": userId },
      });
      assert.strictEqual(cancelRes.statusCode, 409, cancelRes.body);
    } finally {
      setFeatureFlag("gift_sms_enabled", true);
    }
  });

  it("prevents double-spend with concurrent wallet operations", async () => {
    // Credit exactly 1 token
    await creditGiftToken("gift_tx_race_1");

    const walletCheck = db.prepare("SELECT balance FROM gift_wallet WHERE user_id = ?").get(userId);
    const startBalance = Number(walletCheck.balance);

    // Attempt two simultaneous debits
    const debit1 = app.inject({
      method: "POST",
      url: "/gifts/wallet/debit-test",
      headers: { "x-user-id": userId },
    }).catch(() => null);
    const debit2 = app.inject({
      method: "POST",
      url: "/gifts/wallet/debit-test",
      headers: { "x-user-id": userId },
    }).catch(() => null);

    // If the debit-test endpoint doesn't exist, test the wallet function directly
    // via creating two gift orders with only 1 token balance
    const { trackId: t1, versionNum: v1 } = await createRenderedTrack();
    const { trackId: t2, versionNum: v2 } = await createRenderedTrack();

    // Ensure balance is exactly 1 by checking current state
    const currentWallet = db.prepare("SELECT balance FROM gift_wallet WHERE user_id = ?").get(userId);
    if (Number(currentWallet.balance) < 1) {
      await creditGiftToken(`gift_tx_race_topup_${Date.now()}`);
    }
    // Set balance to exactly 1
    db.prepare("UPDATE gift_wallet SET balance = 1 WHERE user_id = ?").run(userId);

    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/gifts",
        headers: { "x-user-id": userId },
        payload: {
          content_type: "song",
          content_id: t1,
          version_num: v1,
          delivery_mode: "immediate",
          sender_timezone: "UTC",
          channels: ["email"],
          recipient_email: "race1@example.com",
        },
      }),
      app.inject({
        method: "POST",
        url: "/gifts",
        headers: { "x-user-id": userId },
        payload: {
          content_type: "song",
          content_id: t2,
          version_num: v2,
          delivery_mode: "immediate",
          sender_timezone: "UTC",
          channels: ["email"],
          recipient_email: "race2@example.com",
        },
      }),
    ]);

    const codes = [res1.statusCode, res2.statusCode].sort();
    // One should succeed (200), one should fail with insufficient tokens
    const successes = codes.filter((c) => c === 200).length;
    const failures = codes.filter((c) => c !== 200).length;
    assert.ok(successes >= 1, "At least one gift should succeed");
    // With atomic wallet, at most one should succeed from balance=1
    assert.ok(successes <= 1, `Only one gift should succeed with balance=1, got ${successes}`);

    // Wallet should never go negative
    const finalWallet = db.prepare("SELECT balance FROM gift_wallet WHERE user_id = ?").get(userId);
    assert.ok(Number(finalWallet.balance) >= 0, `Wallet balance should never be negative: ${finalWallet.balance}`);
  });

  it("claims song share with correct PIN and device token", async () => {
    await creditGiftToken("gift_tx_claim_1");
    const { trackId, versionNum } = await createRenderedTrack();

    const giftRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "immediate",
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "claimer@example.com",
      },
    });
    assert.strictEqual(giftRes.statusCode, 200, giftRes.body);
    const gift = JSON.parse(giftRes.body).gift;
    const shareId = gift.share_token_id;
    const pin = gift.claim_pin;

    // Register a device for the recipient
    const recipientId = `recipient_${Date.now()}`;
    db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)").run(recipientId, nowIso(), "low");
    const regRes = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { "x-user-id": recipientId },
      payload: { device_id: `device_claim_${Date.now()}`, platform: "ios", app_version: "1.0.0" },
    });
    assert.strictEqual(regRes.statusCode, 200, regRes.body);
    const { device_token: deviceToken } = JSON.parse(regRes.body);

    // Claim
    const claimRes = await app.inject({
      method: "POST",
      url: `/share/${shareId}/claim`,
      headers: { "x-device-token": deviceToken },
      payload: { pin },
    });
    assert.strictEqual(claimRes.statusCode, 200, claimRes.body);
    const claim = JSON.parse(claimRes.body);
    assert.ok(claim.status === "claimed" || claim.success === true, `Unexpected claim response: ${claimRes.body}`);
  });

  it("rejects song claim with wrong PIN and locks after 5 attempts", async () => {
    await creditGiftToken("gift_tx_brute_1");
    const { trackId, versionNum } = await createRenderedTrack();

    const giftRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "immediate",
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "brute@example.com",
      },
    });
    assert.strictEqual(giftRes.statusCode, 200, giftRes.body);
    const gift = JSON.parse(giftRes.body).gift;
    const shareId = gift.share_token_id;

    const recipientId = `brute_recipient_${Date.now()}`;
    db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)").run(recipientId, nowIso(), "low");
    const regRes = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { "x-user-id": recipientId },
      payload: { device_id: `device_brute_${Date.now()}`, platform: "ios", app_version: "1.0.0" },
    });
    const { device_token: deviceToken } = JSON.parse(regRes.body);

    // 5 wrong PIN attempts
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/share/${shareId}/claim`,
        headers: { "x-device-token": deviceToken },
        payload: { pin: "000000" },
      });
      assert.ok(res.statusCode === 401 || res.statusCode === 403, `Attempt ${i + 1}: ${res.statusCode}`);
    }

    // 6th attempt should be rate-limited / locked
    const lockedRes = await app.inject({
      method: "POST",
      url: `/share/${shareId}/claim`,
      headers: { "x-device-token": deviceToken },
      payload: { pin: "000000" },
    });
    assert.strictEqual(lockedRes.statusCode, 429, `Should be locked after 5 attempts: ${lockedRes.body}`);
  });

  it("claims poem share and returns full verses", async () => {
    await creditGiftToken("gift_tx_poem_full_1");

    const poemId = `poem_full_${Date.now()}`;
    const fullVerses = [["First line of verse one", "Second line of verse one"], ["First line of verse two", "Second line of verse two"]];
    db.prepare(
      `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(poemId, userId, "Full Verses Test", "Jamie", "birthday", "heartfelt", JSON.stringify(fullVerses), "msg", "generated", nowIso(), nowIso());

    const giftRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "poem",
        content_id: poemId,
        delivery_mode: "immediate",
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "poem-full@example.com",
      },
    });
    assert.strictEqual(giftRes.statusCode, 200, giftRes.body);
    const gift = JSON.parse(giftRes.body).gift;

    const recipientId = `poem_claimer_${Date.now()}`;
    db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)").run(recipientId, nowIso(), "low");
    const regRes = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { "x-user-id": recipientId },
      payload: { device_id: `device_poem_full_${Date.now()}`, platform: "ios", app_version: "1.0.0" },
    });
    const { device_token: deviceToken } = JSON.parse(regRes.body);

    const claimRes = await app.inject({
      method: "POST",
      url: `/poem-share/${gift.share_token_id}/claim`,
      headers: { "x-device-token": deviceToken },
      payload: { pin: gift.claim_pin },
    });
    assert.strictEqual(claimRes.statusCode, 200, claimRes.body);
    const claimBody = JSON.parse(claimRes.body);
    assert.ok(claimBody.poem, "Claim response should include poem");
    assert.ok(claimBody.poem.verses, "Poem should include verses");
    assert.strictEqual(claimBody.poem.verses.length, 2, "Should return all verses, not just preview");
    assert.deepStrictEqual(claimBody.poem.verses, fullVerses, "Should return full verse content");
  });

  it("claims scheduled poem gifts from the frozen snapshot even after poem edits", async () => {
    await creditGiftToken(`gift_tx_poem_snapshot_${Date.now()}`);
    const originalVerses = [["Original line one", "Original line two"]];
    const { poemId } = createGeneratedPoem({ title: "Snapshot Test", verses: originalVerses });

    const giftRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "poem",
        content_id: poemId,
        delivery_mode: "immediate",
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "snapshot@example.com",
      },
    });
    assert.strictEqual(giftRes.statusCode, 200, giftRes.body);
    const gift = JSON.parse(giftRes.body).gift;

    db.prepare(
      "UPDATE poems SET title = ?, verses = ?, updated_at = ? WHERE id = ?"
    ).run("Edited After Gift", JSON.stringify([["Edited line"]]), nowIso(), poemId);

    const recipientId = `poem_snapshot_${Date.now()}`;
    db.prepare("INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)").run(recipientId, nowIso(), "low");
    const regRes = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { "x-user-id": recipientId },
      payload: { device_id: `device_poem_snapshot_${Date.now()}`, platform: "ios", app_version: "1.0.0" },
    });
    const { device_token: deviceToken } = JSON.parse(regRes.body);

    const claimRes = await app.inject({
      method: "POST",
      url: `/poem-share/${gift.share_token_id}/claim`,
      headers: { "x-device-token": deviceToken },
      payload: { pin: gift.claim_pin },
    });
    assert.strictEqual(claimRes.statusCode, 200, claimRes.body);
    const claimBody = JSON.parse(claimRes.body);
    assert.strictEqual(claimBody.poem.title, "Snapshot Test");
    assert.deepStrictEqual(claimBody.poem.verses, originalVerses);
  });

  it("stale dispatching gifts are recovered onto the retry queue", async () => {
    await creditGiftToken(`gift_tx_stale_dispatch_${Date.now()}`);
    const { trackId, versionNum } = await createRenderedTrack();
    const createRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "song",
        content_id: trackId,
        version_num: versionNum,
        delivery_mode: "scheduled",
        send_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "stale-dispatch@example.com",
      },
    });
    assert.strictEqual(createRes.statusCode, 200, createRes.body);
    const gift = JSON.parse(createRes.body).gift;

    db.prepare(
      "UPDATE gift_orders SET status = 'dispatching', dispatch_status = 'pending', dispatch_started_at = ?, next_retry_at = NULL WHERE id = ?"
    ).run(new Date(Date.now() - 30 * 60 * 1000).toISOString(), gift.id);

    const job = startGiftDispatchJob({
      db,
      dispatchGiftById: async () => ({ skipped: true }),
      intervalMs: 60_000,
      batchSize: 10,
      staleDispatchMs: 5 * 60 * 1000,
    });
    await job.tick();
    job.stop();

    const recovered = db.prepare(
      "SELECT status, dispatch_status, dispatch_started_at, next_retry_at FROM gift_orders WHERE id = ?"
    ).get(gift.id);
    assert.strictEqual(recovered.status, "dispatch_retry");
    assert.strictEqual(recovered.dispatch_status, "error");
    assert.strictEqual(recovered.dispatch_started_at, null);
    assert.ok(recovered.next_retry_at, "Recovered gift should have next_retry_at");
  });

  it("does NOT reset claim_attempts on anonymous poem unlock", async () => {
    await creditGiftToken("gift_tx_brute_poem_1");
    setFeatureFlag("gift_require_app_claim", false);

    const poemId = `poem_brute_${Date.now()}`;
    db.prepare(
      `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(poemId, userId, "Brute Test", "Jamie", "birthday", "heartfelt", JSON.stringify([["L1", "L2"]]), "msg", "generated", nowIso(), nowIso());

    try {
      // Create non-app-only gift (allows anonymous claim)
      const giftRes = await app.inject({
        method: "POST",
        url: "/gifts",
        headers: { "x-user-id": userId },
        payload: {
          content_type: "poem",
          content_id: poemId,
          delivery_mode: "immediate",
          sender_timezone: "UTC",
          channels: ["email"],
          recipient_email: "brute-poem@example.com",
        },
      });
      assert.strictEqual(giftRes.statusCode, 200, giftRes.body);
      const gift = JSON.parse(giftRes.body).gift;
      const shareId = gift.share_token_id;
      const pin = gift.claim_pin;

      // Make 3 wrong PIN attempts
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: "POST",
          url: `/poem-share/${shareId}/claim`,
          payload: { pin: "000000" },
        });
      }

      // Check attempts = 3
      const shareBefore = db.prepare("SELECT claim_attempts FROM poem_share_tokens WHERE id = ?").get(shareId);
      assert.strictEqual(Number(shareBefore.claim_attempts), 3, "Should have 3 failed attempts");

      // Now unlock with correct PIN (anonymous — no auth header)
      const unlockRes = await app.inject({
        method: "POST",
        url: `/poem-share/${shareId}/claim`,
        payload: { pin },
      });
      assert.strictEqual(unlockRes.statusCode, 200, unlockRes.body);

      // Verify attempts were NOT reset
      const shareAfter = db.prepare("SELECT claim_attempts FROM poem_share_tokens WHERE id = ?").get(shareId);
      assert.ok(Number(shareAfter.claim_attempts) >= 3, `Attempts should not be reset after anonymous unlock, got ${shareAfter.claim_attempts}`);
    } finally {
      setFeatureFlag("gift_require_app_claim", true);
    }
  });

  it("enforces app-only poem gift claim with device token requirement", async () => {
    await creditGiftToken("gift_tx_4");

    const poemId = `poem_${Date.now()}`;
    db.prepare(
      `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      poemId,
      userId,
      "For You",
      "Jamie",
      "birthday",
      "heartfelt",
      JSON.stringify([["Line one", "Line two"]]),
      "Poem gift",
      "generated",
      nowIso(),
      nowIso()
    );

    const createGiftRes = await app.inject({
      method: "POST",
      url: "/gifts",
      headers: { "x-user-id": userId },
      payload: {
        content_type: "poem",
        content_id: poemId,
        delivery_mode: "immediate",
        sender_timezone: "UTC",
        channels: ["email"],
        recipient_email: "recipient@example.com",
      },
    });
    assert.strictEqual(createGiftRes.statusCode, 200, createGiftRes.body);
    const gift = JSON.parse(createGiftRes.body).gift;
    const shareId = gift.share_token_id;
    const pin = gift.claim_pin;

    const unauthClaim = await app.inject({
      method: "POST",
      url: `/poem-share/${shareId}/claim`,
      payload: { pin },
    });
    assert.strictEqual(unauthClaim.statusCode, 401, unauthClaim.body);
    assert.strictEqual(JSON.parse(unauthClaim.body).error, "DEVICE_TOKEN_REQUIRED");

    const registerRes = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { "x-user-id": userId },
      payload: {
        device_id: "ios_device_claim_test",
        platform: "ios",
        app_version: "1.0.0",
      },
    });
    assert.strictEqual(registerRes.statusCode, 200, registerRes.body);
    const { device_token: deviceToken } = JSON.parse(registerRes.body);
    assert.ok(deviceToken);

    const appClaim = await app.inject({
      method: "POST",
      url: `/poem-share/${shareId}/claim`,
      headers: { "x-device-token": deviceToken },
      payload: { pin },
    });
    assert.strictEqual(appClaim.statusCode, 200, appClaim.body);
    const appClaimBody = JSON.parse(appClaim.body);
    assert.ok(appClaimBody.status === "claimed" || appClaimBody.status === "unlocked");
  });
});

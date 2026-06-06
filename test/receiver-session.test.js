require("dotenv/config");
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

async function makeApp(t, extraConfig = {}) {
  const storageDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "porizo-receiver-test-"),
  );
  t.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));
  const config = {
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    STREAM_BASE_URL: "http://stream.local",
    PUBLIC_BASE_URL: "http://public.local",
    ALLOW_DEVICE_TOKEN_FALLBACK: true,
    ...extraConfig,
  };
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  const storage = createStorageProvider(config);
  const app = buildServer({ db, config, storage });
  t.after(() => app.close());
  return { app, db };
}

function seedSongShare(
  db,
  shareId,
  { webStreamAllowed = 1, claimPolicy = "app_only" } = {},
) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run("user_receiver_test", now, "low");
  db.prepare(
    "INSERT OR IGNORE INTO tracks (id, user_id, title, status, recipient_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "track_receiver_test",
    "user_receiver_test",
    "For Receiver",
    "completed",
    "Receiver",
    now,
    now,
  );
  db.prepare(
    "INSERT OR IGNORE INTO track_versions (id, track_id, version_num, status, render_type, params_json, params_hash, preview_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "tv_receiver_test",
    "track_receiver_test",
    1,
    "completed",
    "preview",
    "{}",
    "receiver_hash",
    "http://stream.local/preview.m4a",
    now,
  );
  db.prepare(
    `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, web_stream_allowed, app_save_allowed, expires_at, created_at, access_count, claim_pin, claim_attempts, stream_key_id, stream_key, delivery_source, claim_policy)
    VALUES (?, ?, ?, ?, 'unbound', ?, 1, ?, ?, 0, ?, 0, ?, ?, 'gift', ?)`,
  ).run(
    shareId,
    "track_receiver_test",
    "tv_receiver_test",
    "user_receiver_test",
    webStreamAllowed,
    new Date(Date.now() + 86400000).toISOString(),
    now,
    "123456",
    "stream_key_id",
    "stream_key",
    claimPolicy,
  );
}

function scheduleShareForFuture(
  db,
  shareId,
  {
    giftId = `gift_${shareId}`,
    futureSendAt = new Date(Date.now() + 86400000).toISOString(),
  } = {},
) {
  db.prepare(
    `INSERT INTO gift_orders (
    id, sender_user_id, content_type, content_id, status, dispatch_status,
    delivery_mode, send_at, sender_timezone, channels_json, share_token_id,
    share_url, claim_pin, claim_policy, expires_in_days, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    giftId,
    "user_receiver_test",
    "song",
    "track_receiver_test",
    "scheduled",
    "pending",
    "scheduled",
    futureSendAt,
    "UTC",
    "[]",
    shareId,
    `http://public.local/g/${shareId}`,
    "123456",
    "app_only",
    30,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  db.prepare(
    "UPDATE share_tokens SET gift_order_id = ?, dispatch_at = ?, dispatched_at = NULL WHERE id = ?",
  ).run(giftId, futureSendAt, shareId);
  return { giftId, futureSendAt };
}

function markShareReady(db, shareId, giftId) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE gift_orders SET dispatched_at = ?, status = ?, dispatch_status = ? WHERE id = ?",
  ).run(now, "dispatched", "sent", giftId);
  db.prepare("UPDATE share_tokens SET dispatched_at = ? WHERE id = ?").run(
    now,
    shareId,
  );
}

function seedPoemShare(db, shareId, { scheduled = false } = {}) {
  const now = new Date().toISOString();
  const poemId = `poem_${shareId}`;
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run("user_receiver_test", now, "low");
  db.prepare(
    "INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    poemId,
    "user_receiver_test",
    "For Receiver",
    "Receiver",
    "birthday",
    "heartfelt",
    "[]",
    "completed",
    now,
    now,
  );
  db.prepare(
    `INSERT INTO poem_share_tokens (
    id, poem_id, creator_id, status, expires_at, created_at, access_count, delivery_source, claim_policy
  ) VALUES (?, ?, ?, 'active', ?, ?, 0, ?, 'app_only')`,
  ).run(
    shareId,
    poemId,
    "user_receiver_test",
    new Date(Date.now() + 86400000).toISOString(),
    now,
    scheduled ? "gift" : "manual",
  );
  if (scheduled) {
    const futureSendAt = new Date(Date.now() + 86400000).toISOString();
    db.prepare(
      `INSERT INTO gift_orders (
      id, sender_user_id, content_type, content_id, status, dispatch_status,
      delivery_mode, send_at, sender_timezone, channels_json, share_token_id,
      share_url, claim_pin, claim_policy, expires_in_days, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `gift_${shareId}`,
      "user_receiver_test",
      "poem",
      poemId,
      "scheduled",
      "pending",
      "scheduled",
      futureSendAt,
      "UTC",
      "[]",
      shareId,
      `http://public.local/g/${shareId}`,
      "123456",
      "app_only",
      30,
      now,
      now,
    );
    db.prepare(
      "UPDATE poem_share_tokens SET gift_order_id = ?, dispatch_at = ?, dispatched_at = NULL WHERE id = ?",
    ).run(`gift_${shareId}`, futureSendAt, shareId);
  }
}

function markPoemShareReady(db, shareId) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE gift_orders SET dispatched_at = ?, status = ?, dispatch_status = ? WHERE share_token_id = ?",
  ).run(now, "dispatched", "sent", shareId);
  db.prepare("UPDATE poem_share_tokens SET dispatched_at = ? WHERE id = ?").run(
    now,
    shareId,
  );
}

test("receiver session records share, kind, event state, and concrete save URL", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const res = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_link_opened", content_kind: "song" },
    headers: { "user-agent": "receiver-test" },
  });

  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.match(body.receiver_session_id, /^rs_[a-f0-9]{24}$/);
  assert.match(body.receiver_session_secret, /^[a-f0-9]{48}$/);
  assert.match(body.receiver_handoff_id, /^rh_[a-f0-9]{24}$/);
  assert.match(
    body.receiver_save_url,
    /^http:\/\/public\.local\/download|^https?:\/\//,
  );

  const row = db
    .prepare("SELECT * FROM receiver_sessions WHERE id = ?")
    .get(body.receiver_session_id);
  assert.equal(row.share_id, shareId);
  assert.equal(row.content_kind, "song");
  assert.equal(row.first_event_name, "receiver_link_opened");
  assert.equal(row.receiver_handoff_id, body.receiver_handoff_id);
});

test("public receiver-session route rejects server-authoritative events", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const res = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_claim_succeeded" },
  });

  assert.equal(res.statusCode, 400, res.body);
  const count = db
    .prepare(
      "SELECT COUNT(*) AS count FROM receiver_session_events WHERE share_id = ?",
    )
    .get(shareId);
  assert.equal(Number(count.count), 0);
});

test("receiver session ignores a submitted session from another share", async (t) => {
  const { app, db } = await makeApp(t);
  const firstShareId = `sh_first_${Date.now()}`;
  const secondShareId = `sh_second_${Date.now()}`;
  seedSongShare(db, firstShareId);
  db.prepare(
    "INSERT INTO tracks (id, user_id, title, status, recipient_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "track_receiver_test_2",
    "user_receiver_test",
    "For Receiver 2",
    "completed",
    "Receiver",
    new Date().toISOString(),
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_json, params_hash, preview_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "tv_receiver_test_2",
    "track_receiver_test_2",
    1,
    "completed",
    "preview",
    "{}",
    "receiver_hash_2",
    "http://stream.local/preview2.m4a",
    new Date().toISOString(),
  );
  db.prepare(
    `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, web_stream_allowed, app_save_allowed, expires_at, created_at, access_count, claim_pin, claim_attempts, stream_key_id, stream_key, delivery_source, claim_policy)
    VALUES (?, ?, ?, ?, 'unbound', 1, 1, ?, ?, 0, ?, 0, ?, ?, 'gift', 'app_only')`,
  ).run(
    secondShareId,
    "track_receiver_test_2",
    "tv_receiver_test_2",
    "user_receiver_test",
    new Date(Date.now() + 86400000).toISOString(),
    new Date().toISOString(),
    "123456",
    "stream_key_id_2",
    "stream_key_2",
  );

  const first = await app.inject({
    method: "POST",
    url: `/share/${firstShareId}/receiver-session`,
    payload: { event_name: "receiver_link_opened" },
  });
  const firstBody = JSON.parse(first.body);

  const second = await app.inject({
    method: "POST",
    url: `/share/${secondShareId}/receiver-session`,
    payload: {
      receiver_session_id: firstBody.receiver_session_id,
      event_name: "receiver_link_opened",
    },
  });
  const secondBody = JSON.parse(second.body);

  assert.equal(second.statusCode, 200, second.body);
  assert.notEqual(
    secondBody.receiver_session_id,
    firstBody.receiver_session_id,
  );
  const firstRow = db
    .prepare("SELECT share_id FROM receiver_sessions WHERE id = ?")
    .get(firstBody.receiver_session_id);
  assert.equal(firstRow.share_id, firstShareId);
});

test("receiver session id alone cannot recover an existing handoff", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const first = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = JSON.parse(first.body);

  const bareReuse = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: {
      receiver_session_id: firstBody.receiver_session_id,
      event_name: "receiver_save_cta_clicked",
    },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(bareReuse.statusCode, 200, bareReuse.body);
  const bareBody = JSON.parse(bareReuse.body);
  assert.notEqual(bareBody.receiver_session_id, firstBody.receiver_session_id);
  assert.notEqual(bareBody.receiver_handoff_id, firstBody.receiver_handoff_id);

  const authenticatedReuse = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: {
      receiver_session_id: firstBody.receiver_session_id,
      receiver_session_secret: firstBody.receiver_session_secret,
      event_name: "receiver_save_cta_clicked",
    },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(authenticatedReuse.statusCode, 200, authenticatedReuse.body);
  const authenticatedBody = JSON.parse(authenticatedReuse.body);
  assert.equal(
    authenticatedBody.receiver_session_id,
    firstBody.receiver_session_id,
  );
});

test("receiver session without id and secret starts a separate browser session", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const first = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = JSON.parse(first.body);

  const second = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(second.statusCode, 200, second.body);
  const secondBody = JSON.parse(second.body);

  assert.notEqual(
    secondBody.receiver_session_id,
    firstBody.receiver_session_id,
  );
  assert.notEqual(
    secondBody.receiver_handoff_id,
    firstBody.receiver_handoff_id,
  );
  const count = db
    .prepare(
      "SELECT COUNT(*) AS count FROM receiver_sessions WHERE share_id = ?",
    )
    .get(shareId);
  assert.equal(Number(count.count), 2);
});

test("signed MP4 download fails closed after claim or app-only policy changes", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId, { claimPolicy: "default" });
  db.prepare("UPDATE share_tokens SET claim_pin = NULL WHERE id = ?").run(
    shareId,
  );

  const preChange = await app.inject({
    method: "GET",
    url: `/share/${shareId}`,
  });
  assert.equal(preChange.statusCode, 200, preChange.body);
  const dlToken = JSON.parse(preChange.body).dl_token;
  assert.ok(dlToken);

  db.prepare("UPDATE share_tokens SET claim_policy = ? WHERE id = ?").run(
    "app_only",
    shareId,
  );
  const appOnlyDownload = await app.inject({
    method: "GET",
    url: `/share/${shareId}/download.mp4?dl_token=${encodeURIComponent(dlToken)}`,
  });
  assert.equal(appOnlyDownload.statusCode, 403, appOnlyDownload.body);

  db.prepare(
    "UPDATE share_tokens SET claim_policy = ?, status = ? WHERE id = ?",
  ).run("default", "claimed", shareId);
  const claimedDownload = await app.inject({
    method: "GET",
    url: `/share/${shareId}/download.mp4?dl_token=${encodeURIComponent(dlToken)}`,
  });
  assert.equal(claimedDownload.statusCode, 403, claimedDownload.body);
});

test("handoff resolves to routing data without exposing audio URL", async (t) => {
  const { app, db } = await makeApp(t, {
    APPSFLYER_ONELINK_BASE_URL: "https://porizo.onelink.me/test",
  });
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const session = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
  });
  const sessionBody = JSON.parse(session.body);
  const saveUrl = new URL(sessionBody.receiver_save_url);
  assert.equal(
    saveUrl.searchParams.get("deep_link_value"),
    sessionBody.receiver_handoff_id,
  );
  assert.notEqual(saveUrl.searchParams.get("deep_link_value"), shareId);

  const resolved = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${sessionBody.receiver_handoff_id}`,
  });

  assert.equal(resolved.statusCode, 200, resolved.body);
  const body = JSON.parse(resolved.body);
  assert.equal(body.receiver_session_id, sessionBody.receiver_session_id);
  assert.equal(body.content_kind, "song");
  assert.match(body.receiver_claim_token, /^rc_[a-f0-9]{32}$/);
  assert.ok(body.receiver_claim_expires_at);
  assert.equal(Object.hasOwn(body, "share_id"), false);
  assert.equal(Object.hasOwn(body, "web_stream_url"), false);

  const preClaimReplay = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${sessionBody.receiver_handoff_id}`,
  });
  assert.equal(preClaimReplay.statusCode, 200, preClaimReplay.body);
  const replayBody = JSON.parse(preClaimReplay.body);
  assert.match(replayBody.receiver_claim_token, /^rc_[a-f0-9]{32}$/);
  assert.notEqual(replayBody.receiver_claim_token, body.receiver_claim_token);

  const recipientId = `recipient_${Date.now()}`;
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run(recipientId, new Date().toISOString(), "low");
  const deviceRegistration = await app.inject({
    method: "POST",
    url: "/device/register",
    headers: { "x-user-id": recipientId },
    payload: {
      device_id: "ios-idfv-opaque",
      platform: "ios",
      app_version: "1.0.0",
    },
  });
  assert.equal(deviceRegistration.statusCode, 200, deviceRegistration.body);
  const deviceToken = JSON.parse(deviceRegistration.body).device_token;
  assert.ok(deviceToken);

  const preClaimStream = await app.inject({
    method: "GET",
    url: `/receiver-claim/${replayBody.receiver_claim_token}/stream`,
    headers: { "x-device-token": deviceToken },
  });
  assert.equal(preClaimStream.statusCode, 409, preClaimStream.body);

  const opaqueClaim = await app.inject({
    method: "POST",
    url: `/receiver-claim/${replayBody.receiver_claim_token}`,
    headers: { "x-device-token": deviceToken },
    payload: {
      app_version: "1.0.0",
      pin: "123456",
    },
  });
  assert.equal(opaqueClaim.statusCode, 200, opaqueClaim.body);

  const retryOpaqueClaim = await app.inject({
    method: "POST",
    url: `/receiver-claim/${replayBody.receiver_claim_token}`,
    headers: { "x-device-token": deviceToken },
    payload: {
      app_version: "1.0.0",
      pin: "123456",
    },
  });
  assert.equal(retryOpaqueClaim.statusCode, 200, retryOpaqueClaim.body);
  assert.equal(JSON.parse(retryOpaqueClaim.body).status, "claimed");

  const postClaimStream = await app.inject({
    method: "GET",
    url: `/receiver-claim/${replayBody.receiver_claim_token}/stream`,
    headers: { "x-device-token": deviceToken },
  });
  assert.equal(postClaimStream.statusCode, 200, postClaimStream.body);

  const replayFromAnotherDevice = await app.inject({
    method: "POST",
    url: `/receiver-claim/${replayBody.receiver_claim_token}`,
    payload: {
      device_id: "ios-idfv-other",
      platform: "ios",
      app_version: "1.0.0",
      pin: "123456",
    },
  });
  assert.equal(
    replayFromAnotherDevice.statusCode,
    409,
    replayFromAnotherDevice.body,
  );

  const replay = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${sessionBody.receiver_handoff_id}`,
  });
  assert.equal(replay.statusCode, 404, replay.body);

  const opened = db
    .prepare(
      "SELECT event_name FROM receiver_session_events WHERE receiver_session_id = ? AND event_name = ?",
    )
    .get(sessionBody.receiver_session_id, "receiver_app_opened");
  assert.equal(opened.event_name, "receiver_app_opened");
  const consumed = db
    .prepare("SELECT handoff_resolved_at FROM receiver_sessions WHERE id = ?")
    .get(sessionBody.receiver_session_id);
  assert.ok(consumed.handoff_resolved_at);
  const claimed = db
    .prepare("SELECT status, bound_device_id FROM share_tokens WHERE id = ?")
    .get(shareId);
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.bound_device_id, "ios-idfv-opaque");
});

test("receiver-session route does not trust client supplied content kind", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const res = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_link_opened", content_kind: "poem" },
  });

  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  const row = db
    .prepare("SELECT content_kind FROM receiver_sessions WHERE id = ?")
    .get(body.receiver_session_id);
  assert.equal(row.content_kind, "song");
  const saveUrl = new URL(body.receiver_save_url);
  assert.equal(
    saveUrl.searchParams.get("deep_link"),
    "porizo:///receiver-handoff/" + body.receiver_handoff_id,
  );
});

test("handoff and gift-link resolvers reject gifts scheduled for the future", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);
  scheduleShareForFuture(db, shareId, { giftId: "gift_receiver_future" });

  const session = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
  });
  assert.equal(session.statusCode, 403, session.body);

  const giftLink = await app.inject({
    method: "GET",
    url: `/gift-link/${shareId}/resolve`,
  });
  assert.equal(giftLink.statusCode, 403, giftLink.body);
});

test("scheduled gifts are rejected on direct web and media endpoints", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);
  db.prepare("UPDATE share_tokens SET claim_pin = NULL WHERE id = ?").run(
    shareId,
  );
  const preScheduleShare = await app.inject({
    method: "GET",
    url: `/share/${shareId}`,
  });
  assert.equal(preScheduleShare.statusCode, 200, preScheduleShare.body);
  const dlToken = JSON.parse(preScheduleShare.body).dl_token;
  assert.ok(dlToken);
  scheduleShareForFuture(db, shareId);

  for (const url of [
    `/play/${shareId}`,
    `/share/${shareId}`,
    `/share/${shareId}/stream`,
    `/share/${shareId}/audio`,
    `/share/${shareId}/teaser`,
    `/share/${shareId}/share.mp4`,
    `/share/${shareId}/download.mp4?dl_token=${encodeURIComponent(dlToken)}`,
    `/embed/${shareId}`,
    `/oembed?url=http%3A%2F%2Fpublic.local%2Fplay%2F${shareId}&format=json`,
  ]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 403, `${url}: ${res.body}`);
    assert.match(res.body, /GIFT_NOT_READY|gift is not ready/i, url);
  }
});

test("revoked and expired song shares are rejected on presentation routes", async (t) => {
  const { app, db } = await makeApp(t);
  const revokedShareId = `sh_revoked_${Date.now()}`;
  const expiredShareId = `sh_expired_${Date.now()}`;
  seedSongShare(db, revokedShareId);
  seedSongShare(db, expiredShareId);
  db.prepare("UPDATE share_tokens SET status = 'revoked' WHERE id = ?").run(
    revokedShareId,
  );
  db.prepare(
    "UPDATE share_tokens SET expires_at = ?, status = 'unbound' WHERE id = ?",
  ).run(new Date(Date.now() - 86400000).toISOString(), expiredShareId);

  for (const shareId of [revokedShareId, expiredShareId]) {
    for (const url of [
      `/play/${shareId}`,
      `/embed/${shareId}`,
      `/oembed?url=http%3A%2F%2Fpublic.local%2Fplay%2F${shareId}&format=json`,
      `/g/${shareId}`,
    ]) {
      const res = await app.inject({ method: "GET", url });
      assert.notEqual(res.statusCode, 200, `${url}: ${res.body}`);
      assert.notEqual(
        res.statusCode,
        302,
        `${url}: ${res.headers.location || res.body}`,
      );
    }
  }
});

test("scheduled handoff is not consumed before the gift becomes ready", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const session = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
  });
  assert.equal(session.statusCode, 200, session.body);
  const sessionBody = JSON.parse(session.body);
  const { giftId } = scheduleShareForFuture(db, shareId);

  const early = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${sessionBody.receiver_handoff_id}`,
  });
  assert.equal(early.statusCode, 403, early.body);
  const unconsumed = db
    .prepare("SELECT handoff_resolved_at FROM receiver_sessions WHERE id = ?")
    .get(sessionBody.receiver_session_id);
  assert.equal(unconsumed.handoff_resolved_at, null);

  markShareReady(db, shareId, giftId);
  const ready = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${sessionBody.receiver_handoff_id}`,
  });
  assert.equal(ready.statusCode, 200, ready.body);
});

test("receiver session reuses a browser session only with id and secret", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const first = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_link_opened" },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = JSON.parse(first.body);

  const second = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: {
      receiver_session_id: firstBody.receiver_session_id,
      receiver_session_secret: firstBody.receiver_session_secret,
      event_name: "receiver_play_started",
    },
    headers: { "user-agent": "same-browser" },
  });

  assert.equal(second.statusCode, 200, second.body);
  const secondBody = JSON.parse(second.body);
  assert.equal(secondBody.receiver_session_id, firstBody.receiver_session_id);
  const count = db
    .prepare(
      "SELECT COUNT(*) AS count FROM receiver_sessions WHERE share_id = ?",
    )
    .get(shareId);
  assert.equal(Number(count.count), 1);
});

test("reused receiver sessions rotate consumed handoff ids", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const first = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = JSON.parse(first.body);
  const resolved = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${firstBody.receiver_handoff_id}`,
  });
  assert.equal(resolved.statusCode, 200, resolved.body);

  const second = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: {
      receiver_session_id: firstBody.receiver_session_id,
      receiver_session_secret: firstBody.receiver_session_secret,
      event_name: "receiver_save_cta_clicked",
    },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(second.statusCode, 200, second.body);
  const secondBody = JSON.parse(second.body);
  assert.equal(secondBody.receiver_session_id, firstBody.receiver_session_id);
  assert.equal(secondBody.receiver_handoff_id, firstBody.receiver_handoff_id);

  const oldReplay = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${firstBody.receiver_handoff_id}`,
  });
  assert.equal(oldReplay.statusCode, 200, oldReplay.body);
});

test("concurrent receiver session reuse does not return overwritten handoff ids", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const first = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
    headers: { "user-agent": "same-browser" },
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = JSON.parse(first.body);
  const resolved = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${firstBody.receiver_handoff_id}`,
  });
  assert.equal(resolved.statusCode, 200, resolved.body);

  const [one, two] = await Promise.all([
    app.inject({
      method: "POST",
      url: `/share/${shareId}/receiver-session`,
      payload: {
        receiver_session_id: firstBody.receiver_session_id,
        receiver_session_secret: firstBody.receiver_session_secret,
        event_name: "receiver_save_cta_clicked",
      },
      headers: { "user-agent": "same-browser" },
    }),
    app.inject({
      method: "POST",
      url: `/share/${shareId}/receiver-session`,
      payload: {
        receiver_session_id: firstBody.receiver_session_id,
        receiver_session_secret: firstBody.receiver_session_secret,
        event_name: "receiver_save_cta_clicked",
      },
      headers: { "user-agent": "same-browser" },
    }),
  ]);
  assert.equal(one.statusCode, 200, one.body);
  assert.equal(two.statusCode, 200, two.body);
  const oneBody = JSON.parse(one.body);
  const twoBody = JSON.parse(two.body);
  assert.equal(oneBody.receiver_session_id, firstBody.receiver_session_id);
  assert.equal(twoBody.receiver_session_id, firstBody.receiver_session_id);
  assert.equal(oneBody.receiver_handoff_id, twoBody.receiver_handoff_id);
  assert.equal(oneBody.receiver_handoff_id, firstBody.receiver_handoff_id);

  const newResolve = await app.inject({
    method: "GET",
    url: `/receiver-handoff/${oneBody.receiver_handoff_id}`,
  });
  assert.equal(newResolve.statusCode, 200, newResolve.body);
});

test("gift-link resolver distinguishes song shares", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const res = await app.inject({
    method: "GET",
    url: `/gift-link/${shareId}/resolve`,
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(JSON.parse(res.body), {
    share_id: shareId,
    content_kind: "song",
  });
});

test("gift-link resolver distinguishes poem shares and rejects scheduled poems", async (t) => {
  const { app, db } = await makeApp(t);
  const poemShareId = `poem_${Date.now()}`;
  const scheduledPoemShareId = `poem_future_${Date.now()}`;
  seedPoemShare(db, poemShareId);
  seedPoemShare(db, scheduledPoemShareId, { scheduled: true });

  const res = await app.inject({
    method: "GET",
    url: `/gift-link/${poemShareId}/resolve`,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(JSON.parse(res.body), {
    share_id: poemShareId,
    content_kind: "poem",
  });

  const scheduled = await app.inject({
    method: "GET",
    url: `/gift-link/${scheduledPoemShareId}/resolve`,
  });
  assert.equal(scheduled.statusCode, 403, scheduled.body);
});

test("scheduled poem gifts are rejected on direct poem viewer and OG image endpoints", async (t) => {
  const { app, db } = await makeApp(t);
  const scheduledPoemShareId = `poem_future_${Date.now()}`;
  seedPoemShare(db, scheduledPoemShareId, { scheduled: true });

  for (const url of [
    `/poem/${scheduledPoemShareId}`,
    `/poem/${scheduledPoemShareId}/og-image.png`,
    `/poem-share/${scheduledPoemShareId}`,
  ]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 403, `${url}: ${res.body}`);
    assert.match(res.body, /GIFT_NOT_READY|gift is not ready/i, url);
  }

  const claim = await app.inject({
    method: "POST",
    url: `/poem-share/${scheduledPoemShareId}/claim`,
    payload: { pin: "123456" },
  });
  assert.equal(claim.statusCode, 403, claim.body);

  markPoemShareReady(db, scheduledPoemShareId);
  const readyViewer = await app.inject({
    method: "GET",
    url: `/poem/${scheduledPoemShareId}`,
  });
  assert.equal(readyViewer.statusCode, 200, readyViewer.body);
});

test("receiver resolver aggregate rate limits random invalid ids", async (t) => {
  const { app } = await makeApp(t);
  let handoffLimited = false;
  for (let i = 0; i < 35; i += 1) {
    const suffix = String(i)
      .padStart(24, "a")
      .slice(-24)
      .replace(/[^a-f0-9]/g, "a");
    const res = await app.inject({
      method: "GET",
      url: `/receiver-handoff/rh_${suffix}`,
    });
    if (res.statusCode === 429) {
      handoffLimited = true;
      assert.match(res.headers["retry-after"], /^\d+$/);
      break;
    }
  }
  assert.equal(handoffLimited, true);
});

test("gift-link resolver aggregate rate limits random invalid ids", async (t) => {
  const { app } = await makeApp(t);
  let limited = false;
  for (let i = 0; i < 35; i += 1) {
    const res = await app.inject({
      method: "GET",
      url: `/gift-link/missing_${i}_${Date.now()}/resolve`,
    });
    if (res.statusCode === 429) {
      limited = true;
      assert.match(res.headers["retry-after"], /^\d+$/);
      break;
    }
  }
  assert.equal(limited, true);
});

test("app-only gift share advertises web playback while preserving claim gates", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const res = await app.inject({ method: "GET", url: `/share/${shareId}` });

  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "unbound");
  assert.equal(body.claim_requires_app, true);
  assert.equal(body.pin_required_for_claim, true);
  assert.equal(body.app_required, false);
  assert.ok(body.web_stream_url);
  assert.equal(body.receiver_save_requires_session, true);
});

test("claim route records backend-authoritative receiver claim outcomes", async (t) => {
  const { app, db } = await makeApp(t);
  const shareId = `sh_${Date.now()}`;
  seedSongShare(db, shareId);

  const session = await app.inject({
    method: "POST",
    url: `/share/${shareId}/receiver-session`,
    payload: { event_name: "receiver_claim_started" },
  });
  const sessionBody = JSON.parse(session.body);

  const badClaim = await app.inject({
    method: "POST",
    url: `/share/${shareId}/claim`,
    payload: {
      device_id: "ios-idfv-123",
      platform: "ios",
      app_version: "1.0.0",
      pin: "000000",
      receiver_session_id: sessionBody.receiver_session_id,
      receiver_session_secret: sessionBody.receiver_session_secret,
    },
  });
  assert.equal(badClaim.statusCode, 401, badClaim.body);

  const recipientId = `recipient_${Date.now()}`;
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, ?)",
  ).run(recipientId, new Date().toISOString(), "low");
  const regRes = await app.inject({
    method: "POST",
    url: "/device/register",
    headers: { "x-user-id": recipientId },
    payload: {
      device_id: "ios-idfv-123",
      platform: "ios",
      app_version: "1.0.0",
    },
  });
  const { device_token: deviceToken } = JSON.parse(regRes.body);

  const goodClaim = await app.inject({
    method: "POST",
    url: `/share/${shareId}/claim`,
    headers: { "x-device-token": deviceToken },
    payload: {
      pin: "123456",
      receiver_session_id: sessionBody.receiver_session_id,
      receiver_session_secret: sessionBody.receiver_session_secret,
    },
  });
  assert.equal(goodClaim.statusCode, 200, goodClaim.body);

  const events = db
    .prepare(
      "SELECT event_name, metadata_json FROM receiver_session_events WHERE receiver_session_id = ? ORDER BY created_at, id",
    )
    .all(sessionBody.receiver_session_id);
  assert.ok(
    events.some(
      (event) =>
        event.event_name === "receiver_claim_failed" &&
        /invalid_pin/.test(event.metadata_json),
    ),
  );
  assert.ok(
    events.some((event) => event.event_name === "receiver_claim_succeeded"),
  );
});

test("download attribution ignores receiver session ids that do not match the handoff", async (t) => {
  const { app, db } = await makeApp(t);
  const firstShareId = `sh_dl_first_${Date.now()}`;
  const secondShareId = `sh_dl_second_${Date.now()}`;
  seedSongShare(db, firstShareId);
  db.prepare(
    "INSERT INTO tracks (id, user_id, title, status, recipient_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "track_receiver_test_dl_2",
    "user_receiver_test",
    "For Receiver 2",
    "completed",
    "Receiver",
    new Date().toISOString(),
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_json, params_hash, preview_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "tv_receiver_test_dl_2",
    "track_receiver_test_dl_2",
    1,
    "completed",
    "preview",
    "{}",
    "receiver_hash_dl_2",
    "http://stream.local/preview2.m4a",
    new Date().toISOString(),
  );
  db.prepare(
    `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, web_stream_allowed, app_save_allowed, expires_at, created_at, access_count, claim_pin, claim_attempts, stream_key_id, stream_key, delivery_source, claim_policy)
    VALUES (?, ?, ?, ?, 'unbound', 1, 1, ?, ?, 0, ?, 0, ?, ?, 'gift', 'app_only')`,
  ).run(
    secondShareId,
    "track_receiver_test_dl_2",
    "tv_receiver_test_dl_2",
    "user_receiver_test",
    new Date(Date.now() + 86400000).toISOString(),
    new Date().toISOString(),
    "123456",
    "stream_key_id_dl_2",
    "stream_key_dl_2",
  );

  const first = await app.inject({
    method: "POST",
    url: `/share/${firstShareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
  });
  const second = await app.inject({
    method: "POST",
    url: `/share/${secondShareId}/receiver-session`,
    payload: { event_name: "receiver_save_cta_clicked" },
  });
  const firstBody = JSON.parse(first.body);
  const secondBody = JSON.parse(second.body);

  const poisoned = await app.inject({
    method: "GET",
    url: `/download?deep_link=${encodeURIComponent(`porizo:///receiver-handoff/${firstBody.receiver_handoff_id}`)}&receiver_session_id=${encodeURIComponent(secondBody.receiver_session_id)}`,
  });
  assert.equal(poisoned.statusCode, 200, poisoned.body);
  const poisonedCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM download_events WHERE receiver_session_id = ?",
    )
    .get(secondBody.receiver_session_id);
  assert.equal(Number(poisonedCount.count), 0);

  const malformed = await app.inject({
    method: "GET",
    url: `/download?deep_link=${encodeURIComponent(`https://evil.test/receiver-handoff/${firstBody.receiver_handoff_id}`)}&receiver_session_id=${encodeURIComponent(firstBody.receiver_session_id)}`,
  });
  assert.equal(malformed.statusCode, 302, malformed.body);
  const malformedCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM download_events WHERE receiver_session_id = ?",
    )
    .get(firstBody.receiver_session_id);
  assert.equal(Number(malformedCount.count), 0);

  const valid = await app.inject({
    method: "GET",
    url: `/download?deep_link=${encodeURIComponent(`porizo:///receiver-handoff/${firstBody.receiver_handoff_id}`)}&receiver_session_id=${encodeURIComponent(firstBody.receiver_session_id)}`,
  });
  assert.equal(valid.statusCode, 200, valid.body);
  const validCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM download_events WHERE receiver_session_id = ?",
    )
    .get(firstBody.receiver_session_id);
  assert.equal(Number(validCount.count), 1);

  const replay = await app.inject({
    method: "GET",
    url: `/download?deep_link=${encodeURIComponent(`porizo:///receiver-handoff/${firstBody.receiver_handoff_id}`)}&receiver_session_id=${encodeURIComponent(firstBody.receiver_session_id)}`,
  });
  assert.equal(replay.statusCode, 200, replay.body);
  const replayCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM download_events WHERE receiver_session_id = ?",
    )
    .get(firstBody.receiver_session_id);
  assert.equal(Number(replayCount.count), 1);
});

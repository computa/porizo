require("dotenv/config");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "test-jwt-secret-download-attribution-0123456789abcdef";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { AttributionService } = require("../src/services/attribution-service");

async function makeApp(t) {
  const config = {
    STORAGE_DIR: "/tmp/porizo-download-attr-test",
    STORAGE_PROVIDER: "local",
    STREAM_BASE_URL: "http://stream.local",
    PUBLIC_BASE_URL: "http://public.local",
    ALLOW_ANON_USER_ID: true,
  };
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  const storage = {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
  const app = buildServer({ db, config, storage });
  t.after(() => app.close());
  return { app, db };
}

let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `203.0.${Math.floor(ipCounter / 254) % 254}.${(ipCounter % 254) + 1}`;
}

function uniqueEmail() {
  return `download-attr-${crypto.randomBytes(8).toString("hex")}@example.com`;
}

function seedUser(db, userId = `download_attr_user_${crypto.randomBytes(6).toString("hex")}`) {
  db.prepare(
    "INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')",
  ).run(userId, new Date().toISOString());
  return userId;
}

function seedDownloadEvent(
  db,
  {
    ip,
    createdAtMs = Date.now(),
    matchedUserId = null,
    utmSource = "seo",
    utmMedium = "landing_page",
    utmCampaign = "song_gift",
    utmContent = "hero",
    utmTerm = null,
    country = "AU",
    referrerUrl = "https://porizo.co/song-gift",
  },
) {
  const id = `dl_${crypto.randomBytes(12).toString("hex")}`;
  db.prepare(`
    INSERT INTO download_events (
      id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
      utm_content, utm_term, country, referrer_url, matched_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ip,
    "download-attribution-test-agent",
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    country,
    referrerUrl,
    matchedUserId,
    new Date(createdAtMs).toISOString(),
  );
  return id;
}

function seedReceiverSession(db, {
  id = "rs_aaaaaaaaaaaaaaaaaaaaaaaa",
  receiverHandoffId = "rh_bbbbbbbbbbbbbbbbbbbbbbbb",
  handoffExpiresAt = new Date(Date.now() + 86_400_000).toISOString(),
} = {}) {
  db.prepare(`
    INSERT INTO receiver_sessions (
      id, share_id, content_kind, receiver_handoff_id, handoff_expires_at,
      first_event_name, last_event_name, created_at, updated_at
    ) VALUES (?, ?, 'song', ?, ?, 'receiver_save_cta_clicked',
      'receiver_save_cta_clicked', ?, ?)
  `).run(
    id,
    `share_${id}`,
    receiverHandoffId,
    handoffExpiresAt,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  return { id, receiverHandoffId };
}

function matchedDownloadUserId(db, eventId) {
  return db
    .prepare("SELECT matched_user_id FROM download_events WHERE id = ?")
    .get(eventId)?.matched_user_id;
}

async function pollMatchedDownloadUserId(db, eventId, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const userId = matchedDownloadUserId(db, eventId);
    if (userId) return userId;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function pollUserAcquisitionSource(db, userId, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const user = db
      .prepare("SELECT acquisition_source FROM users WHERE id = ?")
      .get(userId);
    if (user?.acquisition_source) return user.acquisition_source;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function emailSignup(app, ip) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: { "x-forwarded-for": ip },
    payload: { email: uniqueEmail(), password: "test-password-123" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().user_id;
}

async function drainDownloadAttribution(app, db, ip) {
  const canaryId = seedDownloadEvent(db, {
    ip,
    createdAtMs: Date.now() + 1000,
    utmCampaign: "canary_download_attribution",
  });
  const userId = await emailSignup(app, ip);
  const matched = await pollMatchedDownloadUserId(db, canaryId);
  assert.equal(matched, userId, "control download attribution ran to completion");
}

test("email signup attributes a same-IP unmatched /download event and backfills user acquisition", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const eventId = seedDownloadEvent(db, {
    ip,
    utmSource: "seo",
    utmMedium: "landing_page",
    utmCampaign: "song_gift",
    utmContent: "hero_badge",
    referrerUrl: "https://porizo.co/song-gift",
  });

  const userId = await emailSignup(app, ip);

  assert.equal(await pollMatchedDownloadUserId(db, eventId), userId);
  assert.equal(await pollUserAcquisitionSource(db, userId), "seo");

  const user = db.prepare(`
    SELECT acquisition_source, acquisition_medium, acquisition_campaign,
           acquisition_content, acquisition_referrer, acquisition_country
    FROM users
    WHERE id = ?
  `).get(userId);
  assert.equal(user.acquisition_source, "seo");
  assert.equal(user.acquisition_medium, "landing_page");
  assert.equal(user.acquisition_campaign, "song_gift");
  assert.equal(user.acquisition_content, "hero_badge");
  assert.equal(user.acquisition_referrer, "https://porizo.co/song-gift");
  assert.equal(user.acquisition_country, "AU");
});

test("email signup does not attribute a different-IP /download event", async (t) => {
  const { app, db } = await makeApp(t);
  const signupIp = uniqueIp();
  const eventId = seedDownloadEvent(db, { ip: uniqueIp() });

  await emailSignup(app, signupIp);
  await drainDownloadAttribution(app, db, signupIp);

  assert.equal(matchedDownloadUserId(db, eventId), null);
});

test("download attribution matcher skips unknown IPs", async (t) => {
  const { db } = await makeApp(t);
  const userId = seedUser(db);
  const eventId = seedDownloadEvent(db, { ip: "unknown" });
  const attributionService = new AttributionService(db);

  const matched = await attributionService.matchRecentDownloadEventForUser(
    userId,
    "unknown",
  );

  assert.equal(matched, null);
  assert.equal(matchedDownloadUserId(db, eventId), null);
  assert.equal(await pollUserAcquisitionSource(db, userId, { timeoutMs: 50 }), null);
});

test("download attribution matcher does not steal already matched events", async (t) => {
  const { db } = await makeApp(t);
  const ip = uniqueIp();
  const existingUserId = seedUser(db);
  const nextUserId = seedUser(db);
  const eventId = seedDownloadEvent(db, { ip, matchedUserId: existingUserId });
  const attributionService = new AttributionService(db);

  const matched = await attributionService.matchRecentDownloadEventForUser(
    nextUserId,
    ip,
  );

  assert.equal(matched, null);
  assert.equal(matchedDownloadUserId(db, eventId), existingUserId);
  assert.equal(await pollUserAcquisitionSource(db, nextUserId, { timeoutMs: 50 }), null);
});

test("/download appends an App Store campaign token and logs the install-intent envelope", async (t) => {
  const { app, db } = await makeApp(t);

  const response = await app.inject({
    method: "GET",
    url: "/download?utm_source=seo&utm_medium=landing_page&utm_campaign=song_gift&utm_content=hero_badge&utm_term=custom%20birthday%20song&ref=https%3A%2F%2Fporizo.co%2Fbirthday-song-maker",
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    },
  });

  assert.equal(response.statusCode, 302, response.body);
  const location = new URL(response.headers.location);
  assert.equal(location.hostname, "apps.apple.com");
  assert.equal(location.searchParams.get("ct"), "song_gift_hero_badge");

  const row = db.prepare(`
    SELECT id, user_agent, utm_source, utm_medium, utm_campaign, utm_content,
           utm_term, referrer_url, receiver_session_id
    FROM download_events
    ORDER BY created_at DESC
    LIMIT 1
  `).get();
  assert.match(row.id, /^dl_[a-f0-9]{16}$/);
  assert.equal(
    row.user_agent,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  );
  assert.equal(row.utm_source, "seo");
  assert.equal(row.utm_medium, "landing_page");
  assert.equal(row.utm_campaign, "song_gift");
  assert.equal(row.utm_content, "hero_badge");
  assert.equal(row.utm_term, "custom birthday song");
  assert.equal(row.referrer_url, "https://porizo.co/birthday-song-maker");
  assert.equal(row.receiver_session_id, null);
});

test("/download redirects bots without logging install intent", async (t) => {
  const { app, db } = await makeApp(t);

  const response = await app.inject({
    method: "GET",
    url: "/download?utm_source=seo&utm_medium=schema&utm_campaign=song_gift&utm_content=schema",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    },
  });

  assert.equal(response.statusCode, 302, response.body);
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM download_events")
    .get();
  assert.equal(Number(count.count), 0);
});

test("/download bot requests with receiver handoff do not consume receiver attribution", async (t) => {
  const { app, db } = await makeApp(t);
  const receiverSession = seedReceiverSession(db);

  const response = await app.inject({
    method: "GET",
    url:
      `/download?deep_link=${encodeURIComponent(`porizo:///receiver-handoff/${receiverSession.receiverHandoffId}`)}` +
      `&receiver_session_id=${encodeURIComponent(receiverSession.id)}`,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  const session = db
    .prepare(
      "SELECT download_attributed_at FROM receiver_sessions WHERE id = ?",
    )
    .get(receiverSession.id);
  assert.equal(session.download_attributed_at, null);
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM download_events")
    .get();
  assert.equal(Number(count.count), 0);
});

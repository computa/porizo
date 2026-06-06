require("dotenv/config");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "test-jwt-secret-receiver-attribution-0123456789abcdef";
process.env.APPLE_CLIENT_ID =
  process.env.APPLE_CLIENT_ID || "com.porizo.app.test";
process.env.ALLOW_MOCK_SOCIAL_AUTH = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");

async function makeApp(t) {
  const config = {
    STORAGE_DIR: "/tmp/porizo-receiver-attr-test",
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

// auth.js keeps rate-limit state in a process-level Map, so it persists across app instances.
// Each test uses a unique client IP (server has trustProxy:true, so x-forwarded-for sets
// request.ip) to get its own rate-limit budget AND its own receiver-session match space.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  // TEST-NET-3 (203.0.113.0/24) plus a second octet to keep every test's IP distinct.
  return `203.0.${Math.floor(ipCounter / 254) % 254}.${(ipCounter % 254) + 1}`;
}

function seedReceiverSession(
  db,
  { ip, createdAtMs = Date.now(), updatedAtMs = null, matchedUserId = null },
) {
  const id = `rs_${crypto.randomBytes(8).toString("hex")}`;
  const created = new Date(createdAtMs).toISOString();
  const updated = new Date(updatedAtMs ?? createdAtMs).toISOString();
  db.prepare(
    `INSERT INTO receiver_sessions
       (id, share_id, content_kind, first_ip_address, last_ip_address, matched_user_id, created_at, updated_at)
     VALUES (?, ?, 'song', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `sh_${crypto.randomBytes(6).toString("hex")}`,
    ip,
    ip,
    matchedUserId,
    created,
    updated,
  );
  return id;
}

function uniqueEmail() {
  return `receiver-attr-${crypto.randomBytes(8).toString("hex")}@example.com`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function buildMockAppleToken({ sub, email, nonce }) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      email,
      email_verified: true,
      iss: "https://appleid.apple.com",
      aud: process.env.APPLE_CLIENT_ID,
      nonce: sha256Hex(nonce),
    }),
  ).toString("base64url");
  const signature = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function matchedUserId(db, sessionId) {
  return db
    .prepare("SELECT matched_user_id FROM receiver_sessions WHERE id = ?")
    .get(sessionId)?.matched_user_id;
}

// Attribution is fire-and-forget (.catch(() => {})) — poll the row instead of awaiting.
async function pollMatchedUserId(db, sessionId, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const id = matchedUserId(db, sessionId);
    if (id) return id;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function emailSignup(app, ip) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: { "x-forwarded-for": ip },
    payload: { email: uniqueEmail(), password: "test-password-123" },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().user_id;
}

// Deterministic "the matcher has run" signal for NEGATIVE assertions. The matcher uses
// ORDER BY updated_at DESC LIMIT 1, so a fresh same-IP session seeded *here* (after the row
// under test, with a later updated_at) is the most-recent candidate for THIS control signup;
// waiting for it to match proves the fire-and-forget path executed — so the earlier signup's
// matcher has also run and we can safely assert the row under test was left untouched.
async function drainAttribution(app, db, ip) {
  const canary = seedReceiverSession(db, {
    ip,
    updatedAtMs: Date.now() + 1000,
  });
  const userId = await emailSignup(app, ip);
  const matched = await pollMatchedUserId(db, canary);
  assert.equal(matched, userId, "control attribution ran to completion");
}

test("email signup attributes a same-IP receiver session", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const sessionId = seedReceiverSession(db, { ip });
  const userId = await emailSignup(app, ip);
  assert.equal(await pollMatchedUserId(db, sessionId), userId);
});

test("email signup does NOT attribute a different-IP receiver session", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const otherIp = seedReceiverSession(db, { ip: uniqueIp() });
  await emailSignup(app, ip); // its matcher finds no session at THIS ip
  await drainAttribution(app, db, ip); // proves the path runs in this harness
  assert.equal(
    matchedUserId(db, otherIp),
    null,
    "different-IP session stays unattributed",
  );
});

test("social (apple) new-user signup attributes a same-IP receiver session", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const sessionId = seedReceiverSession(db, { ip });
  const nonce = `nonce-${crypto.randomBytes(8).toString("hex")}`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/social",
    headers: { "x-forwarded-for": ip },
    payload: {
      provider: "apple",
      id_token: buildMockAppleToken({
        sub: `apple-${crypto.randomBytes(8).toString("hex")}`,
        email: uniqueEmail(),
        nonce,
      }),
      nonce,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(await pollMatchedUserId(db, sessionId), res.json().user_id);
});

test("social returning-user login (isNewUser=false) does NOT attribute", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const sub = `apple-${crypto.randomBytes(8).toString("hex")}`;
  const email = uniqueEmail();
  const first = await app.inject({
    method: "POST",
    url: "/auth/social",
    headers: { "x-forwarded-for": ip },
    payload: {
      provider: "apple",
      id_token: buildMockAppleToken({ sub, email, nonce: "n1-" + sub }),
      nonce: "n1-" + sub,
    },
  });
  assert.equal(first.statusCode, 201, first.body);

  // Returning login for the same apple identity, with a fresh same-IP session present.
  const sessionId = seedReceiverSession(db, { ip });
  const second = await app.inject({
    method: "POST",
    url: "/auth/social",
    headers: { "x-forwarded-for": ip },
    payload: {
      provider: "apple",
      id_token: buildMockAppleToken({ sub, email, nonce: "n2-" + sub }),
      nonce: "n2-" + sub,
    },
  });
  assert.equal(second.statusCode, 200, second.body); // existing user → login, not 201
  await drainAttribution(app, db, ip);
  assert.equal(
    matchedUserId(db, sessionId),
    null,
    "returning login must not attribute",
  );
});

test("phone registration attributes a same-IP receiver session", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const sessionId = seedReceiverSession(db, { ip });
  const phone = `+614${String(crypto.randomInt(0, 10 ** 8)).padStart(8, "0")}`;
  const code = "123456";
  db.prepare(
    `INSERT INTO phone_verifications (id, phone_number, code, code_hash, expires_at, attempts)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(
    `pv_${crypto.randomBytes(8).toString("hex")}`,
    phone,
    code,
    sha256Hex(code),
    new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  );
  const verify = await app.inject({
    method: "POST",
    url: "/auth/phone/verify",
    headers: { "x-forwarded-for": ip },
    payload: { phone_number: phone, code },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  const register = await app.inject({
    method: "POST",
    url: "/auth/phone/register",
    headers: { "x-forwarded-for": ip },
    payload: {
      registration_token: verify.json().registration_token,
      phone_number: phone,
      name: "Phone User",
    },
  });
  assert.equal(register.statusCode, 201, register.body);
  assert.equal(await pollMatchedUserId(db, sessionId), register.json().user_id);
});

test("already-matched session is preserved (idempotent — first writer wins)", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const preMatched = seedReceiverSession(db, {
    ip,
    matchedUserId: "usr_existing_owner",
  });
  await emailSignup(app, ip); // SELECT skips matched rows → no candidate at this ip
  await drainAttribution(app, db, ip);
  assert.equal(
    matchedUserId(db, preMatched),
    "usr_existing_owner",
    "a second signup must not steal an already-attributed session",
  );
});

test("a session older than the 72h window is NOT attributed", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const stale = seedReceiverSession(db, {
    ip,
    createdAtMs: Date.now() - 73 * 60 * 60 * 1000,
  });
  await emailSignup(app, ip); // outside the window → excluded
  await drainAttribution(app, db, ip);
  assert.equal(
    matchedUserId(db, stale),
    null,
    "stale (>72h) session stays unattributed",
  );
});

test("when multiple same-IP sessions match, the most-recently-updated wins", async (t) => {
  const { app, db } = await makeApp(t);
  const ip = uniqueIp();
  const older = seedReceiverSession(db, {
    ip,
    updatedAtMs: Date.now() - 60 * 60 * 1000,
  });
  const newer = seedReceiverSession(db, { ip, updatedAtMs: Date.now() });
  const userId = await emailSignup(app, ip);
  assert.equal(
    await pollMatchedUserId(db, newer),
    userId,
    "newest session is attributed",
  );
  assert.equal(
    matchedUserId(db, older),
    null,
    "older same-IP session is left for next time",
  );
});

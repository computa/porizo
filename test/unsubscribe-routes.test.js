process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "test-jwt-secret-unsubscribe-routes-0123456789abcdef";
process.env.UNSUBSCRIBE_SECRET =
  process.env.UNSUBSCRIBE_SECRET || "test-unsubscribe-secret-routes";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { signUnsubscribeToken } = require("../src/utils/unsubscribe-token");

async function makeApp(t) {
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  const config = {
    STORAGE_DIR: "/tmp/porizo-unsubscribe-routes-test",
    STORAGE_PROVIDER: "local",
    STREAM_BASE_URL: "http://stream.local",
    PUBLIC_BASE_URL: "http://public.local",
    ALLOW_ANON_USER_ID: true,
  };
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

function userId(prefix = "unsubscribe_user") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function seedUser(db, id, { unsubscribedAt = null } = {}) {
  db.prepare(
    `INSERT INTO users (id, email, unsubscribed_at, created_at, risk_level)
     VALUES (?, ?, ?, ?, 'low')`,
  ).run(
    id,
    `${id}@example.com`,
    unsubscribedAt,
    new Date().toISOString(),
  );
}

function unsubscribePath(id, token = signUnsubscribeToken(id)) {
  return `/unsubscribe?u=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
}

function getUnsubscribedAt(db, id) {
  return db
    .prepare("SELECT unsubscribed_at FROM users WHERE id = ?")
    .get(id)?.unsubscribed_at;
}

test("GET /unsubscribe with a valid token renders confirmation and marks the user unsubscribed", async (t) => {
  const { app, db } = await makeApp(t);
  const id = userId();
  seedUser(db, id);

  const response = await app.inject({
    method: "GET",
    url: unsubscribePath(id),
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.body, /You&#39;re unsubscribed/);
  assert.ok(getUnsubscribedAt(db, id));
});

test("POST /unsubscribe is one-click and preserves the first unsubscribe timestamp", async (t) => {
  const { app, db } = await makeApp(t);
  const id = userId();
  const firstUnsubscribedAt = "2026-06-27T10:00:00.000Z";
  seedUser(db, id, { unsubscribedAt: firstUnsubscribedAt });

  const response = await app.inject({
    method: "POST",
    url: unsubscribePath(id),
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, "");
  assert.equal(getUnsubscribedAt(db, id), firstUnsubscribedAt);
});

test("POST /unsubscribe with a valid token marks a newly unsubscribed user", async (t) => {
  const { app, db } = await makeApp(t);
  const id = userId();
  seedUser(db, id);

  const response = await app.inject({
    method: "POST",
    url: unsubscribePath(id),
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, "");
  assert.ok(getUnsubscribedAt(db, id));
});

test("POST /unsubscribe with a valid token for a missing user does not leak existence", async (t) => {
  const { app } = await makeApp(t);
  const id = userId("missing_unsubscribe_user");

  const response = await app.inject({
    method: "POST",
    url: unsubscribePath(id),
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, "");
});

test("POST /unsubscribe with an invalid token does not mutate the user", async (t) => {
  const { app, db } = await makeApp(t);
  const id = userId();
  seedUser(db, id);

  const response = await app.inject({
    method: "POST",
    url: unsubscribePath(id, "invalid-token"),
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.body, "");
  assert.equal(getUnsubscribedAt(db, id), null);
});

test("GET /unsubscribe with an invalid token renders a no-store error page without mutation", async (t) => {
  const { app, db } = await makeApp(t);
  const id = userId();
  seedUser(db, id);

  const response = await app.inject({
    method: "GET",
    url: unsubscribePath(id, "invalid-token"),
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.body, /Link not valid/);
  assert.equal(getUnsubscribedAt(db, id), null);
});

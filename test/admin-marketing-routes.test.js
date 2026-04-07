require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function nowIso() {
  return new Date().toISOString();
}

describe("admin marketing routes", () => {
  let db;
  let app;
  let adminToken;

  async function loginAdmin() {
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@porizo.app", password: "admin123" },
    });
    assert.equal(response.statusCode, 200);
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
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
    adminToken = await loginAdmin();
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("exports all campaign contacts when no status filter is provided", async () => {
    const now = nowIso();
    await db.prepare(`
      INSERT INTO marketing_campaigns (id, name, status, created_at, updated_at)
      VALUES (?, ?, 'completed', ?, ?)
    `).run("camp-1", "Spring Campaign", now, now);

    await db.prepare(`
      INSERT INTO marketing_contacts (
        id, first_name, last_name, email, company_name, status, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, ?, 'active', ?, ?),
        (?, ?, ?, ?, ?, 'bounced', ?, ?),
        (?, ?, ?, ?, ?, 'unsubscribed', ?, ?)
    `).run(
      "contact-1", "Ada", "Active", "ada@example.com", "Ada Co", now, now,
      "contact-2", "Ben", "Bounced", "ben@example.com", "Ben Co", now, now,
      "contact-3", "Uma", "Unsubscribed", "uma@example.com", "Uma Co", now, now
    );

    await db.prepare(`
      INSERT INTO marketing_engagements (
        id, contact_id, campaign_id, opened, clicked, replied, bounced, unsubscribed, created_at, updated_at
      ) VALUES
        (?, ?, ?, 1, 0, 0, 0, 0, ?, ?),
        (?, ?, ?, 1, 0, 0, 1, 0, ?, ?),
        (?, ?, ?, 1, 0, 0, 0, 1, ?, ?)
    `).run(
      "eng-1", "contact-1", "camp-1", now, now,
      "eng-2", "contact-2", "camp-1", now, now,
      "eng-3", "contact-3", "camp-1", now, now
    );

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/marketing/contacts/export?campaign_id=camp-1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/csv/);
    assert.match(response.body, /ada@example\.com/);
    assert.match(response.body, /ben@example\.com/);
    assert.match(response.body, /uma@example\.com/);
  });

  test("returns 404 when exporting contacts for an unknown campaign", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/marketing/contacts/export?campaign_id=missing-campaign",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 404);
    assert.match(response.body, /campaign not found/i);
  });

  test("rejects invalid boolean marketing filters instead of silently coercing them", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/marketing/contacts/export?opened=maybe",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /opened must be true or false/i);
  });

  test("rejects invalid contact status filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/marketing/contacts?status=pending",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /status must be one of/i);
  });
});

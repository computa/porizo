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

  test("sends push campaigns through OneSignal and records the notification", async () => {
    const now = nowIso();
    const calls = [];
    await db.prepare(`
      INSERT INTO marketing_campaigns (id, name, type, status, created_at, updated_at)
      VALUES (?, ?, 'push', 'draft', ?, ?)
    `).run("push-camp-1", "Welcome Push", now, now);

    await app.close();
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
      oneSignalService: {
        isConfigured: () => true,
        sendToSegment: async (payload) => {
          calls.push(payload);
          return { id: "os-notification-1", recipients: 7 };
        },
      },
    });
    adminToken = await loginAdmin();

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/marketing/campaigns/push-camp-1/send-push",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        title: "Make a song",
        body: "Turn a memory into music today.",
        segments: ["All"],
        confirm: "SEND_PUSH",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().onesignal.id, "os-notification-1");
    assert.equal(response.json().onesignal.recipients, 7);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      segments: ["All"],
      title: "Make a song",
      body: "Turn a memory into music today.",
      data: {
        campaign_id: "push-camp-1",
        campaign_name: "Welcome Push",
      },
      imageUrl: null,
      name: "Welcome Push",
    });

    const campaign = await db.prepare("SELECT status, recipient_count FROM marketing_campaigns WHERE id = ?").get("push-camp-1");
    assert.equal(campaign.status, "sent");
    assert.equal(campaign.recipient_count, 7);

    const push = await db.prepare("SELECT onesignal_notification_id, recipients_count FROM push_campaigns WHERE name = ?").get("Welcome Push");
    assert.equal(push.onesignal_notification_id, "os-notification-1");
    assert.equal(push.recipients_count, 7);
  });

  test("requires explicit confirmation before sending a live push campaign", async () => {
    const now = nowIso();
    await db.prepare(`
      INSERT INTO marketing_campaigns (id, name, type, status, created_at, updated_at)
      VALUES (?, ?, 'push', 'draft', ?, ?)
    `).run("push-camp-2", "Unconfirmed Push", now, now);

    await app.close();
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
      oneSignalService: {
        isConfigured: () => true,
        sendToSegment: async () => {
          throw new Error("should not send");
        },
      },
    });
    adminToken = await loginAdmin();

    const response = await app.inject({
      method: "POST",
      url: "/admin/dashboard/marketing/campaigns/push-camp-2/send-push",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        title: "No send",
        body: "Missing confirmation",
        segments: ["All"],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /SEND_PUSH/);
  });
});

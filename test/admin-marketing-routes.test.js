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

async function seedColdEmailCampaign(db, overrides = {}) {
  const now = overrides.created_at || nowIso();
  const campaign = {
    id: "cold-route-campaign",
    campaign_tag: "cold-route",
    subject: "Cold route subject",
    template_html_path: "marketing/email/cold-intro.html",
    template_text_path: "marketing/email/cold-intro.txt",
    from_address: "Porizo <hello@porizo.app>",
    reply_to: "hello@porizo.app",
    per_day: 10,
    schedule_pace_seconds: 60,
    schedule_offset_minutes: 30,
    earliest_run_date_utc: "2026-06-01",
    fire_after_utc_hour: 9,
    active: 1,
    created_at: now,
    updated_at: now,
    ...overrides,
  };

  await db
    .prepare(
      `INSERT INTO cold_email_campaigns (
        id,
        campaign_tag,
        subject,
        template_html_path,
        template_text_path,
        from_address,
        reply_to,
        per_day,
        schedule_pace_seconds,
        schedule_offset_minutes,
        earliest_run_date_utc,
        fire_after_utc_hour,
        active,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      campaign.id,
      campaign.campaign_tag,
      campaign.subject,
      campaign.template_html_path,
      campaign.template_text_path,
      campaign.from_address,
      campaign.reply_to,
      campaign.per_day,
      campaign.schedule_pace_seconds,
      campaign.schedule_offset_minutes,
      campaign.earliest_run_date_utc,
      campaign.fire_after_utc_hour,
      campaign.active,
      campaign.created_at,
      campaign.updated_at,
    );

  return campaign;
}

async function seedColdEmailRecipient(db, { campaignId, indexPos, sentAt = null }) {
  await db
    .prepare(
      "INSERT INTO cold_email_recipients (campaign_id, index_pos, email, first_name, sent_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      campaignId,
      indexPos,
      `cold-${campaignId}-${indexPos}@example.com`,
      "Test",
      sentAt,
    );
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

  test("surfaces custom cold-email templates referenced by campaigns", async () => {
    await seedColdEmailCampaign(db, {
      id: "cold-custom-template",
      template_html_path: "marketing/email/custom-route.html",
      template_text_path: "marketing/email/custom-route.txt",
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/marketing/email-templates",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 200, response.body);
    const custom = response
      .json()
      .cold_email_templates.find((template) => template.id === "custom:custom-route.html");
    assert.ok(custom);
    assert.equal(custom.custom, true);
    assert.equal(custom.file, "custom-route.html");
  });

  test("loads every allowlisted nurture template from the runtime directory", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/marketing/email-templates",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 200, response.body);
    const templates = response.json().templates;
    assert.deepEqual(
      templates.map((template) => template.id),
      ["email-1-introduction", "email-2-social-proof", "email-3-final-nudge"],
    );
    assert.ok(templates.every((template) => template.html && !template.error));
  });

  test("lists all cold-email campaigns while preserving active pending_count behavior", async () => {
    await seedColdEmailCampaign(db, {
      id: "cold-active",
      active: 1,
      created_at: "2026-06-27T10:00:00.000Z",
      updated_at: "2026-06-27T10:00:00.000Z",
    });
    await seedColdEmailCampaign(db, {
      id: "cold-inactive",
      active: 0,
      created_at: "2026-06-27T11:00:00.000Z",
      updated_at: "2026-06-27T11:00:00.000Z",
    });
    await seedColdEmailRecipient(db, { campaignId: "cold-active", indexPos: 0 });
    await seedColdEmailRecipient(db, { campaignId: "cold-active", indexPos: 1 });
    await seedColdEmailRecipient(db, { campaignId: "cold-inactive", indexPos: 0 });

    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard/marketing/cold-email",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(response.statusCode, 200, response.body);
    const campaigns = response.json().campaigns;
    assert.deepEqual(
      campaigns.map((campaign) => campaign.id),
      ["cold-inactive", "cold-active"],
    );
    assert.equal(
      campaigns.find((campaign) => campaign.id === "cold-active").pending_count,
      2,
    );
    assert.equal(
      campaigns.find((campaign) => campaign.id === "cold-inactive").pending_count,
      0,
    );
  });

  test("patches cold-email campaigns with optimistic concurrency and audit metadata", async () => {
    await seedColdEmailCampaign(db, {
      id: "cold-patch",
      subject: "Original subject",
      per_day: 10,
      earliest_run_date_utc: "2026-06-01",
      updated_at: "2026-06-27T10:00:00.000Z",
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/dashboard/marketing/cold-email/cold-patch",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "If-Match": "2026-06-27T10:00:00.000Z",
      },
      payload: {
        subject: "Updated subject",
        per_day: 7,
        earliest_run_date_utc: null,
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    const campaign = response.json().campaign;
    assert.equal(campaign.subject, "Updated subject");
    assert.equal(campaign.per_day, 7);
    assert.equal(campaign.earliest_run_date_utc, null);
    assert.notEqual(campaign.updated_at, "2026-06-27T10:00:00.000Z");

    const audit = await db
      .prepare(
        "SELECT resource_type, metadata_json FROM audit_logs WHERE action = ? AND resource_id = ?",
      )
      .get("cold_email_campaign_update", "cold-patch");
    assert.equal(audit.resource_type, "cold_email_campaigns");
    const metadata = JSON.parse(audit.metadata_json);
    assert.deepEqual(metadata.before, {
      subject: "Original subject",
      per_day: 10,
      earliest_run_date_utc: "2026-06-01",
    });
    assert.deepEqual(metadata.after, {
      subject: "Updated subject",
      per_day: 7,
      earliest_run_date_utc: null,
    });
  });

  test("rejects stale cold-email PATCH without mutating the campaign", async () => {
    await seedColdEmailCampaign(db, {
      id: "cold-stale",
      subject: "Original subject",
      updated_at: "2026-06-27T10:00:00.000Z",
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/dashboard/marketing/cold-email/cold-stale",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "If-Match": "2026-06-27T09:59:00.000Z",
      },
      payload: { subject: "Stale subject" },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error, "STALE_UPDATE");
    const row = await db
      .prepare("SELECT subject, updated_at FROM cold_email_campaigns WHERE id = ?")
      .get("cold-stale");
    assert.deepEqual(row, {
      subject: "Original subject",
      updated_at: "2026-06-27T10:00:00.000Z",
    });
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

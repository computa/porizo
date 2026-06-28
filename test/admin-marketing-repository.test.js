process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createAdminMarketingRepository,
} = require("../src/database/admin-marketing-repository");

describe("AdminMarketingRepository", () => {
  let db;
  let repo;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repo = createAdminMarketingRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("importContactsTransaction dedupes by email and company/website", async () => {
    const now = "2026-06-27T00:00:00.000Z";
    const result = await repo.importContactsTransaction({
      now,
      rows: [
        {
          id: "contact-1",
          firstName: "Ada",
          lastName: "Lovelace",
          companyName: "Ada Co",
          website: "https://ada.example",
          description: null,
          contactName: "Ada Lovelace",
          email: "ada@example.com",
          category: "founder",
          score: 10,
          icpFitReasoning: null,
          audienceReach: null,
          partnershipOpportunity: null,
          contactApproach: null,
          sourceFile: "contacts.csv",
        },
        {
          id: "contact-2",
          firstName: "Ada",
          lastName: "Duplicate",
          companyName: "Other Co",
          website: null,
          description: null,
          contactName: "Ada Duplicate",
          email: "ada@example.com",
          category: null,
          score: 0,
          icpFitReasoning: null,
          audienceReach: null,
          partnershipOpportunity: null,
          contactApproach: null,
          sourceFile: "contacts.csv",
        },
        {
          id: "contact-3",
          firstName: null,
          lastName: null,
          companyName: "Legacy Co",
          website: null,
          description: null,
          contactName: null,
          email: null,
          category: "partner",
          score: 5,
          icpFitReasoning: null,
          audienceReach: null,
          partnershipOpportunity: null,
          contactApproach: null,
          sourceFile: "contacts.csv",
        },
        {
          id: "contact-4",
          firstName: null,
          lastName: null,
          companyName: "Legacy Co",
          website: null,
          description: null,
          contactName: null,
          email: null,
          category: "partner",
          score: 5,
          icpFitReasoning: null,
          audienceReach: null,
          partnershipOpportunity: null,
          contactApproach: null,
          sourceFile: "contacts.csv",
        },
        {
          id: "contact-5",
          firstName: null,
          lastName: null,
          companyName: null,
          website: null,
          description: null,
          contactName: null,
          email: null,
          category: null,
          score: 0,
          icpFitReasoning: null,
          audienceReach: null,
          partnershipOpportunity: null,
          contactApproach: null,
          sourceFile: "contacts.csv",
        },
      ],
    });

    assert.deepEqual(result, { inserted: 2, skipped: 3 });

    const rows = await db
      .prepare("SELECT id, email, company_name, status FROM marketing_contacts ORDER BY id")
      .all();
    assert.deepEqual(rows, [
      {
        id: "contact-1",
        email: "ada@example.com",
        company_name: "Ada Co",
        status: "active",
      },
      {
        id: "contact-3",
        email: null,
        company_name: "Legacy Co",
        status: "active",
      },
    ]);
  });

  test("importCampaignEngagementsTransaction additive-merges and recalculates campaign stats", async () => {
    const now = "2026-06-27T00:00:00.000Z";
    await db
      .prepare(
        "INSERT INTO marketing_campaigns (id, name, type, status, created_at, updated_at) VALUES (?, ?, 'email', 'sent', ?, ?)",
      )
      .run("camp-1", "Launch", now, now);
    await db
      .prepare(
        `INSERT INTO marketing_contacts (
          id, first_name, last_name, email, company_name, status, created_at, updated_at
        ) VALUES
          (?, ?, ?, ?, ?, 'active', ?, ?),
          (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        "contact-1",
        "Ada",
        "Active",
        "ada@example.com",
        "Ada Co",
        now,
        now,
        "contact-2",
        "Uma",
        "Active",
        "uma@example.com",
        "Uma Co",
        now,
        now,
      );
    await db
      .prepare(
        `INSERT INTO marketing_engagements (
          id, contact_id, campaign_id, opened, clicked, replied, bounced,
          unsubscribed, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 0, 0, 0, 0, ?, ?)`,
      )
      .run("eng-existing", "contact-1", "camp-1", now, now);

    const result = await repo.importCampaignEngagementsTransaction({
      campaignId: "camp-1",
      now,
      rows: [
        {
          id: "eng-1",
          email: "ada@example.com",
          opened: 0,
          clicked: 1,
          replied: 0,
          bounced: 1,
          unsubscribed: 0,
        },
        {
          id: "eng-2",
          email: "uma@example.com",
          opened: 0,
          clicked: 0,
          replied: 0,
          bounced: 0,
          unsubscribed: 1,
        },
        {
          id: "eng-3",
          email: "missing@example.com",
          opened: 1,
          clicked: 1,
          replied: 1,
          bounced: 0,
          unsubscribed: 0,
        },
        {
          id: "eng-4",
          email: null,
          opened: 1,
          clicked: 0,
          replied: 0,
          bounced: 0,
          unsubscribed: 0,
        },
      ],
    });

    assert.deepEqual(result, {
      matched: 2,
      skippedUnknown: 2,
      bouncedCount: 1,
      unsubscribedCount: 1,
    });

    const contacts = await db
      .prepare("SELECT id, status FROM marketing_contacts ORDER BY id")
      .all();
    assert.deepEqual(contacts, [
      { id: "contact-1", status: "bounced" },
      { id: "contact-2", status: "unsubscribed" },
    ]);

    const engagements = await db
      .prepare(
        "SELECT contact_id, opened, clicked, bounced, unsubscribed FROM marketing_engagements ORDER BY contact_id",
      )
      .all();
    assert.deepEqual(engagements, [
      {
        contact_id: "contact-1",
        opened: 1,
        clicked: 1,
        bounced: 1,
        unsubscribed: 0,
      },
      {
        contact_id: "contact-2",
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 1,
      },
    ]);

    const campaign = await db
      .prepare(
        "SELECT recipient_count, opens, clicks, bounces, unsubscribes FROM marketing_campaigns WHERE id = ?",
      )
      .get("camp-1");
    assert.deepEqual(campaign, {
      recipient_count: 2,
      opens: 1,
      clicks: 1,
      bounces: 1,
      unsubscribes: 1,
    });
  });

  test("recordPushSend inserts the notification row and marks the campaign sent", async () => {
    const now = "2026-06-27T00:00:00.000Z";
    await db
      .prepare(
        "INSERT INTO marketing_campaigns (id, name, type, status, created_at, updated_at) VALUES (?, ?, 'push', 'draft', ?, ?)",
      )
      .run("push-1", "Welcome Push", now, now);

    const updated = await repo.recordPushSend({
      pushCampaignId: "push-row-1",
      campaignId: "push-1",
      campaignName: "Welcome Push",
      targetLabel: "All",
      title: "Make a song",
      body: "Turn a memory into music.",
      dataJson: JSON.stringify({ campaign_id: "push-1" }),
      imageUrl: null,
      notificationId: "os-1",
      sentAt: now,
      recipients: 7,
    });

    assert.equal(updated.status, "sent");
    assert.equal(updated.recipient_count, 7);

    const push = await db
      .prepare(
        "SELECT name, segment, onesignal_notification_id, recipients_count FROM push_campaigns WHERE id = ?",
      )
      .get("push-row-1");
    assert.deepEqual(push, {
      name: "Welcome Push",
      segment: "All",
      onesignal_notification_id: "os-1",
      recipients_count: 7,
    });
  });
});

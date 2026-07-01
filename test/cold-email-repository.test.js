const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createColdEmailRepository } = require("../src/database/cold-email-repository");

let db;
let repository;

async function seedCampaign(overrides = {}) {
  const campaign = {
    id: "repo-campaign",
    campaign_tag: "repo-cohort",
    subject: "Repo subject",
    template_html_path: "marketing/email/repo.html",
    template_text_path: "marketing/email/repo.txt",
    from_address: "Repo <repo@example.com>",
    reply_to: "reply@example.com",
    per_day: 3,
    schedule_pace_seconds: 60,
    schedule_offset_minutes: 30,
    earliest_run_date_utc: "2026-05-01",
    fire_after_utc_hour: 9,
    active: 1,
    started_at: null,
    last_run_at: null,
    last_run_date_utc: null,
    created_at: "2026-05-13T08:00:00.000Z",
    updated_at: "2026-05-13T08:00:00.000Z",
    ...overrides,
  };

  await db.prepare(`
    INSERT INTO cold_email_campaigns (
      id, campaign_tag, subject, template_html_path, template_text_path,
      from_address, reply_to, per_day, schedule_pace_seconds,
      schedule_offset_minutes, earliest_run_date_utc, fire_after_utc_hour, active,
      started_at, last_run_at, last_run_date_utc, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    campaign.started_at,
    campaign.last_run_at,
    campaign.last_run_date_utc,
    campaign.created_at,
    campaign.updated_at,
  );

  return campaign;
}

async function seedRecipient(indexPos, email, firstName = "Test", sentAt = null) {
  await db
    .prepare(
      "INSERT INTO cold_email_recipients (campaign_id, index_pos, email, first_name, sent_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run("repo-campaign", indexPos, email, firstName, sentAt);
}

describe("cold-email repository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createColdEmailRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("loadCampaign normalizes active flag and counts unsent recipients", async () => {
    await seedCampaign({ active: 1 });
    await seedRecipient(0, "a@example.com");
    await seedRecipient(1, "b@example.com", "B", "2026-05-13T10:00:00.000Z");
    await seedRecipient(2, "c@example.com");

    const campaign = await repository.loadCampaign("repo-campaign");

    assert.equal(campaign.active, 1);
    assert.equal(campaign.pending_count, 2);
  });

  test("listActiveCampaigns returns active campaigns with pending counts only", async () => {
    await seedCampaign();
    await seedRecipient(0, "a@example.com");
    await seedCampaign({ id: "inactive-campaign", active: 0 });

    const campaigns = await repository.listActiveCampaigns();

    assert.deepEqual(
      campaigns.map((campaign) => campaign.id),
      ["repo-campaign"],
    );
    assert.equal(campaigns[0].pending_count, 1);
  });

  test("listAllCampaigns returns every campaign ordered by created_at descending", async () => {
    await seedCampaign({
      id: "campaign_old",
      created_at: "2026-05-13T09:00:00.000Z",
    });
    await seedCampaign({
      id: "campaign_new",
      created_at: "2026-05-13T10:00:00.000Z",
      active: 0,
    });

    const campaigns = await repository.listAllCampaigns();

    assert.deepEqual(
      campaigns.map((campaign) => campaign.id),
      ["campaign_new", "campaign_old"],
    );
  });

  test("listTemplateReferences returns distinct campaign template paths", async () => {
    await seedCampaign({
      id: "campaign_template_a",
      template_html_path: "marketing/email/custom-a.html",
      template_text_path: "marketing/email/custom-a.txt",
    });
    await seedCampaign({
      id: "campaign_template_b",
      template_html_path: "marketing/email/custom-a.html",
      template_text_path: "marketing/email/custom-a.txt",
    });
    await seedCampaign({
      id: "campaign_template_c",
      template_html_path: "marketing/email/custom-c.html",
      template_text_path: "marketing/email/custom-c.txt",
    });

    const refs = await repository.listTemplateReferences();

    assert.deepEqual(refs, [
      {
        html_path: "marketing/email/custom-a.html",
        text_path: "marketing/email/custom-a.txt",
      },
      {
        html_path: "marketing/email/custom-c.html",
        text_path: "marketing/email/custom-c.txt",
      },
    ]);
  });

  test("listPendingRecipients skips sent rows and unsubscribed users case-insensitively", async () => {
    await seedCampaign();
    await seedRecipient(0, "alice@example.com", "Alice");
    await seedRecipient(1, "BOB@example.com", "Bob");
    await seedRecipient(2, "carol@example.com", "Carol", "2026-05-13T10:00:00.000Z");
    await db.prepare(
      "INSERT INTO users (id, email, unsubscribed_at, created_at, risk_level) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "user_bob",
      "bob@example.com",
      "2026-05-12T10:00:00.000Z",
      "2026-05-01T00:00:00.000Z",
      "low",
    );

    const rows = await repository.listPendingRecipients("repo-campaign", 10);

    assert.deepEqual(
      rows.map((row) => row.email),
      ["alice@example.com"],
    );
  });

  test("claimRunSlot enforces the interval gate and releaseRunSlot restores prior state", async () => {
    await seedCampaign({
      last_run_at: "2026-05-13T09:00:00.000Z",
      last_run_date_utc: "2026-05-13",
    });

    const blocked = await repository.claimRunSlot(
      "repo-campaign",
      "2026-05-13T09:30:00.000Z",
      "2026-05-13",
      60,
    );
    assert.equal(blocked, false);

    const claimed = await repository.claimRunSlot(
      "repo-campaign",
      "2026-05-13T10:00:00.000Z",
      "2026-05-13",
      60,
    );
    assert.equal(claimed, true);

    await repository.releaseRunSlot(
      "repo-campaign",
      "2026-05-13T09:00:00.000Z",
      "2026-05-13",
    );
    const row = await db
      .prepare("SELECT last_run_at, last_run_date_utc FROM cold_email_campaigns WHERE id = ?")
      .get("repo-campaign");
    assert.equal(row.last_run_at, "2026-05-13T09:00:00.000Z");
    assert.equal(row.last_run_date_utc, "2026-05-13");
  });

  test("markBatchSent updates only acked recipients and recordRunStats preserves started_at", async () => {
    await seedCampaign({ started_at: "2026-05-12T10:00:00.000Z" });
    await seedRecipient(0, "a@example.com");
    await seedRecipient(1, "b@example.com");
    await seedRecipient(2, "c@example.com");
    const rows = await repository.listPendingRecipients("repo-campaign", 3);
    const payload = rows.map((row, index) => ({
      scheduled_at: `2026-05-13T10:0${index}:00.000Z`,
    }));

    const sent = await repository.markBatchSent(
      "repo-campaign",
      rows,
      payload,
      { data: [{ id: "re_0" }, {}, { id: "re_2" }] },
      "2026-05-13T09:00:00.000Z",
    );
    await repository.recordRunStats(
      "repo-campaign",
      "2026-05-13T09:00:00.000Z",
      sent,
    );

    assert.equal(sent, 2);
    const recipients = await db
      .prepare("SELECT index_pos, resend_email_id FROM cold_email_recipients ORDER BY index_pos")
      .all();
    assert.deepEqual(
      recipients.map((row) => row.resend_email_id),
      ["re_0", null, "re_2"],
    );
    const campaign = await repository.loadCampaign("repo-campaign");
    assert.equal(campaign.started_at, "2026-05-12T10:00:00.000Z");
    assert.equal(campaign.last_batch_size, 2);
    assert.equal(campaign.total_queued, 2);
  });

  test("markBatchSent uses payload source_index_pos when invalid rows were filtered", async () => {
    await seedCampaign();
    await seedRecipient(0, "invalid");
    await seedRecipient(1, "valid@example.com");
    const rows = await db
      .prepare("SELECT * FROM cold_email_recipients WHERE campaign_id = ? ORDER BY index_pos")
      .all("repo-campaign");

    const sent = await repository.markBatchSent(
      "repo-campaign",
      rows,
      [{ source_index_pos: 1, scheduled_at: "2026-05-13T10:00:00.000Z" }],
      { data: [{ id: "re_valid" }] },
      "2026-05-13T09:00:00.000Z",
    );

    assert.equal(sent, 1);
    const recipients = await db
      .prepare("SELECT index_pos, resend_email_id FROM cold_email_recipients ORDER BY index_pos")
      .all();
    assert.deepEqual(
      recipients.map((row) => row.resend_email_id),
      [null, "re_valid"],
    );
  });

  test("updateCampaignFields updates whitelisted fields with optimistic concurrency", async () => {
    await seedCampaign({
      updated_at: "2026-05-13T08:00:00.000Z",
    });

    const changed = await repository.updateCampaignFields(
      "repo-campaign",
      {
        subject: "Updated subject",
        per_day: 7,
        earliest_run_date_utc: null,
      },
      "2026-05-13T08:00:00.000Z",
      "2026-05-13T09:00:00.000Z",
    );

    assert.equal(changed, true);
    const row = await db
      .prepare(
        "SELECT subject, per_day, earliest_run_date_utc, updated_at FROM cold_email_campaigns WHERE id = ?",
      )
      .get("repo-campaign");
    assert.deepEqual(row, {
      subject: "Updated subject",
      per_day: 7,
      earliest_run_date_utc: null,
      updated_at: "2026-05-13T09:00:00.000Z",
    });
  });

  test("updateCampaignFields returns false for stale expected updated_at", async () => {
    await seedCampaign({
      subject: "Original subject",
      updated_at: "2026-05-13T08:00:00.000Z",
    });

    const changed = await repository.updateCampaignFields(
      "repo-campaign",
      { subject: "Stale update" },
      "2026-05-13T07:59:00.000Z",
      "2026-05-13T09:00:00.000Z",
    );

    assert.equal(changed, false);
    const row = await db
      .prepare("SELECT subject, updated_at FROM cold_email_campaigns WHERE id = ?")
      .get("repo-campaign");
    assert.deepEqual(row, {
      subject: "Original subject",
      updated_at: "2026-05-13T08:00:00.000Z",
    });
  });

  test("updateCampaignFields rejects unsupported field names before SQL construction", async () => {
    await seedCampaign();

    await assert.rejects(
      () =>
        repository.updateCampaignFields(
          "repo-campaign",
          { "subject = 'bad' --": "Bad" },
          "2026-05-13T08:00:00.000Z",
          "2026-05-13T09:00:00.000Z",
        ),
      /unsupported cold-email campaign patch field/,
    );
  });
});

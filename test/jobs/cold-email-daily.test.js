/**
 * Integration tests for src/jobs/cold-email-daily.js
 * Uses in-memory SQLite + mocked Resend fetch.
 *
 * NOTE: the Postgres adapter's prepare().get/all/run is async; the SQLite
 * adapter is sync. The service code awaits every DB call (no-op on sync),
 * so these SQLite tests exercise the same code path that runs in Postgres
 * production.
 */

const path = require("node:path");
const fs = require("node:fs");
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { getDatabase } = require("../../src/database");
const { startColdEmailJob } = require("../../src/jobs/cold-email-daily");

let db;
let templatesRepoRelative;

async function seedCampaign(overrides = {}) {
  // Write tiny templates somewhere under the repo's templates root so the
  // service's safeTemplatePath sandbox lets them load. The fixture writes
  // to test/.tmp-cold/<unique>/ inside the repo, then computes a
  // marketing/email-relative symlink — except symlinks are brittle. Simpler
  // and equivalent: write the test templates directly under marketing/email/
  // with a unique-per-test name, and clean them up in afterEach.
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmpName = `test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(
    repoRoot,
    "marketing",
    "email",
    ".test-fixtures",
    tmpName,
  );
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, "cold-intro.html");
  const textPath = path.join(dir, "cold-intro.txt");
  fs.writeFileSync(htmlPath, "<p>Hi {{first_name}}</p>");
  fs.writeFileSync(textPath, "Hi {{first_name}}");
  templatesRepoRelative = {
    html: path.relative(repoRoot, htmlPath),
    text: path.relative(repoRoot, textPath),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };

  const campaign = {
    id: "test-campaign",
    campaign_tag: "test-cohort",
    subject: "Test subject",
    template_html_path: templatesRepoRelative.html,
    template_text_path: templatesRepoRelative.text,
    from_address: "Test <test@example.com>",
    reply_to: "test@example.com",
    per_day: 3,
    schedule_pace_seconds: 60,
    schedule_offset_minutes: 30,
    earliest_run_date_utc: "2026-05-01",
    fire_after_utc_hour: 9,
    active: 1,
    ...overrides,
  };

  await db
    .prepare(
      `INSERT INTO cold_email_campaigns
        (id, campaign_tag, subject, template_html_path, template_text_path,
         from_address, reply_to, per_day, schedule_pace_seconds,
         schedule_offset_minutes, earliest_run_date_utc, fire_after_utc_hour, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );

  const recipients = [
    [0, "alice@example.com", "Alice"],
    [1, "bob@example.com", "Bob"],
    [2, "carol@example.com", "Carol"],
    [3, "dave@example.com", "Dave"],
    [4, "eve@example.com", "Eve"],
  ];
  for (const [idx, email, first] of recipients) {
    await db
      .prepare(
        "INSERT INTO cold_email_recipients (campaign_id, index_pos, email, first_name) VALUES (?, ?, ?, ?)",
      )
      .run(campaign.id, idx, email, first);
  }
  return campaign;
}

function mockResendFetch({ ok = true, status = 200, ids, body } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const payload = JSON.parse(init.body);
    const data =
      body !== undefined
        ? body
        : payload.map((_, i) => ({ id: ids ? ids[i] : `re_${i}` }));
    return {
      ok,
      status,
      json: async () => (body !== undefined ? body : { data }),
      text: async () => (ok ? "" : "mocked failure"),
    };
  };
  return { fetchImpl, calls };
}

describe("cold-email-daily job", () => {
  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
  });

  afterEach(async () => {
    if (templatesRepoRelative?.cleanup) templatesRepoRelative.cleanup();
    if (db?.close) await db.close();
  });

  it("fires once and marks the per_day batch as sent with correct ids and scheduled_at", async () => {
    await seedCampaign();
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const result = await job.runNow();
    job.stop();

    assert.equal(calls.length, 1, "exactly one batch HTTP call");
    const sentRows = await db
      .prepare(
        "SELECT index_pos, email, resend_email_id, scheduled_at FROM cold_email_recipients WHERE sent_at IS NOT NULL ORDER BY index_pos",
      )
      .all();
    assert.equal(sentRows.length, 3, "per_day = 3 rows marked sent");
    assert.deepEqual(
      sentRows.map((r) => r.index_pos),
      [0, 1, 2],
      "lowest index_pos rows sent first",
    );
    assert.equal(sentRows[0].resend_email_id, "re_0");
    assert.equal(sentRows[1].resend_email_id, "re_1");
    assert.equal(sentRows[2].resend_email_id, "re_2");
    // Offset 30 min, pace 60s → 10:30:00, 10:31:00, 10:32:00
    assert.equal(sentRows[0].scheduled_at, "2026-05-13T10:30:00.000Z");
    assert.equal(sentRows[1].scheduled_at, "2026-05-13T10:31:00.000Z");
    assert.equal(sentRows[2].scheduled_at, "2026-05-13T10:32:00.000Z");
    assert.equal(result.campaigns[0].fired, true);
    assert.equal(result.campaigns[0].queued, 3);

    const camp = await db
      .prepare("SELECT * FROM cold_email_campaigns WHERE id = ?")
      .get("test-campaign");
    assert.equal(camp.last_run_date_utc, "2026-05-13");
    assert.equal(camp.last_batch_size, 3);
    assert.equal(camp.total_queued, 3);
  });

  it("does NOT fire twice on the same UTC day (atomic claim)", async () => {
    await seedCampaign();
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    await job.runNow();
    const second = await job.runNow();
    job.stop();

    assert.equal(
      calls.length,
      1,
      "only one HTTP call across two sequential runs",
    );
    assert.equal(second.campaigns[0].fired, false);
  });

  it("atomic claim prevents double-fire when two processCampaign calls race (simulates multi-replica)", async () => {
    // The job module's isRunning guard handles same-process re-entry, but
    // multi-replica races bypass it. Simulate by calling the service directly
    // twice in parallel and assert the DB-level claim wins exactly once.
    await seedCampaign();
    const svc = require("../../src/services/cold-email-service");
    const { fetchImpl, calls } = mockResendFetch();
    const campaign = await svc.loadCampaign(db, "test-campaign");
    const [r1, r2] = await Promise.allSettled([
      svc.processCampaign(db, campaign, {
        apiKey: "re_test",
        now: new Date("2026-05-13T10:00:00Z"),
        fetchImpl,
        log: () => {},
      }),
      svc.processCampaign(db, campaign, {
        apiKey: "re_test",
        now: new Date("2026-05-13T10:00:00Z"),
        fetchImpl,
        log: () => {},
      }),
    ]);
    const results = [r1, r2].map((p) =>
      p.status === "fulfilled" ? p.value : { error: p.reason.message },
    );
    const fired = results.filter((r) => r.fired === true).length;
    assert.equal(
      fired,
      1,
      "exactly one of the two concurrent calls actually fired",
    );
    assert.equal(calls.length, 1, "only one Resend HTTP call");
  });

  it("does not fire before fire_after_utc_hour", async () => {
    await seedCampaign({ fire_after_utc_hour: 12 });
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(calls.length, 0);
    assert.equal(r.campaigns[0].fired, false);
  });

  it("skips already-sent rows on subsequent days", async () => {
    await seedCampaign();
    await db
      .prepare(
        "UPDATE cold_email_recipients SET sent_at = '2026-05-12T10:00:00Z', resend_email_id = 'pre' WHERE campaign_id = ? AND index_pos IN (0, 1)",
      )
      .run("test-campaign");

    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    await job.runNow();
    job.stop();

    const sent = await db
      .prepare(
        "SELECT index_pos FROM cold_email_recipients WHERE sent_at IS NOT NULL ORDER BY index_pos",
      )
      .all();
    assert.deepEqual(
      sent.map((r) => r.index_pos),
      [0, 1, 2, 3, 4],
    );
    assert.equal(calls.length, 1);
  });

  it("declines to start without RESEND_API_KEY (returns no-op handle)", async () => {
    await seedCampaign();
    const job = startColdEmailJob({
      db,
      apiKey: "",
      intervalMs: 1_000_000,
      log: () => {},
    });
    const r = await job.runNow();
    assert.equal(r.skipped, true);
    job.stop();
  });

  it("does not advance state if Resend rejects (state rolled back)", async () => {
    await seedCampaign();
    const fetchImpl = async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    });
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(r.campaigns[0].fired, false);
    assert.match(r.campaigns[0].error, /Resend batch failed/);
    const sent = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM cold_email_recipients WHERE sent_at IS NOT NULL",
      )
      .get();
    assert.equal(sent.n, 0, "no rows marked sent on Resend failure");
    const camp = await db
      .prepare("SELECT * FROM cold_email_campaigns WHERE id = ?")
      .get("test-campaign");
    assert.equal(camp.last_run_date_utc, null, "last_run_date_utc rolled back");
    assert.equal(camp.last_batch_size, null);
    assert.equal(camp.total_queued, 0);
  });

  it("Resend returns empty data array → treated as failure, state rolled back", async () => {
    await seedCampaign();
    const { fetchImpl } = mockResendFetch({ body: { data: [] } });
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(r.campaigns[0].fired, false);
    assert.match(r.campaigns[0].error, /no usable email ids/i);
    const camp = await db
      .prepare(
        "SELECT last_run_date_utc, total_queued FROM cold_email_campaigns WHERE id = ?",
      )
      .get("test-campaign");
    assert.equal(camp.last_run_date_utc, null, "rolled back on empty data");
    assert.equal(camp.total_queued, 0);
  });

  it("partial Resend response (some ids missing) marks only acked rows, advances state by acked count", async () => {
    await seedCampaign();
    // 3 rows expected; Resend returns 3 entries but middle one has null id
    const { fetchImpl, calls } = mockResendFetch({
      ids: ["re_0", null, "re_2"],
    });
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(calls.length, 1);
    assert.equal(r.campaigns[0].fired, true);
    assert.equal(r.campaigns[0].queued, 2);
    assert.equal(r.campaigns[0].attempted, 3);
    const rows = await db
      .prepare(
        "SELECT index_pos, sent_at FROM cold_email_recipients WHERE campaign_id = ? ORDER BY index_pos",
      )
      .all("test-campaign");
    assert.equal(rows[0].sent_at !== null, true, "row 0 sent");
    assert.equal(rows[1].sent_at, null, "row 1 still pending");
    assert.equal(rows[2].sent_at !== null, true, "row 2 sent");
  });

  it("missing template file rolls back state with structured error", async () => {
    await seedCampaign();
    // Delete the html template before runNow
    templatesRepoRelative.cleanup();
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(calls.length, 0, "Resend never called");
    assert.equal(r.campaigns[0].fired, false);
    assert.match(r.campaigns[0].error, /ENOENT|no such file/i);
    const camp = await db
      .prepare(
        "SELECT last_run_date_utc FROM cold_email_campaigns WHERE id = ?",
      )
      .get("test-campaign");
    assert.equal(camp.last_run_date_utc, null);
  });

  it("path-traversal template_html_path is rejected by safeTemplatePath", async () => {
    await seedCampaign({ template_html_path: "../../.env" });
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(calls.length, 0);
    assert.equal(r.campaigns[0].fired, false);
    assert.match(r.campaigns[0].error, /escapes templates root/i);
  });

  it("per_day > Resend batch limit (100) throws and rolls back", async () => {
    await seedCampaign({ per_day: 150 });
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(calls.length, 0);
    assert.equal(r.campaigns[0].fired, false);
    assert.match(r.campaigns[0].error, /exceeds Resend batch limit/);
  });

  it("payload empty (all invalid emails) rolls back state", async () => {
    await seedCampaign();
    await db
      .prepare(
        "UPDATE cold_email_recipients SET email = 'invalid' WHERE campaign_id = ?",
      )
      .run("test-campaign");
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(calls.length, 0);
    assert.equal(r.campaigns[0].fired, false);
    assert.equal(r.campaigns[0].reason, "payload empty");
    const camp = await db
      .prepare(
        "SELECT last_run_date_utc FROM cold_email_campaigns WHERE id = ?",
      )
      .get("test-campaign");
    assert.equal(camp.last_run_date_utc, null);
  });

  it("inactive campaign is filtered out by listActiveCampaigns", async () => {
    await seedCampaign({ active: 0 });
    const { fetchImpl, calls } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    const r = await job.runNow();
    job.stop();
    assert.equal(calls.length, 0);
    assert.deepEqual(r.campaigns, [], "no active campaigns returned");
  });

  it("started_at is preserved across runs (COALESCE semantics)", async () => {
    await seedCampaign();
    const { fetchImpl } = mockResendFetch();
    const job = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-13T10:00:00Z"),
      log: () => {},
    });
    await job.runNow();
    const day1 = await db
      .prepare("SELECT started_at FROM cold_email_campaigns WHERE id = ?")
      .get("test-campaign");
    job.stop();
    assert.ok(day1.started_at, "started_at set after first run");

    // Second fixture day with same db, mimicking next-day fire
    // First, add a couple more recipients so pending > 0
    await db
      .prepare(
        "INSERT INTO cold_email_recipients (campaign_id, index_pos, email, first_name) VALUES (?, ?, ?, ?)",
      )
      .run("test-campaign", 5, "frank@example.com", "Frank");
    await db
      .prepare(
        "INSERT INTO cold_email_recipients (campaign_id, index_pos, email, first_name) VALUES (?, ?, ?, ?)",
      )
      .run("test-campaign", 6, "gina@example.com", "Gina");

    const job2 = startColdEmailJob({
      db,
      apiKey: "re_test",
      intervalMs: 1_000_000,
      fetchImpl,
      now: () => new Date("2026-05-14T10:00:00Z"),
      log: () => {},
    });
    await job2.runNow();
    job2.stop();
    const day2 = await db
      .prepare(
        "SELECT started_at, last_run_at FROM cold_email_campaigns WHERE id = ?",
      )
      .get("test-campaign");
    assert.equal(
      day2.started_at,
      day1.started_at,
      "started_at unchanged on later runs",
    );
    assert.ok(day2.last_run_at > day1.started_at, "last_run_at advances");
  });
});

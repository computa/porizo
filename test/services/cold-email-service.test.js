/**
 * Tests for src/services/cold-email-service.js
 * Focus on pure decision logic (shouldFireToday) and payload-building.
 * No live Resend calls; the HTTP submit is exercised separately via mocked fetch.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const svc = require("../../src/services/cold-email-service");

const baseCampaign = (over = {}) => ({
  id: "mothers-day-2026",
  campaign_tag: "cold-intro-day2plus",
  subject: "A song from one memory",
  template_html_path: "marketing/email/cold-intro.html",
  template_text_path: "marketing/email/cold-intro.txt",
  from_address: "Ambrose from Porizo <support@porizo.co>",
  reply_to: "support@porizo.co",
  per_day: 80,
  schedule_pace_seconds: 270,
  schedule_offset_minutes: 60,
  earliest_run_date_utc: "2026-05-11",
  fire_after_utc_hour: 9,
  active: 1,
  started_at: "2026-05-11T01:00:07Z",
  last_run_at: "2026-05-12T01:00:06Z",
  last_run_date_utc: "2026-05-12",
  last_batch_size: 80,
  total_queued: 160,
  pending_count: 4240,
  ...over,
});

describe("cold-email-service · shouldFireNow", () => {
  it("fires when all gates are clear", () => {
    const now = new Date("2026-05-13T09:30:00Z");
    const r = svc.shouldFireNow(baseCampaign(), now);
    assert.equal(r.fire, true, r.reason);
  });

  it("skips when campaign is inactive", () => {
    const now = new Date("2026-05-13T09:30:00Z");
    const r = svc.shouldFireNow(baseCampaign({ active: 0 }), now);
    assert.equal(r.fire, false);
    assert.match(r.reason, /inactive/);
  });

  it("skips when today is before earliest_run_date_utc", () => {
    const now = new Date("2026-05-10T09:30:00Z");
    const r = svc.shouldFireNow(baseCampaign(), now);
    assert.equal(r.fire, false);
    assert.match(r.reason, /too early/i);
  });

  it("skips when current hour is before fire_after_utc_hour", () => {
    const now = new Date("2026-05-13T08:30:00Z");
    const r = svc.shouldFireNow(baseCampaign(), now);
    assert.equal(r.fire, false);
    assert.match(r.reason, /before .* hour/i);
  });

  it("skips when current hour >= fire_until_utc_hour", () => {
    const now = new Date("2026-05-13T19:00:00Z");
    const r = svc.shouldFireNow(baseCampaign({ fire_until_utc_hour: 19 }), now);
    assert.equal(r.fire, false);
    assert.match(r.reason, /after .* hour/i);
  });

  it("skips when interval has not elapsed since last_run_at", () => {
    const now = new Date("2026-05-13T10:00:00Z");
    const r = svc.shouldFireNow(
      baseCampaign({
        last_run_at: "2026-05-13T09:30:00Z",
        min_minutes_between_runs: 60,
      }),
      now,
    );
    assert.equal(r.fire, false);
    assert.match(r.reason, /interval not elapsed/i);
  });

  it("fires when interval has fully elapsed since last_run_at", () => {
    const now = new Date("2026-05-13T11:00:00Z");
    const r = svc.shouldFireNow(
      baseCampaign({
        last_run_at: "2026-05-13T09:30:00Z",
        min_minutes_between_runs: 60,
      }),
      now,
    );
    assert.equal(r.fire, true, r.reason);
  });

  it("fires when last_run_at is null (never fired)", () => {
    const now = new Date("2026-05-13T09:30:00Z");
    const r = svc.shouldFireNow(
      baseCampaign({
        last_run_at: null,
        last_run_date_utc: null,
        min_minutes_between_runs: 60,
      }),
      now,
    );
    assert.equal(r.fire, true, r.reason);
  });

  it("allows a second fire on the same UTC day once interval has elapsed", () => {
    // Default 1×/day campaigns have min_minutes_between_runs=1440, which
    // naturally blocks same-day re-fires. Campaigns that opt into intraday
    // cadence by setting min_minutes_between_runs=60 fire as soon as the
    // gap is met, ignoring last_run_date_utc.
    const now = new Date("2026-05-13T10:30:00Z");
    const r = svc.shouldFireNow(
      baseCampaign({
        last_run_at: "2026-05-13T09:30:00Z",
        last_run_date_utc: "2026-05-13", // same day as `now`
        min_minutes_between_runs: 60,
      }),
      now,
    );
    assert.equal(r.fire, true, r.reason);
  });

  it("skips when no pending recipients", () => {
    const now = new Date("2026-05-13T09:30:00Z");
    const r = svc.shouldFireNow(baseCampaign({ pending_count: 0 }), now);
    assert.equal(r.fire, false);
    assert.match(r.reason, /no pending/i);
  });

  it("fires exactly at fire_after_utc_hour", () => {
    const now = new Date("2026-05-13T09:00:00Z");
    const r = svc.shouldFireNow(baseCampaign(), now);
    assert.equal(r.fire, true);
  });

  it("default min_minutes_between_runs (1440) blocks a 12h-old fire", () => {
    // Legacy 1×/day campaigns: with no min_minutes_between_runs override,
    // a fire that ran 12h ago is still inside the 24h window and gated.
    const now = new Date("2026-05-13T09:30:00Z");
    const r = svc.shouldFireNow(
      baseCampaign({
        last_run_at: "2026-05-12T21:30:00Z",
        min_minutes_between_runs: 1440,
      }),
      now,
    );
    assert.equal(r.fire, false);
    assert.match(r.reason, /interval not elapsed/i);
  });

  it("shouldFireToday is a backwards-compatible alias for shouldFireNow", () => {
    assert.equal(svc.shouldFireToday, svc.shouldFireNow);
  });
});

describe("cold-email-service · buildResendPayload", () => {
  const fixtureRows = [
    {
      campaign_id: "c1",
      index_pos: 0,
      email: "alice@example.com",
      first_name: "Alice",
    },
    {
      campaign_id: "c1",
      index_pos: 1,
      email: "bob@example.com",
      first_name: "Bob",
    },
    {
      campaign_id: "c1",
      index_pos: 2,
      email: "carol@example.com",
      first_name: "Carol",
    },
  ];
  const opts = {
    campaign: baseCampaign(),
    htmlTemplate: "<p>Hi {{first_name}}, this is a song</p>",
    textTemplate: "Hi {{first_name}}",
    scheduleStart: new Date("2026-05-13T10:00:00Z"),
  };

  it("returns one payload entry per row", () => {
    const p = svc.buildResendPayload(fixtureRows, opts);
    assert.equal(p.length, 3);
  });

  it("substitutes first_name in html + text templates", () => {
    const p = svc.buildResendPayload(fixtureRows, opts);
    assert.match(p[0].html, /Hi Alice,/);
    assert.match(p[0].text, /Hi Alice/);
    assert.match(p[1].html, /Hi Bob,/);
  });

  it("paces scheduled_at by schedule_pace_seconds between rows", () => {
    const p = svc.buildResendPayload(fixtureRows, opts);
    const t0 = new Date(p[0].scheduled_at).getTime();
    const t1 = new Date(p[1].scheduled_at).getTime();
    const t2 = new Date(p[2].scheduled_at).getTime();
    assert.equal(t1 - t0, 270 * 1000);
    assert.equal(t2 - t1, 270 * 1000);
  });

  it("first scheduled_at equals scheduleStart", () => {
    const p = svc.buildResendPayload(fixtureRows, opts);
    assert.equal(
      new Date(p[0].scheduled_at).toISOString(),
      "2026-05-13T10:00:00.000Z",
    );
  });

  it("includes campaign tag and cohort tag", () => {
    const p = svc.buildResendPayload(fixtureRows, opts);
    const cohort = p[0].tags.find((t) => t.name === "cohort");
    assert.equal(cohort.value, "cold-intro-day2plus");
  });

  it("uses campaign from_address and reply_to", () => {
    const p = svc.buildResendPayload(fixtureRows, opts);
    assert.equal(p[0].from, "Ambrose from Porizo <support@porizo.co>");
    assert.equal(p[0].reply_to, "support@porizo.co");
  });

  it("substitutes {{campaign}} with campaign.id (UTM attribution)", () => {
    // /download?utm_campaign={{campaign}} must resolve to the real
    // campaign id so download_events.utm_campaign correctly attributes
    // the click.
    const utmHtml =
      '<a href="https://porizo.co/download?utm_campaign={{campaign}}&utm_content=cold-intro">Get it</a>';
    const utmText =
      "Get it: https://porizo.co/download?utm_campaign={{campaign}}&utm_content=cold-intro";
    const p = svc.buildResendPayload(fixtureRows, {
      ...opts,
      htmlTemplate: utmHtml,
      textTemplate: utmText,
    });
    assert.match(p[0].html, /utm_campaign=mothers-day-2026/);
    assert.match(p[0].text, /utm_campaign=mothers-day-2026/);
    assert.doesNotMatch(p[0].html, /\{\{campaign\}\}/);
    assert.doesNotMatch(p[0].text, /\{\{campaign\}\}/);
  });

  it("skips rows with missing or invalid email", () => {
    const rows = [
      {
        campaign_id: "c1",
        index_pos: 0,
        email: "ok@example.com",
        first_name: "A",
      },
      { campaign_id: "c1", index_pos: 1, email: "", first_name: "B" },
      { campaign_id: "c1", index_pos: 2, email: "noatsign", first_name: "C" },
      {
        campaign_id: "c1",
        index_pos: 3,
        email: "fine@example.com",
        first_name: "D",
      },
    ];
    const p = svc.buildResendPayload(rows, opts);
    assert.equal(p.length, 2);
    assert.equal(p[0].to[0], "ok@example.com");
    assert.equal(p[1].to[0], "fine@example.com");
  });
});

describe("cold-email-service · computeScheduleStart", () => {
  it("returns now + offset_minutes", () => {
    const now = new Date("2026-05-13T09:30:00Z");
    const start = svc.computeScheduleStart(now, 60);
    assert.equal(start.toISOString(), "2026-05-13T10:30:00.000Z");
  });
});

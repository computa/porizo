process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { createAttributionRepository } = require("../src/database/attribution-repository");

let db;
let repository;

async function seedUser({
  id,
  createdAt = "2026-04-10T10:00:00.000Z",
  country = null,
  acquisitionSource = null,
  acquisitionMedium = null,
  acquisitionCampaign = null,
  acquisitionContent = null,
  acquisitionTerm = null,
  acquisitionCountry = null,
  acquisitionReferrer = null,
  acquisitionAt = null,
} = {}) {
  await db.prepare(`
    INSERT INTO users (
      id, risk_level, country, acquisition_source, acquisition_medium,
      acquisition_campaign, acquisition_content, acquisition_term,
      acquisition_country, acquisition_referrer, acquisition_at, created_at
    ) VALUES (?, 'low', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    country,
    acquisitionSource,
    acquisitionMedium,
    acquisitionCampaign,
    acquisitionContent,
    acquisitionTerm,
    acquisitionCountry,
    acquisitionReferrer,
    acquisitionAt,
    createdAt,
  );
}

async function seedAppleAds({
  id,
  userId,
  status = "resolved",
  campaignId = 123,
  adGroupId = 456,
  keywordId = 789,
  orgId = 321,
  country = "AU",
  clickDate = "2026-04-11T10:00:00.000Z",
  lastError = null,
  createdAt = "2026-04-11T10:05:00.000Z",
  resolvedAt = "2026-04-11T10:06:00.000Z",
} = {}) {
  await db.prepare(`
    INSERT INTO apple_ads_attribution (
      id, user_id, attribution_token_sha256, token_length, status, api_status_code,
      campaign_id, ad_group_id, keyword_id, org_id, country_or_region, click_date,
      last_error, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, 64, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    `${id}_token_hash`,
    status,
    status === "resolved" ? 200 : null,
    campaignId,
    adGroupId,
    keywordId,
    orgId,
    country,
    clickDate,
    lastError,
    createdAt,
    createdAt,
    resolvedAt,
  );
}

async function seedDownload({
  id,
  ip = "203.0.113.10",
  matchedUserId = null,
  utmSource = "seo",
  utmMedium = "landing_page",
  utmCampaign = "song_gift",
  utmContent = "hero",
  utmTerm = null,
  country = "AU",
  referrerUrl = "https://porizo.co/song-gift",
  createdAt = "2026-04-11T10:00:00.000Z",
} = {}) {
  await db.prepare(`
    INSERT INTO download_events (
      id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
      utm_content, utm_term, country, referrer_url, matched_user_id, created_at
    ) VALUES (?, ?, 'repo-test-agent', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ip,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    country,
    referrerUrl,
    matchedUserId,
    createdAt,
  );
}

async function seedShare({
  id,
  trackId = `track_${id}`,
  trackVersionId = `version_${id}`,
  creatorId = `creator_${id}`,
  status = "active",
  boundDeviceId = null,
  boundUserId = null,
  utmSource = "seo",
  utmMedium = "share_card",
  utmCampaign = "mothers_day_song",
  createdAt = "2026-06-27T10:00:00.000Z",
  expiresAt = "2026-07-27T10:00:00.000Z",
} = {}) {
  await db.prepare(`
    INSERT INTO share_tokens (
      id, track_id, track_version_id, creator_id, status, bound_device_id,
      bound_user_id, expires_at, created_at, utm_source, utm_medium,
      utm_campaign
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    trackId,
    trackVersionId,
    creatorId,
    status,
    boundDeviceId,
    boundUserId,
    expiresAt,
    createdAt,
    utmSource,
    utmMedium,
    utmCampaign,
  );
}

async function seedReceiverSession({
  id,
  receiverHandoffId,
  handoffExpiresAt = "2026-06-28T10:00:00.000Z",
} = {}) {
  await db.prepare(`
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
    "2026-06-27T10:00:00.000Z",
    "2026-06-27T10:00:00.000Z",
  );
}

describe("AttributionRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createAttributionRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("findLatestAppleAdsAttributionForUser honors status and developer-test filters", async () => {
    await seedUser({ id: "attr_user" });
    await seedAppleAds({
      id: "aaa_older",
      userId: "attr_user",
      campaignId: 111,
      createdAt: "2026-04-11T09:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_failed",
      userId: "attr_user",
      status: "failed",
      campaignId: 222,
      lastError: "boom",
      createdAt: "2026-04-11T11:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_test_status",
      userId: "attr_user",
      status: "test",
      campaignId: 333,
      createdAt: "2026-04-11T12:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_dev_tuple",
      userId: "attr_user",
      campaignId: 1234567890,
      adGroupId: 1234567890,
      orgId: 1234567890,
      createdAt: "2026-04-11T13:00:00.000Z",
    });

    const latestAny = await repository.findLatestAppleAdsAttributionForUser("attr_user");
    const latestResolved = await repository.findLatestAppleAdsAttributionForUser("attr_user", {
      resolvedOnly: true,
    });

    assert.equal(latestAny.id, "aaa_failed");
    assert.equal(latestAny.status, "failed");
    assert.equal(latestResolved.id, "aaa_older");
    assert.equal(latestResolved.campaign_id, 111);
  });

  test("Apple Ads token persistence helpers insert, update, and mark failures by token hash", async () => {
    await seedUser({ id: "token_user" });

    const inserted = await repository.upsertAppleAdsAttributionResult({
      id: "aaa_token_result",
      userId: "token_user",
      tokenHash: "token_hash_result",
      tokenLength: 64,
      status: "resolved",
      apiStatusCode: 200,
      campaignId: 123,
      adGroupId: 456,
      keywordId: 789,
      orgId: 321,
      conversionType: "Download",
      countryOrRegion: "AU",
      clickDate: "2026-04-11T10:00:00.000Z",
      impressionDate: "2026-04-11T09:55:00.000Z",
      isRedownload: 0,
      rawResponseJson: '{"campaignId":123}',
      lastError: null,
      createdAt: "2026-04-11T10:05:00.000Z",
      updatedAt: "2026-04-11T10:05:00.000Z",
      resolvedAt: "2026-04-11T10:05:00.000Z",
    });

    assert.equal(inserted.id, "aaa_token_result");
    assert.equal(inserted.status, "resolved");
    assert.equal(inserted.campaign_id, 123);

    const updated = await repository.upsertAppleAdsAttributionResult({
      existingId: inserted.id,
      id: "unused_insert_id",
      userId: "token_user",
      tokenHash: "token_hash_result",
      tokenLength: 64,
      status: "not_found",
      apiStatusCode: 404,
      campaignId: null,
      adGroupId: null,
      keywordId: null,
      orgId: null,
      conversionType: null,
      countryOrRegion: null,
      clickDate: null,
      impressionDate: null,
      isRedownload: null,
      rawResponseJson: '{"message":"No attribution"}',
      lastError: null,
      createdAt: "2026-04-11T10:06:00.000Z",
      updatedAt: "2026-04-11T10:06:00.000Z",
      resolvedAt: "2026-04-11T10:06:00.000Z",
    });

    assert.equal(updated.id, inserted.id);
    assert.equal(updated.status, "not_found");
    assert.equal(updated.api_status_code, 404);
    assert.equal(updated.campaign_id, null);

    const failed = await repository.recordAppleAdsAttributionFailure({
      existingId: inserted.id,
      id: "unused_failure_insert_id",
      userId: "token_user",
      tokenHash: "token_hash_result",
      tokenLength: 64,
      message: "Apple Ads attribution request failed.",
      now: "2026-04-11T10:07:00.000Z",
    });

    assert.equal(failed.id, inserted.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.last_error, "Apple Ads attribution request failed.");

    const insertedFailure = await repository.recordAppleAdsAttributionFailure({
      id: "aaa_token_failure",
      userId: "token_user",
      tokenHash: "token_hash_failure",
      tokenLength: 64,
      message: "timeout",
      now: "2026-04-11T10:08:00.000Z",
    });

    assert.equal(insertedFailure.id, "aaa_token_failure");
    assert.equal(insertedFailure.status, "failed");
    assert.equal(insertedFailure.last_error, "timeout");
  });

  test("download matching helpers choose the newest unmatched event and guard claim races", async () => {
    await seedUser({ id: "existing_user" });
    await seedUser({ id: "new_user" });
    await seedUser({ id: "other_user" });
    await seedDownload({
      id: "dl_old",
      ip: "203.0.113.44",
      createdAt: "2026-04-11T09:00:00.000Z",
    });
    await seedDownload({
      id: "dl_new",
      ip: "203.0.113.44",
      createdAt: "2026-04-11T10:00:00.000Z",
    });
    await seedDownload({
      id: "dl_matched",
      ip: "203.0.113.44",
      matchedUserId: "existing_user",
      createdAt: "2026-04-11T11:00:00.000Z",
    });

    const event = await repository.findRecentUnmatchedDownloadEventByIp(
      "203.0.113.44",
      "2026-04-11T08:00:00.000Z",
    );
    assert.equal(event.id, "dl_new");

    const claimed = await repository.claimDownloadEventForUser("new_user", "dl_new");
    assert.equal(claimed.changes, 1);
    const raced = await repository.claimDownloadEventForUser("other_user", "dl_new");
    assert.equal(raced.changes, 0);

    const row = await db
      .prepare("SELECT matched_user_id FROM download_events WHERE id = ?")
      .get("dl_new");
    assert.equal(row.matched_user_id, "new_user");
  });

  test("insertDownloadEvent persists the full install-intent envelope", async () => {
    await repository.insertDownloadEvent({
      id: "dl_full_envelope",
      ipAddress: "203.0.113.55",
      userAgent: "PorizoDownloadTest/1.0",
      utmSource: "seo",
      utmMedium: "landing_page",
      utmCampaign: "song_gift",
      utmContent: "hero_badge",
      utmTerm: "custom birthday song",
      country: "AU",
      referrerUrl: "https://porizo.co/birthday-song-maker",
      receiverSessionId: "rs_111111111111111111111111",
      createdAt: "2026-06-27T10:30:00.000Z",
    });

    const row = await db
      .prepare(
        `SELECT id, ip_address, user_agent, utm_source, utm_medium,
                utm_campaign, utm_content, utm_term, country, referrer_url,
                receiver_session_id, created_at
         FROM download_events
         WHERE id = ?`,
      )
      .get("dl_full_envelope");

    assert.deepEqual(row, {
      id: "dl_full_envelope",
      ip_address: "203.0.113.55",
      user_agent: "PorizoDownloadTest/1.0",
      utm_source: "seo",
      utm_medium: "landing_page",
      utm_campaign: "song_gift",
      utm_content: "hero_badge",
      utm_term: "custom birthday song",
      country: "AU",
      referrer_url: "https://porizo.co/birthday-song-maker",
      receiver_session_id: "rs_111111111111111111111111",
      created_at: "2026-06-27T10:30:00.000Z",
    });
  });

  test("recordDownloadEvent rolls back receiver attribution when event insert fails", async () => {
    await seedDownload({
      id: "dl_duplicate",
      ip: "203.0.113.77",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await seedReceiverSession({
      id: "rs_aaaaaaaaaaaaaaaaaaaaaaaa",
      receiverHandoffId: "rh_bbbbbbbbbbbbbbbbbbbbbbbb",
    });

    await assert.rejects(
      () =>
        repository.recordDownloadEvent({
          id: "dl_duplicate",
          ipAddress: "203.0.113.88",
          userAgent: "PorizoDownloadTest/1.0",
          utmSource: "seo",
          createdAt: "2026-06-27T10:30:00.000Z",
          receiverAttribution: {
            receiverSessionId: "rs_aaaaaaaaaaaaaaaaaaaaaaaa",
            receiverHandoffId: "rh_bbbbbbbbbbbbbbbbbbbbbbbb",
          },
        }),
      /UNIQUE|constraint/i,
    );

    const session = await db
      .prepare(
        "SELECT download_attributed_at FROM receiver_sessions WHERE id = ?",
      )
      .get("rs_aaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(session.download_attributed_at, null);

    const attributedEvents = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM download_events WHERE receiver_session_id = ?",
      )
      .get("rs_aaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(Number(attributedEvents.count), 0);
  });

  test("batch attribution queries return the latest evidence per user", async () => {
    await seedUser({ id: "user_a" });
    await seedUser({ id: "user_b" });
    await seedAppleAds({
      id: "aaa_a_old",
      userId: "user_a",
      campaignId: 100,
      createdAt: "2026-04-11T09:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_a_new",
      userId: "user_a",
      campaignId: 200,
      createdAt: "2026-04-11T10:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_b_pending",
      userId: "user_b",
      status: "pending",
      campaignId: null,
      createdAt: "2026-04-11T11:00:00.000Z",
    });
    await seedDownload({
      id: "dl_a_old",
      matchedUserId: "user_a",
      utmCampaign: "old_campaign",
      createdAt: "2026-04-11T08:00:00.000Z",
    });
    await seedDownload({
      id: "dl_a_new",
      matchedUserId: "user_a",
      utmCampaign: "new_campaign",
      createdAt: "2026-04-11T12:00:00.000Z",
    });

    const resolvedApple = await repository.findLatestResolvedAppleAdsForUsers(["user_a", "user_b"]);
    const latestApple = await repository.findLatestAppleAdsForUsers(["user_a", "user_b"]);
    const downloads = await repository.findLatestDownloadsForUsers(["user_a", "user_b"]);

    assert.deepEqual(
      resolvedApple.map((row) => [row.user_id, row.campaign_id]),
      [["user_a", 200]],
    );
    assert.deepEqual(
      latestApple.map((row) => [row.user_id, row.status, row.campaign_id]),
      [
        ["user_a", "resolved", 200],
        ["user_b", "pending", null],
      ],
    );
    assert.deepEqual(
      downloads.map((row) => [row.user_id, row.utm_campaign]),
      [["user_a", "new_campaign"]],
    );
  });

  test("Apple Ads backfill uses COALESCE and download replacement overwrites the full acquisition projection", async () => {
    await seedUser({
      id: "backfill_user",
      country: "NZ",
      acquisitionSource: "Founder outreach",
    });

    await repository.backfillUserFromAppleAds({
      userId: "backfill_user",
      acquisitionSource: "Apple Ads",
      acquisitionMedium: "cpc",
      acquisitionCampaign: "123",
      acquisitionContent: "456",
      acquisitionTerm: "789",
      acquisitionCountry: "AU",
      acquisitionAt: "2026-04-11T10:00:00.000Z",
    });

    const afterApple = await db.prepare(`
      SELECT acquisition_source, acquisition_medium, acquisition_campaign,
             acquisition_content, acquisition_term, acquisition_country, acquisition_at
      FROM users WHERE id = ?
    `).get("backfill_user");
    assert.equal(afterApple.acquisition_source, "Founder outreach");
    assert.equal(afterApple.acquisition_medium, "cpc");
    assert.equal(afterApple.acquisition_campaign, "123");

    await repository.replaceUserAcquisitionFromDownload({
      userId: "backfill_user",
      acquisitionSource: "seo",
      acquisitionMedium: "landing_page",
      acquisitionCampaign: "mothers_day_song",
      acquisitionContent: "hero",
      acquisitionTerm: null,
      acquisitionCountry: "AU",
      acquisitionReferrer: "https://porizo.co/mothers-day-song",
      acquisitionAt: "2026-04-12T10:00:00.000Z",
    });

    const afterDownload = await db.prepare(`
      SELECT acquisition_source, acquisition_medium, acquisition_campaign,
             acquisition_content, acquisition_term, acquisition_country,
             acquisition_referrer, acquisition_at
      FROM users WHERE id = ?
    `).get("backfill_user");
    assert.deepEqual(afterDownload, {
      acquisition_source: "seo",
      acquisition_medium: "landing_page",
      acquisition_campaign: "mothers_day_song",
      acquisition_content: "hero",
      acquisition_term: null,
      acquisition_country: "AU",
      acquisition_referrer: "https://porizo.co/mothers-day-song",
      acquisition_at: "2026-04-12T10:00:00.000Z",
    });
  });

  test("health rows preserve attribution dashboard counts", async () => {
    await seedUser({ id: "stored_user", acquisitionSource: "seo" });
    await seedUser({ id: "resolved_user" });
    await seedUser({ id: "pending_user" });
    await seedAppleAds({
      id: "aaa_resolved",
      userId: "resolved_user",
      status: "resolved",
      country: "AU",
    });
    await seedAppleAds({
      id: "aaa_pending",
      userId: "pending_user",
      status: "pending",
      country: null,
    });
    await seedAppleAds({
      id: "aaa_test",
      userId: "pending_user",
      status: "test",
      country: "US",
    });
    await seedDownload({
      id: "dl_matched",
      matchedUserId: "stored_user",
      utmCampaign: "mothers_day_song",
    });
    await seedDownload({
      id: "dl_unmatched",
      matchedUserId: null,
      utmCampaign: "birthday_song",
    });

    const rows = await repository.getAttributionHealthRows();

    assert.equal(Number(rows.users.total_users), 3);
    assert.equal(Number(rows.users.users_with_stored_attribution), 1);
    assert.equal(Number(rows.appleAds.total_tokens), 3);
    assert.equal(Number(rows.appleAds.resolved), 1);
    assert.equal(Number(rows.appleAds.pending), 1);
    assert.equal(Number(rows.appleAds.test_data), 1);
    assert.equal(Number(rows.backfillMismatch.resolved_rows_not_backfilled), 1);
    assert.equal(Number(rows.downloads.total_events), 2);
    assert.equal(Number(rows.downloads.matched_events), 1);
    assert.equal(Number(rows.downloads.unmatched_attributed_events), 1);
    assert.equal(Number(rows.canonical.users_with_any_attribution_signal), 3);
  });

  test("Apple Ads keyword map repository upserts and lists deterministic pages", async () => {
    await repository.upsertAppleAdsKeywordMapRow({
      keywordId: "100",
      campaignId: "321",
      campaignName: "Porizo - Category US",
      adGroupId: "654",
      adGroupName: "High-Intent Keywords",
      keywordText: "custom song",
      matchType: "BROAD",
      bidAmount: "1.20",
      status: "ENABLED",
      source: "seed",
      lastSeenAt: "2026-06-26T10:00:00.000Z",
      now: "2026-06-26T10:01:00.000Z",
    });
    await repository.upsertAppleAdsKeywordMapRow({
      keywordId: "101",
      campaignId: "321",
      campaignName: "Porizo - Category US",
      adGroupId: "654",
      adGroupName: "High-Intent Keywords",
      keywordText: "gift song",
      matchType: "EXACT",
      bidAmount: "1.80",
      status: "ENABLED",
      source: "seed",
      lastSeenAt: "2026-06-27T10:00:00.000Z",
      now: "2026-06-27T10:01:00.000Z",
    });
    await repository.upsertAppleAdsKeywordMapRow({
      keywordId: "102",
      campaignId: null,
      campaignName: null,
      adGroupId: null,
      adGroupName: null,
      keywordText: "unseen keyword",
      matchType: null,
      bidAmount: null,
      status: null,
      source: "seed",
      lastSeenAt: "2026-06-25T10:00:00.000Z",
      now: "2026-06-27T10:02:00.000Z",
    });
    await repository.upsertAppleAdsKeywordMapRow({
      keywordId: "100",
      campaignId: "999",
      campaignName: "Porizo - Gift US",
      adGroupId: "888",
      adGroupName: "Gift Terms",
      keywordText: "personalized gift song",
      matchType: "PHRASE",
      bidAmount: "2.10",
      status: "PAUSED",
      source: "apple_ads_api",
      lastSeenAt: "2026-06-26T12:00:00.000Z",
      now: "2026-06-27T10:03:00.000Z",
    });

    const firstPage = await repository.listAppleAdsKeywordMap({
      limit: 2,
      offset: 0,
    });
    const secondPage = await repository.listAppleAdsKeywordMap({
      limit: 2,
      offset: 2,
    });

    assert.equal(firstPage.total, 3);
    assert.equal(firstPage.limit, 2);
    assert.equal(firstPage.offset, 0);
    assert.deepEqual(
      firstPage.rows.map((row) => row.keyword_id),
      ["101", "100"],
    );
    assert.deepEqual(
      secondPage.rows.map((row) => row.keyword_id),
      ["102"],
    );

    const updated = firstPage.rows.find((row) => row.keyword_id === "100");
    assert.equal(updated.campaign_id, "999");
    assert.equal(updated.campaign_name, "Porizo - Gift US");
    assert.equal(updated.ad_group_id, "888");
    assert.equal(updated.keyword_text, "personalized gift song");
    assert.equal(updated.match_type, "PHRASE");
    assert.equal(updated.bid_amount, "2.10");
    assert.equal(updated.status, "PAUSED");
    assert.equal(updated.source, "apple_ads_api");
  });

  test("admin attribution dashboard aggregate helpers preserve counts and filters", async () => {
    const since = "2026-06-01T00:00:00.000Z";
    await seedUser({ id: "attr_dashboard_user" });
    await seedUser({ id: "attr_dashboard_organic" });
    await seedUser({ id: "attr_dashboard_dev" });
    await seedShare({
      id: "share_attr_1",
      status: "active",
      boundDeviceId: "device_1",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await seedShare({
      id: "share_attr_2",
      status: "claimed",
      createdAt: "2026-06-27T11:00:00.000Z",
    });
    await seedShare({
      id: "share_unattributed",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      createdAt: "2026-06-27T12:00:00.000Z",
    });
    await seedShare({
      id: "share_old",
      utmCampaign: "custom_song_gift",
      createdAt: "2026-05-01T10:00:00.000Z",
    });
    await seedDownload({
      id: "download_attr_1",
      matchedUserId: "attr_dashboard_user",
      utmCampaign: "mothers_day_song",
      utmContent: "hero",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await seedDownload({
      id: "download_attr_2",
      matchedUserId: null,
      utmCampaign: "mothers_day_song",
      utmContent: "nav",
      createdAt: "2026-06-27T11:00:00.000Z",
    });
    await seedDownload({
      id: "download_unattributed",
      matchedUserId: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      createdAt: "2026-06-27T12:00:00.000Z",
    });
    await seedDownload({
      id: "download_old",
      matchedUserId: null,
      utmCampaign: "custom_song_gift",
      createdAt: "2026-05-01T10:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_dashboard_resolved",
      userId: "attr_dashboard_user",
      status: "resolved",
      campaignId: 321,
      adGroupId: 654,
      keywordId: 987,
      country: "US",
      createdAt: "2026-06-27T10:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_dashboard_not_found",
      userId: "attr_dashboard_organic",
      status: "not_found",
      campaignId: 321,
      adGroupId: 654,
      keywordId: 987,
      country: null,
      createdAt: "2026-06-27T11:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_dashboard_test",
      userId: "attr_dashboard_dev",
      status: "test",
      campaignId: 111,
      adGroupId: 222,
      keywordId: 333,
      createdAt: "2026-06-27T12:00:00.000Z",
    });
    await seedAppleAds({
      id: "aaa_dashboard_dev_tuple",
      userId: "attr_dashboard_dev",
      status: "resolved",
      campaignId: 1234567890,
      adGroupId: 1234567890,
      keywordId: 444,
      orgId: 1234567890,
      createdAt: "2026-06-27T13:00:00.000Z",
    });
    await repository.upsertAppleAdsKeywordMapRow({
      keywordId: "987",
      campaignId: "321",
      campaignName: "Porizo - Category US",
      adGroupId: "654",
      adGroupName: "High-Intent Keywords",
      keywordText: "gift song",
      matchType: "EXACT",
      bidAmount: "1.80",
      status: "ENABLED",
      source: "seed",
      lastSeenAt: "2026-06-27T10:00:00.000Z",
      now: "2026-06-27T10:01:00.000Z",
    });

    const shareCampaignRows = await repository.listShareAttributionBreakdown({
      field: "utm_campaign",
      since,
    });
    const downloadCampaignRows = await repository.listDownloadAttributionBreakdown({
      field: "utm_campaign",
      since,
    });
    const shareContentRows = await repository.listShareAttributionBreakdown({
      field: "utm_content",
      since,
    });
    const appleRows = await repository.listAppleAdsCampaignAttribution({
      since,
      limit: 50,
    });
    const totals = await repository.getAttributionTotals({ since });

    assert.deepEqual(shareCampaignRows, [{
      value: "mothers_day_song",
      share_count: 2,
      claim_count: 2,
    }]);
    assert.deepEqual(downloadCampaignRows, [{
      value: "mothers_day_song",
      download_count: 2,
      registration_count: 1,
    }]);
    assert.deepEqual(shareContentRows, []);
    assert.equal(appleRows.length, 1);
    assert.equal(String(appleRows[0].campaign_id), "321");
    assert.equal(String(appleRows[0].ad_group_id), "654");
    assert.equal(String(appleRows[0].keyword_id), "987");
    assert.equal(appleRows[0].campaign_name, "Porizo - Category US");
    assert.equal(appleRows[0].keyword_text, "gift song");
    assert.equal(appleRows[0].token_count, 2);
    assert.equal(appleRows[0].user_count, 2);
    assert.equal(appleRows[0].resolved_count, 1);
    assert.equal(appleRows[0].not_found_count, 1);
    assert.equal(appleRows[0].failed_count, 0);
    assert.equal(appleRows[0].with_country_count, 1);
    assert.deepEqual(totals, {
      withAttribution: 2,
      totalShares: 3,
      downloadsWithAttribution: 2,
      totalDownloads: 3,
      attributedRegistrations: 1,
    });
    await assert.rejects(
      () => repository.listDownloadAttributionBreakdown({
        field: "utm_source; DROP TABLE users; --",
        since,
      }),
      /Unsupported attribution field/,
    );
  });
});

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  createAdminGrowthService,
} = require("../src/services/admin/growth-service");

const NOW = "2026-06-27T10:00:00.000Z";
const WEEK_AGO = "2026-06-20T10:00:00.000Z";

function createGrowthFixture({ repository = {}, attributionService = {} } = {}) {
  const audits = [];
  const calls = [];
  const defaults = {
    async listShareAttributionBreakdown(payload) {
      calls.push(["share-breakdown", payload]);
      return [];
    },
    async listDownloadAttributionBreakdown(payload) {
      calls.push(["download-breakdown", payload]);
      return [];
    },
    async listAppleAdsCampaignAttribution(payload) {
      calls.push(["apple-ads", payload]);
      return [{ campaign_id: "321", resolved_count: 1 }];
    },
    async getAttributionTotals(payload) {
      calls.push(["totals", payload]);
      return {
        withAttribution: 2,
        totalShares: 4,
        downloadsWithAttribution: 3,
        totalDownloads: 6,
        attributedRegistrations: 1,
      };
    },
    async listAppleAdsKeywordMap(payload) {
      calls.push(["keyword-map", payload]);
      return { rows: [], total: 0, ...payload };
    },
    async upsertAppleAdsKeywordMapRow(payload) {
      calls.push(["upsert-keyword", payload]);
      return { changes: 1 };
    },
  };

  const service = createAdminGrowthService({
    attributionRepository: { ...defaults, ...repository },
    attributionService: {
      async getAttributionHealth() {
        calls.push(["health"]);
        return { ok: true };
      },
      ...attributionService,
    },
    audit: async (...args) => audits.push(args),
    now: () => new Date(NOW),
  });

  return { audits, calls, service };
}

describe("AdminGrowthService", () => {
  test("getAttribution fans out, merges rows, sorts, and formats rates", async () => {
    const { calls, service } = createGrowthFixture({
      repository: {
        async listShareAttributionBreakdown({ field, since }) {
          calls.push(["share-breakdown", { field, since }]);
          if (field !== "utm_source") return [];
          return [
            { value: "newsletter", share_count: "2", claim_count: "1" },
            { value: "ads", share_count: "3", claim_count: "2" },
          ];
        },
        async listDownloadAttributionBreakdown({ field, since }) {
          calls.push(["download-breakdown", { field, since }]);
          if (field !== "utm_source") return [];
          return [
            { value: "newsletter", download_count: "4", registration_count: "2" },
            { value: "ads", download_count: "4", registration_count: "3" },
          ];
        },
      },
    });

    const result = await service.getAttribution(7);

    assert.deepEqual(
      calls
        .filter(([name]) => name === "share-breakdown")
        .map(([, payload]) => payload),
      [
        { field: "utm_source", since: WEEK_AGO },
        { field: "utm_medium", since: WEEK_AGO },
        { field: "utm_campaign", since: WEEK_AGO },
        { field: "utm_content", since: WEEK_AGO },
        { field: "utm_term", since: WEEK_AGO },
      ],
    );
    assert.deepEqual(result.bySource, [
      {
        utm_source: "ads",
        share_count: 3,
        claim_count: 2,
        download_count: 4,
        registration_count: 3,
      },
      {
        utm_source: "newsletter",
        share_count: 2,
        claim_count: 1,
        download_count: 4,
        registration_count: 2,
      },
    ]);
    assert.deepEqual(result.appleAdsByCampaign, [
      { campaign_id: "321", resolved_count: 1 },
    ]);
    assert.equal(result.attributionRate, "50.00");
    assert.equal(result.downloadAttributionRate, "50.00");
    assert.equal(result.attributedRegistrations, 1);
  });

  test("bounds keyword map listing", async () => {
    const { calls, service } = createGrowthFixture();

    assert.deepEqual(await service.getAppleAdsKeywordMap(), {
      rows: [],
      total: 0,
      limit: 500,
      offset: 0,
    });
    await service.getAppleAdsKeywordMap({ limit: 5000, offset: -10 });

    assert.deepEqual(calls.filter(([name]) => name === "keyword-map"), [
      ["keyword-map", { limit: 500, offset: 0 }],
      ["keyword-map", { limit: 1000, offset: 0 }],
    ]);
  });

  test("upsertAppleAdsKeywordMap normalizes aliases, skips incomplete rows, and audits once", async () => {
    const { audits, calls, service } = createGrowthFixture();

    const result = await service.upsertAppleAdsKeywordMap(
      [
        {
          id: 987,
          campaign_id: 321,
          campaign_name: "Porizo - Category US",
          ad_group_id: 654,
          ad_group_name: "High-Intent",
          text: "gift song",
          matchType: "EXACT",
          bidAmount: 1.8,
          status: "ENABLED",
        },
        { keyword_id: "missing-text" },
      ],
      "admin_growth",
    );

    assert.deepEqual(result, { upserted: 1, skipped: 1 });
    assert.deepEqual(calls.filter(([name]) => name === "upsert-keyword"), [
      [
        "upsert-keyword",
        {
          keywordId: "987",
          campaignId: "321",
          campaignName: "Porizo - Category US",
          adGroupId: "654",
          adGroupName: "High-Intent",
          keywordText: "gift song",
          matchType: "EXACT",
          bidAmount: "1.8",
          status: "ENABLED",
          source: "apple_ads_api",
          lastSeenAt: NOW,
          now: NOW,
        },
      ],
    ]);
    assert.deepEqual(audits, [
      [
        "admin_growth",
        "admin_sync_apple_ads_keyword_map",
        "apple_ads_keyword_map",
        "bulk",
        {
          rowCount: 2,
          upserted: 1,
          contract: "apple-ads-keyword-map-v1",
        },
      ],
    ]);
  });

  test("upsertAppleAdsKeywordMap rejects invalid payloads", async () => {
    const { audits, service } = createGrowthFixture();

    await assert.rejects(
      () => service.upsertAppleAdsKeywordMap(null),
      /keywords must be an array/,
    );
    await assert.rejects(
      () => service.upsertAppleAdsKeywordMap(new Array(5001).fill({ text: "x" })),
      /limited to 5000 rows/,
    );
    assert.deepEqual(audits, []);
  });
});

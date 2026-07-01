"use strict";

const { safeBounds } = require("./pagination");

function createAdminGrowthService({
  attributionService,
  attributionRepository,
  audit,
  now = () => new Date(),
}) {
  if (!attributionService) {
    throw new Error("attributionService is required");
  }
  if (!attributionRepository) {
    throw new Error("attributionRepository is required");
  }
  if (typeof audit !== "function") {
    throw new Error("audit function is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }

  function nowIso() {
    const value = now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  function daysAgoIso(days) {
    return new Date(new Date(nowIso()).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function normalizeBidAmount(row) {
    if (row.bid_amount != null) {
      return String(row.bid_amount);
    }
    if (row.bidAmount != null) {
      return String(row.bidAmount);
    }
    return null;
  }

  async function getAttributionHealth() {
    return attributionService.getAttributionHealth();
  }

  async function getAttribution(days = 30) {
    const daysAgo = daysAgoIso(days);

    const buildBreakdown = async (field) => {
      const label = field;
      const [shareRows, downloadRows] = await Promise.all([
        attributionRepository.listShareAttributionBreakdown({
          field,
          since: daysAgo,
        }),
        attributionRepository.listDownloadAttributionBreakdown({
          field,
          since: daysAgo,
        }),
      ]);

      const merged = new Map();
      const ensure = (value) => {
        const key = value || "";
        if (!merged.has(key)) {
          merged.set(key, {
            [label]: value,
            share_count: 0,
            claim_count: 0,
            download_count: 0,
            registration_count: 0,
          });
        }
        return merged.get(key);
      };

      for (const row of shareRows) {
        const item = ensure(row.value);
        item.share_count = Number(row.share_count || 0);
        item.claim_count = Number(row.claim_count || 0);
      }

      for (const row of downloadRows) {
        const item = ensure(row.value);
        item.download_count = Number(row.download_count || 0);
        item.registration_count = Number(row.registration_count || 0);
      }

      return Array.from(merged.values()).sort(
        (a, b) =>
          b.download_count - a.download_count ||
          b.registration_count - a.registration_count ||
          b.share_count - a.share_count,
      );
    };

    const [bySource, byMedium, byCampaign, byContent, byTerm] =
      await Promise.all([
        buildBreakdown("utm_source"),
        buildBreakdown("utm_medium"),
        buildBreakdown("utm_campaign"),
        buildBreakdown("utm_content"),
        buildBreakdown("utm_term"),
      ]);

    const [appleAdsByCampaign, totals] = await Promise.all([
      attributionRepository.listAppleAdsCampaignAttribution({
        since: daysAgo,
        limit: 50,
      }),
      attributionRepository.getAttributionTotals({ since: daysAgo }),
    ]);
    const {
      withAttribution,
      totalShares,
      downloadsWithAttribution,
      totalDownloads,
      attributedRegistrations,
    } = totals;

    return {
      bySource,
      byMedium,
      byCampaign,
      byContent,
      byTerm,
      appleAdsByCampaign,
      withAttribution,
      totalShares,
      attributionRate:
        totalShares > 0 ? ((withAttribution / totalShares) * 100).toFixed(2) : "0.00",
      downloadsWithAttribution,
      totalDownloads,
      attributedRegistrations,
      downloadAttributionRate:
        totalDownloads > 0
          ? ((downloadsWithAttribution / totalDownloads) * 100).toFixed(2)
          : "0.00",
    };
  }

  async function getAppleAdsKeywordMap({ limit = 500, offset = 0 } = {}) {
    return attributionRepository.listAppleAdsKeywordMap(
      safeBounds(limit, offset, 1000),
    );
  }

  async function upsertAppleAdsKeywordMap(rows, adminId = "system") {
    if (!Array.isArray(rows)) {
      throw new Error("keywords must be an array");
    }
    if (rows.length > 5000) {
      throw new Error("keyword map sync is limited to 5000 rows per request");
    }

    const timestamp = nowIso();
    let upserted = 0;
    for (const row of rows) {
      const keywordId = String(row.keyword_id ?? row.keywordId ?? row.id ?? "").trim();
      const keywordText = String(row.keyword_text ?? row.keyword ?? row.text ?? "").trim();
      if (!keywordId || !keywordText) continue;

      await attributionRepository.upsertAppleAdsKeywordMapRow({
        keywordId,
        campaignId: row.campaign_id != null ? String(row.campaign_id) : null,
        campaignName: row.campaign_name || null,
        adGroupId: row.ad_group_id != null ? String(row.ad_group_id) : null,
        adGroupName: row.ad_group_name || null,
        keywordText,
        matchType: row.match_type || row.matchType || null,
        bidAmount: normalizeBidAmount(row),
        status: row.status || null,
        source: row.source || "apple_ads_api",
        lastSeenAt: row.last_seen_at || timestamp,
        now: timestamp,
      });
      upserted += 1;
    }

    await audit(
      adminId,
      "admin_sync_apple_ads_keyword_map",
      "apple_ads_keyword_map",
      "bulk",
      {
        rowCount: rows.length,
        upserted,
        contract: "apple-ads-keyword-map-v1",
      },
    );

    return { upserted, skipped: rows.length - upserted };
  }

  return {
    getAttributionHealth,
    getAttribution,
    getAppleAdsKeywordMap,
    upsertAppleAdsKeywordMap,
  };
}

module.exports = {
  createAdminGrowthService,
};

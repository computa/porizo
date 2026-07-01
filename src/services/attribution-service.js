"use strict";

const { createAttributionRepository } = require("../database/attribution-repository");

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function campaignFromAppleAds(row) {
  if (!row || row.campaign_id === null || row.campaign_id === undefined) {
    return null;
  }
  return String(row.campaign_id);
}

function sourceFromDownload(row) {
  if (!row) return null;
  return clean(row.utm_source) || clean(row.referrer_url) || "Download link";
}

function isAppleAdsSource(value) {
  return clean(value)?.toLowerCase() === "apple ads";
}

function applyDownloadAttribution(result, row, { overwriteAppleAds = false } = {}) {
  if (!row) return result;

  const downloadSource = sourceFromDownload(row);
  const shouldOverwriteSource = overwriteAppleAds || !result.acquisition_source;
  const shouldOverwriteDetails = overwriteAppleAds || !result.acquisition_source;

  if (shouldOverwriteSource) {
    result.acquisition_source = downloadSource;
  }
  if (shouldOverwriteDetails) {
    result.acquisition_medium = clean(row.utm_medium);
    result.acquisition_campaign = clean(row.utm_campaign);
    result.acquisition_content = clean(row.utm_content);
    result.acquisition_term = clean(row.utm_term);
    result.acquisition_referrer = clean(row.referrer_url);
    result.acquisition_at = clean(row.created_at);
  } else {
    result.acquisition_medium = result.acquisition_medium || clean(row.utm_medium);
    result.acquisition_campaign = result.acquisition_campaign || clean(row.utm_campaign);
    result.acquisition_content = result.acquisition_content || clean(row.utm_content);
    result.acquisition_term = result.acquisition_term || clean(row.utm_term);
    result.acquisition_referrer = result.acquisition_referrer || clean(row.referrer_url);
    result.acquisition_at = result.acquisition_at || clean(row.created_at);
  }
  result.acquisition_country = (overwriteAppleAds ? clean(row.country) : result.acquisition_country) || result.acquisition_country || clean(row.country);

  return result;
}

const APPLE_ADS_DEVELOPER_TEST_ID = 1234567890;

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function isAppleAdsDeveloperTestData(row) {
  if (!row) return false;
  return numeric(row.org_id ?? row.orgId ?? row.orgID) === APPLE_ADS_DEVELOPER_TEST_ID
    && numeric(row.campaign_id ?? row.campaignId ?? row.campaignID) === APPLE_ADS_DEVELOPER_TEST_ID
    && numeric(row.ad_group_id ?? row.adGroupId ?? row.adGroupID) === APPLE_ADS_DEVELOPER_TEST_ID;
}

function withinBackfillWindow(userCreatedAt, attributionCreatedAt, maxAgeMs = 48 * 60 * 60 * 1000) {
  if (!userCreatedAt || !attributionCreatedAt) {
    return true;
  }
  const userTime = Date.parse(userCreatedAt);
  const attributionTime = Date.parse(attributionCreatedAt);
  if (!Number.isFinite(userTime) || !Number.isFinite(attributionTime)) {
    return true;
  }
  return attributionTime - userTime <= maxAgeMs;
}

const DOWNLOAD_ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000;

function usableClientIp(value) {
  const ip = clean(value);
  return ip && ip.toLowerCase() !== "unknown" ? ip : null;
}

class AttributionService {
  constructor(db, { repository } = {}) {
    this.db = db;
    this.repository = repository || createAttributionRepository(db);
  }

  resolveUserAttribution(user, { appleAdsAttribution = null, latestAppleAdsAttribution = null, downloadAttribution = null } = {}) {
    const result = {
      acquisition_source: clean(user?.acquisition_source),
      acquisition_medium: clean(user?.acquisition_medium),
      acquisition_campaign: clean(user?.acquisition_campaign),
      acquisition_content: clean(user?.acquisition_content),
      acquisition_term: clean(user?.acquisition_term),
      acquisition_country: clean(user?.acquisition_country),
      acquisition_referrer: clean(user?.acquisition_referrer),
      acquisition_at: clean(user?.acquisition_at),
      registration_country: clean(user?.country),
      attribution_status: "unknown",
      attribution_reason: "No matched download event or resolved Apple Ads attribution.",
      attribution_confidence: "none",
    };

    if (result.acquisition_source || result.acquisition_campaign || result.acquisition_country || result.acquisition_medium || result.acquisition_term) {
      result.attribution_status = "attributed";
      result.attribution_reason = "Stored user acquisition fields.";
      result.attribution_confidence = "stored";
    }

    const hasStoredNonAppleSource = result.acquisition_source && !isAppleAdsSource(result.acquisition_source);

    if (downloadAttribution) {
      const overwroteAppleAds = isAppleAdsSource(result.acquisition_source);
      const sourceWasBlank = !result.acquisition_source;
      const sourceMatchesDownload = clean(result.acquisition_source)?.toLowerCase() === clean(sourceFromDownload(downloadAttribution))?.toLowerCase();
      applyDownloadAttribution(result, downloadAttribution, {
        overwriteAppleAds: overwroteAppleAds,
      });
      result.attribution_status = "attributed";
      result.attribution_reason = overwroteAppleAds
        ? "Matched recent /download attribution event; registration source overrides stored Apple Ads install attribution."
        : (sourceWasBlank || sourceMatchesDownload || result.attribution_confidence === "none"
          ? "Matched recent /download attribution event."
          : result.attribution_reason);
      result.attribution_confidence = overwroteAppleAds
        ? "download_event_over_apple_ads"
        : (sourceWasBlank || sourceMatchesDownload || result.attribution_confidence === "none"
          ? "download_event"
          : result.attribution_confidence);
    }

    const hasResolvedNonAppleSource = result.acquisition_source && !isAppleAdsSource(result.acquisition_source);

    if (appleAdsAttribution?.status === "resolved" && !hasStoredNonAppleSource && !hasResolvedNonAppleSource) {
      result.acquisition_source = result.acquisition_source || "Apple Ads";
      result.acquisition_medium = result.acquisition_medium || "cpc";
      result.acquisition_campaign = result.acquisition_campaign || campaignFromAppleAds(appleAdsAttribution);
      result.acquisition_content = result.acquisition_content || clean(appleAdsAttribution.ad_group_id);
      result.acquisition_term = result.acquisition_term || clean(appleAdsAttribution.keyword_id);
      result.acquisition_country = result.acquisition_country || clean(appleAdsAttribution.country_or_region);
      result.acquisition_at = result.acquisition_at || clean(appleAdsAttribution.click_date) || clean(appleAdsAttribution.resolved_at) || clean(appleAdsAttribution.created_at);
      result.attribution_status = "attributed";
      result.attribution_reason = result.attribution_confidence === "stored"
        ? "Stored user acquisition fields, filled from resolved Apple Ads attribution where blank."
        : "Resolved Apple Ads attribution.";
      result.attribution_confidence = result.attribution_confidence === "stored" ? "stored_plus_apple_ads" : "apple_ads";
    }

    if (result.acquisition_source) {
      return result;
    }

    if (latestAppleAdsAttribution?.status === "not_found") {
      return {
        ...result,
        acquisition_source: "Organic / direct",
        attribution_status: "organic",
        attribution_reason: "Apple Ads returned no ad attribution for this install token.",
        attribution_confidence: "apple_ads_not_found",
      };
    }

    if (latestAppleAdsAttribution?.status === "pending") {
      return {
        ...result,
        acquisition_source: "Pending attribution",
        attribution_status: "pending",
        attribution_reason: "Apple Ads attribution token captured but not resolved yet.",
        attribution_confidence: "pending",
      };
    }

    if (latestAppleAdsAttribution?.status === "failed") {
      return {
        ...result,
        acquisition_source: "Attribution failed",
        attribution_status: "failed",
        attribution_reason: clean(latestAppleAdsAttribution.last_error) || "Apple Ads attribution resolution failed.",
        attribution_confidence: "failed",
      };
    }

    if (latestAppleAdsAttribution?.status === "test") {
      return {
        ...result,
        acquisition_source: "Unknown",
        attribution_status: "ignored",
        attribution_reason: "Apple Ads returned developer-mode test data, so it was ignored.",
        attribution_confidence: "apple_ads_test_data",
      };
    }

    return {
      ...result,
      acquisition_source: "Unknown",
    };
  }

  async getLatestAppleAdsAttributionForUser(userId, { resolvedOnly = false } = {}) {
    return await this.repository.findLatestAppleAdsAttributionForUser(userId, { resolvedOnly });
  }

  async getLatestDownloadAttributionForUser(userId) {
    return await this.repository.findLatestDownloadAttributionForUser(userId);
  }

  async matchRecentDownloadEventForUser(userId, clientIp, { now = new Date(), windowMs = DOWNLOAD_ATTRIBUTION_WINDOW_MS } = {}) {
    const ip = usableClientIp(clientIp);
    if (!userId || !ip) {
      return null;
    }

    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const cutoff = new Date(baseMs - windowMs).toISOString();
    const event = await this.repository.findRecentUnmatchedDownloadEventByIp(ip, cutoff);

    if (!event) {
      return null;
    }

    const result = await this.repository.claimDownloadEventForUser(userId, event.id);

    if (Number(result?.changes || 0) === 0) {
      return null;
    }

    await this.backfillUserAcquisitionFromDownload(userId, event);
    return event;
  }

  async getUserAttribution(user) {
    if (!user?.id) {
      return this.resolveUserAttribution(user);
    }
    const [appleAdsAttribution, latestAppleAdsAttribution, downloadAttribution] = await Promise.all([
      this.getLatestAppleAdsAttributionForUser(user.id, { resolvedOnly: true }),
      this.getLatestAppleAdsAttributionForUser(user.id),
      this.getLatestDownloadAttributionForUser(user.id),
    ]);

    return this.resolveUserAttribution(user, {
      appleAdsAttribution,
      latestAppleAdsAttribution,
      downloadAttribution,
    });
  }

  async attachAttributionToUsers(users) {
    if (!Array.isArray(users) || users.length === 0) {
      return users || [];
    }

    const userIds = [...new Set(users.map((user) => user.id).filter(Boolean))];
    if (userIds.length === 0) {
      return users.map((user) => ({
        ...user,
        ...this.resolveUserAttribution(user),
      }));
    }

    const [appleRows, latestAppleRows, downloadRows] = await Promise.all([
      this.repository.findLatestResolvedAppleAdsForUsers(userIds),
      this.repository.findLatestAppleAdsForUsers(userIds),
      this.repository.findLatestDownloadsForUsers(userIds),
    ]);

    const appleByUser = new Map(appleRows.map((row) => [row.user_id, row]));
    const latestAppleByUser = new Map(latestAppleRows.map((row) => [row.user_id, row]));
    const downloadByUser = new Map(downloadRows.map((row) => [row.user_id, row]));

    return users.map((user) => ({
      ...user,
      ...this.resolveUserAttribution(user, {
        appleAdsAttribution: appleByUser.get(user.id),
        latestAppleAdsAttribution: latestAppleByUser.get(user.id),
        downloadAttribution: downloadByUser.get(user.id),
      }),
    }));
  }

  async backfillUserAcquisitionFromAppleAds(row) {
    if (!row || row.status !== "resolved" || !row.user_id || isAppleAdsDeveloperTestData(row)) {
      return;
    }

    const user = await this.repository.findUserAcquisitionForAppleAds(row.user_id);

    if (!user || !withinBackfillWindow(user.created_at, row.created_at)) {
      return;
    }

    const campaign = campaignFromAppleAds(row);
    await this.repository.backfillUserFromAppleAds({
      userId: row.user_id,
      acquisitionSource: "Apple Ads",
      acquisitionMedium: "cpc",
      acquisitionCampaign: campaign,
      acquisitionContent: clean(row.ad_group_id),
      acquisitionTerm: clean(row.keyword_id),
      acquisitionCountry: clean(row.country_or_region),
      acquisitionAt: clean(row.click_date) || clean(row.resolved_at) || clean(row.created_at),
    });
  }

  async backfillUserAcquisitionFromDownload(userId, row) {
    if (!userId || !row) {
      return;
    }

    const user = await this.repository.findUserAcquisitionForDownload(userId);

    if (!user) {
      return;
    }

    const current = {
      acquisition_source: clean(user.acquisition_source),
      acquisition_medium: clean(user.acquisition_medium),
      acquisition_campaign: clean(user.acquisition_campaign),
      acquisition_content: clean(user.acquisition_content),
      acquisition_term: clean(user.acquisition_term),
      acquisition_country: clean(user.acquisition_country),
      acquisition_referrer: clean(user.acquisition_referrer),
      acquisition_at: clean(user.acquisition_at),
    };
    const overwriteAppleAds = isAppleAdsSource(current.acquisition_source);
    const next = applyDownloadAttribution({ ...current }, row, { overwriteAppleAds });
    next.acquisition_country = next.acquisition_country || clean(user.country);

    await this.repository.replaceUserAcquisitionFromDownload({
      userId,
      acquisitionSource: next.acquisition_source,
      acquisitionMedium: next.acquisition_medium,
      acquisitionCampaign: next.acquisition_campaign,
      acquisitionContent: next.acquisition_content,
      acquisitionTerm: next.acquisition_term,
      acquisitionCountry: next.acquisition_country,
      acquisitionReferrer: next.acquisition_referrer,
      acquisitionAt: next.acquisition_at,
    });
  }

  async getAttributionHealth() {
    const { users, appleAds, backfillMismatch, downloads, canonical } =
      await this.repository.getAttributionHealthRows();

    const totalUsers = Number(users?.total_users || 0);
    const usersWithAnyAttributionSignal = Number(canonical?.users_with_any_attribution_signal || 0);

    return {
      users: {
        total: totalUsers,
        withStoredAttribution: Number(users?.users_with_stored_attribution || 0),
        withoutStoredAttribution: Number(users?.users_without_stored_attribution || 0),
        withAnyAttributionSignal: usersWithAnyAttributionSignal,
        unknownOrNoSignal: Math.max(0, totalUsers - usersWithAnyAttributionSignal),
      },
      appleAds: {
        totalTokens: Number(appleAds?.total_tokens || 0),
        resolved: Number(appleAds?.resolved || 0),
        resolvedUsers: Number(appleAds?.resolved_users || 0),
        resolvedWithCountry: Number(appleAds?.resolved_with_country || 0),
        resolvedMissingCountry: Number(appleAds?.resolved_missing_country || 0),
        notFound: Number(appleAds?.not_found || 0),
        testData: Number(appleAds?.test_data || 0),
        pending: Number(appleAds?.pending || 0),
        failed: Number(appleAds?.failed || 0),
        resolvedRowsNotBackfilled: Number(backfillMismatch?.resolved_rows_not_backfilled || 0),
      },
      downloads: {
        totalEvents: Number(downloads?.total_events || 0),
        matchedEvents: Number(downloads?.matched_events || 0),
        matchedUsers: Number(downloads?.matched_users || 0),
        unmatchedAttributedEvents: Number(downloads?.unmatched_attributed_events || 0),
      },
    };
  }
}

module.exports = {
  AttributionService,
  isAppleAdsDeveloperTestData,
  usableClientIp,
};

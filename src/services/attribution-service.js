"use strict";

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

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

const DOWNLOAD_ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000;

function usableClientIp(value) {
  const ip = clean(value);
  return ip && ip.toLowerCase() !== "unknown" ? ip : null;
}

class AttributionService {
  constructor(db) {
    this.db = db;
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
    const statusClause = resolvedOnly ? "AND status = 'resolved'" : "";
    return await this.db.prepare(`
      SELECT id, user_id, status, campaign_id, ad_group_id, keyword_id, org_id, conversion_type,
             country_or_region, click_date, last_error, created_at, resolved_at
      FROM apple_ads_attribution
      WHERE user_id = ? ${statusClause}
        AND status <> 'test'
        AND NOT (
          COALESCE(org_id, -1) = 1234567890
          AND COALESCE(campaign_id, -1) = 1234567890
          AND COALESCE(ad_group_id, -1) = 1234567890
        )
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId);
  }

  async getLatestDownloadAttributionForUser(userId) {
    return await this.db.prepare(`
      SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
      FROM download_events
      WHERE matched_user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId);
  }

  async matchRecentDownloadEventForUser(userId, clientIp, { now = new Date(), windowMs = DOWNLOAD_ATTRIBUTION_WINDOW_MS } = {}) {
    const ip = usableClientIp(clientIp);
    if (!userId || !ip) {
      return null;
    }

    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const cutoff = new Date(baseMs - windowMs).toISOString();
    const event = await this.db.prepare(`
      SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
      FROM download_events
      WHERE ip_address = ?
        AND created_at > ?
        AND matched_user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get(ip, cutoff);

    if (!event) {
      return null;
    }

    const result = await this.db.prepare(`
      UPDATE download_events
      SET matched_user_id = ?
      WHERE id = ? AND matched_user_id IS NULL
    `).run(userId, event.id);

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

    const idsSql = placeholders(userIds.length);

    const [appleRows, latestAppleRows, downloadRows] = await Promise.all([
      this.db.prepare(`
        SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, created_at, resolved_at
        FROM (
          SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, created_at, resolved_at,
                 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
          FROM apple_ads_attribution
          WHERE status = 'resolved' AND user_id IN (${idsSql})
            AND NOT (
              COALESCE(org_id, -1) = 1234567890
              AND COALESCE(campaign_id, -1) = 1234567890
              AND COALESCE(ad_group_id, -1) = 1234567890
            )
        ) ranked_apple_ads
        WHERE rn = 1
      `).all(...userIds),
      this.db.prepare(`
        SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, last_error, created_at, resolved_at
        FROM (
          SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, last_error, created_at, resolved_at,
                 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
          FROM apple_ads_attribution
          WHERE user_id IN (${idsSql}) AND status <> 'test'
        ) ranked_apple_ads
        WHERE rn = 1
      `).all(...userIds),
      this.db.prepare(`
        SELECT matched_user_id as user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
        FROM (
          SELECT matched_user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at,
                 ROW_NUMBER() OVER (PARTITION BY matched_user_id ORDER BY created_at DESC) as rn
          FROM download_events
          WHERE matched_user_id IN (${idsSql})
        ) ranked_downloads
        WHERE rn = 1
      `).all(...userIds),
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

    const user = await this.db.prepare(`
      SELECT id, acquisition_source, acquisition_medium, acquisition_campaign, acquisition_content,
             acquisition_term, acquisition_country, acquisition_referrer, acquisition_at, created_at
      FROM users
      WHERE id = ?
    `).get(row.user_id);

    if (!user || !withinBackfillWindow(user.created_at, row.created_at)) {
      return;
    }

    const campaign = campaignFromAppleAds(row);
    await this.db.prepare(`
      UPDATE users
      SET acquisition_source = COALESCE(acquisition_source, ?),
          acquisition_medium = COALESCE(acquisition_medium, ?),
          acquisition_campaign = COALESCE(acquisition_campaign, ?),
          acquisition_content = COALESCE(acquisition_content, ?),
          acquisition_term = COALESCE(acquisition_term, ?),
          acquisition_country = COALESCE(acquisition_country, ?),
          acquisition_at = COALESCE(acquisition_at, ?)
      WHERE id = ?
    `).run(
      "Apple Ads",
      "cpc",
      campaign,
      clean(row.ad_group_id),
      clean(row.keyword_id),
      clean(row.country_or_region),
      clean(row.click_date) || clean(row.resolved_at) || clean(row.created_at),
      row.user_id
    );
  }

  async backfillUserAcquisitionFromDownload(userId, row) {
    if (!userId || !row) {
      return;
    }

    const user = await this.db.prepare(`
      SELECT id, acquisition_source, acquisition_medium, acquisition_campaign, acquisition_content,
             acquisition_term, acquisition_country, acquisition_referrer, acquisition_at, country
      FROM users
      WHERE id = ?
    `).get(userId);

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

    await this.db.prepare(`
      UPDATE users
      SET acquisition_source = ?,
          acquisition_medium = ?,
          acquisition_campaign = ?,
          acquisition_content = ?,
          acquisition_term = ?,
          acquisition_country = ?,
          acquisition_referrer = ?,
          acquisition_at = ?
      WHERE id = ?
    `).run(
      next.acquisition_source,
      next.acquisition_medium,
      next.acquisition_campaign,
      next.acquisition_content,
      next.acquisition_term,
      next.acquisition_country,
      next.acquisition_referrer,
      next.acquisition_at,
      userId
    );
  }

  async getAttributionHealth() {
    const [users, appleAds, backfillMismatch, downloads] = await Promise.all([
      this.db.prepare(`
        SELECT
          COUNT(*) as total_users,
          SUM(CASE WHEN acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_country IS NOT NULL THEN 1 ELSE 0 END) as users_with_stored_attribution,
          SUM(CASE WHEN acquisition_source IS NULL AND acquisition_campaign IS NULL AND acquisition_country IS NULL THEN 1 ELSE 0 END) as users_without_stored_attribution
        FROM users
      `).get(),
      this.db.prepare(`
        SELECT
          COUNT(*) as total_tokens,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
          SUM(CASE WHEN status = 'resolved' AND country_or_region IS NOT NULL AND country_or_region <> '' THEN 1 ELSE 0 END) as resolved_with_country,
          SUM(CASE WHEN status = 'resolved' AND (country_or_region IS NULL OR country_or_region = '') THEN 1 ELSE 0 END) as resolved_missing_country,
          COUNT(DISTINCT CASE WHEN status = 'resolved' THEN user_id END) as resolved_users,
          SUM(CASE WHEN status = 'not_found' THEN 1 ELSE 0 END) as not_found,
          SUM(CASE WHEN status = 'test' THEN 1 ELSE 0 END) as test_data,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM apple_ads_attribution
      `).get(),
      this.db.prepare(`
        SELECT COUNT(DISTINCT aaa.user_id) as resolved_rows_not_backfilled
        FROM apple_ads_attribution aaa
        JOIN users u ON u.id = aaa.user_id
        WHERE aaa.status = 'resolved'
          AND NOT (
            COALESCE(aaa.org_id, -1) = 1234567890
            AND COALESCE(aaa.campaign_id, -1) = 1234567890
            AND COALESCE(aaa.ad_group_id, -1) = 1234567890
          )
          AND (
            (u.acquisition_source IS NULL)
            OR (aaa.campaign_id IS NOT NULL AND u.acquisition_campaign IS NULL)
            OR (aaa.ad_group_id IS NOT NULL AND u.acquisition_content IS NULL)
            OR (aaa.keyword_id IS NOT NULL AND u.acquisition_term IS NULL)
            OR (aaa.country_or_region IS NOT NULL AND aaa.country_or_region <> '' AND u.acquisition_country IS NULL)
          )
      `).get(),
      this.db.prepare(`
        SELECT
          COUNT(*) as total_events,
          SUM(CASE WHEN matched_user_id IS NOT NULL THEN 1 ELSE 0 END) as matched_events,
          COUNT(DISTINCT CASE WHEN matched_user_id IS NOT NULL THEN matched_user_id END) as matched_users,
          SUM(CASE WHEN matched_user_id IS NULL
                    AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
                   THEN 1 ELSE 0 END) as unmatched_attributed_events
        FROM download_events
      `).get(),
    ]);

    const canonical = await this.db.prepare(`
      SELECT COUNT(*) as users_with_any_attribution_signal
      FROM users u
      WHERE u.acquisition_source IS NOT NULL
         OR u.acquisition_campaign IS NOT NULL
         OR u.acquisition_country IS NOT NULL
         OR EXISTS (
            SELECT 1 FROM apple_ads_attribution aaa
           WHERE aaa.user_id = u.id AND aaa.status IN ('resolved', 'not_found', 'pending', 'failed')
         )
         OR EXISTS (
           SELECT 1 FROM download_events de
           WHERE de.matched_user_id = u.id
         )
    `).get();

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

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

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

class AttributionService {
  constructor(db) {
    this.db = db;
  }

  resolveUserAttribution(user, { appleAdsAttribution = null, latestAppleAdsAttribution = null, downloadAttribution = null } = {}) {
    const result = {
      acquisition_source: clean(user?.acquisition_source),
      acquisition_campaign: clean(user?.acquisition_campaign),
      acquisition_country: clean(user?.acquisition_country),
      attribution_status: "unknown",
      attribution_reason: "No matched download event or resolved Apple Ads attribution.",
      attribution_confidence: "none",
    };

    if (result.acquisition_source || result.acquisition_campaign || result.acquisition_country) {
      result.attribution_status = "attributed";
      result.attribution_reason = "Stored user acquisition fields.";
      result.attribution_confidence = "stored";
    }

    if (appleAdsAttribution?.status === "resolved") {
      result.acquisition_source = result.acquisition_source || "Apple Ads";
      result.acquisition_campaign = result.acquisition_campaign || campaignFromAppleAds(appleAdsAttribution);
      result.acquisition_country = result.acquisition_country || clean(appleAdsAttribution.country_or_region);
      result.attribution_status = "attributed";
      result.attribution_reason = result.attribution_confidence === "stored"
        ? "Stored user acquisition fields, filled from resolved Apple Ads attribution where blank."
        : "Resolved Apple Ads attribution.";
      result.attribution_confidence = result.attribution_confidence === "stored" ? "stored_plus_apple_ads" : "apple_ads";
    }

    if (downloadAttribution) {
      result.acquisition_source = result.acquisition_source || sourceFromDownload(downloadAttribution);
      result.acquisition_campaign = result.acquisition_campaign || clean(downloadAttribution.utm_campaign);
      result.acquisition_country = result.acquisition_country || clean(downloadAttribution.country);
      result.attribution_status = "attributed";
      result.attribution_reason = result.attribution_confidence === "none"
        ? "Matched recent /download attribution event."
        : result.attribution_reason;
      result.attribution_confidence = result.attribution_confidence === "none"
        ? "download_event"
        : result.attribution_confidence;
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

    return {
      ...result,
      acquisition_source: "Unknown",
    };
  }

  async getLatestAppleAdsAttributionForUser(userId, { resolvedOnly = false } = {}) {
    const statusClause = resolvedOnly ? "AND status = 'resolved'" : "";
    return await this.db.prepare(`
      SELECT id, user_id, status, campaign_id, ad_group_id, keyword_id, org_id, conversion_type,
             country_or_region, last_error, created_at, resolved_at
      FROM apple_ads_attribution
      WHERE user_id = ? ${statusClause}
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId);
  }

  async getLatestDownloadAttributionForUser(userId) {
    return await this.db.prepare(`
      SELECT id, utm_source, utm_medium, utm_campaign, utm_content, country, referrer_url, created_at
      FROM download_events
      WHERE matched_user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId);
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
        SELECT user_id, status, campaign_id, country_or_region, created_at
        FROM (
          SELECT user_id, status, campaign_id, country_or_region, created_at,
                 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
          FROM apple_ads_attribution
          WHERE status = 'resolved' AND user_id IN (${idsSql})
        ) ranked_apple_ads
        WHERE rn = 1
      `).all(...userIds),
      this.db.prepare(`
        SELECT user_id, status, campaign_id, country_or_region, last_error, created_at
        FROM (
          SELECT user_id, status, campaign_id, country_or_region, last_error, created_at,
                 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
          FROM apple_ads_attribution
          WHERE user_id IN (${idsSql})
        ) ranked_apple_ads
        WHERE rn = 1
      `).all(...userIds),
      this.db.prepare(`
        SELECT matched_user_id as user_id, utm_source, utm_medium, utm_campaign, country, referrer_url, created_at
        FROM (
          SELECT matched_user_id, utm_source, utm_medium, utm_campaign, country, referrer_url, created_at,
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
    if (!row || row.status !== "resolved" || !row.user_id) {
      return;
    }

    const campaign = campaignFromAppleAds(row);
    await this.db.prepare(`
      UPDATE users
      SET acquisition_source = COALESCE(acquisition_source, ?),
          acquisition_campaign = COALESCE(acquisition_campaign, ?),
          acquisition_country = COALESCE(acquisition_country, ?)
      WHERE id = ?
    `).run(
      "Apple Ads",
      campaign,
      clean(row.country_or_region),
      row.user_id
    );
  }

  async backfillUserAcquisitionFromDownload(userId, row) {
    if (!userId || !row) {
      return;
    }

    await this.db.prepare(`
      UPDATE users
      SET acquisition_source = COALESCE(acquisition_source, ?),
          acquisition_campaign = COALESCE(acquisition_campaign, ?),
          acquisition_country = COALESCE(acquisition_country, ?)
      WHERE id = ?
    `).run(
      sourceFromDownload(row),
      clean(row.utm_campaign),
      clean(row.country),
      userId
    );
  }

  async getAttributionHealth() {
    const [users, appleAds, backfillMismatch] = await Promise.all([
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
          SUM(CASE WHEN status = 'not_found' THEN 1 ELSE 0 END) as not_found,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM apple_ads_attribution
      `).get(),
      this.db.prepare(`
        SELECT COUNT(DISTINCT aaa.user_id) as resolved_rows_not_backfilled
        FROM apple_ads_attribution aaa
        JOIN users u ON u.id = aaa.user_id
        WHERE aaa.status = 'resolved'
          AND (
            u.acquisition_source IS NULL
            OR u.acquisition_country IS NULL
          )
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
        resolvedWithCountry: Number(appleAds?.resolved_with_country || 0),
        notFound: Number(appleAds?.not_found || 0),
        pending: Number(appleAds?.pending || 0),
        failed: Number(appleAds?.failed || 0),
        resolvedRowsNotBackfilled: Number(backfillMismatch?.resolved_rows_not_backfilled || 0),
      },
    };
  }
}

module.exports = {
  AttributionService,
};

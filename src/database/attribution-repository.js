"use strict";

const { createReceiverSessionRepository } = require("./receiver-session-repository");
const { createPreparedDbFromQuery } = require("../utils/db-adapter");

function createInClause(values) {
  return {
    sql: values.map(() => "?").join(", "),
    params: values,
  };
}

const SHARE_ATTRIBUTION_FIELDS = new Map([
  ["utm_source", "utm_source"],
  ["utm_medium", "utm_medium"],
  ["utm_campaign", "utm_campaign"],
]);

const DOWNLOAD_ATTRIBUTION_FIELDS = new Map([
  ["utm_source", "utm_source"],
  ["utm_medium", "utm_medium"],
  ["utm_campaign", "utm_campaign"],
  ["utm_content", "utm_content"],
  ["utm_term", "utm_term"],
]);

function requireDownloadAttributionField(field) {
  const column = DOWNLOAD_ATTRIBUTION_FIELDS.get(field);
  if (!column) {
    throw new Error(`Unsupported attribution field: ${field}`);
  }
  return column;
}

function optionalShareAttributionField(field) {
  return SHARE_ATTRIBUTION_FIELDS.get(field) || null;
}

function insertDownloadEventRow(db, {
  id,
  ipAddress,
  userAgent = null,
  utmSource = null,
  utmMedium = null,
  utmCampaign = null,
  utmContent = null,
  utmTerm = null,
  country = null,
  referrerUrl = null,
  receiverSessionId = null,
  createdAt,
}) {
  return db.prepare(`
    INSERT INTO download_events (
      id, ip_address, user_agent, utm_source, utm_medium, utm_campaign,
      utm_content, utm_term, country, referrer_url, receiver_session_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ipAddress,
    userAgent,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    country,
    referrerUrl,
    receiverSessionId,
    createdAt,
  );
}

function createAttributionRepository(db) {
  async function findAppleAdsAttributionByTokenHash(tokenHash) {
    return db.prepare("SELECT * FROM apple_ads_attribution WHERE attribution_token_sha256 = ?")
      .get(tokenHash);
  }

  async function recordAppleAdsAttributionFailure({
    existingId = null,
    id,
    userId,
    tokenHash,
    tokenLength,
    message,
    now,
  }) {
    if (existingId) {
      await db.prepare(
        "UPDATE apple_ads_attribution SET status = ?, last_error = ?, updated_at = ? WHERE id = ?",
      ).run("failed", message, now, existingId);
    } else {
      await db.prepare(`
        INSERT INTO apple_ads_attribution (
          id, user_id, attribution_token_sha256, token_length, status, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, tokenHash, tokenLength, "failed", message, now, now);
    }
    return findAppleAdsAttributionByTokenHash(tokenHash);
  }

  async function upsertAppleAdsAttributionResult({
    existingId = null,
    id,
    userId,
    tokenHash,
    tokenLength,
    status,
    apiStatusCode,
    campaignId,
    adGroupId,
    keywordId,
    orgId,
    conversionType,
    countryOrRegion,
    clickDate,
    impressionDate,
    isRedownload,
    rawResponseJson,
    lastError,
    createdAt,
    updatedAt,
    resolvedAt,
  }) {
    if (existingId) {
      await db.prepare(`
        UPDATE apple_ads_attribution
        SET status = ?,
            api_status_code = ?,
            campaign_id = ?,
            ad_group_id = ?,
            keyword_id = ?,
            org_id = ?,
            conversion_type = ?,
            country_or_region = ?,
            click_date = ?,
            impression_date = ?,
            is_redownload = ?,
            raw_response_json = ?,
            last_error = ?,
            updated_at = ?,
            resolved_at = ?
        WHERE id = ?
      `).run(
        status,
        apiStatusCode,
        campaignId,
        adGroupId,
        keywordId,
        orgId,
        conversionType,
        countryOrRegion,
        clickDate,
        impressionDate,
        isRedownload,
        rawResponseJson,
        lastError,
        updatedAt,
        resolvedAt,
        existingId,
      );
    } else {
      await db.prepare(`
        INSERT INTO apple_ads_attribution (
          id, user_id, attribution_token_sha256, token_length, status, api_status_code,
          campaign_id, ad_group_id, keyword_id, org_id, conversion_type, country_or_region,
          click_date, impression_date, is_redownload, raw_response_json, last_error,
          created_at, updated_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        userId,
        tokenHash,
        tokenLength,
        status,
        apiStatusCode,
        campaignId,
        adGroupId,
        keywordId,
        orgId,
        conversionType,
        countryOrRegion,
        clickDate,
        impressionDate,
        isRedownload,
        rawResponseJson,
        lastError,
        createdAt,
        updatedAt,
        resolvedAt,
      );
    }
    return findAppleAdsAttributionByTokenHash(tokenHash);
  }

  async function findLatestAppleAdsAttributionForUser(userId, { resolvedOnly = false } = {}) {
    const statusClause = resolvedOnly ? "AND status = 'resolved'" : "";
    return db.prepare(`
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

  async function findLatestDownloadAttributionForUser(userId) {
    return db.prepare(`
      SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
      FROM download_events
      WHERE matched_user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId);
  }

  async function findRecentUnmatchedDownloadEventByIp(ip, cutoffIso) {
    return db.prepare(`
      SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
      FROM download_events
      WHERE ip_address = ?
        AND created_at > ?
        AND matched_user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get(ip, cutoffIso);
  }

  async function claimDownloadEventForUser(userId, eventId) {
    return db.prepare(`
      UPDATE download_events
      SET matched_user_id = ?
      WHERE id = ? AND matched_user_id IS NULL
    `).run(userId, eventId);
  }

  async function insertDownloadEvent(event) {
    return insertDownloadEventRow(db, event);
  }

  async function recordDownloadEvent(event) {
    const receiverAttribution = event.receiverAttribution || null;
    if (!receiverAttribution) {
      const insertResult = await insertDownloadEventRow(db, event);
      return { insertResult, receiverSessionId: null };
    }

    if (typeof db.transaction !== "function") {
      throw new Error("Download receiver attribution requires database transaction support");
    }

    return db.transaction(async (query) => {
      const txDb = createPreparedDbFromQuery(query, db);
      const receiverSessionRepository = createReceiverSessionRepository(txDb);
      const marked = await receiverSessionRepository.markDownloadAttributedByHandoff({
        receiverSessionId: receiverAttribution.receiverSessionId,
        receiverHandoffId: receiverAttribution.receiverHandoffId,
        now: event.createdAt,
      });
      const receiverSessionId = marked.attributed
        ? receiverAttribution.receiverSessionId
        : null;
      const eventWithoutReceiverAttribution = { ...event };
      delete eventWithoutReceiverAttribution.receiverAttribution;
      const insertResult = await insertDownloadEventRow(txDb, {
        ...eventWithoutReceiverAttribution,
        receiverSessionId,
      });
      return { insertResult, receiverSessionId };
    });
  }

  async function findLatestResolvedAppleAdsForUsers(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return [];
    }
    const ids = createInClause(userIds);
    return db.prepare(`
      SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, created_at, resolved_at
      FROM (
        SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, created_at, resolved_at,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM apple_ads_attribution
        WHERE status = 'resolved' AND user_id IN (${ids.sql})
          AND NOT (
            COALESCE(org_id, -1) = 1234567890
            AND COALESCE(campaign_id, -1) = 1234567890
            AND COALESCE(ad_group_id, -1) = 1234567890
          )
      ) ranked_apple_ads
      WHERE rn = 1
    `).all(...ids.params);
  }

  async function findLatestAppleAdsForUsers(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return [];
    }
    const ids = createInClause(userIds);
    return db.prepare(`
      SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, last_error, created_at, resolved_at
      FROM (
        SELECT user_id, status, campaign_id, ad_group_id, keyword_id, country_or_region, click_date, last_error, created_at, resolved_at,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM apple_ads_attribution
        WHERE user_id IN (${ids.sql}) AND status <> 'test'
      ) ranked_apple_ads
      WHERE rn = 1
    `).all(...ids.params);
  }

  async function findLatestDownloadsForUsers(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return [];
    }
    const ids = createInClause(userIds);
    return db.prepare(`
      SELECT matched_user_id as user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
      FROM (
        SELECT matched_user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at,
               ROW_NUMBER() OVER (PARTITION BY matched_user_id ORDER BY created_at DESC) as rn
        FROM download_events
        WHERE matched_user_id IN (${ids.sql})
      ) ranked_downloads
      WHERE rn = 1
    `).all(...ids.params);
  }

  async function findUserAcquisitionForAppleAds(userId) {
    return db.prepare(`
      SELECT id, acquisition_source, acquisition_medium, acquisition_campaign, acquisition_content,
             acquisition_term, acquisition_country, acquisition_referrer, acquisition_at, created_at
      FROM users
      WHERE id = ?
    `).get(userId);
  }

  async function backfillUserFromAppleAds({
    userId,
    acquisitionSource,
    acquisitionMedium,
    acquisitionCampaign,
    acquisitionContent,
    acquisitionTerm,
    acquisitionCountry,
    acquisitionAt,
  }) {
    return db.prepare(`
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
      acquisitionSource,
      acquisitionMedium,
      acquisitionCampaign,
      acquisitionContent,
      acquisitionTerm,
      acquisitionCountry,
      acquisitionAt,
      userId,
    );
  }

  async function findUserAcquisitionForDownload(userId) {
    return db.prepare(`
      SELECT id, acquisition_source, acquisition_medium, acquisition_campaign, acquisition_content,
             acquisition_term, acquisition_country, acquisition_referrer, acquisition_at, country
      FROM users
      WHERE id = ?
    `).get(userId);
  }

  async function replaceUserAcquisitionFromDownload({
    userId,
    acquisitionSource,
    acquisitionMedium,
    acquisitionCampaign,
    acquisitionContent,
    acquisitionTerm,
    acquisitionCountry,
    acquisitionReferrer,
    acquisitionAt,
  }) {
    return db.prepare(`
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
      acquisitionSource,
      acquisitionMedium,
      acquisitionCampaign,
      acquisitionContent,
      acquisitionTerm,
      acquisitionCountry,
      acquisitionReferrer,
      acquisitionAt,
      userId,
    );
  }

  async function getUserAttributionHealthRow() {
    return db.prepare(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_country IS NOT NULL THEN 1 ELSE 0 END) as users_with_stored_attribution,
        SUM(CASE WHEN acquisition_source IS NULL AND acquisition_campaign IS NULL AND acquisition_country IS NULL THEN 1 ELSE 0 END) as users_without_stored_attribution
      FROM users
    `).get();
  }

  async function getAppleAdsHealthRow() {
    return db.prepare(`
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
    `).get();
  }

  async function getAppleAdsBackfillMismatchRow() {
    return db.prepare(`
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
    `).get();
  }

  async function getDownloadHealthRow() {
    return db.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN matched_user_id IS NOT NULL THEN 1 ELSE 0 END) as matched_events,
        COUNT(DISTINCT CASE WHEN matched_user_id IS NOT NULL THEN matched_user_id END) as matched_users,
        SUM(CASE WHEN matched_user_id IS NULL
                  AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
                 THEN 1 ELSE 0 END) as unmatched_attributed_events
      FROM download_events
    `).get();
  }

  async function getUsersWithAnyAttributionSignalRow() {
    return db.prepare(`
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
  }

  async function getAttributionHealthRows() {
    const [users, appleAds, backfillMismatch, downloads, canonical] = await Promise.all([
      getUserAttributionHealthRow(),
      getAppleAdsHealthRow(),
      getAppleAdsBackfillMismatchRow(),
      getDownloadHealthRow(),
      getUsersWithAnyAttributionSignalRow(),
    ]);
    return { users, appleAds, backfillMismatch, downloads, canonical };
  }

  async function listShareAttributionBreakdown({ field, since }) {
    const column = optionalShareAttributionField(field);
    if (!column) {
      return [];
    }

    const rows = await db.prepare(`
      SELECT ${column} AS value,
             COUNT(*) AS share_count,
             SUM(CASE WHEN status = 'claimed' OR bound_device_id IS NOT NULL OR bound_user_id IS NOT NULL THEN 1 ELSE 0 END) AS claim_count
      FROM share_tokens
      WHERE created_at > ? AND ${column} IS NOT NULL
      GROUP BY ${column}
    `).all(since);

    return rows.map((row) => ({
      value: row.value,
      share_count: Number(row.share_count || 0),
      claim_count: Number(row.claim_count || 0),
    }));
  }

  async function listDownloadAttributionBreakdown({ field, since }) {
    const column = requireDownloadAttributionField(field);
    const rows = await db.prepare(`
      SELECT ${column} AS value,
             COUNT(*) AS download_count,
             COUNT(DISTINCT matched_user_id) AS registration_count
      FROM download_events
      WHERE created_at > ? AND ${column} IS NOT NULL
      GROUP BY ${column}
    `).all(since);

    return rows.map((row) => ({
      value: row.value,
      download_count: Number(row.download_count || 0),
      registration_count: Number(row.registration_count || 0),
    }));
  }

  async function listAppleAdsCampaignAttribution({ since, limit = 50 }) {
    const rows = await db.prepare(`
      SELECT aaa.campaign_id,
             aaa.ad_group_id,
             aaa.keyword_id,
             akm.campaign_name,
             akm.ad_group_name,
             akm.keyword_text,
             akm.match_type,
             COUNT(*) AS token_count,
             COUNT(DISTINCT aaa.user_id) AS user_count,
             SUM(CASE WHEN aaa.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
             SUM(CASE WHEN aaa.status = 'not_found' THEN 1 ELSE 0 END) AS not_found_count,
             SUM(CASE WHEN aaa.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
             SUM(CASE WHEN aaa.country_or_region IS NOT NULL AND aaa.country_or_region <> '' THEN 1 ELSE 0 END) AS with_country_count
      FROM apple_ads_attribution aaa
      LEFT JOIN apple_ads_keyword_map akm
        ON CAST(aaa.keyword_id AS TEXT) = akm.keyword_id
      WHERE aaa.created_at > ?
        AND aaa.status <> 'test'
        AND NOT (
          COALESCE(aaa.org_id, -1) = 1234567890
          AND COALESCE(aaa.campaign_id, -1) = 1234567890
          AND COALESCE(aaa.ad_group_id, -1) = 1234567890
        )
      GROUP BY aaa.campaign_id,
               aaa.ad_group_id,
               aaa.keyword_id,
               akm.campaign_name,
               akm.ad_group_name,
               akm.keyword_text,
               akm.match_type
      ORDER BY resolved_count DESC, token_count DESC
      LIMIT ?
    `).all(since, limit);

    return rows.map((row) => ({
      ...row,
      token_count: Number(row.token_count || 0),
      user_count: Number(row.user_count || 0),
      resolved_count: Number(row.resolved_count || 0),
      not_found_count: Number(row.not_found_count || 0),
      failed_count: Number(row.failed_count || 0),
      with_country_count: Number(row.with_country_count || 0),
    }));
  }

  async function getAttributionTotals({ since }) {
    const [
      withAttribution,
      totalShares,
      downloadsWithAttribution,
      totalDownloads,
      attributedRegistrations,
    ] = await Promise.all([
      db.prepare(`
        SELECT COUNT(*) as count
        FROM share_tokens
        WHERE created_at > ? AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
      `).get(since),
      db.prepare(`
        SELECT COUNT(*) as count FROM share_tokens WHERE created_at > ?
      `).get(since),
      db.prepare(`
        SELECT COUNT(*) as count
        FROM download_events
        WHERE created_at > ? AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
      `).get(since),
      db.prepare(`
        SELECT COUNT(*) as count FROM download_events WHERE created_at > ?
      `).get(since),
      db.prepare(`
        SELECT COUNT(DISTINCT matched_user_id) as count
        FROM download_events
        WHERE created_at > ? AND matched_user_id IS NOT NULL
          AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
      `).get(since),
    ]);

    return {
      withAttribution: Number(withAttribution?.count || 0),
      totalShares: Number(totalShares?.count || 0),
      downloadsWithAttribution: Number(downloadsWithAttribution?.count || 0),
      totalDownloads: Number(totalDownloads?.count || 0),
      attributedRegistrations: Number(attributedRegistrations?.count || 0),
    };
  }

  async function listAppleAdsKeywordMap({ limit, offset }) {
    const rows = await db.prepare(`
      SELECT keyword_id,
             campaign_id,
             campaign_name,
             ad_group_id,
             ad_group_name,
             keyword_text,
             match_type,
             bid_amount,
             status,
             source,
             last_seen_at,
             updated_at
      FROM apple_ads_keyword_map
      ORDER BY
        CASE WHEN last_seen_at IS NULL THEN 1 ELSE 0 END,
        last_seen_at DESC,
        campaign_name,
        ad_group_name,
        keyword_text
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = (await db.prepare(`
      SELECT COUNT(*) AS count FROM apple_ads_keyword_map
    `).get())?.count ?? 0;

    return {
      rows,
      total: Number(total || 0),
      limit,
      offset,
    };
  }

  async function upsertAppleAdsKeywordMapRow({
    keywordId,
    campaignId,
    campaignName,
    adGroupId,
    adGroupName,
    keywordText,
    matchType,
    bidAmount,
    status,
    source,
    lastSeenAt,
    now,
  }) {
    return db.prepare(`
      INSERT INTO apple_ads_keyword_map (
        keyword_id,
        campaign_id,
        campaign_name,
        ad_group_id,
        ad_group_name,
        keyword_text,
        match_type,
        bid_amount,
        status,
        source,
        last_seen_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(keyword_id) DO UPDATE SET
        campaign_id = excluded.campaign_id,
        campaign_name = excluded.campaign_name,
        ad_group_id = excluded.ad_group_id,
        ad_group_name = excluded.ad_group_name,
        keyword_text = excluded.keyword_text,
        match_type = excluded.match_type,
        bid_amount = excluded.bid_amount,
        status = excluded.status,
        source = excluded.source,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `).run(
      keywordId,
      campaignId,
      campaignName,
      adGroupId,
      adGroupName,
      keywordText,
      matchType,
      bidAmount,
      status,
      source,
      lastSeenAt,
      now,
      now,
    );
  }

  return {
    findAppleAdsAttributionByTokenHash,
    recordAppleAdsAttributionFailure,
    upsertAppleAdsAttributionResult,
    findLatestAppleAdsAttributionForUser,
    findLatestDownloadAttributionForUser,
    findRecentUnmatchedDownloadEventByIp,
    claimDownloadEventForUser,
    insertDownloadEvent,
    recordDownloadEvent,
    findLatestResolvedAppleAdsForUsers,
    findLatestAppleAdsForUsers,
    findLatestDownloadsForUsers,
    findUserAcquisitionForAppleAds,
    backfillUserFromAppleAds,
    findUserAcquisitionForDownload,
    replaceUserAcquisitionFromDownload,
    getUserAttributionHealthRow,
    getAppleAdsHealthRow,
    getAppleAdsBackfillMismatchRow,
    getDownloadHealthRow,
    getUsersWithAnyAttributionSignalRow,
    getAttributionHealthRows,
    listShareAttributionBreakdown,
    listDownloadAttributionBreakdown,
    listAppleAdsCampaignAttribution,
    getAttributionTotals,
    listAppleAdsKeywordMap,
    upsertAppleAdsKeywordMapRow,
  };
}

module.exports = { createAttributionRepository };

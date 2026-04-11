"use strict";

const crypto = require("crypto");
const { nowIso, toJson } = require("../utils/common");
const { newUuid } = require("../utils/ids");

function asInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function parseAppleAttributionResponse(rawText) {
  if (!rawText || !rawText.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawText);
  } catch {
    return {};
  }
}

function normalizeAppleAdsRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    api_status_code: row.api_status_code == null ? null : Number(row.api_status_code),
    campaign_id: row.campaign_id == null ? null : Number(row.campaign_id),
    ad_group_id: row.ad_group_id == null ? null : Number(row.ad_group_id),
    keyword_id: row.keyword_id == null ? null : Number(row.keyword_id),
    org_id: row.org_id == null ? null : Number(row.org_id),
    conversion_type: row.conversion_type,
    country_or_region: row.country_or_region,
    click_date: row.click_date,
    impression_date: row.impression_date,
    is_redownload:
      row.is_redownload == null
        ? null
        : row.is_redownload === true || row.is_redownload === 1,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
  };
}

function registerAnalyticsRoutes(app, {
  db,
  appConfig,
  requireUserId,
  sendError,
  addAuditEntry,
  eventsService,
}) {
  app.post("/analytics/apple-ads-attribution", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    const rawToken = request.body?.attributionToken;
    if (typeof rawToken !== "string") {
      return sendError(reply, 400, "INVALID_ATTRIBUTION_TOKEN", "Missing attributionToken.");
    }

    const attributionToken = rawToken.trim();
    if (attributionToken.length < 32) {
      return sendError(reply, 400, "INVALID_ATTRIBUTION_TOKEN", "Invalid attribution token.");
    }

    const tokenHash = crypto.createHash("sha256").update(attributionToken).digest("hex");
    const now = nowIso();
    const existing = await db.prepare(
      "SELECT * FROM apple_ads_attribution WHERE attribution_token_sha256 = ?"
    ).get(tokenHash);

    if (existing && ["resolved", "not_found"].includes(existing.status)) {
      reply.send({
        attribution: normalizeAppleAdsRow(existing),
        deduped: true,
      });
      return;
    }

    const controller = new AbortController();
    const timeoutMs = Number(appConfig.APPLE_ADS_ATTRIBUTION_TIMEOUT_MS || 8000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    let responseText = "";
    try {
      response = await fetch(appConfig.APPLE_ADS_ATTRIBUTION_URL, {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "user-agent": "PorizoAppleAdsAttribution/1.0",
        },
        body: attributionToken,
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (error) {
      clearTimeout(timeout);
      const message = error?.name === "AbortError"
        ? `Apple Ads attribution request timed out after ${timeoutMs}ms`
        : (error?.message || "Apple Ads attribution request failed.");

      if (existing) {
        await db.prepare(
          "UPDATE apple_ads_attribution SET status = ?, last_error = ?, updated_at = ? WHERE id = ?"
        ).run("failed", message, now, existing.id);
      } else {
        await db.prepare(`
          INSERT INTO apple_ads_attribution (
            id, user_id, attribution_token_sha256, token_length, status, last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newUuid(), userId, tokenHash, attributionToken.length, "failed", message, now, now);
      }

      return sendError(reply, 503, "APPLE_ADS_UNAVAILABLE", message);
    }
    clearTimeout(timeout);

    const payload = parseAppleAttributionResponse(responseText);
    const statusCode = Number(response.status);
    const normalizedStatus = response.status === 200 ? "resolved" : (response.status === 404 ? "not_found" : "failed");
    const lastError = normalizedStatus === "failed"
      ? (responseText.trim() || `Apple Ads attribution failed with status ${response.status}`)
      : null;
    const resolvedAt = normalizedStatus === "failed" ? null : now;

    const persisted = {
      apiStatusCode: statusCode,
      campaignId: asInteger(payload.campaignId ?? payload.campaignID),
      adGroupId: asInteger(payload.adGroupId ?? payload.adGroupID),
      keywordId: asInteger(payload.keywordId ?? payload.keywordID),
      orgId: asInteger(payload.orgId ?? payload.orgID),
      conversionType: payload.conversionType || null,
      countryOrRegion: payload.countryOrRegion || null,
      clickDate: payload.clickDate || null,
      impressionDate: payload.impressionDate || null,
      isRedownload:
        payload.isRedownload == null
          ? null
          : (payload.isRedownload === true || payload.isRedownload === 1 ? 1 : 0),
      rawResponseJson: responseText.trim() ? toJson(payload) : null,
      lastError,
      updatedAt: now,
      resolvedAt,
    };

    if (existing) {
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
        normalizedStatus,
        persisted.apiStatusCode,
        persisted.campaignId,
        persisted.adGroupId,
        persisted.keywordId,
        persisted.orgId,
        persisted.conversionType,
        persisted.countryOrRegion,
        persisted.clickDate,
        persisted.impressionDate,
        persisted.isRedownload,
        persisted.rawResponseJson,
        persisted.lastError,
        persisted.updatedAt,
        persisted.resolvedAt,
        existing.id
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
        newUuid(),
        userId,
        tokenHash,
        attributionToken.length,
        normalizedStatus,
        persisted.apiStatusCode,
        persisted.campaignId,
        persisted.adGroupId,
        persisted.keywordId,
        persisted.orgId,
        persisted.conversionType,
        persisted.countryOrRegion,
        persisted.clickDate,
        persisted.impressionDate,
        persisted.isRedownload,
        persisted.rawResponseJson,
        persisted.lastError,
        now,
        persisted.updatedAt,
        persisted.resolvedAt
      );
    }

    const row = await db.prepare(
      "SELECT * FROM apple_ads_attribution WHERE attribution_token_sha256 = ?"
    ).get(tokenHash);

    await addAuditEntry({
      userId,
      action: "apple_ads_attribution_capture",
      resourceType: "apple_ads_attribution",
      resourceId: row.id,
      metadata: {
        status: normalizedStatus,
        api_status_code: statusCode,
        campaign_id: row.campaign_id,
        ad_group_id: row.ad_group_id,
        keyword_id: row.keyword_id,
        org_id: row.org_id,
      },
    });

    eventsService.emit("apple_ads_attribution_capture", {
      userId,
      resourceType: "apple_ads_attribution",
      resourceId: row.id,
      metadata: {
        status: normalizedStatus,
        api_status_code: statusCode,
        campaign_id: row.campaign_id,
        ad_group_id: row.ad_group_id,
        keyword_id: row.keyword_id,
        org_id: row.org_id,
      },
    });

    if (normalizedStatus === "failed") {
      return sendError(reply, 502, "APPLE_ADS_RESOLUTION_FAILED", lastError || "Apple Ads attribution resolution failed.");
    }

    reply.send({
      attribution: normalizeAppleAdsRow(row),
      deduped: false,
    });
  });
}

module.exports = {
  registerAnalyticsRoutes,
};

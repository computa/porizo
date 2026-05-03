"use strict";

const crypto = require("crypto");
const { nowIso, toJson } = require("../utils/common");
const { newUuid } = require("../utils/ids");
const { AttributionService } = require("../services/attribution-service");

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

// Keys that MUST NOT appear in event properties — server-side PII guard.
// Code review alone is not a control; this is enforced at ingest.
const FORBIDDEN_PROPERTY_KEYS = new Set([
  "email",
  "phone",
  "name",
  "recipient_name",
  "recipient",
  "message",
  "lyrics",
  "raw_text",
  "full_name",
  "user_email",
  "user_phone",
]);

const EVENT_NAME_REGEX = /^[a-z][a-z0-9_]{0,63}$/;
const EVENT_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;
const MAX_PROPERTY_KEYS = 8;
const MAX_PROPERTY_VALUE_LENGTH = 256;

function registerAnalyticsRoutes(app, {
  db,
  appConfig,
  requireUserId,
  sendError,
  addAuditEntry,
  eventsService,
  consumeRateLimit,
}) {
  const attributionService = new AttributionService(db);

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
      await attributionService.backfillUserAcquisitionFromAppleAds(existing);
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
    await attributionService.backfillUserAcquisitionFromAppleAds(row);

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

  // Client-side funnel event ingest. iOS posts here after firing Firebase;
  // rows flow into the `events` table for admin query. Fire-and-forget from
  // the client, so we optimise for fast validation + idempotent inserts.
  app.post("/analytics/event", async (request, reply) => {
    if (appConfig.ANALYTICS_INGEST_ENABLED === "false") {
      return sendError(reply, 503, "ANALYTICS_INGEST_DISABLED", "Analytics ingestion is currently disabled.");
    }

    const userId = await requireUserId(request, reply);
    if (!userId) {
      return;
    }

    // Rate limit: 100/min AND 2000/day per user. Cheap insurance against
    // a buggy or malicious client flooding the events table.
    if (typeof consumeRateLimit === "function") {
      const minuteLimit = await consumeRateLimit(userId, "analytics_event_minute", 100, 60);
      if (!minuteLimit.allowed) {
        return sendError(reply, 429, "RATE_LIMITED", "Analytics ingestion rate limit reached.", {
          retry_after: minuteLimit.reset_at,
        });
      }
      const dayLimit = await consumeRateLimit(userId, "analytics_event_day", 2000, 24 * 60 * 60);
      if (!dayLimit.allowed) {
        return sendError(reply, 429, "RATE_LIMITED", "Analytics ingestion daily cap reached.", {
          retry_after: dayLimit.reset_at,
        });
      }
    }

    const body = request.body || {};
    const eventId = body.event_id;
    const eventName = body.event_name;
    const properties = body.properties;
    const resourceType = body.resource_type;
    const resourceId = body.resource_id;

    const startedAt = Date.now();
    const logOutcome = (status, rejectReason) => {
      const durationMs = Date.now() - startedAt;
      if (rejectReason) {
        console.log(`[analytics/event] ${status} event_name=${eventName ?? "?"} user_id=${userId} duration_ms=${durationMs} reject=${rejectReason}`);
      } else {
        console.log(`[analytics/event] ${status} event_name=${eventName} user_id=${userId} duration_ms=${durationMs}`);
      }
    };

    if (typeof eventId !== "string" || !EVENT_ID_REGEX.test(eventId)) {
      logOutcome("rejected", "event_id");
      return sendError(reply, 400, "INVALID_EVENT_ID", "event_id must be a string of 8-64 alphanumeric/underscore/hyphen characters.");
    }
    if (typeof eventName !== "string" || !EVENT_NAME_REGEX.test(eventName)) {
      logOutcome("rejected", "event_name");
      return sendError(reply, 400, "INVALID_EVENT_NAME", "event_name must be snake_case, start with a letter, and be 1-64 chars.");
    }

    let metadata = null;
    if (properties !== undefined && properties !== null) {
      if (typeof properties !== "object" || Array.isArray(properties)) {
        logOutcome("rejected", "properties_type");
        return sendError(reply, 400, "INVALID_PROPERTIES", "properties must be an object.");
      }
      const keys = Object.keys(properties);
      if (keys.length > MAX_PROPERTY_KEYS) {
        logOutcome("rejected", "properties_count");
        return sendError(reply, 413, "PROPERTIES_TOO_MANY", `properties must have at most ${MAX_PROPERTY_KEYS} keys.`);
      }
      for (const key of keys) {
        if (FORBIDDEN_PROPERTY_KEYS.has(key)) {
          logOutcome("rejected", `forbidden_key:${key}`);
          return sendError(reply, 400, "FORBIDDEN_PROPERTY_KEY", `properties key "${key}" is not allowed (potential PII).`);
        }
        const value = properties[key];
        if (typeof value !== "string") {
          logOutcome("rejected", `non_string:${key}`);
          return sendError(reply, 400, "INVALID_PROPERTY_VALUE", `properties.${key} must be a string.`);
        }
        if (value.length > MAX_PROPERTY_VALUE_LENGTH) {
          logOutcome("rejected", `value_length:${key}`);
          return sendError(reply, 413, "PROPERTY_VALUE_TOO_LONG", `properties.${key} exceeds ${MAX_PROPERTY_VALUE_LENGTH} characters.`);
        }
      }
      metadata = properties;
    }

    if (resourceType !== undefined && typeof resourceType !== "string") {
      logOutcome("rejected", "resource_type");
      return sendError(reply, 400, "INVALID_RESOURCE_TYPE", "resource_type must be a string if provided.");
    }
    if (resourceId !== undefined && typeof resourceId !== "string") {
      logOutcome("rejected", "resource_id");
      return sendError(reply, 400, "INVALID_RESOURCE_ID", "resource_id must be a string if provided.");
    }

    try {
      const result = await eventsService.emit(eventName, {
        id: eventId,
        userId,
        resourceType: resourceType || undefined,
        resourceId: resourceId || undefined,
        metadata,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      const status = result.duplicate ? "duplicate" : "accepted";
      logOutcome(status);
      reply.code(202).send({ id: result.id, status });
    } catch (error) {
      logOutcome("error", error?.message || "emit_failed");
      return sendError(reply, 500, "INGEST_FAILED", "Failed to persist event.");
    }
  });
}

module.exports = {
  registerAnalyticsRoutes,
};

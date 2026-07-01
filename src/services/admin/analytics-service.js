"use strict";

function createAdminAnalyticsService({
  eventsRepository,
  now = () => new Date(),
  random = Math.random,
  cache = new Map(),
  cacheTtlMs = 60 * 1000,
}) {
  if (!eventsRepository) {
    throw new Error("eventsRepository is required");
  }
  if (typeof now !== "function") {
    throw new Error("now function is required");
  }
  if (typeof random !== "function") {
    throw new Error("random function is required");
  }
  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function") {
    throw new Error("cache must implement get and set");
  }

  function currentTimeMs() {
    const value = now();
    const timestamp =
      value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      throw new Error("now function returned an invalid date");
    }
    return timestamp;
  }

  function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= currentTimeMs()) {
      cache.delete?.(key);
      return null;
    }
    return entry.payload;
  }

  function cacheSet(key, payload) {
    cache.set(key, { payload, expiresAt: currentTimeMs() + cacheTtlMs });
  }

  function clampDays(days) {
    const n = Number.isFinite(Number(days)) ? Math.trunc(Number(days)) : 30;
    return Math.max(1, Math.min(365, n));
  }

  function clampLimit(limit, max = 200) {
    const n = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 50;
    return Math.max(1, Math.min(max, n));
  }

  function isoAgo(days) {
    return new Date(currentTimeMs() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  async function getAnalyticsOverview(days) {
    const clampedDays = clampDays(days);
    const cacheKey = `overview:${clampedDays}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const counts = await eventsRepository.getAdminEventCountsAfter(
      isoAgo(clampedDays),
    );
    const payload = { days: clampedDays, counts };
    cacheSet(cacheKey, payload);
    return payload;
  }

  async function getAnalyticsDaily(eventName, days) {
    const clampedDays = clampDays(days);
    const cacheKey = `daily:${eventName}:${clampedDays}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const byDay = await eventsRepository.getAdminDailyEventCountsAfter(
      eventName,
      isoAgo(clampedDays),
    );
    const payload = { event_name: eventName, days: clampedDays, byDay };
    cacheSet(cacheKey, payload);
    return payload;
  }

  async function getFunnelCohort(days) {
    const clampedDays = clampDays(days);
    const cacheKey = `funnel:${clampedDays}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const daysAgo = isoAgo(clampedDays);
    const hops = [
      ["auth_completed", "create_started"],
      ["create_started", "create_completed"],
      ["create_completed", "first_song_completed"],
      ["first_song_completed", "share_create"],
    ];

    const steps = [];
    for (const [from, to] of hops) {
      const startRow = await eventsRepository.countDistinctUsersForEventAfter(
        from,
        daysAgo,
      );
      const startUsers = startRow?.c ?? 0;

      const convertedRow =
        await eventsRepository.countDistinctUsersConvertedAfter(
          from,
          to,
          daysAgo,
        );
      const convertedUsers = convertedRow?.c ?? 0;

      steps.push({
        from,
        to,
        startUsers,
        convertedUsers,
        conversionRate:
          startUsers > 0
            ? ((convertedUsers / startUsers) * 100).toFixed(2)
            : "0.00",
      });
    }

    const payload = { days: clampedDays, steps };
    cacheSet(cacheKey, payload);
    return payload;
  }

  async function getUserAnalytics(adminId, adminEmail, userId, limit) {
    const clampedLimit = clampLimit(limit, 200);
    const events = await eventsRepository.getAdminUserEvents(
      userId,
      clampedLimit,
    );

    const timestampMs = currentTimeMs();
    const metadata = JSON.stringify({
      admin_id: adminId,
      admin_email: adminEmail,
      target_user_id: userId,
      event_count: events.length,
    });
    await eventsRepository.insertUserAnalyticsReadAudit({
      id: `audit_${timestampMs.toString(36)}_${random().toString(36).slice(2, 10)}`,
      adminId,
      targetUserId: userId,
      metadataJson: metadata,
      createdAt: new Date(timestampMs).toISOString(),
    });

    return { userId, limit: clampedLimit, events };
  }

  return {
    getAnalyticsOverview,
    getAnalyticsDaily,
    getFunnelCohort,
    getUserAnalytics,
  };
}

module.exports = {
  createAdminAnalyticsService,
};

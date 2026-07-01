"use strict";

function escapeLikePattern(str) {
  return String(str).replace(/[%_\\]/g, "\\$&");
}

function buildUserSearchFilter({
  email,
  userId,
  riskLevel,
  tier,
  trackId,
  shareId,
  recipientName,
}) {
  const where = ["1=1"];
  const params = [];

  if (email) {
    const escaped = escapeLikePattern(email);
    where.push("u.email LIKE ? ESCAPE '\\'");
    params.push(`%${escaped}%`);
  }
  if (userId) {
    where.push("u.id = ?");
    params.push(userId);
  }
  if (riskLevel) {
    where.push("u.risk_level = ?");
    params.push(riskLevel);
  }
  if (tier) {
    if (tier === "free") {
      where.push("(e.tier = 'free' OR e.tier IS NULL)");
    } else {
      where.push("e.tier = ?");
      params.push(tier);
    }
  }
  if (trackId) {
    where.push(
      "EXISTS (SELECT 1 FROM tracks t2 WHERE t2.id = ? AND t2.user_id = u.id)",
    );
    params.push(trackId);
  }
  if (shareId) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM share_tokens st
        JOIN tracks t3 ON t3.id = st.track_id
        WHERE st.id = ? AND t3.user_id = u.id
      )
    `);
    params.push(shareId);
  }
  if (recipientName) {
    const escaped = escapeLikePattern(recipientName);
    where.push(
      "EXISTS (SELECT 1 FROM tracks t4 WHERE t4.user_id = u.id AND t4.recipient_name LIKE ? ESCAPE '\\')",
    );
    params.push(`%${escaped}%`);
  }

  return {
    whereSql: where.join(" AND "),
    params,
  };
}

function createAdminUserReadRepository(db) {
  async function searchUsers(filters) {
    const { limit, offset } = filters;
    const filter = buildUserSearchFilter(filters);

    const sql = `
      SELECT
        u.id, u.email, u.display_name, u.risk_level, u.locked_until, u.created_at,
        u.country,
        u.acquisition_source,
        u.acquisition_medium,
        u.acquisition_campaign,
        u.acquisition_content,
        u.acquisition_term,
        u.acquisition_country,
        u.acquisition_referrer,
        u.acquisition_at,
        COALESCE(e.tier, 'free') as tier,
        COALESCE(e.gift_songs_used_total, 0) as gift_songs_used_total,
        COALESCE(track_counts.track_count, 0) as track_count,
        COALESCE(vp.status, 'none') as voice_status,
        COALESCE(activity.last_active, u.created_at) as last_active
      FROM users u
      LEFT JOIN entitlements e ON e.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) as track_count
        FROM tracks
        GROUP BY user_id
      ) track_counts ON track_counts.user_id = u.id
      LEFT JOIN voice_profiles vp ON vp.id = (
        SELECT vp2.id
        FROM voice_profiles vp2
        WHERE vp2.user_id = u.id AND vp2.deleted_at IS NULL
        ORDER BY vp2.created_at DESC, vp2.id DESC
        LIMIT 1
      )
      LEFT JOIN (
        SELECT user_id, MAX(created_at) as last_active
        FROM tracks
        GROUP BY user_id
      ) activity ON activity.user_id = u.id
      WHERE ${filter.whereSql}
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(DISTINCT u.id) as total
      FROM users u
      LEFT JOIN entitlements e ON e.user_id = u.id
      WHERE ${filter.whereSql}
    `;

    const [users, countRow] = await Promise.all([
      db.prepare(sql).all(...filter.params, limit, offset),
      db.prepare(countSql).get(...filter.params),
    ]);

    return {
      users,
      total: Number(countRow?.total || 0),
    };
  }

  async function getUserStats() {
    const stats = await db
      .prepare(
        `SELECT
           COUNT(*) as total_users,
           SUM(CASE WHEN e.tier IN ('pro', 'plus') THEN 1 ELSE 0 END) as paid_users,
           SUM(CASE WHEN e.tier = 'trial' THEN 1 ELSE 0 END) as trial_users,
           SUM(CASE WHEN e.tier = 'free' OR e.tier IS NULL THEN 1 ELSE 0 END) as free_users
         FROM users u
         LEFT JOIN entitlements e ON e.user_id = u.id`,
      )
      .get();

    return {
      totalUsers: Number(stats?.total_users || 0),
      paidUsers: Number(stats?.paid_users || 0),
      trialUsers: Number(stats?.trial_users || 0),
      freeUsers: Number(stats?.free_users || 0),
    };
  }

  async function getUserById(userId) {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  }

  async function getUserVoiceProfile(userId) {
    return db
      .prepare(
        `SELECT id, status, quality_score, created_at
         FROM voice_profiles
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(userId);
  }

  async function getUserEntitlements(userId) {
    return db.prepare("SELECT * FROM entitlements WHERE user_id = ?").get(userId);
  }

  async function getLatestUserSubscription(userId) {
    return db
      .prepare(
        "SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId);
  }

  async function listUserTracks(userId) {
    return db
      .prepare(
        "SELECT id, title, occasion, status, created_at FROM tracks WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
      )
      .all(userId);
  }

  async function listUserShares(userId) {
    return db
      .prepare(
        `SELECT st.id, st.status, st.access_count, t.title
         FROM share_tokens st
         JOIN tracks t ON st.track_id = t.id
         WHERE t.user_id = ?
         ORDER BY st.created_at DESC LIMIT 10`,
      )
      .all(userId);
  }

  async function getLatestUserDownloadAttribution(userId) {
    return db
      .prepare(
        `SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, referrer_url, created_at
         FROM download_events
         WHERE matched_user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId);
  }

  async function getLatestResolvedAppleAdsAttribution(userId) {
    return db
      .prepare(
        `SELECT id, status, campaign_id, ad_group_id, keyword_id, org_id, conversion_type, country_or_region, click_date, created_at, resolved_at
         FROM apple_ads_attribution
         WHERE user_id = ? AND status = 'resolved'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId);
  }

  return {
    searchUsers,
    getUserStats,
    getUserById,
    getUserVoiceProfile,
    getUserEntitlements,
    getLatestUserSubscription,
    listUserTracks,
    listUserShares,
    getLatestUserDownloadAttribution,
    getLatestResolvedAppleAdsAttribution,
  };
}

module.exports = {
  buildUserSearchFilter,
  createAdminUserReadRepository,
};

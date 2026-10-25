"use strict";

function escapeLikePattern(str) {
  return String(str).replace(/[%_\\]/g, "\\$&");
}

const REGISTRATION_STATUS_SQL = `CASE
  WHEN u.deleted_at IS NOT NULL THEN 'deleted'
  WHEN EXISTS (
    SELECT 1 FROM user_auth_providers registration_provider
    WHERE registration_provider.user_id = u.id
      AND registration_provider.status = 'active'
  ) THEN 'registered'
  WHEN u.account_status = 'guest' THEN 'guest'
  ELSE 'unclaimed'
END`;

const CANONICAL_EMAIL_SQL = `(SELECT contact.value_display
  FROM user_contacts contact
  WHERE contact.user_id = u.id AND contact.type = 'email'
  ORDER BY
    CASE WHEN contact.verified_at IS NOT NULL THEN 0 ELSE 1 END,
    CASE WHEN contact.is_primary THEN 0 ELSE 1 END,
    contact.created_at,
    contact.id
  LIMIT 1)`;

const CANONICAL_EMAIL_VERIFIED_AT_SQL = `(SELECT contact.verified_at
  FROM user_contacts contact
  WHERE contact.user_id = u.id AND contact.type = 'email'
  ORDER BY
    CASE WHEN contact.verified_at IS NOT NULL THEN 0 ELSE 1 END,
    CASE WHEN contact.is_primary THEN 0 ELSE 1 END,
    contact.created_at,
    contact.id
  LIMIT 1)`;

const IDENTITY_SELECT_SQL = `
  ${REGISTRATION_STATUS_SQL} AS registration_status,
  u.account_status,
  COALESCE(${CANONICAL_EMAIL_SQL}, u.email) AS canonical_email,
  CASE
    WHEN ${CANONICAL_EMAIL_VERIFIED_AT_SQL} IS NOT NULL THEN 'verified'
    WHEN ${CANONICAL_EMAIL_SQL} IS NOT NULL THEN 'unverified'
    WHEN u.email IS NOT NULL THEN 'legacy'
    ELSE 'none'
  END AS email_status,
  CASE WHEN EXISTS (
    SELECT 1 FROM user_auth_providers provider
    WHERE provider.user_id = u.id AND provider.status = 'active' AND provider.provider = 'apple'
  ) THEN 1 ELSE 0 END AS has_apple_auth,
  CASE WHEN EXISTS (
    SELECT 1 FROM user_auth_providers provider
    WHERE provider.user_id = u.id AND provider.status = 'active' AND provider.provider = 'google'
  ) THEN 1 ELSE 0 END AS has_google_auth,
  CASE WHEN EXISTS (
    SELECT 1 FROM user_auth_providers provider
    WHERE provider.user_id = u.id AND provider.status = 'active' AND provider.provider = 'email'
  ) THEN 1 ELSE 0 END AS has_email_auth,
  CASE WHEN EXISTS (
    SELECT 1 FROM user_auth_providers provider
    WHERE provider.user_id = u.id AND provider.status = 'active' AND provider.provider = 'phone'
  ) THEN 1 ELSE 0 END AS has_phone_auth`;

function normalizeIdentityFields(row) {
  if (!row) return row;
  const authMethods = ["apple", "google", "email", "phone"].filter(
    (provider) => row[`has_${provider}_auth`],
  );
  const normalized = {
    ...row,
    email: row.canonical_email,
    auth_methods: authMethods,
  };
  delete normalized.canonical_email;
  for (const provider of ["apple", "google", "email", "phone"]) {
    delete normalized[`has_${provider}_auth`];
  }
  return normalized;
}

function buildUserSearchFilter({
  email,
  userId,
  riskLevel,
  tier,
  registrationStatus = "registered",
  trackId,
  shareId,
  recipientName,
}) {
  const where = ["1=1"];
  const params = [];

  if (email) {
    const escaped = escapeLikePattern(email);
    where.push(`(
      u.email LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM user_contacts email_contact
        WHERE email_contact.user_id = u.id
          AND email_contact.type = 'email'
          AND email_contact.value_normalized LIKE ? ESCAPE '\\'
      )
    )`);
    params.push(`%${escaped}%`, `%${escaped}%`);
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
  if (registrationStatus !== "all") {
    where.push(`${REGISTRATION_STATUS_SQL} = ?`);
    params.push(registrationStatus);
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
        u.id, u.display_name, u.risk_level, u.locked_until, u.created_at,
        ${IDENTITY_SELECT_SQL},
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
      users: users.map(normalizeIdentityFields),
      total: Number(countRow?.total || 0),
    };
  }

  async function getUserStats() {
    const stats = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN ${REGISTRATION_STATUS_SQL} = 'registered' THEN 1 ELSE 0 END) as total_users,
           SUM(CASE WHEN ${REGISTRATION_STATUS_SQL} = 'registered' AND e.tier IN ('pro', 'plus') THEN 1 ELSE 0 END) as paid_users,
           SUM(CASE WHEN ${REGISTRATION_STATUS_SQL} = 'registered' AND e.tier = 'trial' THEN 1 ELSE 0 END) as trial_users,
           SUM(CASE WHEN ${REGISTRATION_STATUS_SQL} = 'registered' AND (e.tier = 'free' OR e.tier IS NULL) THEN 1 ELSE 0 END) as free_users,
           SUM(CASE WHEN ${REGISTRATION_STATUS_SQL} = 'guest' THEN 1 ELSE 0 END) as guest_users,
           SUM(CASE WHEN ${REGISTRATION_STATUS_SQL} = 'unclaimed' THEN 1 ELSE 0 END) as unclaimed_users,
           SUM(CASE WHEN ${REGISTRATION_STATUS_SQL} = 'deleted' THEN 1 ELSE 0 END) as deleted_users
         FROM users u
         LEFT JOIN entitlements e ON e.user_id = u.id`,
      )
      .get();

    return {
      totalUsers: Number(stats?.total_users || 0),
      paidUsers: Number(stats?.paid_users || 0),
      trialUsers: Number(stats?.trial_users || 0),
      freeUsers: Number(stats?.free_users || 0),
      guestUsers: Number(stats?.guest_users || 0),
      unclaimedUsers: Number(stats?.unclaimed_users || 0),
      deletedUsers: Number(stats?.deleted_users || 0),
    };
  }

  async function getUserById(userId) {
    const user = await db
      .prepare(
        `SELECT u.*, ${IDENTITY_SELECT_SQL}
         FROM users u
         WHERE u.id = ?`,
      )
      .get(userId);
    return normalizeIdentityFields(user);
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

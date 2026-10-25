async function insertUser(db, userId) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')",
    )
    .run(userId, new Date().toISOString());
  await db
    .prepare(
      "INSERT OR IGNORE INTO user_auth_providers (id, user_id, provider, provider_user_id, status) VALUES (?, ?, 'apple', ?, 'active')",
    )
    .run(`provider_${userId}`, userId, `apple_${userId}`);
}

async function insertAppleAdsAttribution(
  db,
  {
    id,
    userId,
    status,
    campaignId = null,
    adGroupId = null,
    keywordId = null,
    country = null,
    clickDate = null,
    createdAt = new Date().toISOString(),
  },
) {
  await db
    .prepare(
      `INSERT INTO apple_ads_attribution (
        id, user_id, attribution_token_sha256, token_length, status, api_status_code,
        campaign_id, ad_group_id, keyword_id, country_or_region, click_date, created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      `${id}_token_hash`,
      64,
      status,
      status === "resolved" ? 200 : status === "not_found" ? 404 : null,
      campaignId,
      adGroupId,
      keywordId,
      country,
      clickDate,
      createdAt,
      createdAt,
      status === "pending" ? null : createdAt,
    );
}

module.exports = { insertAppleAdsAttribution, insertUser };

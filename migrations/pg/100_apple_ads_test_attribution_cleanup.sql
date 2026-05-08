UPDATE apple_ads_attribution
SET status = 'test',
    last_error = COALESCE(
      last_error,
      'Apple Ads returned developer-mode test attribution data - ignored for acquisition reporting.'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'resolved'
  AND COALESCE(org_id, -1) = 1234567890
  AND COALESCE(campaign_id, -1) = 1234567890
  AND COALESCE(ad_group_id, -1) = 1234567890;

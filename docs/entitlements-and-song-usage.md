# Entitlements And Song Usage

New users receive the admin-configured one-time free signup song grant from `free_tier_songs_grant`, currently seeded to 2 song credits. The free subscription plan remains 0 songs per month; there is no monthly free refill.

Trial song grants are disabled by default. Re-enabling `trial_config.is_active` must be a deliberate product decision because it adds songs on top of the signup grant.

`tier = free` does not mean unpaid. A free-tier user can have paid one-off credits in `gift_wallet.balance`.

Count generated songs from `track_versions.song_entitlement_consumed_at IS NOT NULL`, not from `tracks` or `create_completed` events. Tracks can be drafts.

Use `entitlements.songs_used_total` for all rendered songs charged to any funding source. Use `entitlements.gift_songs_used_total` for the subset funded by paid gift-wallet credits.

For per-user reporting, prefer `user_song_usage_summary`.

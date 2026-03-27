-- Update Plus plan: 10 songs + 10 poems per month (was 4 songs, 0 poems)
UPDATE subscription_plans SET songs_per_month = 10, poems_per_month = 10
WHERE id = 'plus';

-- Update Pro plan: 20 songs + 20 poems per month (was 10 songs, 0 poems)
UPDATE subscription_plans SET songs_per_month = 20, poems_per_month = 20
WHERE id = 'pro';

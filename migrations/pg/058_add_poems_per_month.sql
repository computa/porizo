-- Migration: Add poems_per_month entitlement to subscription plans
-- Allows admin to configure how many poems each plan tier can generate per month

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS poems_per_month INTEGER NOT NULL DEFAULT 0;

-- Backfill existing plans
UPDATE subscription_plans SET poems_per_month = 10 WHERE tier = 'plus';
UPDATE subscription_plans SET poems_per_month = 20 WHERE tier = 'pro';

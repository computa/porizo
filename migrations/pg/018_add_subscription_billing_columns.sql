-- Migration: Add billing retry and upgrade/downgrade tracking columns to subscriptions table

-- Add billing retry flag
ALTER TABLE subscriptions ADD COLUMN is_in_billing_retry INTEGER DEFAULT 0;

-- Add pending product for upgrade/downgrade tracking
ALTER TABLE subscriptions ADD COLUMN pending_product_id TEXT;

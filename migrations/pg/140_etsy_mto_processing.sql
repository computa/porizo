ALTER TABLE etsy_mto_items ADD COLUMN lease_token TEXT;
ALTER TABLE etsy_mto_items ADD COLUMN lease_until TEXT;
ALTER TABLE etsy_mto_items ADD COLUMN last_error TEXT;

ALTER TABLE gift_orders ADD COLUMN recipient_name TEXT;

UPDATE gift_orders
SET recipient_name = COALESCE(
  recipient_name,
  json_extract(content_snapshot_json, '$.recipient_name')
)
WHERE recipient_name IS NULL;

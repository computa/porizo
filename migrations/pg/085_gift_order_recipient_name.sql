ALTER TABLE gift_orders ADD COLUMN IF NOT EXISTS recipient_name TEXT;

UPDATE gift_orders
SET recipient_name = COALESCE(
  recipient_name,
  CASE
    WHEN content_snapshot_json IS NULL OR btrim(content_snapshot_json) = '' THEN NULL
    ELSE (content_snapshot_json::jsonb ->> 'recipient_name')
  END
)
WHERE recipient_name IS NULL;

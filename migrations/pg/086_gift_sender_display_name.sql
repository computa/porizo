ALTER TABLE gift_orders ADD COLUMN IF NOT EXISTS sender_display_name TEXT;

UPDATE gift_orders
SET sender_display_name = (
  SELECT COALESCE(
    NULLIF(TRIM(u.display_name), ''),
    SPLIT_PART(u.email, '@', 1)
  )
  FROM users u WHERE u.id = gift_orders.sender_user_id
)
WHERE sender_display_name IS NULL;

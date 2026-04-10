ALTER TABLE gift_orders ADD COLUMN sender_display_name TEXT;

UPDATE gift_orders
SET sender_display_name = (
  SELECT COALESCE(
    NULLIF(TRIM(u.display_name), ''),
    SUBSTR(u.email, 1, INSTR(u.email, '@') - 1)
  )
  FROM users u WHERE u.id = gift_orders.sender_user_id
)
WHERE sender_display_name IS NULL;

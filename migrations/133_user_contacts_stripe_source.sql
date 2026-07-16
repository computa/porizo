-- No-op for SQLite: migrations/091_user_contacts.sql defines source as plain
-- TEXT NOT NULL with no CHECK constraint, so 'stripe_checkout' is already
-- accepted. The PostgreSQL twin (migrations/pg/133) rebuilds the CHECK to add
-- 'stripe_checkout' — the same class of gap that broke prod new-user signups
-- with 23514 when 'magic_link' was missing (migration 130).
SELECT 1;

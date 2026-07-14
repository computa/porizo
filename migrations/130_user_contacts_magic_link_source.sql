-- No-op for SQLite: migrations/091_user_contacts.sql defines source as plain
-- TEXT NOT NULL with no CHECK constraint, so 'magic_link' is already accepted.
-- The PostgreSQL twin (migrations/pg/130) rebuilds the 091 CHECK to include
-- 'magic_link', which production rejected with 23514 on new-user signup.
SELECT 1;

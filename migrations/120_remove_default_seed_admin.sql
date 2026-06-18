-- (Postgres-only migration) Migration 120 removes the default seed admin in Postgres.
-- Intentionally a NO-OP for SQLite: the test suite uses the seeded admin
-- (admin@porizo.app / admin123 from migration 023) as a login fixture, so it must
-- remain in SQLite. This placeholder reserves the migration number to keep the two
-- dialects aligned and prevent number reuse.
SELECT 1;

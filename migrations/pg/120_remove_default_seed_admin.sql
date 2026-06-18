-- Remove the insecure default seed admin (admin@porizo.app / admin123, id adm_initial).
-- Production and any fresh Postgres environment must NOT carry a default-credential
-- superadmin. The real admin (abcobimma@gmail.com) was created via the admin setup
-- endpoint; new environments bootstrap their first admin the same way
-- (POST /admin/auth/setup, gated by ADMIN_SETUP_SECRET) -- no default password ever.
--
-- Postgres-only ON PURPOSE: the SQLite migration keeps the seed as a login fixture
-- for the admin test suite. The two dialects are tracked in separate
-- schema_migrations tables, so they are allowed to diverge here.
--
-- Idempotent: a no-op on the live prod DB where the row was already removed manually.
-- admin_sessions cascades on the admin_users delete; cleared explicitly first anyway.
DELETE FROM admin_sessions WHERE admin_id = 'adm_initial';
DELETE FROM admin_users WHERE id = 'adm_initial';

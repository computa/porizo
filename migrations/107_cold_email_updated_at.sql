-- 107_cold_email_updated_at.sql
-- Adds updated_at to cold_email_campaigns for optimistic concurrency on
-- the admin PATCH endpoint. Without it, two concurrent PATCHes with
-- disjoint fields silently last-writer-wins per field.
--
-- The application is the source of truth for updated_at (no trigger) —
-- every UPDATE statement in src/services/cold-email-service.js and
-- src/routes/admin.js sets it explicitly. Easier to reason about than
-- a trigger that fires for some UPDATEs and not others.

ALTER TABLE cold_email_campaigns ADD COLUMN updated_at TEXT;
UPDATE cold_email_campaigns SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL;

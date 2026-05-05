-- Migration 098: Add consent_scopes column to enrollment_sessions (SQLite)
--
-- Per docs/plans/2026-05-05-002-fix-suno-voice-persona-architecture-findings-plan.md U17.
-- See migrations/pg/098_enrollment_sessions_consent_scopes.sql for full rationale.
--
-- SQLite notes:
--   - SQLite does not support `ADD COLUMN IF NOT EXISTS`. The migration runner skips
--     already-applied migrations via `schema_migrations`, so this is safe on first apply.
--     Manual re-runs against an existing column will fail; that's acceptable per the
--     migration-runner contract.
--   - SQLite does not support DISTINCT ON; use a correlated subquery instead.

ALTER TABLE enrollment_sessions ADD COLUMN consent_scopes TEXT;

UPDATE enrollment_sessions
SET consent_scopes = (
  SELECT vpp.consent_scope
  FROM voice_provider_profiles vpp
  WHERE vpp.user_id = enrollment_sessions.user_id
    AND vpp.consent_scope IS NOT NULL
    AND vpp.deleted_at IS NULL
  ORDER BY vpp.created_at DESC
  LIMIT 1
)
WHERE consent_scopes IS NULL;

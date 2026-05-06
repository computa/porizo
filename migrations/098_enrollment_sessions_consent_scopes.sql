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
-- Existing rows intentionally remain NULL. Persona consent is granted only by
-- an enrollment request payload, not by retroactively copying provider rows.

ALTER TABLE enrollment_sessions ADD COLUMN consent_scopes TEXT;

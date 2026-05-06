-- Migration 098: Add consent_scopes column to enrollment_sessions (PostgreSQL)
--
-- Per docs/plans/2026-05-05-002-fix-suno-voice-persona-architecture-findings-plan.md U17.
-- The legacy `consent_version` column stores a semver-shaped value ("1.0"), not a
-- scope-list. Reading `consent_version` as a scope ("voice_suno_persona_v1") was the
-- silent-deny bug behind the Suno persona consent gate.
--
-- This migration adds a dedicated `consent_scopes` column for scope-list storage
-- (e.g. "voice_suno_persona_v1" or a JSON array of scopes).
--
-- After this migration, U2's enrollmentSessionHasPersonaConsent reads consent_scopes;
-- consent_version remains for backward compatibility but is no longer treated as a scope.
-- Existing rows intentionally remain NULL. Persona consent is granted only by an
-- enrollment request payload, not by retroactively copying provider rows.

ALTER TABLE enrollment_sessions
  ADD COLUMN IF NOT EXISTS consent_scopes TEXT;

ALTER TABLE enrollment_sessions
  DROP CONSTRAINT IF EXISTS enrollment_sessions_consent_scopes_format;

ALTER TABLE enrollment_sessions
  ADD CONSTRAINT enrollment_sessions_consent_scopes_format
  CHECK (consent_scopes IS NULL OR consent_scopes LIKE '[%' OR consent_scopes = 'voice_suno_persona_v1')
  NOT VALID;

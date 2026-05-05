-- Migration 098: Add consent_scopes column to enrollment_sessions (PostgreSQL)
--
-- Per docs/plans/2026-05-05-002-fix-suno-voice-persona-architecture-findings-plan.md U17.
-- The legacy `consent_version` column stores a semver-shaped value ("1.0"), not a
-- scope-list. Reading `consent_version` as a scope ("voice_suno_persona_v1") was the
-- silent-deny bug behind the Suno persona consent gate.
--
-- This migration adds a dedicated `consent_scopes` column for scope-list storage
-- (e.g. "voice_suno_persona_v1" or a JSON array of scopes), and backfills it for
-- existing rows from the most recent voice_provider_profiles.consent_scope per user.
--
-- After this migration, U2's enrollmentSessionHasPersonaConsent reads consent_scopes;
-- consent_version remains for backward compatibility but is no longer treated as a scope.

ALTER TABLE enrollment_sessions
  ADD COLUMN IF NOT EXISTS consent_scopes TEXT;

-- Backfill: for each enrollment_session with NULL consent_scopes, copy the most
-- recent (and non-null) consent_scope from a matching voice_provider_profiles row
-- for the same user. If the user has no voice_provider_profiles with a non-null
-- scope, consent_scopes stays NULL — fail-secure (U2 will deny consent).
UPDATE enrollment_sessions es
SET consent_scopes = sub.consent_scope
FROM (
  SELECT DISTINCT ON (vpp.user_id)
    vpp.user_id,
    vpp.consent_scope
  FROM voice_provider_profiles vpp
  WHERE vpp.consent_scope IS NOT NULL
    AND vpp.deleted_at IS NULL
  ORDER BY vpp.user_id, vpp.created_at DESC
) sub
WHERE es.user_id = sub.user_id
  AND es.consent_scopes IS NULL;

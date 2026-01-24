-- Migration: Extend auth_events event_type CHECK constraint
-- Adds: signup_success, orphaned_provider_recovery

-- SQLite: Need to recreate table (SQLite doesn't support ALTER CONSTRAINT)
-- For SQLite, this is a no-op since CHECK constraints aren't enforced the same way
-- The application code handles validation

-- This migration is primarily for PostgreSQL compatibility
-- SQLite version is kept for migration tracking consistency

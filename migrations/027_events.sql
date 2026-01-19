-- Migration: Unified events table for all telemetry
-- This table provides a single source of truth for analytics, growth tracking,
-- and funnel analysis across the entire platform.

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for querying by event type (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);

-- Index for user-scoped queries (user activity, funnel analysis)
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);

-- Index for resource-scoped queries (track/share specific events)
CREATE INDEX IF NOT EXISTS idx_events_resource ON events(resource_type, resource_id);

-- Index for time-based queries (dashboards, reports)
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- Composite index for common dashboard queries: event type + time range
CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(event_name, created_at);

-- Event types reference:
-- Story flow:     story_start, story_confirm, story_abandon
-- Render flow:    render_start, render_ready, render_fail
-- Share flow:     share_create, share_claim, share_stream
-- Teaser flow:    teaser_viewed, teaser_click
-- Auth flow:      auth_login, auth_logout, auth_register
-- Subscription:   subscription_start, subscription_renew, subscription_cancel

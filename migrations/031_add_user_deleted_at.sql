-- Migration 031: Add deleted_at column to users table
-- Required for GDPR Article 17 account deletion (soft delete with audit trail)
-- The auth-service.js deleteUserAccount() function references this column

-- Add deleted_at column for soft deletion
ALTER TABLE users ADD COLUMN deleted_at TEXT;

-- Index for efficient filtering of non-deleted users
CREATE INDEX idx_users_deleted_at ON users(deleted_at);

-- Index for finding users by email (excluding deleted)
CREATE INDEX idx_users_email_active ON users(email) WHERE deleted_at IS NULL;

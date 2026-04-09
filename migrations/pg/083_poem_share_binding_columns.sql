-- Add missing poem share binding column for PostgreSQL databases created from
-- the early poem sharing migration set. SQLite already had this column, but
-- PostgreSQL omitted it in 036 and later gift flows now rely on it.

ALTER TABLE poem_share_tokens
  ADD COLUMN IF NOT EXISTS bound_device_id TEXT;

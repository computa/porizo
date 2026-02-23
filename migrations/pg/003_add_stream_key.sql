ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS stream_key_id TEXT;
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS stream_key TEXT;

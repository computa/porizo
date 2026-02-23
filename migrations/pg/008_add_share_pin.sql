-- Add claim PIN for share token verification
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS claim_pin TEXT;
ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS claim_attempts INTEGER NOT NULL DEFAULT 0;

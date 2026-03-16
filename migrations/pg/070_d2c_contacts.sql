-- D2C Contact Schema: person-centric contacts + per-campaign engagement tracking

-- Step 1: Add new columns and make company_name nullable
ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE marketing_contacts ALTER COLUMN company_name DROP NOT NULL;

ALTER TABLE marketing_contacts DROP CONSTRAINT IF EXISTS chk_contact_status;
ALTER TABLE marketing_contacts ADD CONSTRAINT chk_contact_status
  CHECK (status IN ('active', 'bounced', 'unsubscribed'));

-- Step 2: Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_email_unique
  ON marketing_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_status ON marketing_contacts(status);

-- Step 3: Per-campaign engagement tracking
CREATE TABLE IF NOT EXISTS marketing_engagements (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES marketing_contacts(id),
  campaign_id TEXT NOT NULL REFERENCES marketing_campaigns(id),
  opened INTEGER NOT NULL DEFAULT 0,
  clicked INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_engagements_campaign ON marketing_engagements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_marketing_engagements_contact ON marketing_engagements(contact_id);

-- D2C Contact Schema: person-centric contacts + per-campaign engagement tracking
-- SQLite requires table-rebuild pattern to make company_name nullable

-- Step 1: Rebuild marketing_contacts with company_name nullable + new columns
CREATE TABLE IF NOT EXISTS marketing_contacts_new (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  company_name TEXT,
  website TEXT,
  description TEXT,
  contact_name TEXT,
  category TEXT,
  score INTEGER DEFAULT 0,
  icp_fit_reasoning TEXT,
  audience_reach TEXT,
  partnership_opportunity TEXT,
  contact_approach TEXT,
  source_file TEXT,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','bounced','unsubscribed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO marketing_contacts_new (
  id, first_name, last_name, email, company_name, website, description,
  contact_name, category, score, icp_fit_reasoning, audience_reach,
  partnership_opportunity, contact_approach, source_file, metadata_json,
  status, created_at, updated_at
)
SELECT
  id, NULL, NULL, email, company_name, website, description,
  contact_name, category, score, icp_fit_reasoning, audience_reach,
  partnership_opportunity, contact_approach, source_file, metadata_json,
  'active', created_at, updated_at
FROM marketing_contacts;

DROP TABLE IF EXISTS marketing_contacts;
ALTER TABLE marketing_contacts_new RENAME TO marketing_contacts;

-- Step 2: Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_email_unique
  ON marketing_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_category ON marketing_contacts(category);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_company ON marketing_contacts(company_name);
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(contact_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_engagements_campaign ON marketing_engagements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_marketing_engagements_contact ON marketing_engagements(contact_id);

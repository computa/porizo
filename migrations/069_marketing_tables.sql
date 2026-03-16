-- Marketing contacts and campaigns for admin dashboard
-- Contacts imported from CSV lead lists, campaigns tracked manually

CREATE TABLE IF NOT EXISTS marketing_contacts (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  website TEXT,
  description TEXT,
  contact_name TEXT,
  email TEXT,
  category TEXT,
  score INTEGER DEFAULT 0,
  icp_fit_reasoning TEXT,
  audience_reach TEXT,
  partnership_opportunity TEXT,
  contact_approach TEXT,
  source_file TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_marketing_contacts_category ON marketing_contacts(category);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_company ON marketing_contacts(company_name);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL DEFAULT 'draft',
  template_id TEXT,
  sent_at TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0,
  unsubscribes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

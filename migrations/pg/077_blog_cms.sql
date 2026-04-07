-- Blog publishing CMS with deterministic SEO/GEO/AEO review gate

CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  answer_summary TEXT NOT NULL DEFAULT '',
  target_query TEXT NOT NULL DEFAULT '',
  target_intent TEXT NOT NULL DEFAULT 'informational',
  primary_keyword TEXT NOT NULL DEFAULT '',
  hero_image_url TEXT,
  body_markdown TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  author_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(review_status IN ('unreviewed', 'approved', 'rejected')),
  review_report_json TEXT,
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_review_status ON blog_posts(review_status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at);

CREATE TABLE IF NOT EXISTS blog_post_revisions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  answer_summary TEXT NOT NULL DEFAULT '',
  target_query TEXT NOT NULL DEFAULT '',
  target_intent TEXT NOT NULL DEFAULT 'informational',
  primary_keyword TEXT NOT NULL DEFAULT '',
  hero_image_url TEXT,
  body_markdown TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  author_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  review_report_json TEXT,
  revision_reason TEXT NOT NULL DEFAULT 'snapshot',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_blog_post_revisions_post_id ON blog_post_revisions(post_id);

CREATE TABLE IF NOT EXISTS blog_review_runs (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  revision_number INTEGER,
  decision TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
  overall_score INTEGER NOT NULL DEFAULT 0,
  seo_score INTEGER NOT NULL DEFAULT 0,
  geo_score INTEGER NOT NULL DEFAULT 0,
  aeo_score INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_review_runs_post_id ON blog_review_runs(post_id);

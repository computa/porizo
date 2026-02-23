-- Admin users table (separate from regular users for security)
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin', -- 'admin' or 'superadmin'
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_login_at TEXT,
  failed_login_count INTEGER DEFAULT 0,
  locked_until TEXT
);

-- Admin sessions (short-lived, separate from user sessions)
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);

-- Seed initial admin (password: 'admin123' - CHANGE IN PRODUCTION)
INSERT INTO admin_users (id, email, password_hash, display_name, role, created_at)
VALUES (
  'adm_initial',
  'admin@porizo.app',
  '$2b$12$mKNe9jbVs6iGRIVFJgdGl.yD2Sc10LYU4WJ7ylefxrz77.KqGlQK2',
  'Admin',
  'superadmin',
  CURRENT_TIMESTAMP
) ON CONFLICT DO NOTHING;

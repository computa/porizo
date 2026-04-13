-- Migration 092: enforce valid auth provider status values in SQLite
-- SQLite cannot add CHECK constraints after table creation, so use triggers.

UPDATE user_auth_providers
SET status = 'active'
WHERE status IS NULL OR status NOT IN ('active', 'revoked', 'suspended');

CREATE TRIGGER IF NOT EXISTS trg_user_auth_providers_status_insert
BEFORE INSERT ON user_auth_providers
FOR EACH ROW
WHEN NEW.status NOT IN ('active', 'revoked', 'suspended')
BEGIN
  SELECT RAISE(ABORT, 'invalid user_auth_providers.status');
END;

CREATE TRIGGER IF NOT EXISTS trg_user_auth_providers_status_update
BEFORE UPDATE OF status ON user_auth_providers
FOR EACH ROW
WHEN NEW.status NOT IN ('active', 'revoked', 'suspended')
BEGIN
  SELECT RAISE(ABORT, 'invalid user_auth_providers.status');
END;

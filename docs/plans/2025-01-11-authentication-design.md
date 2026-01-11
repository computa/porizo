# Porizo Authentication System Design

> **For Claude:** Use `test-driven-development` skill for implementation.

**Goal:** Implement secure user authentication with social login (Apple/Google) primary, email/password fallback.

**Tech Stack:** Node.js/Fastify, SQLite (→PostgreSQL), JWT, Resend email, Apple/Google Sign-In

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth methods | Social primary + email fallback | Best UX, Apple requires it if any social |
| Account linking | Single users table + providers | User can link multiple auth methods |
| Token strategy | JWT access (15m) + rotating refresh (30d) | Standard mobile pattern, revocable |
| Email service | Resend | Simple API, free tier sufficient |

---

## Database Schema

```sql
-- Core user identity
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  email_verified INTEGER DEFAULT 0,
  display_name TEXT,
  avatar_url TEXT,
  failed_login_count INTEGER DEFAULT 0,
  locked_until TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Auth providers (apple, google, email)
CREATE TABLE user_auth_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('apple', 'google', 'email')),
  provider_user_id TEXT NOT NULL,
  provider_data TEXT,  -- JSON: provider-specific claims
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(provider, provider_user_id)
);

-- Password credentials (email provider only)
CREATE TABLE user_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_changed_at TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- User sessions (device management)
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT,
  ip_address TEXT,
  user_agent TEXT,
  last_active_at TEXT,
  revoked_at TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Token families (for rotation tracking and bulk revocation)
CREATE TABLE token_families (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES user_sessions(id) ON DELETE CASCADE,
  compromised_at TEXT,  -- Set when reuse detected
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Refresh tokens (rotatable, revocable)
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_family TEXT NOT NULL REFERENCES token_families(id) ON DELETE CASCADE,
  generation INTEGER DEFAULT 1,  -- Increments on rotation
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  requested_ip TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Email verification tokens
CREATE TABLE email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Auth events (audit trail)
CREATE TABLE auth_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'login_success', 'login_failed', 'logout',
    'token_refresh', 'token_revoked', 'token_reuse_detected',
    'password_changed', 'password_reset_requested', 'password_reset_completed',
    'provider_linked', 'provider_unlinked',
    'email_verified', 'account_locked', 'account_unlocked'
  )),
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,  -- JSON for event-specific data
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============ INDEXES ============

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_auth_providers_user ON user_auth_providers(user_id);
CREATE INDEX idx_auth_providers_lookup ON user_auth_providers(provider, provider_user_id);
CREATE INDEX idx_sessions_user_active ON user_sessions(user_id, last_active_at);
CREATE INDEX idx_token_families_user ON token_families(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(token_family);
CREATE INDEX idx_password_reset_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX idx_email_verify_hash ON email_verification_tokens(token_hash);
CREATE INDEX idx_email_verify_user ON email_verification_tokens(user_id);
CREATE INDEX idx_auth_events_user ON auth_events(user_id, created_at);
CREATE INDEX idx_auth_events_type ON auth_events(event_type, created_at);

-- ============ TRIGGERS ============

CREATE TRIGGER users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
```

---

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/auth/social` | POST | None | Apple/Google sign-in |
| `/auth/signup` | POST | None | Email registration |
| `/auth/login` | POST | None | Email login |
| `/auth/verify-email` | POST | None | Verify email token |
| `/auth/refresh` | POST | None | Get new access token (rotates refresh) |
| `/auth/logout` | POST | Access | Revoke refresh token |
| `/auth/forgot-password` | POST | None | Request reset email |
| `/auth/reset-password` | POST | None | Reset with token |
| `/auth/me` | GET | Access | Get current user |
| `/auth/sessions` | GET | Access | List active sessions |
| `/auth/sessions/:id` | DELETE | Access | Revoke session |
| `/auth/link-provider` | POST | Access | Add auth method |

### Request/Response Contracts

```javascript
// POST /auth/social
Request:  { provider: "apple"|"google", id_token: "xxx", name?: "John" }
Response: { user_id, access_token, refresh_token, expires_in: 900, is_new_user: bool }

// POST /auth/signup
Request:  { email, password, name }
Response: { user_id, access_token, refresh_token, expires_in: 900 }
// Sends verification email via Resend

// POST /auth/login
Request:  { email, password }
Response: { user_id, access_token, refresh_token, expires_in: 900 }

// POST /auth/refresh
Request:  { refresh_token }
Response: { access_token, refresh_token, expires_in: 900 }
// Note: Returns NEW refresh_token (rotation)

// POST /auth/forgot-password
Request:  { email }
Response: { message: "If account exists, reset email sent" }
// Always 200 (prevent enumeration)

// POST /auth/reset-password
Request:  { token, new_password }
Response: { message: "Password reset successful" }
// Revokes all refresh tokens

// GET /auth/me
Response: { user_id, email, display_name, avatar_url, providers: ["apple", "email"] }

// GET /auth/sessions
Response: { sessions: [{ id, device_name, ip_address, last_active_at, current: bool }] }
```

---

## Security Requirements

### Token Security
- Access tokens: 15 min expiry, HS256 signed
- Refresh tokens: 30 day expiry, stored hashed (SHA-256), rotated on use
- Password reset: 30 min expiry, 128-bit random, single-use, hashed
- All tokens: `crypto.randomBytes(32)` for generation

### Social Auth Validation
Apple/Google id_token must validate:
- Signature (via provider's public keys)
- `aud` matches app ID
- `iss` is correct provider
- `exp` hasn't passed
- `nonce` matches (replay protection)

### Password Security
- bcrypt with cost factor 12
- Minimum 8 chars, maximum 72 chars
- Constant-time comparison (always run bcrypt even if user not found)

### Rate Limits
- `/auth/signup`, `/auth/login`: 10/hour per IP
- `/auth/forgot-password`: 3/hour per email
- `/auth/social`: 20/hour per IP

### Account Lockout
- Lock after 5 failed attempts
- 15 minute lockout duration
- Reset on successful login

### Audit Logging
All auth events logged to `auth_events` table with IP, user agent, timestamp.

---

## iOS Implementation

### AuthManager.swift
```swift
@MainActor
class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isAuthenticated = false
    @Published var currentUser: User?

    private var accessToken: String?  // Memory only
    private let keychain = KeychainService()

    func signInWithApple(credential: ASAuthorizationAppleIDCredential) async throws
    func signInWithGoogle() async throws  // For Android parity
    func signUp(email: String, password: String, name: String) async throws
    func login(email: String, password: String) async throws
    func getValidAccessToken() async throws -> String  // Auto-refresh
    func logout() async throws
}
```

### Token Storage
- Access token: Memory only (`private var`)
- Refresh token: iOS Keychain via `KeychainService`

---

## Email Templates (Resend)

### Password Reset
```
Subject: Reset your Porizo password
Body: Click here to reset your password. Link expires in 30 minutes.
[Reset Password Button → {PUBLIC_BASE_URL}/reset-password?token={token}]
```

### Email Verification
```
Subject: Verify your Porizo email
Body: Click here to verify your email address.
[Verify Email Button → {PUBLIC_BASE_URL}/verify-email?token={token}]
```

---

## Deferred to Post-MVP

- Password history (prevent reuse)
- Device fingerprinting/binding
- Soft delete for users
- MFA/TOTP support
- WebAuthn/Passkeys

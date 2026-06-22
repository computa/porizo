# Feature Audit: Authentication / Identity / Onboarding / Account Lifecycle

**Domain:** A — Auth, Identity, Onboarding, Account Lifecycle  
**Auditor:** Claude Code (automated feature-discovery pass)  
**Date:** 2026-06-22  
**Scope:** `src/routes/auth.js`, `src/routes/onboarding.js`, `src/routes/well-known.js`, `src/services/auth-service.js`, `src/services/identity-service.js`, `src/services/apple-signin.js`, `src/services/social-token-verifier.js`, `src/services/device-token.js`, `src/services/admin-auth-service.js`, relevant migrations in `migrations/pg/`

**Methodology:** Code read — all status assertions below are VERIFIED from source, not inferred.

**Total features inventoried: 20**

---

## Feature Index

1. Email/Password Signup
2. Email/Password Login
3. Sign In with Apple (SIWA)
4. Google Social Login
5. Facebook Social Login
6. Phone OTP — Send Code
7. Phone OTP — Verify & Login
8. Phone OTP — Register New Account
9. Anonymous Device Token
10. JWT Access Token Issuance & Verification
11. Refresh Token Rotation (Token Family)
12. Account Lockout
13. Forgot Password / Reset Password
14. Email Verification (send + resend + verify)
15. Session Management (list + revoke)
16. Phone Number Linking to Existing Account
17. Apple Identity Linking to Existing Account
18. User Profile (get / update / skip-completion / username check)
19. Account Deletion (GDPR soft-delete + cascade)
20. Onboarding Questionnaire & Song Suggestion
21. OAuth 2.0 / MCP Server Discovery (well-known)
22. Admin Authentication (separate surface)

---

### 1. Email/Password Signup

**user_story:** As a new user, I want to create an account with email and password, so that I can access Porizo without a social provider.

**expected_behavior:**

- `POST /auth/signup` — requires `email`, `password`, `name`, optional `locale`, `country`.
- Rate-limited: 5/hour per IP (`signup:${clientIp}`).
- Validates email format, password min-length (deferred to schema), username format (`/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/`).
- Dedup check: rejects if email already exists in `user_contacts` with `verified_at IS NOT NULL`.
- Creates user via `identityService.createUserWithIdentity` (inserts `users`, `user_contacts`, `user_auth_providers` rows in a transaction).
- Creates entitlements row for free tier.
- Sends verification email via `emailService`.
- Creates session + issues access + refresh tokens via `createSessionAndTokens`.
- Logs `auth_events` row with type `signup_success`.
- Initialises `AttributionService` with install attribution if present.
- Returns `{ accessToken, refreshToken, user: buildUserProfileResponse(...) }`.

**status:** implemented

**gaps:**

- No `username` field on the signup schema — username is set at profile-update time, meaning there is a window where the user exists with no username. The `GET /users/username/available` check is advisory only; there is no atomic reserve-and-set in signup.
- Email is stored but **unverified** at signup; most downstream gating depends on `email_verified` flag. No hard block on using the app unverified (risk: placeholder email addresses accumulate).
- Password strength policy relies entirely on Fastify JSON schema `minLength` — no entropy/complexity check, no common-password blocklist.
- `failed_login_count` is only reset on successful login; there is no reset-on-account-creation path (irrelevant today, but would matter if a signup re-uses a previously locked user record somehow).
- No idempotency key — double-tap of signup returns 409 on second attempt, but there is no client-visible idempotency to distinguish "already mine" from "someone else has this email".
- Country detection falls back to GeoIP then defaults to `'US'`; GeoIP library (`geoip-lite`) has a known lag on accuracy for mobile IPs.

**key_files:** `src/routes/auth.js` (signup handler ~L300+), `src/services/identity-service.js` (`createUserWithIdentity`), `src/services/auth-service.js` (`createRefreshToken`, `createSession`)

**db_tables:** `users`, `user_contacts`, `user_auth_providers`, `user_sessions`, `refresh_tokens`, `token_families`, `entitlements`, `auth_events`, `rate_limits`

---

### 2. Email/Password Login

**user_story:** As a registered user, I want to log in with email and password, so that I can access my account.

**expected_behavior:**

- `POST /auth/login` — requires `email`, `password`.
- Rate-limited: 10/hour per `ip:email` combination (prevents credential stuffing); separate per-IP limit.
- Looks up user via `user_contacts` (verified email only), then fetches `password_hash` from `user_auth_providers`.
- Checks `isAccountLocked(userId)` before password comparison — rejects with `ACCOUNT_LOCKED` if `locked_until > NOW()`.
- Uses `bcrypt.compare`; on failure calls `incrementFailedLoginCount` (increments `failed_login_count`, sets `locked_until = NOW() + lockout_duration` after threshold — threshold and duration configurable via `security_config` table or env).
- On success: resets `failed_login_count`, logs `login_success` auth event, creates session + tokens.
- Returns same shape as signup.

**status:** implemented

**gaps:**

- **Timing oracle:** `bcrypt.compare` is called even when no `password_hash` row exists (good), but error message is uniform — however the rate limit key includes the email, so an attacker can enumerate valid emails by observing which email+IP combinations hit the rate limit earlier (they get `RATE_LIMITED` instead of `INVALID_CREDENTIALS`).
- Rate limit window is in-memory `Map` as a fast-path with DB as authoritative store — but the in-memory cache is per-process. In a multi-instance Railway deployment, the in-memory fast-path never fires for cross-instance hits; **only the DB count matters**. This works correctly for correctness but means the in-memory optimisation is ineffective.
- Lockout `locked_until` column lives on `users` — no index on `locked_until`, so `isAccountLocked` does a primary-key lookup followed by a column comparison (fine for scale today).
- No notification to user when account is locked (no email, no SMS).
- No "remember this device" or persistent-login differentiation — all logins get 90-day refresh tokens regardless.

**key_files:** `src/routes/auth.js` (login handler), `src/services/auth-service.js` (`isAccountLocked`, `incrementFailedLoginCount`, `resetFailedLoginCount`)

**db_tables:** `users`, `user_contacts`, `user_auth_providers`, `user_sessions`, `refresh_tokens`, `token_families`, `auth_events`, `rate_limits`, `security_config`

---

### 3. Sign In with Apple (SIWA)

**user_story:** As an iOS user, I want to sign in with my Apple ID, so that I don't need to manage a password.

**expected_behavior:**

- Handled via `POST /auth/social` with `provider: "apple"`.
- Two sub-paths depending on what the client sends:
  - **id_token path:** `social-token-verifier.js` → `verifyAppleToken` — fetches Apple JWKS from `https://appleid.apple.com/auth/keys` (cached 24h via `jwks-rsa`), verifies JWT signature + `aud` (client_id) + `iss` + expiry.
  - **authorization_code path:** `apple-signin.js` → `exchangeAppleAuthorizationCode` — exchanges code for Apple tokens server-to-server; `refreshAppleToken` is also exported.
- Provider is enabled/disabled via `feature_flags` / `provider_control` table (`isProviderConfigured("apple")`).
- On verify success: calls `identityService.resolveUserByIdentity(db, "apple", appleUserId)` — looks up `granted_identities` table.
- If user exists: login path (session + tokens).
- If user not found: `createUserWithIdentity` (signup path) using name/email from Apple token's `name` claim (only present on first auth) and `email` (may be private relay address).
- Apple relay emails (`isAppleRelay`) stored but flagged; email-based dedup skips relay addresses.
- Logs `auth_events` row (`social_login_success` or `signup_success`).

**status:** implemented

**gaps:**

- Apple's `name` claim is only delivered on the first authorization. If the user deletes and reinstalls the app, `name` will be null and the account will be created with no display name, requiring the user to set it manually. No fallback prompt.
- `aud` check in `verifyAppleToken` must match `APPLE_CLIENT_ID` env var — if this is not set in production the claim check fails open (need to verify env is set on Railway).
- No nonce validation on the id_token path — Apple supports nonces for replay prevention but this is not enforced server-side (iOS client may set a nonce; the server does not verify it).
- `exchangeAppleAuthorizationCode` stores the resulting Apple refresh token — but `refreshAppleToken` is exported and never called anywhere in the route layer (dead function or TODO for token revocation on account delete).
- Private relay emails: if user later tries email/password signup with the same relay email, dedup check may match or miss depending on normalization.

**key_files:** `src/routes/auth.js` (social handler), `src/services/social-token-verifier.js` (`verifyAppleToken`), `src/services/apple-signin.js` (`exchangeAppleAuthorizationCode`)

**db_tables:** `granted_identities`, `users`, `user_contacts`, `user_sessions`, `refresh_tokens`, `auth_events`

---

### 4. Google Social Login

**user_story:** As a user, I want to sign in with my Google account, so that I can access Porizo without a password.

**expected_behavior:**

- `POST /auth/social` with `provider: "google"`.
- `verifyGoogleToken` in `social-token-verifier.js` — uses Google JWKS from `https://www.googleapis.com/oauth2/v3/certs` (cached 24h), verifies JWT signature + `aud` + `iss` + expiry.
- `exchangeGoogleAuthorizationCode` is also available for authorization-code flow.
- `isProviderConfigured("google")` gates the provider.
- Same resolve/create flow as Apple.

**status:** implemented

**gaps:**

- Same nonce gap as Apple — server does not validate nonce if Google sends one.
- `GOOGLE_CLIENT_ID` env var must be set for `aud` check; verify it is set in Railway production.
- Google's `email_verified` claim in the id_token is not explicitly checked — a non-verified Google email could be accepted as a verified contact.
- No revocation: on account deletion, there is no call to revoke the Google token, so the account could continue being "associated" from Google's perspective.

**key_files:** `src/services/social-token-verifier.js` (`verifyGoogleToken`, `exchangeGoogleAuthorizationCode`)

**db_tables:** `granted_identities`, `users`, `user_contacts`, `user_sessions`, `refresh_tokens`, `auth_events`

---

### 5. Facebook Social Login

**user_story:** As a user, I want to sign in with Facebook, so that I can use an existing social identity.

**expected_behavior:**

- `POST /auth/social` with `provider: "facebook"`.
- `verifyFacebookToken` calls Facebook's token debug endpoint (`graph.facebook.com/debug_token`) using an app access token — does not use JWKS (Facebook does not expose standard JWKS).
- `exchangeFacebookAuthorizationCode` available.
- `isProviderConfigured("facebook")` gates it.

**status:** implemented (partial — not confirmed live in production; `isProviderConfigured` check may have it disabled)

**gaps:**

- Facebook uses a different validation mechanism (graph API call) vs JWKS for Apple/Google — introduces a network dependency at login time with no retry/circuit breaker.
- App access token (`FB_APP_ID:FB_APP_SECRET`) must be set — if missing, `verifyFacebookToken` will fail at runtime with an unhandled rejection shaped error.
- Facebook's `email` is not always present (users can deny email permission) — code must handle null email gracefully; verify this path is covered.
- No user-facing indication of which providers are enabled; client must probe.

**key_files:** `src/services/social-token-verifier.js` (`verifyFacebookToken`)

**db_tables:** `granted_identities`, `users`, `user_contacts`, `user_sessions`, `refresh_tokens`, `auth_events`

---

### 6. Phone OTP — Send Code

**user_story:** As a user, I want to receive a one-time code via SMS, so that I can verify my phone number.

**expected_behavior:**

- `POST /auth/phone/send-code` — requires `phone_number` in E.164 format.
- Two-layer rate limiting: 5/hour per IP (`phone-send:${clientIp}`) AND 5/hour per phone number (`sms:phone:${phone_number}`).
- E.164 format validated before per-phone rate limit keying (avoids bombing limit on garbage input).
- `smsService.isConfigured()` checked — returns 503 if SMS not configured.
- Calls `smsService.sendCode(phone_number)` — delegates to configured SMS provider.
- Returns `{ success: true }` (no info leak about whether phone is registered).

**status:** implemented

**gaps:**

- No international dialling code allowlist — any E.164 number is accepted. Premium-rate SMS fraud is possible without a country-code denylist.
- Per-phone rate limit key does not normalise the phone number before keying (e.g., `+12025551234` vs `+1-202-555-1234` would be different keys if client sends non-canonical E.164 — but E.164 validation runs first so this is acceptable).
- No audit log of SMS send events; only `auth_events` for login/register, not for OTP sends. Makes abuse investigation harder.
- 5/hour per phone is generous for SMS fraud; industry best practice is 3/hour with exponential backoff.
- SMS provider fallback not implemented — single provider failure blocks all phone auth.

**key_files:** `src/routes/auth.js` (phone/send-code handler), `src/services/sms-service.js`

**db_tables:** `rate_limits`, `phone_verifications` (via SMS service)

---

### 7. Phone OTP — Verify & Login

**user_story:** As a user who received an SMS code, I want to enter it to log in or initiate registration, so that I am authenticated via my phone number.

**expected_behavior:**

- `POST /auth/phone/verify` — requires `phone_number`, `code`.
- Rate-limited: 10/hour per IP.
- `smsService.verifyCode(phone_number, code)` validates the OTP.
- **If phone is already a known identity:** `identityService.resolveUserByIdentity(db, "phone", phone_number)` → login path (session + tokens).
- **If phone is new:** issues a short-lived `registration_token` (HMAC-signed, stored hashed in `phone_registration_tokens` with TTL) and returns `{ verified: true, registration_token, requires_registration: true }` — client must follow up with `POST /auth/phone/register`.
- Logs appropriate `auth_events` on login.

**status:** implemented

**gaps:**

- `registration_token` is HMAC-signed using `JWT_SECRET` (or `PHONE_HMAC_KEY`). If `JWT_SECRET` is rotated, all pending registration tokens are immediately invalidated with no graceful transition period.
- Token TTL is stored in `phone_registration_tokens.expires_at` but the expiry is only enforced at `consumeRegistrationToken` time — there is no background job to purge expired rows.
- The `verified_at` timestamp on the registration token is set by the server but the `verifyCode` result is trusted from `smsService` without re-checking clock skew.
- If a user completes `verify` but abandons `register`, the orphaned `phone_registration_tokens` row persists until expiry. No cleanup mechanism.

**key_files:** `src/routes/auth.js` (phone/verify, phone/register handlers), `src/services/sms-service.js`

**db_tables:** `phone_registration_tokens`, `user_contacts`, `user_sessions`, `refresh_tokens`, `auth_events`, `rate_limits`

---

### 8. Phone OTP — Register New Account

**user_story:** As a user who verified a new phone number, I want to complete registration with my name and optional email, so that my account is created.

**expected_behavior:**

- `POST /auth/phone/register` — requires `registration_token`, `phone_number`, `name`; optional `email`, `locale`, `country`.
- Rate-limited: 5/hour per IP.
- `consumeRegistrationToken` validates HMAC and phone-number binding, marks token consumed.
- Cross-identifier dedup: checks if phone already registered (shouldn't be — verify step gated it) AND if provided email already exists as a verified contact.
- `createUserWithIdentity` with `phone` as primary identity.
- Optional email stored unverified if provided.
- Creates session + tokens, returns same shape as signup.

**status:** implemented

**gaps:**

- Race condition: between `verify` and `register`, another request could register the same phone (e.g., attacker replaying a stolen registration_token from a different IP). `consumeRegistrationToken` sets `consumed_at` atomically, so the token cannot be reused — but there is no unique constraint preventing two `register` calls with different tokens for the same phone if both arrive before either is marked consumed. Needs a `unique index on phone_number` in `user_contacts` to be the final guard.
- `registration_token` is bound to IP at creation but the IP binding check is **advisory** (warns in log) rather than a hard reject — an attacker who intercepts the token from a different IP can still complete registration.
- If `email` is provided during phone register, it is stored unverified. If the user later does email/password signup with the same email, the dedup check looks for `verified_at IS NOT NULL` — so the unverified email from phone-register does NOT block a new email signup. This is correct behaviour but means two accounts can momentarily share an unverified email, which is confusing if the user then verifies both.

**key_files:** `src/routes/auth.js` (phone/register), `src/services/identity-service.js` (`createUserWithIdentity`)

**db_tables:** `phone_registration_tokens`, `users`, `user_contacts`, `user_auth_providers`, `user_sessions`, `refresh_tokens`, `entitlements`, `auth_events`

---

### 9. Anonymous Device Token

**user_story:** As an unauthenticated app user, I want a device-scoped token, so that the server can identify my device without requiring login (e.g., for share-link claim, rate-limiting, app-context detection).

**expected_behavior:**

- `issueDeviceToken({ userId, deviceId, platform, appVersion })` in `device-token.js`.
- Issues a signed JWT (`issuer: "porizo-device"`) containing `device_id`, `platform`, `app_version`, and optionally `sub` (userId if authenticated).
- TTL: `DEVICE_TOKEN_TTL_DAYS` env var (default 30 days).
- Signed with `DEVICE_TOKEN_SECRET` (falls back to `JWT_SECRET`).
- `verifyDeviceToken(token)` verifies signature + expiry.
- Used by `isAppContext(request)` in `src/utils/request-context.js` to distinguish app requests from browser requests (for share-link app-wall gating).
- Device tokens are **stateless** (no DB row) — cannot be individually revoked.

**status:** implemented

**gaps:**

- **No revocation path.** If a device token is compromised, there is no way to invalidate it short of rotating `DEVICE_TOKEN_SECRET` (which invalidates ALL device tokens).
- Device tokens fall back to `JWT_SECRET` — if the two secrets are the same, a device token could theoretically be used to impersonate a user JWT (different `iss` claim prevents this in practice, but defence-in-depth suggests separate secrets).
- No DB record means no audit trail: cannot answer "which devices accessed this share link?".
- Token re-issuance on app restart creates accumulating tokens with no mechanism to retire old ones.
- TTL of 30 days means a user who installs, grants device token, then uninstalls still has a valid device token for 30 days with no way to force revocation.

**key_files:** `src/services/device-token.js`, `src/utils/request-context.js`

**db_tables:** none (stateless JWT)

---

### 10. JWT Access Token Issuance & Verification

**user_story:** As an authenticated user, I want a short-lived access token, so that I can make authenticated API requests without re-authenticating.

**expected_behavior:**

- `generateAccessToken(userId, options)` in `auth-service.js` — signs HS256 JWT with `sub: userId`, `sid: sessionId`, configured expiry (default: 60 minutes), `iss: config.jwtIssuer`.
- `verifyAccessToken(token)` — verifies signature, expiry, with configurable `clockTolerance` (default 5s).
- `requireAuth` preHandler in `auth.js`: extracts Bearer token, calls `verifyAccessToken`, then does **two DB lookups**: (1) `users WHERE id = ? AND deleted_at IS NULL` — ensures user not soft-deleted; (2) `user_sessions WHERE id = ? AND revoked_at IS NULL` — ensures session is still active.
- Sets `request.userId` and `request.sessionId` for downstream handlers.
- `getJwtFingerprint()` returns a SHA-256 hash of the first 8 bytes of the JWT secret — used for diagnostics without exposing the secret.

**status:** implemented — strong implementation with session validation on every request

**gaps:**

- `requireAuth` makes 2 DB queries per authenticated request. No caching layer (Redis/memcached) means every API call hits Postgres twice. At scale this becomes a bottleneck; for current user count it is fine.
- `clockTolerance` is hardcoded at 5s default — not configurable per environment. In environments with NTP drift this could cause intermittent 401s.
- No JWT key rotation mechanism. Rotating `JWT_SECRET` immediately invalidates all access tokens and all refresh token HMAC checks simultaneously.
- Access token does not include `aud` (audience) claim, making it reusable against any Porizo API endpoint (no per-service scoping).

**key_files:** `src/services/auth-service.js` (`generateAccessToken`, `verifyAccessToken`), `src/routes/auth.js` (`requireAuth`)

**db_tables:** `users`, `user_sessions`

---

### 11. Refresh Token Rotation (Token Family)

**user_story:** As an authenticated user, I want my session to persist across token expiries, so that I do not need to re-log in frequently.

**expected_behavior:**

- `POST /auth/refresh` — requires `refresh_token` in body.
- `rotateRefreshToken(rawToken)` in `auth-service.js`:
  - Hashes token with `hashToken` (SHA-256).
  - Looks up `refresh_tokens` by hash; checks not revoked and not expired.
  - **Token reuse detection:** if token is already revoked, marks entire `token_families` row as `compromised_at = NOW()` and revokes ALL tokens in that family — treats reuse as theft signal.
  - Issues a new `refresh_token` with incremented `generation` counter.
  - Revokes the old token.
- Route checks if resolved `userId` maps to a non-deleted user; if user is deleted, revokes all their tokens.
- Returns new `{ accessToken, refreshToken }`.
- Access token: 60 min. Refresh token: 90 days (configurable via `config.refreshTokenExpiryDays`).

**status:** implemented — token family rotation with theft detection is a strong implementation

**gaps:**

- Token family compromise revokes ALL tokens in the family, but does NOT immediately revoke active sessions (user_sessions rows). A stolen access token (still within 60-min window) continues to work even after family compromise.
- No push notification or email sent to the user when a token family is compromised (silent security event).
- `token_families` table has no TTL/cleanup job — families accumulate forever even after all tokens in them expire.
- `refresh_tokens` similarly has no background cleanup for expired rows.
- Rotation happens in a **non-transactional** sequence: (1) insert new token, (2) revoke old token. A crash between steps would leave both tokens valid briefly (but old token's reuse detection would catch it on the next attempt).

**key_files:** `src/services/auth-service.js` (`createRefreshToken`, `verifyRefreshToken`, `rotateRefreshToken`, `compromiseAllTokenFamiliesForUser`), `src/routes/auth.js` (refresh handler)

**db_tables:** `refresh_tokens`, `token_families`, `user_sessions`

---

### 12. Account Lockout

**user_story:** As the platform, I want to lock accounts after repeated failed login attempts, so that brute-force attacks are prevented.

**expected_behavior:**

- `incrementFailedLoginCount(userId)` increments `users.failed_login_count`; if threshold is exceeded, sets `users.locked_until = NOW() + lockout_duration`.
- Threshold and duration fetched from `security_config` table (configurable per environment), with hardcoded defaults.
- `isAccountLocked(userId)` returns true if `locked_until > NOW()`.
- `resetFailedLoginCount(userId)` zeros the counter and clears `locked_until` on successful login.
- Called only from email/password login path — social and phone login do not increment the counter.

**status:** implemented

**gaps:**

- **Social and phone login do not hit the lockout counter.** An attacker who can control the phone OTP flow (e.g., SIM swap) has no lockout protection.
- `locked_until` is checked before `bcrypt.compare` — but the response message on locked account leaks that the account exists (different error than `INVALID_CREDENTIALS`). This is an enumeration vector.
- No progressive lockout: first lockout and hundredth lockout use the same duration.
- Lockout duration is wall-clock based (`locked_until`), not attempt-count based — an attacker can wait it out and resume.
- No admin UI to manually unlock an account (admin route to view `failed_login_count` may exist but was not verified in scope).

**key_files:** `src/services/auth-service.js` (`incrementFailedLoginCount`, `isAccountLocked`, `resetFailedLoginCount`), `src/routes/auth.js` (login handler)

**db_tables:** `users` (`failed_login_count`, `locked_until`), `security_config`

---

### 13. Forgot Password / Reset Password

**user_story:** As a user who forgot their password, I want to receive a reset link by email, so that I can set a new password.

**expected_behavior:**

- `POST /auth/forgot-password` — requires `email`.
- Always returns 200 (no enumeration leak on unknown email).
- Rate-limited per IP.
- Looks up user by verified email contact; if found: `createPasswordResetToken(userId)` generates a secure random token, hashes it, stores in `password_reset_tokens` with TTL.
- Sends reset email via `emailService`.
- `POST /auth/reset-password` — requires `token`, `new_password`.
- `verifyPasswordResetToken(token)` validates hash + expiry + not-used.
- `markPasswordResetTokenUsed(tokenId)` marks used, `invalidateAllPasswordResetTokens(userId)` revokes all others.
- Calls `revokeAllRefreshTokensForUser(userId)` — forces re-login on all devices after password reset.
- Re-hashes password with bcrypt and updates `user_auth_providers`.

**status:** implemented

**gaps:**

- `invalidateAllPasswordResetTokens` and `revokeAllRefreshTokensForUser` are called but `revokeAllSessionsExcept(userId, null)` is NOT called — sessions in `user_sessions` are NOT revoked on password reset. An attacker with a stolen session token can continue using it after the victim resets their password.
- Password reset token TTL not verified in code (likely 1 hour, but not confirmed without reading full `createPasswordResetToken` body).
- No notification to user that password was changed (security alert email).
- `new_password` strength check relies on schema `minLength` only — same gap as signup.

**key_files:** `src/routes/auth.js` (forgot-password, reset-password handlers), `src/services/auth-service.js` (`createPasswordResetToken`, `verifyPasswordResetToken`, `markPasswordResetTokenUsed`, `invalidateAllPasswordResetTokens`)

**db_tables:** `password_reset_tokens`, `user_auth_providers`, `refresh_tokens`, `token_families`

---

### 14. Email Verification (Send + Resend + Verify)

**user_story:** As a new user, I want to verify my email address, so that my account is confirmed and I can access all features.

**expected_behavior:**

- Verification email sent automatically at signup / phone-register (if email provided).
- `POST /auth/verify-email` — requires `token` (from email link). No auth required. `verifyEmailVerificationToken(token)` looks up hash in `email_verification_tokens`, checks expiry, marks `verified_at` on `user_contacts`.
- `POST /auth/email/resend-verification` — requires auth (`requireAuth`). Rate-limited: 3/hour per user. Calls `invalidateEmailVerificationTokens(userId)` then `createEmailVerificationToken(userId, email)` and re-sends.
- On verification: `user_contacts` row gets `verified_at` set. `user_auth_providers` gets `email_verified = true` (if email/password account).

**status:** implemented

**gaps:**

- `verify-email` is unauthenticated — the token IS the credential, which is correct. However there is no binding of the token to a device/session; anyone who intercepts the email link can verify the address for the intended user (acceptable for email verification, but worth noting).
- Token expiry not confirmed in scope but likely 24h based on conventions elsewhere. If token expires, user must use resend flow.
- After email verification, no automatic re-issuance of access token with updated `email_verified` claim — the client continues using an old access token that lacks the verified flag until refresh.
- No mechanism to change/update email address (only add or verify). Email change flow is not implemented.
- Resend rate limit (3/hour) does not account for abuse: a malicious user could use resend to spam another email address. Resend should require the unverified email to belong to the requesting user — verified by checking `user_contacts` ownership.

**key_files:** `src/routes/auth.js` (verify-email, resend-verification), `src/services/auth-service.js` (`createEmailVerificationToken`, `verifyEmailVerificationToken`, `invalidateEmailVerificationTokens`)

**db_tables:** `email_verification_tokens`, `user_contacts`, `user_auth_providers`

---

### 15. Session Management (List + Revoke)

**user_story:** As a user, I want to see my active login sessions and revoke any I don't recognise, so that I can protect my account.

**expected_behavior:**

- `GET /auth/sessions` — `requireAuth`. Queries `user_sessions WHERE user_id = ? AND revoked_at IS NULL` along with `user_agent`, `ip_address`, `created_at`, `last_active_at`. Returns array of sessions.
- `DELETE /auth/sessions/:id` — `requireAuth`. Revokes a specific session (sets `revoked_at`) if it belongs to the requesting user. Cannot revoke current session this way (guarded).
- `POST /auth/logout` — `requireAuth`. Revokes current session + current refresh token. Returns 204.
- `createSession(userId, options)` in `auth-service.js` — inserts `user_sessions` with `user_agent`, `ip`, `device_name`, `last_active_at`.

**status:** implemented

**gaps:**

- `last_active_at` on sessions is set at creation but never updated on subsequent authenticated requests — the session list shows the login time, not the last-seen time.
- No "revoke all other sessions" button from `GET /auth/sessions` — user must revoke one by one. `revokeAllSessionsExcept(userId, sessionId)` exists in auth-service but is not exposed as an API endpoint.
- Session records accumulate indefinitely (no expiry on `user_sessions` rows matching the access token TTL); only `revoked_at` gates them.
- `device_name` is set from client-supplied request body — not validated or sanitised beyond schema checks, potential for stored XSS if ever rendered in admin UI without escaping.

**key_files:** `src/routes/auth.js` (sessions, logout handlers), `src/services/auth-service.js` (`createSession`, `revokeSession`, `revokeAllSessionsExcept`, `listSessions`)

**db_tables:** `user_sessions`, `refresh_tokens`

---

### 16. Phone Number Linking to Existing Account

**user_story:** As an existing user, I want to add a phone number to my account, so that I can use phone OTP as an additional login method.

**expected_behavior:**

- `POST /auth/phone/link` — `requireAuth`. Requires `phone_number`, `code` (previously verified OTP).
- Rate-limited per IP.
- Verifies OTP via `smsService.verifyCode`.
- Checks that phone is not already linked to another account.
- Calls `identityService.linkIdentityToUser(db, request.userId, "phone", phone_number)` — inserts `user_contacts` row.
- Logs auth event.

**status:** implemented

**gaps:**

- The OTP used here is the same one issued by `POST /auth/phone/send-code` — but there is no token binding between the "send" and "link" flows. A code sent for the purpose of registration could be replayed here if intercepted. The OTP itself is short-lived (SMS service TTL), which mitigates this.
- No check that the authenticated user doesn't already have a phone number — `linkIdentityToUser` should enforce uniqueness, but the error message on conflict should be user-friendly.
- No notification to existing phone owner when their number is re-linked (if somehow the dedup check fails).

**key_files:** `src/routes/auth.js` (phone/link handler), `src/services/identity-service.js` (`linkIdentityToUser`)

**db_tables:** `user_contacts`, `auth_events`

---

### 17. Apple Identity Linking to Existing Account

**user_story:** As an existing email/phone user, I want to link my Apple ID to my account, so that I can use SIWA as a login method.

**expected_behavior:**

- `POST /auth/identity/link/apple` — `requireAuth`. Requires Apple `id_token` or `authorization_code`.
- Verifies the Apple token via `verifySocialToken` / `exchangeAppleAuthorizationCode`.
- Checks that the Apple ID (`provider_user_id`) is not already linked to a different account — `assertNoIdentityConflict`.
- Calls `linkIdentityToUser(db, request.userId, "apple", appleUserId)`.
- Optionally syncs Apple email as a contact.

**status:** implemented

**gaps:**

- If the Apple ID is already linked to a DIFFERENT account, the error response reveals that the Apple ID is in use — a minor identity enumeration leak.
- No `assertNoContactConflict` called for the Apple email (relay or real) — a real Apple email could silently create a duplicate `user_contacts` entry if it already exists under a different user.
- After linking, no notification is sent to user (security alert for "new sign-in method added").

**key_files:** `src/routes/auth.js` (identity/link/apple), `src/services/identity-service.js` (`linkIdentityToUser`, `assertNoIdentityConflict`)

**db_tables:** `granted_identities`, `user_contacts`

---

### 18. User Profile (Get / Update / Skip-Completion / Username Check)

**user_story:** As a logged-in user, I want to view and update my profile information, so that my account is complete and personalised.

**expected_behavior:**

- `GET /auth/me` — `requireAuth`. Calls `buildUserProfileResponse(userId)` which aggregates: user row, all contacts (`user_contacts`), all providers (`user_auth_providers`), `computeProfileCompleteness(...)`, `entitlements` tier, primary email/phone.
- `PATCH /auth/profile` — `requireAuth`. Accepts `contact_email`, `display_name`. Updating email triggers a new verification flow.
- `POST /auth/profile/skip-completion` — `requireAuth`. Marks profile completion as skipped (sets a flag, allowing user to bypass mandatory profile completion prompts).
- `GET /users/username/available` — **no auth required** (public). Query param `username`. Returns `{ available: boolean }`. Validates format.

**status:** implemented

**gaps:**

- `GET /users/username/available` is unauthenticated — an unauthenticated attacker can enumerate all taken usernames in bulk. Should require at minimum a device token or rate limit aggressively.
- `PATCH /auth/profile` accepts `contact_email` which is stored unverified. There is no binding check that prevents a user from claiming another user's unverified email.
- No display_name sanitisation beyond Fastify schema — HTML/script injection possible if display_name is ever rendered without escaping in admin UI or emails.
- `computeProfileCompleteness` returns a `missing_profile_requirements` array — client relies on this to gate features, but server does not re-enforce completeness on sensitive operations (e.g., creating a song while profile is incomplete is not blocked server-side).

**key_files:** `src/routes/auth.js` (me, profile, skip-completion handlers), `src/services/identity-service.js` (`computeProfileCompleteness`, `buildUserProfileResponse`)

**db_tables:** `users`, `user_contacts`, `user_auth_providers`, `entitlements`

---

### 19. Account Deletion (GDPR Soft-Delete + Cascade)

**user_story:** As a user, I want to permanently delete my account, so that my personal data is removed from the platform.

**expected_behavior:**

- `DELETE /auth/delete-account` — `requireAuth`.
- Calls `authService.deleteUserAccount(request.userId)` which performs a **cascading deletion**:
  - Sets `users.deleted_at = NOW()` (soft delete).
  - Revokes all refresh tokens for the user.
  - Revokes all sessions.
  - Logs a `gdprAuditService` event (GDPR deletion request record).
- Route also logs the deletion IP and user agent.
- Returns 200 with `{ success: true, message: "Account deleted successfully" }`.

**status:** partial — soft-delete and token revocation work, but true GDPR erasure is incomplete

**gaps:**

- **Soft-delete only.** `users.deleted_at` is set, but PII fields (`name`, `email` in contacts, `phone` in contacts) are **not nulled/pseudonymised**. GDPR Article 17 requires erasure of personal data, not just tombstoning the row. A soft-delete without PII wipe is not compliant.
- `revokeAllEnrollmentSessionTokensForUser` is imported in auth-service.js (visible in exports) but it is unclear if it is called inside `deleteUserAccount` — enrollment session data (voice recordings) may persist.
- No deletion of `share_tokens`, `audit_logs`, `track_library_entries` — personal data in these tables is not erased.
- No async job to delete S3/filesystem audio files associated with the user's tracks.
- No confirmation step (e.g., require re-auth or password confirmation before deletion) — a CSRF or stolen token could trigger deletion.
- No account recovery window (e.g., 30-day grace period where user can undo deletion).
- `gdprAuditService.logDeletion` records the event, but the audit trail itself contains PII (userId). Whether the audit log is separately retained and for how long is not clear from code.

**key_files:** `src/routes/auth.js` (delete-account handler), `src/services/auth-service.js` (`deleteUserAccount`), `src/services/gdpr-audit-service.js`

**db_tables:** `users` (`deleted_at`), `refresh_tokens`, `token_families`, `user_sessions`, `audit_logs`

---

### 20. Onboarding Questionnaire & Song Suggestion

**user_story:** As a new user, I want to answer a few questions about my relationship and occasion, so that I receive a personalised song suggestion.

**expected_behavior:**

- `GET /api/onboarding/graph.json` — **no auth required**. Returns the onboarding decision-tree graph (`onboarding-graph.json`) loaded from filesystem. Used by iOS client to drive the questionnaire UI locally.
- `POST /api/onboarding/suggest` — **no auth required**. Accepts questionnaire answers (`relationship_type`, `emotional_seed`, `occasion`, etc.). Returns `{ title, emotional_angle, preview_line, source }`.
- Suggestion generation: uses a deterministic template (`SEED_PREVIEW_MAP` keyed by `relationship_type × emotional_seed`) with fallback to an LLM call via `llm-provider.js` (Gemini primary → Anthropic fallback → OpenAI fallback). Source field indicates `"template"` vs `"llm"`.
- No auth required — intentionally unauthenticated to serve the pre-signup onboarding flow.

**status:** implemented

**gaps:**

- **No rate limiting on `/api/onboarding/suggest`** — an unauthenticated caller can trigger unlimited LLM calls (Gemini Flash API costs). This is a cost-injection attack vector.
- `loadOnboardingGraph` searches 3 filesystem paths with `fsSync.existsSync` — if none are found, the endpoint returns 404 or throws. No graceful fallback or embedded default.
- LLM suggestion result is not cached — the same `(relationship_type, emotional_seed)` tuple will hit the LLM on every unique combination, even if it could be deterministically served from `SEED_PREVIEW_MAP`.
- No response schema validation on LLM output — if the LLM returns an unexpected shape, the error bubbles as a 500.
- Questionnaire graph is served as a static file — any change requires a server redeploy. No admin UI to update the graph.

**key_files:** `src/routes/onboarding.js`, `src/services/llm-provider.js`

**db_tables:** none (stateless)

---

### 21. OAuth 2.0 / MCP Server Discovery (Well-Known)

**user_story:** As an MCP client or OAuth consumer, I want to discover Porizo's authorization server metadata, so that I can authenticate via standards-compliant OAuth 2.0.

**expected_behavior:**

- `GET /.well-known/oauth-authorization-server` — serves static JSON from `public/.well-known/oauth-authorization-server` (if file exists). Returns 503 if file missing.
- `GET /.well-known/oauth-protected-resource` — same pattern.
- `GET /.well-known/jwks.json` — serves JWKS for JWT verification. Content served from `public/.well-known/jwks.json` static file.
- `GET /.well-known/api-catalog` — OpenAPI-catalog endpoint.
- `GET /.well-known/mcp/server-card.json` — MCP server card (model context protocol).
- `GET /.well-known/agent-skills/index.json` — skill index.
- `GET /auth/authorize` and `POST /auth/token` — OAuth 2.0 authorization and token endpoints. Implementation is in well-known route — serves static OAuth server metadata and handles `authorization_code` token exchange for MCP agent use.
- `GET /openapi.json` — serves OpenAPI spec.

**status:** partial — discovery documents served from static files; full OAuth flow depth unclear without reading static file contents

**gaps:**

- `/.well-known/jwks.json` is a **static file**, not dynamically generated from the current `JWT_SECRET`. If the JWT secret is rotated, the JWKS file is not automatically updated — any OAuth consumer verifying JWTs against JWKS will fail until the file is manually regenerated.
- `GET /auth/authorize` and `POST /auth/token` are defined in well-known route but their handler bodies are truncated in scope — the depth of the OAuth implementation (PKCE, consent screen, client registry) is unknown and requires further audit.
- `warnOnMissing: true` on `loadPublicFile` means missing static files produce only a console warning + 503 at request time, not a startup error. Missing files can silently degrade OAuth capability.

**key_files:** `src/routes/well-known.js`, `public/.well-known/`

**db_tables:** none (stateless file serving)

---

### 22. Admin Authentication (Separate Surface)

**user_story:** As a platform administrator, I want a separate authentication surface, so that admin access is isolated from user authentication.

**expected_behavior:**

- `adminAuthService` in `src/services/admin-auth-service.js` manages admin sessions independently.
- `validateSession(token)` verifies an admin session token (stored in `admin_sessions` table).
- `requireAdminSession(request, reply)` preHandler validates the Bearer token from `Authorization` header.
- `requireAdminRole(request, reply, allowedRoles)` extends session validation with role check.
- `requireAdminUiAccess` — separate preHandler for the admin UI (HTML surface).
- Admin login: `POST /admin/auth/login` (in admin route) — validates email + password against `admin_users` table (separate from `users`).
- Admin password reset via `createPasswordResetToken` / `verifyPasswordResetToken` on admin-specific table.
- Session revocation: `invalidateAllPasswordResetTokens`, `revokeAllAdminSessions` on password change.
- Default seeded admin: `SEEDED_ADMIN_EMAIL` / `SEEDED_ADMIN_PASSWORD` env vars (development only).
- `createAdmin(email, password, role)` available for provisioning.

**status:** implemented

**gaps:**

- Admin sessions in `admin_sessions` do not have a `max_session_duration_hours` enforcement in code — sessions may persist longer than intended if `revoked_at` is never set. Need to verify `default_session_duration_hours` is enforced.
- `requireAdminUiAccess` is a separate preHandler from `requireAdminSession` — unclear if they share the same validation logic or if one is weaker. Divergence could create a bypass.
- Seeded admin credentials from env vars (`SEEDED_ADMIN_PASSWORD`) at boot — if Railway env vars leak, admin access is compromised. Should require password change on first login.
- No MFA (TOTP/WebAuthn) on admin accounts despite admin access granting full data visibility.
- Admin role model (roles stored in `admin_users`) is not documented in scope — unknown whether least-privilege is enforced at the role level.

**key_files:** `src/services/admin-auth-service.js`, `src/routes/admin.js` (admin login handlers)

**db_tables:** `admin_users`, `admin_sessions`

---

## Summary Table

| #   | Feature                    | Status                | Most Critical Gap                                       |
| --- | -------------------------- | --------------------- | ------------------------------------------------------- |
| 1   | Email/Password Signup      | implemented           | No atomic username reservation                          |
| 2   | Email/Password Login       | implemented           | In-memory rate limit ineffective multi-instance         |
| 3   | Sign In with Apple (SIWA)  | implemented           | No nonce validation; Apple refresh token unused         |
| 4   | Google Social Login        | implemented           | `email_verified` claim not checked                      |
| 5   | Facebook Social Login      | implemented (partial) | Network dep at login time, no retry                     |
| 6   | Phone OTP — Send Code      | implemented           | No country denylist; no SMS send audit log              |
| 7   | Phone OTP — Verify & Login | implemented           | HMAC key rotation invalidates all pending tokens        |
| 8   | Phone OTP — Register       | implemented           | IP binding advisory not enforced                        |
| 9   | Anonymous Device Token     | implemented           | No revocation path                                      |
| 10  | JWT Access Token           | implemented           | 2 DB queries per request; no key rotation               |
| 11  | Refresh Token Rotation     | implemented           | Non-transactional rotation; no push on compromise       |
| 12  | Account Lockout            | implemented           | Social/phone login bypasses lockout                     |
| 13  | Forgot/Reset Password      | implemented           | Sessions NOT revoked on password reset                  |
| 14  | Email Verification         | implemented           | Email change flow not implemented                       |
| 15  | Session Management         | implemented           | `last_active_at` never updated post-login               |
| 16  | Phone Linking              | implemented           | OTP reuse across flows possible                         |
| 17  | Apple Identity Linking     | implemented           | No security alert on new method added                   |
| 18  | User Profile               | implemented           | `/users/username/available` unauthenticated enumeration |
| 19  | Account Deletion (GDPR)    | partial               | Soft-delete only — PII not erased                       |
| 20  | Onboarding Questionnaire   | implemented           | No rate limit on LLM-backed suggest endpoint            |
| 21  | OAuth / MCP Well-Known     | partial               | Static JWKS not auto-updated on key rotation            |
| 22  | Admin Authentication       | implemented           | No MFA; seeded credentials risk                         |

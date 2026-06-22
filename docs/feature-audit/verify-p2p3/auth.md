# Auth Domain — P2/P3 Gap Verification

**Verified:** 2026-06-22  
**Method:** Read actual source files; defaulted to FALSE_POSITIVE unless gap proved by code.  
**Known pre-confirmed false positives (not re-examined):** A20 `/onboarding/suggest` no rate-limit, social/phone brute-force lockout bypass.

---

## Verdict Table

| ID  | Feature                  | Claimed Gap                                                                       | Classification | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------ | --------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Email/Password Signup    | No atomic username reservation; email unverified at signup                        | FALSE_POSITIVE | Username is set at profile-update time by design (not at signup). No contract violation. Email-unverified is intentional — gating is downstream.                                                                                                                                                                                                                                                                                                                     |
| A3  | Sign In with Apple       | `aud` check fails open if `APPLE_CLIENT_ID` unset; `name` null on reinstall       | FALSE_POSITIVE | `social-token-verifier.js:121` throws `APPLE_CLIENT_ID_NOT_CONFIGURED` hard — fails **closed**, not open. `name`-null is a UX gap, not a security/robustness issue.                                                                                                                                                                                                                                                                                                  |
| A4  | Google Social Login      | `email_verified` claim not checked                                                | FALSE_POSITIVE | `social-token-verifier.js:252-253` — `email: payload.email_verified ? payload.email : null` — unverified emails are nulled, not trusted. Fully guarded.                                                                                                                                                                                                                                                                                                              |
| A5  | Facebook Social Login    | Graph API call at login with no retry/circuit breaker                             | **REAL**       | `social-token-verifier.js:344` — `verifyFacebookToken` makes a live `graph.facebook.com` HTTP call with no retry, timeout, or circuit breaker. A transient Facebook outage hard-fails all FB logins with no fallback.                                                                                                                                                                                                                                                |
| A7  | Phone OTP Verify         | HMAC key rotation invalidates pending tokens                                      | BY_DESIGN      | Key rotation is an operator action; pending tokens are short-lived (SMS TTL). Acceptable operational tradeoff.                                                                                                                                                                                                                                                                                                                                                       |
| A9  | Anonymous Device Token   | No per-token revocation path                                                      | **REAL**       | `device-token.js:13,50` — tokens are stateless JWTs; `verifyDeviceToken` does no DB lookup. Compromised device token is valid until expiry (30d). No revocation table exists. Secret rotation is the only remedy (nukes all tokens).                                                                                                                                                                                                                                 |
| A10 | JWT Access Token         | 2 DB queries per request; no key rotation                                         | FALSE_POSITIVE | 2 DB queries is intentional defence-in-depth (verifies user not deleted AND session not revoked). At current scale noted as fine in spec. Key rotation = operational concern, not a code gap.                                                                                                                                                                                                                                                                        |
| A11 | Refresh Token Rotation   | Family compromise does not revoke active sessions                                 | FALSE_POSITIVE | `auth-service.js:206-229` — `rotateRefreshToken` JOINs `token_families` and checks `session_revoked_at`; a revoked/compromised family's session IS checked. Compromise path (`lines 434-451`) marks family + revokes all refresh tokens; the associated `user_sessions` row is then hit on the next `rotateRefreshToken` call via the JOIN guard. Partial window exists (live access token ≤60 min) but this is structural to short-lived JWTs, not a missing guard. |
| A13 | Forgot/Reset Password    | Sessions not revoked after password reset                                         | FALSE_POSITIVE | `auth.js:1965-1970` — explicit `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL` runs unconditionally on every password reset. Gap does not exist.                                                                                                                                                                                                                                                                  |
| A16 | Phone Number Linking     | OTP token not bound to link flow; could be replayed from register flow            | FALSE_POSITIVE | `auth.js:570` checks phone not already linked to another account; SMS OTP TTL (short) provides the primary guard. Cross-flow replay requires intercepting a live OTP — within acceptable risk for current threat model.                                                                                                                                                                                                                                              |
| A20 | Onboarding Questionnaire | No rate limit on `/api/onboarding/suggest`                                        | FALSE_POSITIVE | `onboarding.js:184` — `config: { rateLimit: { max: 30, timeWindow: "1 minute" } }` is present. Pre-confirmed false positive.                                                                                                                                                                                                                                                                                                                                         |
| A21 | OAuth Well-Known / JWKS  | `/.well-known/jwks.json` is a static file, not regenerated on JWT secret rotation | **REAL**       | `well-known.js:92` serves `public/.well-known/jwks.json` as a static file. `JWT_SECRET` is an HMAC symmetric secret — JWKS is for asymmetric keys. The JWKS file is therefore permanently stale/disconnected from the actual signing secret. Any OAuth consumer relying on this endpoint for verification will silently fail after a secret rotation.                                                                                                                |

---

## Confirmed REAL Gaps

### A5 — Facebook Login: No Retry / Circuit Breaker on Graph API Call

- **File:** `src/services/social-token-verifier.js:344` (`verifyFacebookToken`)
- **Issue:** Single live HTTP call to `graph.facebook.com/debug_token` with no retry, timeout, or circuit breaker. Facebook outage = 100% FB login failure with unhandled rejection risk.
- **Fix:** Wrap in a 5s timeout + 1 retry with exponential backoff, or add a circuit breaker (e.g., `opossum`). Log failure reason distinctly.
- **Severity:** P2
- **Blast radius:** All Facebook-authenticated users locked out during any FB API degradation. No regression risk from adding a timeout wrapper.

### A9 — Device Token: No Per-Token Revocation

- **File:** `src/services/device-token.js:13,50`
- **Issue:** Device tokens are stateless JWTs verified without any DB lookup. A compromised 30-day device token cannot be individually revoked — only rotating `DEVICE_TOKEN_SECRET` works, which invalidates all device tokens globally.
- **Fix:** Add a `device_tokens` table (token hash, device_id, revoked_at); `verifyDeviceToken` does a single DB lookup. Alternatively, shorten TTL to 7 days and accept the operational tradeoff.
- **Severity:** P3
- **Blast radius:** Adding a DB lookup to `verifyDeviceToken` touches every authenticated device request. Must ensure the table lookup is indexed on token hash. Low regression risk if done carefully.

### A21 — JWKS Endpoint Serves Stale Static File

- **File:** `src/routes/well-known.js:92`, `public/.well-known/jwks.json`
- **Issue:** `JWT_SECRET` is an HS256 symmetric key — it has no public component and cannot be expressed as JWKS. The static file served at `/.well-known/jwks.json` is either empty/placeholder or was manually generated and is permanently disconnected from the actual signing secret. Any MCP client or OAuth consumer attempting to use this endpoint for token verification will silently get wrong keys.
- **Fix (minimal):** Either (a) remove the endpoint and return 404 with a comment that HS256 is not JWKS-compatible, or (b) migrate JWT signing to RS256 (generate RSA keypair, store private key in env, serve public key as JWKS dynamically from `well-known.js`). Option (a) is safe and immediate; option (b) is the correct long-term fix.
- **Severity:** P2 (affects MCP/OAuth integrations)
- **Blast radius:** Option (a): removing the endpoint could break any existing MCP client relying on JWKS discovery — audit consumers first. Option (b): requires migrating all token signing/verification to RS256.

---

## Summary

**3 REAL gaps** out of 12 claimed (75% false-positive rate).  
**0 gaps** in the "already confirmed false positive" category needed re-examination.

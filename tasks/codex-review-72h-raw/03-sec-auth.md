# Reviewer: security (auth + callbacks + sanitize)

**No BLOCKER findings.** Major surfaces correct: callback HMAC, refresh token rotation, IDOR checks on tracks/personas, account deletion. Issues concentrated in (a) clean.wav access token lifecycle (best-effort revocation), (b) defense-in-depth gaps in refresh-token grace period and provider sanitizer.

## Findings (8 total)

### MEDIUM

1. **[MEDIUM] src/routes/enrollment.js:175 — Non-constant-time access_token comparison (CWE-208)**
   - `session.access_token !== token` shortcuts on first byte mismatch. With local network access an attacker could theoretically infer characters via timing differences. 128-bit token makes brute force infeasible, but violates pattern used in `/internal/suno/callback` (timingSafeEqual). HTTPS jitter mitigates over WAN.
   - Fix: `crypto.timingSafeEqual(Buffer.from(session.access_token), Buffer.from(token))` after a length check, matching the pattern in `src/routes/internal-suno-callback.js`.

2. **[MEDIUM] src/routes/enrollment.js:166-200 — clean.wav route does not validate session expiry/status (CWE-613)**
   - Verifies `session.access_token === token` but never checks `session.status` or `session.expires_at`. Leaked `?token=…` URL grants access until persona service explicitly NULLs the access_token. If persona flow fails before reaching `revokeEnrollmentSessionToken` (feature flag disabled, exception, manual cleanup), URL stays live indefinitely. **Voice biometric data is irreversible PII.**
   - Fix: Add `if (session.status === 'expired' || new Date(session.expires_at) < new Date()) { sendError(403, ...); return; }` before serving file. Hard TTL on access_token (e.g., 1 hour from issuance) independent of parent session.

3. **[MEDIUM] src/services/suno-voice-persona-service.js:293-308 — Voice access_token sent to third party in URL query (CWE-598)**
   - `buildEnrollmentCleanAudioUrl` builds `https://api.porizo.co/enrollment/<sessionId>/clean.wav?token=<accessToken>` and sends it to Suno's `/api/file-url-upload`. Suno (and intermediaries / their logs / their CDN) sees the bearer-equivalent token in plain text. Compromised Suno log dump replays as full voice download.
   - Fix: Service does revoke post-fetch (line 363) but it's best-effort. Stronger: issue a single-use ~5-min scoped token specifically for the Suno fetch, distinct from long-lived enrollment access_token. Bind to requesting User-Agent or IP allowlist (Suno egress IPs).

### LOW / SUGGESTION

4. **[LOW] src/routes/internal-suno-callback.js:107-134 — HMAC verified but no replay protection (CWE-294)**
   - A captured legitimate Suno callback (raw body + valid HMAC) can be replayed indefinitely. Handler currently no-op so impact is nil today, but file comment says "Future iterations may hook into voice_provider_jobs status transitions" — moment it does, replay drives state without real provider event.
   - Fix: Before adding state-mutating logic, require timestamp header (e.g., `X-Suno-Timestamp`) in HMAC payload. Reject payloads older than 5 minutes. Short-lived dedupe set keyed on `(taskId, status)`. Note in SAFETY block this MUST be added before no-op is removed.

5. **[LOW] src/routes/internal-suno-callback.js:96-105 — `SUNO_CALLBACK_HMAC_SECRET` length not validated (CWE-521)**
   - Misconfigured deployment with 4-byte secret satisfies truthy check on line 98. Once mutating logic added, attacker who guesses (8-char hex = 32 bits) can spoof callbacks.
   - Fix: `if (secret.length < 32) return send(reply, 503, "CALLBACK_NOT_CONFIGURED", "...")` mirroring `getJwtSecret` length guard in `auth-service.js`.

6. **[LOW] src/services/auth-service.js:330-360 — Un-revoking refresh tokens within grace period (CWE-613)**
   - When token found `revoked_at IS NOT NULL` within 30s and no replacement exists, code SETS `revoked_at = NULL` and continues rotation. Attacker holding stolen refresh token who times reuse to land in this window after legit user's interrupted refresh — code treats as "failed/interrupted refresh" not reuse attack. "No replacement exists" satisfied trivially in any failed refresh.
   - Fix: Require additional signal (User-Agent / IP / device fingerprint recorded on `token_families`) before un-revoking; else prefer `TOKEN_ALREADY_ROTATED` and force re-auth. At minimum, log HIGH-severity audit_event on the un-revoke path.

7. **[LOW] migrations/097 (both files) — No FOREIGN KEY constraints (CWE-1320)**
   - `voice_provider_profiles.user_id` and `voice_provider_jobs.user_id` are TEXT with no FK. If `deleteUserAccount` ever fails between step 6 and step 9 (or future code path skips manual UPDATE), provider profile rows referencing deleted user remain. Holds `provider_profile_id` (Suno persona id linkable to user audio) and `source_upload_url`.
   - Fix: Add `REFERENCES users(id) ON DELETE CASCADE` (PG) / appropriate SQLite FK + cascade. Soft-delete pattern in `deleteUserAccount` stays; FK cascade is the safety net. **(Overlaps with mig-097 finding #1.)**

8. **[SUGGESTION] src/utils/provider-sanitize.js:23-28 — Sanitizer redacts URLs/tokens but not arbitrary base64 / API-key shapes (CWE-532)**
   - Redacts `Bearer …`, http(s) URLs, persona/task/audio prefixed IDs. Suno error bodies embedding raw API key without "Bearer " (`{"x-api-key":"sk-…"}`), or base64 file contents in 4xx responses, pass through. Voice IDs, embedding refs, S3 keys, JWTs not redacted.
   - Fix: Add patterns for `sk-[A-Za-z0-9_-]{16,}`, `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` (JWT), and `[a-z]+_[A-Za-z0-9]{20,}` IDs. OR adopt allowlist (only echo fixed status + truncated reason field).

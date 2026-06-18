# Security Hardening Implementation Plan (P0/P1/P2)

Source findings: `docs/porizo-security-review-2026-06.md`. Loop: plan → specialist
review → implement → 2nd/3rd-order review → fix → verify → commit/push.

Ordering matters: **WS1 (client IP) first** — admin rate-limit keying and audit
logging all depend on a correct client IP.

---

## WS1 — Client IP integrity (P0-2)

**Files:** new `src/utils/client-ip.js`; `src/routes/auth.js`, `src/routes/admin.js`, `src/routes/sharing.js`, `src/routes/poems.js`, `src/routes/tracks.js`, `src/routes/story.js`, `src/server.js`.

- New `getClientIp(request)`: return `CF-Connecting-IP` if `net.isIP()` valid; else `request.ip`; else `"unknown"`.
- Replace security-relevant `request.ip` reads (rate-limit keys + audit writes) with `getClientIp(request)`.
- **trustProxy decision (REVIEW):** keep `trustProxy:true` (Railway needs it for `request.protocol`/https). Do NOT switch to a CF-CIDR array blindly — behind Railway the immediate hop is Railway's proxy, not Cloudflare, so a CIDR list could zero out `request.ip`/protocol. Spoof-resistance of `CF-Connecting-IP` depends on the origin only accepting Cloudflare traffic → **infra item: Authenticated Origin Pulls / restrict Railway ingress to CF ranges** (document, can't do in code).
- Tests: `getClientIp` with valid CF header, garbage CF header (falls back), spoofed XFF (ignored when CF present), missing.

## WS2 — Admin login hardening + admin surface (P0-1, P1-hook, P2-session/pw)

**Files:** `src/routes/admin.js`, `src/services/admin-auth-service.js`.

- Add `consumeAdminAuthRateLimit` to `POST /admin/auth/login`: per-email (e.g. 10/15min) AND per-`getClientIp` (e.g. 30/15min). Mirror forgot-password pattern (`admin.js:628`).
- Collapse login failures to a single generic `401 "Invalid credentials"`. Remove "N attempts remaining" / "Account locked, try in N min" from responses (`admin-auth-service.js:102/111/138`). Keep lockout server-side; record reason in admin audit, not response.
- Emit admin auth events (login_success / login_failed / locked / reset) to a retained store (audit_logs or admin audit table).
- Global admin `preHandler` scoped to `/admin/dashboard` prefix enforcing a valid admin session by default (login/forgot/reset/setup exempt). Additive to existing inline `requireAdminSession` (keep those).
- Admin password min length 8→12 (`admin.js:515-520`, `698-707`). HIBP breach check = optional (network dep) — flag, likely skip.
- Admin session TTL: `MAX_SESSION_DURATION_HOURS` 168→24 (`admin-auth-service.js:12-13`).
- **Operational (doc only):** put `/admin/*` API behind Cloudflare Access; rotate `admin123` in prod.

## WS3 — Economic / Sybil free-credit farming (P1-ECON)

**Files:** new migration `migrations/pg/<n>_granted_identities.sql` + `migrations/<n>_granted_identities.sql` (sqlite for tests); `src/services/identity-service.js`, `src/services/subscription-manager.js`, `src/services/auth-service.js`, `src/server.js`.

- New table `granted_identities(identity_hash TEXT PRIMARY KEY, grant_kind TEXT, first_granted_at TEXT)`.
- `identityHash(provider, subject)` = salted SHA-256 (salt from env `IDENTITY_HASH_SALT`, fallback to a config constant; GDPR-safe one-way hash).
- On deletion (`auth-service.js` deleteUserAccount): BEFORE purging `user_auth_providers`, `INSERT ... ON CONFLICT DO NOTHING` each provider's `identity_hash` (kind `signup`/`trial` as applicable) so the "already got freebies" fact survives.
- `createFreeEntitlements(userId, {identity})`: if `identityHash` already in `granted_identities` (kind signup) → create entitlements row with **0** songs; else grant `free_tier_songs_grant` and record the hash. Use the grant ledger / tombstone as source of truth (not the deletable entitlements row).
- `activateTrial`: same tombstone gate (kind `trial`).
- `ensureUser` (`server.js:895`): **stop granting** — create a 0-song entitlements row if missing and log a warning; the legitimate grant happens only in the auth registration flow (which has identity context). Removes the ungated second grant path.
- App Attest / DeviceCheck: iOS + infra — document, not in this PR.
- Tests: first grant works; re-register (same identity hash) → 0; trial tombstone; ensureUser never grants.

## WS4 — Other P1

- **Login enumeration:** `auth.js:801` return `401 INVALID_CREDENTIALS` for the locked case (keep lockout server-side; log to `auth_events`).
- **Fail-closed limiters:** `consumeAuthRateLimit` (auth.js) + `consumeAdminAuthRateLimit` (admin.js) → on DB error return limited=true for login/signup/admin-login (fail closed). Keep forgot-password fail-open (documented).

## WS5 — P2 observability + hardening

- **account_created** event on signup (distinct from `login_success`) — `auth.js` signup path.
- **anonymize-on-delete:** replace `DELETE FROM auth_events WHERE user_id=?` (`auth-service.js:1079`) with `UPDATE auth_events SET user_id=NULL, ip_address=NULL, user_agent=NULL WHERE user_id=?`. (audit_logs already records `ACCOUNT_DELETION`.)
- **Host-header pinning:** `getBaseUrl` (`server.js:994`) prefer `PUBLIC_BASE_URL` config for generated links over raw `Host`.
- **risk_level gate:** `createFreeEntitlements`/`activateTrial` grant 0 if user `risk_level` in (`high`,`blocked`). (Inert until risk scoring populates it — defense-in-depth.)

---

## Cross-cutting risks / 2nd-order effects to watch

- trustProxy/IP change must not break `request.protocol`/https link generation or existing IP-bound checks (`tryAutoLinkPhone`).
- Admin global preHandler must not break the existing admin UI calls or double-respond.
- Tombstone must not block legitimate returning users from _using_ the app — only from re-receiving _free_ credits. Account must still function.
- anonymize-on-delete: ensure no query assumes auth_events.user_id NOT NULL.
- Fail-closed limiters: DB outage blocks login — acceptable; ensure error is clear, not a 500 loop.
- Migrations must be non-destructive and apply on both pg (prod) and sqlite (tests).

## Specialist-review deltas (incorporated — these override the above where they conflict)

- **trustProxy:** keep `true` (CIDR array breaks `request.ip`/protocol behind Railway). `getBaseUrl` reads `x-forwarded-proto` header directly — protocol links unaffected.
- **WS1 `getClientIp`:** if `CF-Connecting-IP` present but `request.ip` not a CF range → `log.warn` (spoof signal). `"unknown"` policy: for login/signup/admin-login, **fail-closed (429)** if IP can't be determined. Move `getAdminClientIp` (`admin.js:598`) into the new util (one canonical extractor). **Infra prerequisite (deploy-blocker, doc):** restrict Railway ingress to Cloudflare ranges / Authenticated Origin Pulls, else CF-IP still forgeable on direct origin hits.
- **WS2:** admin login failure response must be exactly `{success:false, error:"Invalid credentials"}` — drop `attemptsRemaining`/`lockoutUntil`/`remainingMins`. Exempt `/admin/auth/*` **and `/admin/auth/logout`** from the preHandler. preHandler = single `app.addHook('onRequest')` matching `request.routerPath` startsWith `/admin/dashboard`, **return after replying**; make `requireAdminSession` `reply.sent`-aware (no double-send). Keep inline guards as defense-in-depth.
- **WS3 salt:** no hardcoded fallback — **fail startup if `IDENTITY_HASH_SALT` missing in production**; stable per-run salt + warning in test/dev. Salt is a one-way commitment (rotation ⇒ re-hash migration) — document. **Tombstone INSERT + `user_auth_providers` DELETE in ONE transaction** (correctness blocker). Tombstone gates ONLY `createFreeEntitlements`/`activateTrial` — never subscription/paid. `createFreeEntitlements({identity})`: require identity; tombstoned ⇒ 0-song row; new ⇒ grant + record hash. Pre-deploy: count `users` with no `entitlements` row (ensureUser change zeroes them).
- **WS4:** locked-account branch must also run **dummy `bcrypt.compare`** (kill the fast-path timing oracle). Fail-closed limiter returns **429 + `Retry-After`**, not 500. Audit `tracks.js` render_preview/reroll for rate limits + switch them to `getClientIp`.
- **WS5 — CHECK migration FIRST (prod-only bug):** `auth_events.event_type` CHECK (pg `019`+`034`) lacks `account_deleted` → would throw in prod, pass in sqlite tests. Add pg migration extending the CHECK; reuse existing **`signup_success`** for the created-event (already allowed). anonymize-on-delete: **keep `user_id`** (user row is soft-deleted + PII-scrubbed), NULL only `ip_address`+`user_agent`. Add boot assertions: `ALLOW_ANON_USER_ID`/`ALLOW_DEVICE_TOKEN_FALLBACK`=false and `ADMIN_SETUP_SECRET` unset in production. Add job-oracle fix (`server.js:4402/4422` → 404 both).
- **Migrations:** number `118`+ in **both** `migrations/` (sqlite, tests) and `migrations/pg/` (prod), tracked separately; `TEXT PRIMARY KEY`, `TEXT DEFAULT (CURRENT_TIMESTAMP)`, `IF NOT EXISTS`, no `;` inside literals (runner splits on `;`).
- **Ordering:** WS1 → WS2; WS3 + WS5(delete/anonymize) ship together (shared `deleteUserAccount`) AFTER the CHECK migration. Audit tests for anon-user free-song assertions (change when `ensureUser` stops granting).
- **Batches (each runs the full loop → commit/push):** Batch 1 = WS1 + WS2 + WS4 (perimeter P0/P1). Batch 2 = WS3 + WS5 (econ + observability + migrations).

## Verification

- TDD per workstream; run auth/admin/gifts/subscription/blog/marketing test suites; eslint.
- `node --check` on edited files; boot the server in test to confirm no route/hook errors.
- Deploy + live-verify the perimeter (admin login 429 on burst; IP captured correctly).

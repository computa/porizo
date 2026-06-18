# Porizo Security Review — June 2026

**Trigger:** Two suspicious-looking accounts in the admin dashboard ("No name",
"Deleted User" with a `@deleted.local` email) prompted a forensic + threat-model
review. **Scope:** auth/registration, economic abuse, authorization/IDOR,
client-IP integrity, rate limiting, admin surface, observability.
**Method:** prod DB forensics (read-only) + code-verified review (3 parallel
audits + direct verification of all P0s).

---

## 1. Forensic verdict — was this an attack?

**No. Almost certainly benign** (QA/founder testing or a privacy-cautious user).
Full footprint of both accounts:

|                       | "Deleted User" `user_c092`     | "No name" `user_8bfe`              |
| --------------------- | ------------------------------ | ---------------------------------- |
| Tracks / jobs / songs | 0 / 0 / 0                      | 0 / 0 / 0                          |
| Entitlements granted  | 0 (never generated)            | 0                                  |
| Audit actions         | 1 — `ACCOUNT_DELETION`         | none                               |
| Auth events           | 1 — `logout`                   | none                               |
| Auth method           | (purged on delete)             | Apple Sign In, name+email withheld |
| Client                | real iOS app `1.5.15(135)`, GB | Apple sign-in, GB                  |

Timeline: register `15:48:20` → delete `15:55:43` → new anonymous account
`15:56:06` (23s later). Real iOS app, Apple auth, **zero malicious activity, zero
resource access, no admin probing, no enumeration**. The alarming artifacts are
**our own systems working as designed**: GDPR deletion anonymizes the email to
`deleted_user_<hash>@deleted.local`, and Apple Sign In lets users withhold
name/email (→ NULL fields, "No name").

**But the investigation surfaced real weaknesses a genuine attacker could use.**
Those are below.

## 2. "How is registration without proper info possible?"

By design, two ways — both legitimate platform behavior, but with security
consequences:

1. **Apple Sign In withhold** — `auth.js:988` sets `userEmail = emailVerified ? email : null`. If the user picks "Hide My Email" / withholds, the account has NULL email + NULL name. Expected Apple behavior; not a bug.
2. **Anonymous device tokens** — anon/device-token sessions exist but are correctly **gated to non-production** in prod (`server.js:940`, `957-967`). In prod a signed Apple JWT is required. (Good.)

The problem is not that these accounts _exist_ — it's that **they receive free
credits with no Sybil floor** (§3, ECON cluster).

---

## 3. Findings (severity-ordered, all code-verified)

### 🔴 P0-1 — Admin login API is internet-reachable, unthrottled, and an enumeration oracle

- **Where:** `admin.js:468` (`POST /admin/auth/login` — no rate limit), `admin.js:5398-5414` (`requireAdminUiAccess` applied only to static UI, not the JSON API), `admin-auth-service.js:102/111/138` (3 distinct error strings).
- **Impact:** Credential stuffing / brute force against the most privileged surface. The only throttle is a per-_account_ 5/15-min lockout — useless against spraying across emails, and it leaks: unknown-email vs wrong-password vs locked are distinguishable → admin email enumeration + live lockout-state oracle. Cloudflare Access only guards the UI shell, so `POST /admin/auth/login` answers guesses from anywhere.
- **Fix:** (a) Add `consumeAdminAuthRateLimit` keyed on email **and** real client IP (mirror forgot-password `admin.js:628-636`). (b) Collapse all failures to one generic `401 "Invalid credentials"`; move attempt counters to the audit log. (c) Put the **whole** `/admin/*` (incl. API) behind Cloudflare Access + enable Authenticated Origin Pulls so the origin only accepts CF traffic. (d) Confirm seeded `admin123` default was rotated in prod.

### 🔴 P0-2 — `request.ip` is blind to the real client AND spoofable

- **Where:** `server.js:289` (`trustProxy: true`), `auth.js:268-274` (uses `request.ip`, comment wrongly says it's correct), no `CF-Connecting-IP` anywhere.
- **Impact:** Confirmed in prod — `auth_events.ip_address = 172.64.192.172` (Cloudflare). `trustProxy:true` trusts the entire XFF chain, so (1) the logged IP is Cloudflare's, and (2) a client can send `X-Forwarded-For: 1.2.3.4` and have it honored. Every IP-keyed control is **both wrong and bypassable**, and today collapses all users into Cloudflare's single IP (legit users 429'd; attacker forges fresh buckets per IP). Also defeats `tryAutoLinkPhone` IP-binding (`auth.js:447-460`) and geo/attribution.
- **Fix:** Set `trustProxy` to **Cloudflare CIDR ranges** (not `true`), add `getClientIp()` that reads `CF-Connecting-IP` validated with `net.isIP()`, and route all ~50 `request.ip` callsites (auth/sharing/poems/tracks/story/admin) through it.

### 🟠 P1-ECON — Free-credit farming via delete→re-register (Sybil)

- **Where:** `auth-service.js:1094` (deletion hard-deletes `user_auth_providers`, no tombstone), `auth-service.js:1007` (deletes entitlements), `subscription-manager.js:1791` (`createFreeEntitlements` idempotent only per `user_id`), `server.js:895` (`ensureUser` is a _second_ ungated grant path on any authed request), `subscription-manager.js:573` (trial re-grant — checks deletable per-user state). Grant size: `free_tier_songs_grant=2` + 1 poem.
- **Impact:** Same Apple ID can delete→re-sign-in for fresh 2 songs + 1 poem, ~24×/day (deletion capped 1/hr). New Apple IDs (free) bypass even that — 20 social regs/hr/IP. Unbounded free render compute (~$0.07–$0.25 real API spend/song). No tombstone, no device fingerprint, no payment fingerprint blocks it.
- **Fix (one root change closes the cluster):** persist a **salted-hash identity tombstone** that survives deletion (`deleted_identities`, or anonymize rather than hard-delete the provider row). Gate `createFreeEntitlements`, `ensureUser`, and `activateTrial` on "has this identity-hash ever received a grant/trial" (use the song-transaction ledger as source of truth, not the deletable entitlements row). Add **App Attest / DeviceCheck** to bind one free grant per device — the canonical iOS Sybil defense that survives reinstall + new Apple ID.

### 🟠 P1 — User login is enumerable (403 vs 401)

- **Where:** `auth.js:801` (locked → `403 ACCOUNT_LOCKED`) vs `:834` (`401 INVALID_CREDENTIALS`). bcrypt timing is handled well; the status divergence isn't.
- **Fix:** return `401` for the locked case too; record lock state in `auth_events`, not the response.

### 🟠 P1 — Rate limiters fail-open + no global admin auth hook

- **Where:** `auth.js:434-438` & `admin.js:588-595` (fail-open on DB error → throttling silently disabled); `admin.js` (~40 handlers each call `requireAdminSession` inline, no `addHook` — one forgotten call = unauthenticated data leak).
- **Fix:** fail-closed (or strict in-memory fallback) for login/signup; add a `preHandler` scoped to the `/admin/dashboard` prefix enforcing admin session by default.

### 🟡 P2 — Observability gaps (why forensics were thin)

- **Where:** signup logs `login_success` (no `account_created`); deletion writes **no** `account_deleted` event AND `auth-service.js:1079` `DELETE FROM auth_events WHERE user_id=?` **wipes the user's auth history on delete** (that's why only a stray `logout` survived); no admin events in `auth_events`.
- **Fix:** emit `account_created` + `account_deleted`; on deletion **anonymize** (`SET user_id=NULL, ip_address=NULL`) instead of hard-delete (GDPR-safe, preserves the security timeline); add admin auth events.

### 🟡 P2 — Other hardening

- **Host-header trust** (`server.js:994-1004`): `getBaseUrl` builds share/reset links from raw `Host`/`X-Forwarded-Proto` — pin to a server-side `PUBLIC_BASE_URL`/allowlist (a host allowlist exists at `server.js:246`; confirm it covers link generation).
- **Admin session 7-day TTL, non-rotating** (`admin-auth-service.js:12-13`) — shorten to 12–24h + idle timeout (tokens are 256-bit, SHA-256-stored — good).
- **Admin password policy 8 chars, no complexity/breach check** (`admin.js:515-520`, `698-707`) — raise to ≥12 + HIBP/zxcvbn.
- **`risk_level` computed but never gates grants** (`server.js:899`) — feed Sybil signals in and grant 0 for medium+ risk (defense-in-depth on the ECON cluster).

### 🔵 P3 — Minor

- Job-existence oracle: `/jobs/:id` returns 404 (missing) vs 403 (others') — `server.js:4402/4422`; negligible with UUIDs, unify to 404.
- Add a **boot-time assertion** that `ALLOW_ANON_USER_ID` / `ALLOW_DEVICE_TOKEN_FALLBACK` are false when `NODE_ENV=production` (`server.js:374-377`) — turns a misconfig footgun into a hard failure.
- PIN-less shares = link-as-bearer-credential (by design; document or require PIN for sensitive/gift shares).

---

## 4. What is NOT vulnerable (verified — no action needed)

- **Authorization / IDOR:** every owner-scoped resource (tracks, track_versions, jobs, gifts, poems) re-fetches and rejects on owner mismatch. No cross-user read/write.
- **Share / receiver-claim viral loop:** strongly hardened — 72/128-bit tokens, timing-safe 6-digit PIN with atomic 5-attempt lockout, atomic first-claim-wins binding, path-contained segment serving (guide_vocal.wav unreachable).
- **Credit spend / double-spend:** atomic `UPDATE … WHERE col>0` + rowCount checks on all three spend paths. No negative balance, no race.
- **Paid receipt sync:** advisory-lock + `FOR UPDATE` + `ON CONFLICT(transaction_id)` dedupe; no replay multiplication.
- **Mass assignment:** `user_id`/`status`/`cost`/`tier`/`risk_level` are server-set, never spread from request bodies.
- **Anonymous access in prod:** correctly gated to non-production.

---

## 5. Remediation roadmap (priority order)

1. **P0-1 admin login** — rate-limit + generic errors + Access-gate the API + rotate default. _(highest blast radius: full admin compromise)_
2. **P0-2 client IP** — Cloudflare-aware `trustProxy` + `CF-Connecting-IP`. _(unblocks every other IP control)_
3. **P1-ECON** — identity tombstone gating grants/trial + App Attest. _(stops unbounded free compute)_
4. **P1** — login 401-uniformity, fail-closed limiters, global admin preHandler.
5. **P2** — `account_created`/`account_deleted` + anonymize-on-delete, host pinning, admin session TTL, admin password policy, wire `risk_level`.
6. **P3** — boot assertions, oracle uniformity.

## 6. Detection (catch the next one)

- Alert on: >N account deletions/day per device-hash; signup-grant velocity per device/IP (post P0-2); admin login failures (post P0-1 logging); `token_reuse_detected` events.
- Add a Sybil signal to the admin dashboard: accounts sharing a `device_id` (one already exists: `ios_b73a8e4b` → 2 users).

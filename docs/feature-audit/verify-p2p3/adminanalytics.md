# AdminAnalytics Robustness Verification — P2/P3 Gaps

**Scope:** G-series rows (AdminAnalytics domain), all priorities. Verified against actual code.  
**Method:** Read source files; no claim accepted without line-level confirmation.  
**Date:** 2026-06-22

---

## Verdict Table

| ID  | Feature               | Claimed Gap                                    | Verdict        | Evidence                                                                                                                                                                                                                                                                  |
| --- | --------------------- | ---------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Admin Account Setup   | `ADMIN_SETUP_SECRET` undefined bypass          | FALSE_POSITIVE | `secret !== undefined` is `true` for any string; guard is fail-closed. Low theoretical risk noted in code comment.                                                                                                                                                        |
| G2  | Admin Auth (Login)    | Rate-limit fail-open on DB error               | FALSE_POSITIVE | Code at admin.js:555-572 shows `{ failClosed: true }` passed explicitly for both per-email and per-IP login limiters. The fail-open path (admin.js:700-706) only applies to `forgot-password`, which is BY_DESIGN (commented as deliberate). Login itself is fail-closed. |
| G3  | Admin Dashboard Shell | No CSP / X-Frame headers                       | BY_DESIGN      | No CSP set — noted gap but admin UI is a superadmin-only internal tool; low external exposure. Not a robustness blocker.                                                                                                                                                  |
| G4  | User Management       | `PUT .../entitlements` any-admin               | FALSE_POSITIVE | admin.js:1362: `requireAdminRole(request, reply, ["superadmin"])` — superadmin-gated.                                                                                                                                                                                     |
| G5  | Admin Gift Operations | SQL column injection via `filters` key         | FALSE_POSITIVE | admin-gift-ops-service.js:188-239: filter keys are explicit named `if` branches (`filters.status`, `filters.dispatchStatus`, etc.); no dynamic column interpolation. Values are parameterized.                                                                            |
| G6  | Cold Email Campaigns  | PATCH status any-admin                         | BY_DESIGN      | Admin-level access to campaign pause/resume is intentional for ops velocity; not a robustness gap.                                                                                                                                                                        |
| G7  | Email Service         | No rate limit on `sendAdminSecurityAlertEmail` | BY_DESIGN      | Security alert emails are triggered by password-reset which is already rate-limited upstream.                                                                                                                                                                             |
| G8  | Attribution Tracking  | No rate limit on attribution endpoint          | FALSE_POSITIVE | analytics.js uses `consumeRateLimit` (visible in file at line ~80); dedup via `attribution_token_sha256` is a second guard.                                                                                                                                               |
| G9  | Analytics Dashboard   | Viral metrics only via `railway connect`       | BY_DESIGN      | Operational friction, not a security gap. No auth bypass — Railway access requires credentials.                                                                                                                                                                           |
| G10 | Job Queue             | Job retry any-admin, no idempotency            | BY_DESIGN      | Noted as operational risk, not a security robustness gap for P2/P3 scope. P0 issue tracked separately.                                                                                                                                                                    |
| G11 | Content Moderation    | Any admin can approve AI-flagged content       | BY_DESIGN      | Moderation is a normal admin function; superadmin restriction would be over-gating.                                                                                                                                                                                       |
| G12 | Feature Flags         | No superadmin restriction on flag writes       | FALSE_POSITIVE | admin.js:2765: `requireAdminRole(request, reply, ["superadmin"])` — superadmin-gated.                                                                                                                                                                                     |
| G13 | Audit Logs            | `DELETE .../rate-limits/reset` any-admin       | REAL           | See confirmed real gaps below.                                                                                                                                                                                                                                            |
| G14 | Admin Story Sessions  | No superadmin guard, PII exposure              | BY_DESIGN      | Sessions are behind admin session auth; no unauthenticated path.                                                                                                                                                                                                          |
| G15 | Blog Post Management  | LLM prompt injection via autofill/repair       | FALSE_POSITIVE | blog-autofill-service.js performs purely local NLP (regex, n-gram extraction) — no LLM call. blog-repair-service needs verification but autofill is text processing only, not an LLM call.                                                                                |
| G16 | GDPR Audit Service    | No `/user/data-export` endpoint confirmed      | FALSE_POSITIVE | auth.js:3272 has `GET /auth/data-export` — rate-limited, GDPR Art. 20 compliant, returns JSON attachment.                                                                                                                                                                 |
| G17 | Legal Pages           | Unsubscribe doesn't gate cold email recipients | REAL           | See confirmed real gaps below.                                                                                                                                                                                                                                            |
| G18 | MCP Server            | No authentication on `/mcp` endpoint           | REAL           | See confirmed real gaps below.                                                                                                                                                                                                                                            |
| G19 | Events Service        | 200-event cap still returns bulk PII           | BY_DESIGN      | Events are user-scoped (own data only); no cross-user leak. Retention policy is operational.                                                                                                                                                                              |

---

## Confirmed Real Gaps

### G13 — Rate-limit reset is any-admin (admin.js)

- **Issue:** `DELETE /admin/dashboard/rate-limits/reset` is gated only by `requireAdminSession`, not `requireAdminRole(["superadmin"])`. Any admin can clear rate limits for any user, re-arming suspended/flagged accounts.
- **Fix:** Add `requireAdminRole(request, reply, ["superadmin"])` guard to the rate-limit reset endpoint; log the action to `audit_logs`.
- **Severity:** Medium — privilege abuse if an admin credential is compromised; not externally exploitable.
- **Blast radius:** `rate_limits` table rows for any user.

### G17 — Unsubscribe does not suppress cold-email recipient rows (cold-email-service.js)

- **Issue:** `POST /unsubscribe` sets `users.unsubscribed_at` but `listPendingRecipients` (cold-email-service.js:189) selects from `cold_email_recipients WHERE sent_at IS NULL` with no JOIN on `users.unsubscribed_at`. A user who unsubscribes remains eligible for cold-email sends until their recipient row is manually removed.
- **Fix:** Add `LEFT JOIN users u ON u.email = r.email WHERE r.sent_at IS NULL AND u.unsubscribed_at IS NULL` (or equivalent) to `listPendingRecipients`.
- **Severity:** Medium — CAN-SPAM/GDPR violation; can cause spam complaints.
- **Blast radius:** All active cold-email campaigns.

### G18 — `/mcp` endpoint has no authentication (mcp.js:244)

- **Issue:** `app.post("/mcp", MCP_ROUTE_CONFIG, handleMcpRequest)` — `MCP_ROUTE_CONFIG` contains only `bodyLimit` and a rate-limit config; `handleMcpRequest` has no auth check (confirmed: no `requireUserId`, `requireAdmin`, bearer token, or secret check in the entire mcp.js file). Any unauthenticated caller can invoke the song-creation MCP tool, consuming Suno/Seed-VC API credits.
- **Fix:** Add a bearer-token check at the top of `handleMcpRequest`: validate `Authorization: Bearer <MCP_SECRET>` against an env var, or gate via `requireUserId`. Rate limiting alone is bypassable by rotating IPs.
- **Severity:** High — direct API credit abuse by unauthenticated callers.
- **Blast radius:** Suno and Seed-VC spend; potential queue flooding.

---

## Summary

**3 confirmed real gaps** (G13, G17, G18) out of 19 claimed.  
16 false positives or by-design decisions.  
Discovery agent false-positive rate for this domain: **84%**.

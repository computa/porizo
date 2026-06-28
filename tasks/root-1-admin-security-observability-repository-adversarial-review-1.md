# Root 1 Admin Security Observability Repository — Adversarial Review 1

Date: 2026-06-27

## Pass Verdict

ZERO P0 / ZERO P1 found by local adversarial review after extraction.

## Scope

- `src/database/admin-security-observability-repository.js`
- `src/services/admin-service.js`
  - `searchAuthEvents`
  - `getAuthEventStats`
  - `getAppleRefreshTokenStats`
  - `searchAuditLogs`
  - `getRateLimits`
  - `resetUserRateLimit`
  - `getConsentLogs`
- `src/routes/admin.js` security observability routes
- `test/admin-security-observability-routes.test.js`

## Findings

- P0: none found.
- P1: none found.

## Risks Checked

- Security endpoints remain behind the global `/admin/dashboard` admin-session
  gate.
- Rate-limit reset remains superadmin-only.
- Route response shapes remain `{ events }`, raw stats object, `{ logs }`,
  `{ limits }`, and `{ consents }`.
- Auth event search preserves exact `event_type`, exact `user_id`, inclusive
  `created_at` bounds, `created_at DESC` ordering, and `user_email` alias.
- Auth event stats preserve strict 24-hour `created_at > dayAgo` cutoff and
  `loginSuccess`/`loginFailed` counters.
- Apple refresh stats preserve action whitelist, inclusive start date, count,
  `last_seen`, and `byAction` rows.
- Audit log search keeps escaped substring matching with `LIKE ? ESCAPE '\\'`
  and the `admin_email` alias.
- Rate-limit reads keep 24-hour `window_start_ms > Date.now() - 86400000`
  cutoff, optional filters, near-limit ratio `>= 0.8`, and ratio-desc ordering.
- Rate-limit reset deletes only the selected `(user_id, action_type)` rows and
  still writes `admin_reset_rate_limit` audit metadata in `AdminService`.
- Consent logs preserve `consent_at IS NOT NULL`, optional version/date filters,
  `consent_at DESC` ordering, and `user_email` alias.
- `getSystemHealth` was intentionally left on `admin-job-ops-repository.js` and
  was not folded into this slice.

## Validation

- `node --check src/database/admin-security-observability-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-security-observability-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-security-observability-routes.test.js`
  - 5 pass / 0 fail

## Delegation

Explorer `Jason` recommended this as a narrow read-side repository extraction
and warned not to move all security methods mechanically. Reviewer `Erdos`
returned zero P0/P1, verified the auth gates, response aliases/shapes, date
bound semantics, audit LIKE escaping, rate-limit reset audit behavior, and
placeholder safety, then was closed cleanly.

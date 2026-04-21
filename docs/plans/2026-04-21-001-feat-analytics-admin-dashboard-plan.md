---
title: "feat: Expose funnel analytics to admin dashboard"
type: feat
status: completed
date: 2026-04-21
deepened: 2026-04-21
---

# feat: Expose funnel analytics to admin dashboard

## Overview

iOS now emits 5 funnel events (`auth_completed`, `session_resumed`, `create_started`, `create_completed`, `first_song_completed`) — but only to Firebase Analytics client-side. Amplitude is wired but DISABLED in production (placeholder API key in `AnalyticsService.swift:55`), and Firebase alone is hard to reconcile row-by-row with Postgres data. The admin dashboard currently sees only server-side events (`teaser_viewed`, `share_claim`, `share_stream`, `share_create`, `story_start`, `poem_teaser_viewed`). This plan wires iOS events into the existing backend `events` table so Postgres becomes the primary source of truth for admin-queryable analytics, and surfaces a funnel view in the admin Growth page.

## Problem Frame

Paul Solt's 5-rule packaging work produced a funnel we cannot measure end-to-end. Between `launch_flash_shown` and the share step sit four critical conversion moments that are dark to our admin console. Firebase has the data but (a) is gated, slow to configure, and lives outside the team's daily workflow, and (b) cannot be joined with `tracks`, `users`, `entitlements`, or other Postgres tables for per-user drilldown. We need the same five events landing in Postgres so they can be queried, charted, and joined with user/track tables.

## Requirements Trace

- **R1.** Every iOS funnel event lands in the Postgres `events` table with `user_id`, `event_name`, and event properties preserved as metadata JSON.
- **R2.** Backend accepts events only from authenticated users via Bearer token; anonymous ingestion is rejected.
- **R3.** iOS continues to fire the existing Firebase SDK call unchanged; backend ingestion is additive and never blocks the caller. Ingestion failures may be logged at `#if DEBUG` level for operational visibility but must never propagate to the log-call site.
- **R4.** iOS ingestion is resilient to transient network/backend errors (one retry) and duplicate-safe (client-generated event id + server-side idempotency).
- **R5.** Admin dashboard exposes a funnel view showing per-user cohort conversion rates for the 4 key hops plus counts of all events.
- **R6.** Admin can filter by time range (7/30/90 days) and drill into per-event daily time series.
- **R7.** *(Deferred)* Admin can view a specific user's event timeline for support investigations. Backend endpoint ships in this plan; UI surface is deferred — see Scope Boundaries and Future Work.

## Scope Boundaries

- **Not in scope:** a new standalone Analytics page (we extend the existing `Growth.tsx` via an extracted `FunnelSection.tsx` component).
- **Not in scope:** charting library upgrades — use whatever `Growth.tsx` already renders with or ship simple CSS bar charts.
- **Not in scope:** backfilling historical Firebase events into the `events` table. Cutover starts from deploy.
- **Not in scope:** pre-auth events (`launch_flash_shown`, `onboarding_v2_*`). Those fire before a Bearer token exists and are followed up on in a separate plan.
- **Not in scope:** writes to any analytics-specific table — reuse the existing `events` table.
- **Not in scope (R7 UI surface):** the per-user event timeline drilldown UI on `Users.tsx`. The backend endpoint (`/admin/dashboard/analytics/user/:userId`) DOES ship in Unit 2 so the capability exists, but the UI is a follow-up plan. Admins can curl the endpoint in the meantime.
- **Not in scope:** per-section `days` filter. This plan keeps the existing Growth page pattern of a single global `days` selector that affects all sections (Funnel + Attribution + Teaser + Share). Per-section scoping is a follow-up if admins ask for it.

## Context & Research

### Relevant Code and Patterns

- **Backend events service:** `src/services/events-service.js` (198 lines). Provides `emit()`, `countByName()`, `getEventCounts()`, `getDailyEventCounts()`, `getFunnelMetrics()`, `getUserEvents()`. Writes to the `events` table. Already in use for server-side events.
- **Events table schema:** `migrations/027_events.sql`. Columns: `id`, `event_name`, `user_id`, `resource_type`, `resource_id`, `metadata_json`, `ip_address`, `user_agent`, `created_at`. Primary key is `id TEXT` — the client can supply the id and the server can `ON CONFLICT DO NOTHING` for idempotency.
- **Admin route pattern:** `src/routes/admin.js:1347-1369` (the `/admin/dashboard/growth/*` handlers). Each handler uses `const admin = await requireAdminSession(request, reply); if (!admin) return;` then proxies to `adminService.*`. Prefix is `/admin/dashboard/*` registered as absolute paths.
- **Admin service pattern:** `src/services/admin-service.js` owns the query methods (`getAttribution`, `getTeaserMetrics`, `getShareMetrics`) that admin routes call. New funnel queries belong here, not in the route handlers directly, because `registerAdminRoutes` does NOT receive `eventsService` as a parameter today.
- **Existing admin page reference:** `admin/src/pages/Growth.tsx` (381 lines). `days` state at line 63 with a 7/30/90 selector at lines 97-105 — reuse both. `useApi().get(...)` hook prepends the admin dashboard prefix, so handlers call relative paths like `/dashboard/analytics/funnel?days=30`.
- **iOS analytics entry point:** `PorizoApp/PorizoApp/Services/AnalyticsService.swift`. Singleton `AnalyticsService.shared.log(_ event: AnalyticsEvent, properties: [String: String]? = nil)` fans out to Firebase (`Analytics.logEvent`). Amplitude is initialized to nil because the API key is a placeholder (line 55-67) — the `amplitude?.track(...)` call on line 92 is a silent no-op in production.
- **iOS auth path:** `PorizoApp/PorizoApp/AuthManager.swift:setAuthProvider`. `saveTokens(authResponse)` writes the new token to Keychain BEFORE `setAuthProvider("apple")` fires `auth_completed`. So when the analytics forward-to-backend call reads the token, it is guaranteed to be the fresh token.
- **iOS network client:** `PorizoApp/PorizoApp/APIClient.swift` is a Swift `actor` with `private async func currentAuthToken()`. `AnalyticsService` currently has no reference to it. Token access must be injected — see Unit 3 decision.

### Institutional Learnings

- Porizo deploys to Railway (not Vercel) with Postgres. Migrations use `railway connect postgres` (see `CLAUDE.md` user memory).
- Backend test suite uses `node:sqlite` (Node 22's built-in SQLite adapter at `src/database/sqlite.js`), not sql.js. `events` table is created by `migrations/027_events.sql` — any new test must initialize the DB with `migrationsDir` set so the `events` table exists at runtime.
- iOS production changes must be verified via `curl` against the live backend before claiming completion (see `~/.claude/rules/porizo-feedback_verify_production_claims.md`).

### External References

Not applicable — this is internal infrastructure built on existing patterns.

## Key Technical Decisions

- **Ingest auth = Bearer token.** All 5 funnel events fire post-authentication. `saveTokens` is called before `setAuthProvider` on every sign-in path, so even `auth_completed` has a valid token at forward time. Anonymous ingestion would add abuse surface without benefit.

- **Ingest failure mode = fire-and-forget with single retry + client-supplied id + server-side idempotency.** Firebase is the only durable third-party sink today (Amplitude is disabled), so the backend becomes the primary source of truth for admin analytics. A full disk queue is still not built (out of scope for v1), but the retry path is made duplicate-safe so transient blips don't inflate counts. See Decision: Idempotency.

- **Idempotency via client `event_id`.** iOS generates a UUID per event; the server uses `INSERT ... ON CONFLICT (id) DO NOTHING` against the `events.id` primary key. The retry scenario most likely to produce duplicates (server wrote row, ACK lost, client retries) is now fully idempotent at zero extra cost.

- **No retry on 401.** If the backend rejects a forward with 401, iOS does NOT retry. The token is stale and only AuthManager's refresh path can fix it. Retrying would send the same bad token again and add log noise.

- **Admin UI = extend `Growth.tsx` via an extracted `FunnelSection.tsx` component.** Funnel analytics is conceptually growth data. Adding a Funnel section inline would push Growth.tsx to ~560 lines in one PR; extracting `FunnelSection.tsx` up front keeps both files under ~400 lines. The `days` state stays global (intentional scope decision — all Growth sections share one time window).

- **Admin routes go through `AdminService`, not direct to `eventsService`.** `registerAdminRoutes` does not receive `eventsService` today. Matching the existing `adminService.getAttribution / getTeaserMetrics / getShareMetrics` pattern is cheaper than threading a new dependency through route wiring and matches project conventions. `AdminService` gains a private `eventsService` field, instantiated from the DB passed at construction.

- **Per-user cohort conversion (not aggregate-over-window).** `eventsService.getFunnelMetrics` computes `endCount / startCount` over the same window, which is a nonsensical ratio when cohorts drift. A new method computes true per-user cohort conversion: `users who fired endEvent within N days of firing startEvent ÷ users who fired startEvent`. A misleading "80% conversion" number is worse than the extra SQL.

- **Funnel hop 4 uses existing `share_create` event, not phantom `share_initiated`.** The `AnalyticsEvent.shareInitiated` enum case exists but nothing emits it. Backend emits `share_create` at `src/routes/tracks.js` when a share token is created — that's the real "user started to share" signal. Rewire hop 4 to `first_song_completed → share_create`. Zero new iOS work.

- **Event properties preserved as JSON WITH server-side guards.** iOS `[String: String]?` maps to `metadata_json`. To prevent PII leaks surfacing to the admin UI via `/analytics/user/:userId`, the ingest endpoint enforces: max 8 keys per event, max 256 chars per value, and rejects any key in a deny-list (`email`, `phone`, `name`, `recipient_name`, `recipient`, `message`, `lyrics`, `raw_text`, `full_name`). Code-review alone is not a control.

- **Rate limit from day 1 = 100/minute, 2000/day per user** on `POST /analytics/event`. Cheap insurance against a jailbroken or buggy client flooding the table and poisoning funnel metrics. Matches the pattern in the `CLAUDE.md` API rate-limits table.

- **Remote kill switch = `ANALYTICS_INGEST_ENABLED` server env var.** When `false`, the backend responds `503 Service Unavailable` from `POST /analytics/event` — iOS discards silently after retry, same as any other backend failure. Lets us disable ingestion end-to-end without shipping an iOS update if something goes wrong.

- **Optional `resource_type` / `resource_id` from iOS body.** `events.resource_type` and `resource_id` are populated for server-side events but will be NULL for iOS events unless we let the client pass them. iOS sends them when it has one — e.g., `first_song_completed` carries `resource_type="track", resource_id=trackId`. Future queries like "events for track X" will then work for both server and client origins. Low cost, high payoff.

- **Response caching on admin analytics endpoints (60s).** `getFunnelMetrics` across 90 days will scan 500k+ rows once the table grows. Cache `/admin/dashboard/analytics/{overview, funnel, daily}` responses per-`days` for 60 seconds in a simple in-memory map. Admin dashboards refresh on demand; 60s staleness is invisible. Not caching `/analytics/user/:userId` — that's a per-userId drilldown with low reuse.

- **No schema change.** `events` schema already has every column we need. Only the client-supplied `event_id` changes the write path (insert-with-supplied-id + on-conflict-do-nothing).

## Open Questions

### Resolved During Planning

- **Should `session_resumed` events reach the backend on warm resume?** Yes — retention signal. Shown in Unit 4 as a retention row, not as a funnel hop.
- **Should we track pre-auth events?** Deferred — those fire before a Bearer token exists. Separate follow-up plan.
- **Auth on `POST /analytics/event`?** Bearer-authed, matching all other iOS→backend calls.
- **iOS failure mode?** Fire-and-forget + single retry + no-retry-on-401 + client event_id + server idempotency. Firebase-only reality acknowledged; disk queue deferred to a follow-up if we see real gaps.
- **Admin UI placement?** Extend `Growth.tsx` by extracting `FunnelSection.tsx` preemptively.
- **Conversion rate math?** Per-user cohort in v1 (not the misleading aggregate ratio).
- **Funnel hop 4 target event?** `share_create` (existing backend event), not the phantom `share_initiated`.
- **Events-service wiring into admin routes?** Via `AdminService` methods, not direct injection.
- **iOS token access for AnalyticsService?** `AnalyticsService.shared.configure(tokenProvider: @Sendable () async -> String?)` at app start.
- **Rate limit value?** 100/min, 2000/day per user, shipped in v1.
- **Remote disable mechanism?** `ANALYTICS_INGEST_ENABLED` env var on backend.
- **PII controls?** Server-side key deny-list + size guards, not code-review-only.
- **Cross-widget `days` state?** Intentionally global for v1 — documented in Scope Boundaries.

### Deferred to Implementation

- **Exact copy on funnel cards and tooltips.** Placeholder headings in Unit 4; tune during visual review.
- **Whether `/analytics/event` needs a dedicated Fastify schema validator.** If `analytics.js` has a convention, follow it; if not, hand-roll a lightweight validator in Unit 1.

## Implementation Units

- [ ] **Unit 1: Add `POST /analytics/event` ingest endpoint**

**Goal:** Accept a single event from an authenticated iOS client, validate it, and forward to `eventsService.emit()` with client-supplied id for idempotency.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** None.

**Files:**
- Modify: `src/routes/analytics.js`
- Modify: `src/services/events-service.js` (add optional `id` parameter on `emit()`, write via `INSERT ... ON CONFLICT (id) DO NOTHING`; also add optional `resource_type` / `resource_id` to the argument object if not already supported)
- Test: `test/routes/analytics-event.test.js` (create new test file — follow the existing `test/routes/*.test.js` harness)

**Approach:**
- Register `app.post('/analytics/event', async (request, reply) => { ... })` using the same user-auth middleware pattern used elsewhere in `analytics.js` (not `requireAdminSession` — that's admin-only). Absolute path, matching the `src/routes/admin.js` style.
- **Kill switch:** If `process.env.ANALYTICS_INGEST_ENABLED === 'false'`, return 503 immediately. Default enabled.
- **Rate limit:** Use the project's existing `consumeRateLimit(userId, 'analytics_event', limit, windowSec)` (same helper used in `story.js:1736`). Limits: 100/min and 2000/day per user — two consecutive checks. If either is exceeded, return 429 with `Retry-After`.
- **Body validation:**
  - Require `event_name: string` matching regex `^[a-z][a-z0-9_]{0,63}$` (permissive — drops the strict enum allowlist that was unmaintainable per review; admin UI filters display instead).
  - Require `event_id: string` (client-generated UUID, 8–64 chars). If missing, reject 400.
  - Optional `properties: Record<string, string>`:
    - Reject if more than 8 keys (413).
    - Reject if any key is in deny-list: `email`, `phone`, `name`, `recipient_name`, `recipient`, `message`, `lyrics`, `raw_text`, `full_name`, `user_email`, `user_phone`.
    - Reject if any value length > 256 chars (413) or non-string (400).
  - Optional `resource_type: string`, `resource_id: string` — pass through to `eventsService.emit()`.
- Derive `user_id` from the authenticated session. Call `eventsService.emit(event_name, { id: event_id, userId, resourceType, resourceId, metadata: properties, ip, userAgent })`.
- Return `202 Accepted` with `{ id: event_id, status: 'accepted' | 'duplicate' }` (`duplicate` when `ON CONFLICT` hit).
- **Structured logging:** One `console.log` (or existing logger) per request with `{ event_name, user_id, status, duration_ms }`.

**Execution note:** Test-first. Write the happy-path test, watch it fail, then implement. The same posture applies to Unit 2 and Unit 3; Unit 4 is presentation-only.

**Patterns to follow:**
- `src/routes/analytics.js` existing `/analytics/apple-ads-attribution` handler for user-auth + body-validation shape.
- `src/services/events-service.js:33` current `emit()` signature — extend additively.
- `consumeRateLimit` pattern from `src/routes/story.js:1736`.

**Test scenarios:**
- Happy path: authed POST with valid `event_id`, `event_name`, `properties` → 202 with `status: 'accepted'`; row exists in `events`.
- Happy path: same event posted twice (retry scenario) → second response is 202 with `status: 'duplicate'`; only ONE row in `events`.
- Happy path: optional `resource_type`/`resource_id` forwarded to `events` row.
- Edge case: `properties` has 9 keys → 413.
- Edge case: `properties.value` is 300 chars → 413.
- Edge case: `properties.email` present → 400 with a message naming the forbidden key.
- Edge case: `event_name` with uppercase → 400 (regex rejects).
- Edge case: `event_name` 100 chars → 400.
- Edge case: missing `event_id` → 400.
- Edge case: `properties` value is a number → 400.
- Error path: unauthenticated → 401.
- Error path: rate-limit exceeded (101st request in a minute) → 429 with `Retry-After`.
- Error path: `ANALYTICS_INGEST_ENABLED=false` → 503, no row written.
- Error path: `eventsService.emit` throws → 500.
- Integration: authed POST, query `events` table, verify `user_id`, `event_name`, `metadata_json`, `resource_type`, `resource_id`, `ip_address`, `user_agent` all match.

**Verification:**
- `npm test` passes the new suite.
- Manual `curl` with a valid Bearer token returns 202 and row is visible in `SELECT * FROM events ORDER BY created_at DESC LIMIT 1`.
- Setting `ANALYTICS_INGEST_ENABLED=false` locally returns 503.

---

- [ ] **Unit 2: Admin query endpoints for funnel analytics (via `AdminService`) with 60s cache**

**Goal:** Expose overview, funnel (per-user cohort), daily series, and per-user timeline endpoints for the admin UI. Wire through `AdminService` — no direct `eventsService` dependency added to route registration.

**Requirements:** R5, R6, R7 (backend only; UI deferred per Scope Boundaries).

**Dependencies:** None — can land in parallel with Unit 1.

**Files:**
- Modify: `src/services/admin-service.js` (add 4 new methods; hold an internal `eventsService` instance)
- Modify: `src/services/events-service.js` (add a new `getFunnelMetricsCohort(startEvent, endEvent, days, windowDays)` method that computes per-user cohort conversion)
- Modify: `src/routes/admin.js` (register 4 new handlers using the existing `growth/*` template)
- Test: `test/services/events-service-cohort.test.js` (new — covers cohort SQL)
- Test: `test/routes/admin-analytics.test.js` (new — covers the 4 endpoints)

**Approach:**

Four endpoints, each guarded by `requireAdminSession` and registered as absolute paths matching `src/routes/admin.js:1347` style:

1. `GET /admin/dashboard/analytics/overview?days=30` → `adminService.getAnalyticsOverview(days)` → returns `{ counts: [{event_name, count}], days }`. **Cached 60s per `days` value.** Uses `eventsService.getEventCounts(days)`.
2. `GET /admin/dashboard/analytics/funnel?days=30` → `adminService.getFunnelCohort(days)` → returns `{ steps: [{from, to, startUsers, convertedUsers, conversionRate}] }` for 4 hops: `auth_completed→create_started`, `create_started→create_completed`, `create_completed→first_song_completed`, `first_song_completed→share_create`. **Cached 60s per `days` value.** Uses the new `eventsService.getFunnelMetricsCohort(...)`.
3. `GET /admin/dashboard/analytics/daily/:eventName?days=30` → `adminService.getDailyEventCounts(eventName, days)` → returns `{ event_name, days, byDay: [{date, count}] }`. **Cached 60s per `(eventName, days)`.** Uses `eventsService.getDailyEventCounts(...)`.
4. `GET /admin/dashboard/analytics/user/:userId?limit=50` → `adminService.getUserEvents(adminId, userId, limit)` → returns `{ userId, events: [...] }`. **Not cached** (per-user, low reuse). **Writes an audit log row** with `user_id=adminId, action='analytics.user.read', resource_type='user_analytics', resource_id=userId` on every successful call.

**Per-user cohort SQL** (new `eventsService.getFunnelMetricsCohort`):
```sql
-- Directional guidance only, not literal. Tune per Postgres/SQLite shared syntax.
-- startUsers = distinct users who fired startEvent in window
-- convertedUsers = of those, who also fired endEvent within windowDays of their startEvent timestamp
```
Return `{ startUsers, convertedUsers, conversionRate: convertedUsers / startUsers }`. Window default: 7 days per-user (configurable).

**Cache implementation:** Small in-memory Map keyed by route+params, with a timestamped wrapper. No new dep. Clear on process restart; 60s TTL. Acceptable for an admin-only endpoint.

**Validation:** Clamp `days` into `[1, 365]`, `limit` into `[1, 200]`. Return 400 on non-numeric.

**Patterns to follow:**
- `src/routes/admin.js:1347-1369` (growth handlers) — exact structure.
- `src/services/admin-service.js` existing methods (`getAttribution`, `getTeaserMetrics`, `getShareMetrics`) — shape of service methods.
- `src/services/audit-logs-service.js` (if exists) or the `audit_logs` write pattern used elsewhere — for the user-timeline audit log.

**Test scenarios:**
- Happy path: seed known events for 3 users across 14 days, call `/funnel?days=14`, verify cohort rates match hand-calculated values.
- Happy path: `/overview?days=7` returns counts sorted DESC by count.
- Happy path: `/daily/auth_completed?days=14` returns date-sorted array with zero-fill for empty days (or not — document the choice).
- Happy path: `/user/:userId?limit=10` returns ≤10 most recent events; `audit_logs` has a new row.
- Edge case: `days=0` → clamped to 1. `days=500` → clamped to 365.
- Edge case: unknown `:eventName` → `{ byDay: [] }`, no error.
- Edge case: `/user/:userId` for non-existent user → either 404 or empty array; pick and document.
- Edge case: cache hit — second call within 60s returns identical response without re-querying (verify via spy on `eventsService` method).
- Error path: non-admin session → returns whatever `requireAdminSession` returns on failure (401/403).
- Integration: `getFunnelMetricsCohort` hand-verified against a SQL query run directly on the test DB.

**Verification:**
- `npm test` passes.
- Direct SQL vs. endpoint response comparison shows matching numbers on a seeded DB.
- Hitting `/user/:userId` creates an `audit_logs` entry visible in that table.

---

- [ ] **Unit 3: iOS `AnalyticsService` fans out to backend with configure-at-startup DI**

**Goal:** Every `AnalyticsService.log(...)` call ALSO fires `POST /analytics/event` with a client-generated UUID, single retry on transient failure, no retry on 401, and silent-best-effort semantics. Token provider and APIClient are injected via a `configure(...)` call at app start.

**Requirements:** R1, R3, R4.

**Dependencies:** None (Unit 1 should ship first to avoid 404 noise in backend logs, but not required — forward fails silently).

**Files:**
- Modify: `PorizoApp/PorizoApp/Services/AnalyticsService.swift`
- Modify: `PorizoApp/PorizoApp/PorizoAppApp.swift` (add one line calling `AnalyticsService.shared.configure(...)` after `AuthManager` and `APIClient` are constructed)
- Test: `PorizoApp/PorizoAppTests/AnalyticsServiceBackendIngestTests.swift` (create; mock `URLSession` like existing `PushNotificationTests.swift`)

**Approach:**

Add a new public method:
```
AnalyticsService.shared.configure(
    apiBaseURL: String,
    tokenProvider: @Sendable @escaping () async -> String?
)
```
Called exactly once from `PorizoAppApp.swift` during app setup.

Add a new private method `forwardToBackend(_ event: AnalyticsEvent, properties: [String: String]?)`:
- If `apiBaseURL` or `tokenProvider` is nil (configure not called yet), skip silently.
- Generate `event_id = UUID().uuidString` once per event.
- On each attempt, re-read the token from `tokenProvider()`. If nil → skip (pre-auth).
- Build body `{ event_id, event_name: event.rawValue, properties, resource_type?, resource_id? }`.
  - For events with a natural resource, pass it: `first_song_completed` → `resource_type="track", resource_id=trackId` (from `properties["trackId"]`).
- POST to `{apiBaseURL}/analytics/event` with `Authorization: Bearer {token}`.
- **Retry logic:**
  - If status is 401 → terminal, do NOT retry. Log `#if DEBUG`.
  - If status is 2xx → done.
  - If status is any other non-2xx, or network error → sleep 1s, re-read token, re-attempt ONCE.
  - On second failure (any reason other than 401) → log `#if DEBUG`, discard.
- Wrap all work in a detached `Task` so the caller is never blocked.

Invoke `forwardToBackend` at the END of the existing `log(_:properties:)` method, after Firebase + Amplitude dispatch. Never throw from this path.

**Property-to-resource mapping table (what gets sent as `resource_type`/`resource_id` per event):**

| Event | resource_type | resource_id |
|---|---|---|
| `auth_completed` | — | — |
| `session_resumed` | — | — |
| `create_started` | — | — |
| `create_completed` | `track` (if type==song) or `poem` | `trackId` / `poemId` from properties |
| `first_song_completed` | `track` | `trackId` from properties |

If the mapped property is missing, send `resource_type`/`resource_id` as absent (don't send empty strings).

**Execution note:** Test-first. Capture URLRequest via mocked URLSession and assert body shape, then implement.

**Patterns to follow:**
- `APIClient` actor's token access (for reference; we don't call through it — we inject a closure instead).
- `PushNotificationTests.swift` URLSession-mocking pattern.
- Existing `@unchecked Sendable` pattern on `AnalyticsService` for the Task/closure interaction.

**Test scenarios:**
- Happy path: `log(.authCompleted, properties: ["method": "apple"])` with valid token → ONE POST observed; body matches `{event_id, event_name: "auth_completed", properties: {method: "apple"}}`.
- Happy path: `first_song_completed` with `properties["trackId"]="abc"` → POST body includes `resource_type="track"`, `resource_id="abc"`.
- Happy path: Firebase path still fires regardless of backend outcome (spy on Firebase).
- Edge case: `tokenProvider()` returns nil → zero POSTs.
- Edge case: `configure(...)` never called → zero POSTs, no crash.
- Edge case: `properties` is nil → POST body omits properties.
- Error path: backend 500 → exactly one retry 1s later with re-read token.
- Error path: backend 401 → NO retry, log once, discard.
- Error path: network throws → same single-retry behavior.
- Integration: `log(...)` returns immediately (measure via completion of a `DispatchSemaphore`-like assertion).

**Verification:**
- Swift tests pass.
- On-device walkthrough: cold launch + sign in → verify `[Analytics]` debug log shows Firebase fire AND a row appears in `events` table (via `railway connect postgres`).
- Fresh retry scenario (kill backend, then restore) shows exactly ONE row per event.

---

- [ ] **Unit 4: Extract `FunnelSection.tsx`, add to `Growth.tsx`, specify all UX states**

**Goal:** Admin sees the funnel with cohort conversion rates, a retention row for `session_resumed`, a daily series for the north-star conversion, and a table of all event counts — with explicit empty/loading/error states so nothing reads as "broken" during the cutover window.

**Requirements:** R5, R6.

**Dependencies:** Unit 2 (endpoints must exist and return the expected shapes).

**Files:**
- Create: `admin/src/pages/Growth/FunnelSection.tsx` (new component; render the funnel widgets)
- Create: `admin/src/pages/Growth/FunnelCard.tsx` (small presentational card — differentiated variant for the north-star hop)
- Modify: `admin/src/pages/Growth.tsx` (import `FunnelSection`, render as a section; nothing else changes)

**Approach:**

`FunnelSection.tsx` owns the funnel data fetching and render. `Growth.tsx` only imports and renders it, keeping the parent file lean.

`FunnelSection` props: `{ days: number }`. Fetches `/dashboard/analytics/overview?days=${days}` and `/dashboard/analytics/funnel?days=${days}` on mount and on `days` change.

**Widgets inside `FunnelSection`:**

1. **Funnel steps strip** — four cards horizontally. The `first_song_completed` hop uses a LARGER, bolder variant of `FunnelCard` (different background weight, bigger numbers, subtle accent). The others use the standard compact variant. This is the north-star conversion — it should dominate visually.

2. **Retention row** — a single small card showing `session_resumed` count for the selected days window + a tiny inline bar strip (last 7 days). Labeled "Active sessions". Not a funnel hop; separate from the step strip.

3. **Daily series chart** — reuses the existing `TeaserMetrics.byDay` visual style but pulls from `/dashboard/analytics/daily/first_song_completed?days=${days}`. Label: "Completed songs per day".

4. **All events table** — small table at the bottom of `FunnelSection`: `event_name`, `count`, sorted DESC. Rendered from the `/overview` response.

**UX states (required, not optional):**

| Condition | Render |
|---|---|
| Loading (initial fetch) | Skeleton cards + "Loading funnel…" label. Match the existing Growth page loading pattern. |
| Empty (pre-cutover — startUsers = 0 for all hops) | Single info card: "Funnel data will appear once iOS events start flowing. Check back in a few hours." No NaN, no zeroes. |
| Partial empty (some hops have data, others don't) | Hops with `startUsers === 0` render as a dim card with `—` instead of a percentage. |
| `startUsers > 0, convertedUsers === 0` | Card shows `0.0%` with the raw count (honest zero, not an error). |
| Error | Error card with retry button, message "Couldn't load funnel. Retry." |

**Cross-widget `days` interaction:** `Growth.tsx` keeps its single `days` state affecting all sections (Funnel, Attribution, Teaser, Share). This is intentional and documented in `FunnelSection.tsx`'s header comment: "Time range is shared across all Growth sections for consistent admin scoping."

**Patterns to follow:**
- `admin/src/pages/Growth.tsx` existing `useApi` + `useEffect([days])` + `Promise.all().then(setX).catch(console.error)` pattern.
- `TeaserMetrics.byDay` daily-bars style.
- `LoadingState` / `ErrorState` components imported in Growth.tsx — reuse for the new section.

**Test scenarios:**
- Test expectation: none at the component level — this is presentation code. Integration coverage for the shapes rendered here comes from Unit 2's route tests.
- Manual visual verification on the dev admin with seeded events covering each UX state (loading, empty, partial, populated, error).

**Verification:**
- `bun run build` (or `npm run build`) succeeds for the admin app.
- Dev admin renders the Funnel section without layout breakage across desktop widths.
- Each card's numbers match a direct SQL query against the `events` table for a known time window.
- Each UX state (loading, empty, partial, populated, error) renders correctly in manual testing (force via network-tab throttling, DB truncate, and a broken API URL).

## System-Wide Impact

- **Interaction graph:** iOS `AnalyticsService.log` now fans out to TWO active sinks in production (Firebase + backend) — Amplitude remains a no-op until the placeholder API key is replaced. Any caller of `log` inherits the new behavior without code changes.
- **Error propagation:** Backend ingestion failures must NOT propagate to the caller. The log call must remain synchronous-in-appearance and never throw. Violations are bugs, not expected failure modes.
- **State lifecycle risks:** iOS offline → Firebase SDK queues on its side and sends on reconnect, but the backend path MISSES those queued events (no disk queue this plan). Acceptable for v1. Adding an outbox is a follow-up if admin gaps become visible.
- **API surface parity:** The new `/analytics/event` endpoint is iOS-only for now. Android would use the same endpoint with the same auth + validation shape.
- **Integration coverage:** Unit 3's integration test (iOS → backend insert → admin query) is the end-to-end proof. Unit-level tests alone are insufficient.
- **Events table `resource_*` semantics change:** iOS events populate `resource_type`/`resource_id` only when the event has a natural resource. Other iOS events store NULL. Admin queries that JOIN events to tracks on resource_id will match iOS rows only for events with resources; this is documented per-event in Unit 3's mapping table.
- **Admin UI `days` state is global** across Funnel / Attribution / Teaser / Share sections. Intentional for v1.
- **Unchanged invariants:** `AnalyticsService.log` keeps its current signature. `eventsService.emit` gains an optional `id` parameter (backward-compatible). Firebase dispatch path is byte-for-byte identical to today. The `events` table schema is unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Retry storm during backend outage (2x amplification) | Bounded per event (single retry at 1s) + 401 terminal rule. No-retry-on-401 eliminates the token-refresh amplification path. Rate limit (100/min/user) caps total volume. Kill switch (`ANALYTICS_INGEST_ENABLED=false`) available without shipping iOS. |
| Authenticated abuse flooding `events` table | Per-user rate limit (100/min, 2000/day) from day 1. Event_name regex validator rejects malformed names. Property size guards cap row bloat. |
| PII leak via `properties` into admin UI | Server-side key deny-list + 256 char/value cap + 8-keys cap enforced at ingest. Explicit, not code-review-only. |
| Admin access to per-user event data without trail | `audit_logs` write on every `/analytics/user/:userId` call. |
| Duplicate events from retry timing | Client UUID + server `ON CONFLICT (id) DO NOTHING`. Zero duplicates by construction. |
| Misleading aggregate conversion rates | Per-user cohort SQL in v1 (new `getFunnelMetricsCohort`). No "80% conversion" that isn't what it looks like. |
| iOS rolls out before backend endpoint deploys | Failure is silent. A short window of backend-log 404s is acceptable noise. No hard-gate needed given fire-and-forget semantics. |
| `events` table growth at scale | 60s cache on admin aggregate endpoints reduces query pressure. 5 new iOS event names at 1-5× per-user frequency is not a step change. Monitor table size; revisit partitioning at >5M rows. |
| `Growth.tsx` bloat | Extracted `FunnelSection.tsx` + `FunnelCard.tsx` up front, not deferred. Growth.tsx stays ≤400 lines. |

## Operational Plan

**Logging (Unit 1):** `POST /analytics/event` emits one structured log line per request: `{ event_name, user_id, status: 'accepted' | 'duplicate' | 'rejected', duration_ms, reject_reason?: string }`. Railway log viewer can filter `event_name` for spot-checks.

**Kill switch:** `ANALYTICS_INGEST_ENABLED` env var on the backend. Default `true`. Setting `false` returns 503 from `POST /analytics/event`; iOS swallows silently. Use for emergency disables without shipping iOS.

**Rate limit observability:** Rate-limit rejections logged at warn level with `user_id` for pattern detection.

**Post-deploy verification checklist:**
1. `curl` against prod `/analytics/event` with a valid Bearer token — expect 202 + `status: 'accepted'`.
2. `railway connect postgres` → `SELECT * FROM events WHERE event_name IN ('auth_completed','create_started','create_completed','first_song_completed','session_resumed') ORDER BY created_at DESC LIMIT 10;` — expect iOS traffic visible within ~10 minutes of TestFlight install.
3. Open admin `/growth` → Funnel section renders; numbers match a direct SQL query for the same window.
4. Admin endpoint cache: hit `/admin/dashboard/analytics/overview?days=30` twice within 60s; second response time should be ~5ms (cache hit).

**Runbook — "Funnel section shows empty":**
1. Check iOS logs for `[Analytics]` forward attempts — are POSTs firing?
2. Check Railway logs for `POST /analytics/event` success rate in last hour.
3. Check env: is `ANALYTICS_INGEST_ENABLED` accidentally `false`?
4. Check DB: `SELECT COUNT(*), event_name FROM events WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY event_name;`
5. If zero iOS rows: check iOS TestFlight version — is it pre-Unit-3 build?

**Rollback:**
- Backend only: set `ANALYTICS_INGEST_ENABLED=false` via Railway; restart; traffic drops immediately. Revert commit to fully remove.
- iOS: cannot remote-disable the forward path, but its silent failure mode means a broken endpoint is harmless to the user. For a bad iOS build, ship a fix via TestFlight — no App Store emergency.

## Documentation / Operational Notes

- Add to `CLAUDE.md` (root) under the "API Rate Limits" table: `POST /analytics/event` — 100/min, 2000/day per user.
- Add to `CLAUDE.md` the new env var: `ANALYTICS_INGEST_ENABLED` (default `true`).
- No Railway migration needed — uses existing `events` table.
- PII policy: properties must not contain PII. Server-side deny-list catches the obvious; review policy still applies as defense in depth.

## Future Work (out of scope for this plan)

- **R7 UI:** per-user event timeline drilldown on `Users.tsx` — separate plan.
- **Pre-auth events:** wire `launch_flash_shown`, `onboarding_v2_*` to the backend with anonymous-or-device-id auth — separate plan.
- **iOS disk queue outbox:** for offline-and-kill scenarios if the admin funnel shows measurable undercounts vs Firebase — revisit after 4-6 weeks of production data.
- **Per-section `days` filter:** if admins ask.
- **Android parity:** if an Android client ships.

## Sources & References

- Related code:
  - `src/services/events-service.js` (events service — adds optional id + cohort method)
  - `src/services/admin-service.js` (admin service — adds funnel methods)
  - `src/routes/admin.js:1347-1369` (admin route pattern)
  - `src/routes/analytics.js` (ingest endpoint home)
  - `src/routes/tracks.js` (existing `share_create` emitter used in funnel hop 4)
  - `migrations/027_events.sql` (events table schema)
  - `admin/src/pages/Growth.tsx` (UI extension target)
  - `PorizoApp/PorizoApp/Services/AnalyticsService.swift` (iOS extension target)
  - `PorizoApp/PorizoApp/AuthManager.swift` (token availability contract at setAuthProvider)
- Related past session: `docs/plans/2026-04-20-ios-funnel-review-and-fix-execplan.md` (prior funnel scoping)

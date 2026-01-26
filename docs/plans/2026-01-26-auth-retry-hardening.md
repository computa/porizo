# Harden Auth Retry Coverage for Story V2 Endpoints

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows `~/.codex/PLANS.MD` (no repo-specific PLANS.MD found).

## Purpose / Big Picture

Users should not be forced to log back in when an access token expires or a transient 401 occurs during Story V2 flows. After this change, all Story V2 endpoints require auth and use refresh-and-retry, and the poem generation path can still return a structured “missing details” response without breaking auth retry behavior. The visible effect is that users can continue story and poem flows without surprise logouts.

## Progress

- [x] (2026-01-26 00:30Z) Audited APIClient direct URLSession calls and identified Story V2 endpoints still bypassing refresh-and-retry.
- [x] (2026-01-26 00:38Z) Implement validateResponse/executeWithAuthRetry support for allowed non-2xx status codes.
- [x] (2026-01-26 00:40Z) Migrate Story V2 endpoints to require auth and use executeWithAuthRetry (including poem-from-story).
- [x] (2026-01-26 00:41Z) Update plan notes with discoveries and decisions.
- [x] (2026-01-26 00:49Z) Harden share device-token flows with refresh-and-retry logic.
- [x] (2026-01-26 01:02Z) Add admin audit + metrics for Apple refresh-token validation.
- [x] (2026-01-26 01:12Z) Add admin UI section for Apple refresh-token inspection.
- [ ] (2026-01-26 01:02Z) Optional: run lint/tests or document why not run.

## Surprises & Discoveries

- Observation: Story V2 client methods used `requiresAuth: false` while server `requireUserId` enforces auth for `/story/*`.
  Evidence: `PorizoApp/PorizoApp/APIClient.swift` vs `src/routes/story.js`.

- Observation: Share claim/stream endpoints return 401 for invalid device tokens and do not support bearer refresh.
  Evidence: `src/server.js` uses `DEVICE_TOKEN_REQUIRED` / `INVALID_DEVICE_TOKEN`; iOS client previously sent a stale token without retry.

## Decision Log

- Decision: Treat Story V2 endpoints as authenticated in production and route through refresh-and-retry.
  Rationale: Server `requireUserId` enforces auth for `/story/*`; client’s `requiresAuth: false` is inconsistent and causes 401s without refresh.
  Date/Author: 2026-01-26 / Codex

- Decision: Allow `executeWithAuthRetry` to accept a set of non-2xx status codes (e.g., 422 for poem gaps).
  Rationale: Some endpoints legitimately return non-2xx payloads that are part of normal flow; we still need auth refresh on 401.
  Date/Author: 2026-01-26 / Codex

- Decision: Handle device-token 401s with a single clear-and-retry for share flows.
  Rationale: Device tokens are separate from bearer auth and must be re-registered when expired or invalid.
  Date/Author: 2026-01-26 / Codex

- Decision: Emit audit logs and analytics events for Apple refresh-token validation outcomes.
  Rationale: Gives production visibility into invalid tokens and rotation success.
  Date/Author: 2026-01-26 / Codex

## Outcomes & Retrospective

Pending.

## Context and Orientation

The iOS API client lives at `PorizoApp/PorizoApp/APIClient.swift`. It has an `executeWithAuthRetry` helper that retries a request after refreshing the access token when a 401 is received. Several Story V2 endpoints (`startStoryV2`, `continueStoryV2`, `confirmStoryV2`, `addStoryDetails`, `createPoemFromStory`, `getStorySession`) still bypass this helper and set `requiresAuth: false`, even though the backend requires authenticated user IDs for `/story/*` routes (`src/routes/story.js`). The poem-from-story endpoint must still accept a 422 response for missing story details, which needs a controlled bypass of the “2xx only” validation.

## Plan of Work

First, extend `validateResponse` and `executeWithAuthRetry` in `PorizoApp/PorizoApp/APIClient.swift` to accept a set of allowed non-2xx status codes, so endpoints like `createPoemFromStory` can treat 422 as an expected response while still benefiting from refresh-and-retry on 401. Next, update Story V2 endpoints to require auth (remove `requiresAuth: false`) and use `executeWithAuthRetry` for the network call. For `createPoemFromStory`, use the new allowed-status path and keep the 422 parsing logic. Finally, add device-token retry logic for share flows to re-register when the server reports `INVALID_DEVICE_TOKEN` or `DEVICE_TOKEN_REQUIRED`.

## Concrete Steps

1) Edit `PorizoApp/PorizoApp/APIClient.swift`:
   - Add an `allowedStatusCodes` parameter to `validateResponse` and `executeWithAuthRetry`.
   - Update the Story V2 methods to use `executeWithAuthRetry` and require auth.

2) Re-run static checks (optional):
   - `npm run lint`
   - `npm test`

## Validation and Acceptance

After changes, Story V2 endpoints should:
- Send Authorization headers in production builds.
- Refresh tokens on 401 and retry once before failing.
- Allow `/story/:id/to-poem` to return 422 with a “missing details” response without throwing a generic auth error.

Manual acceptance:
- Start a story, answer at least one question, and generate a poem.
- If access token is expired, flow should refresh and continue without logout.

## Idempotence and Recovery

Edits are localized to `PorizoApp/PorizoApp/APIClient.swift`. If a change breaks compilation, revert that file or use `git checkout -- PorizoApp/PorizoApp/APIClient.swift` (only for this file).

## Artifacts and Notes

None yet.

## Interfaces and Dependencies

No new external dependencies. Use the existing `AuthRefreshClosure`, `executeWithAuthRetry`, and `validateResponse` in `PorizoApp/PorizoApp/APIClient.swift`.

Plan revision note: Initial version created to track auth retry hardening for Story V2 endpoints.

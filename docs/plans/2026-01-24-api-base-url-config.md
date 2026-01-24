# API Base URL Configuration Hardening

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows the ExecPlan Standard in `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Users and testers should be able to point the iOS app at the correct backend without code edits, so the poem flow and all other flows work consistently across simulator, device, and production. Success is visible when the app uses a single configurable base URL for all API calls, avoiding timeouts caused by mismatched servers.

## Progress

- [x] (2026-01-24 06:55Z) Create plan document and define scope.
- [x] (2026-01-24 06:58Z) Implement centralized API base URL configuration.
- [x] (2026-01-24 06:58Z) Replace hardcoded APIClient base URLs with config helper.
- [x] (2026-01-24 06:58Z) Update Info.plist to allow build-time override.
- [x] (2026-01-24 07:02Z) Run lint/tests and document evidence.

## Surprises & Discoveries

- Observation: The simulator timeouts were due to a Next.js server occupying port 3000, not a poem-specific error.
  Evidence: `ps -p 19136 -o command=` showed `next-server (v16.0.10)`.

## Decision Log

- Decision: Centralize API base URL in a new `AppConfig.apiBaseURL` and make it overrideable via environment or Info.plist.
  Rationale: Avoid hardcoded localhost ports and enable production-grade configuration.
  Date/Author: 2026-01-24 / Codex

## Outcomes & Retrospective

Completed centralized API base URL configuration and removed hardcoded localhost URLs. Tests pass. Next step is to verify the simulator uses the new configuration by setting `PORIZO_API_BASE_URL` in the scheme and confirming story/poem flows load.

## Context and Orientation

The iOS app currently hardcodes `http://localhost:3000` in multiple views and the `APIClient` default initializer. This causes timeouts when the API server is not running on that port or when a different process (like Next.js) is bound to it. The root view is `PorizoApp/PorizoApp/RootView.swift`, and the API client is `PorizoApp/PorizoApp/APIClient.swift`.

## Plan of Work

Add a new `AppConfig` helper that resolves the API base URL from (in order) environment, Info.plist, and defaults. Update `APIClient` to use this helper as its default base URL. Replace all remaining hardcoded base URLs in views and previews with `AppConfig.apiBaseURL`. Add an Info.plist key `PORIZO_API_BASE_URL` to allow build-time overrides without code changes.

## Concrete Steps

Run all commands from `/Users/ao/Documents/projects/porizo`.

1) Add `PorizoApp/PorizoApp/AppConfig.swift` with the base URL resolver.
2) Update `PorizoApp/PorizoApp/APIClient.swift` to default to `AppConfig.apiBaseURL`.
3) Replace all `APIClient(baseURL: "http://localhost:3000")` (and `3001`) with `AppConfig.apiBaseURL`.
4) Add `PORIZO_API_BASE_URL` to `PorizoApp/Info.plist`.
5) Run `npm run lint` and `npm test`.

Expected evidence snippets:

    `AppConfig.apiBaseURL` used in APIClient default init.
    `PORIZO_API_BASE_URL` key visible in Info.plist.

## Validation and Acceptance

Acceptance: The app uses a single configurable base URL for all API calls, and no hardcoded localhost URLs remain in production code paths. In simulator, setting `PORIZO_API_BASE_URL` in the scheme should redirect API traffic without code changes.

## Idempotence and Recovery

Edits are safe to reapply. If configuration causes issues, remove `AppConfig` references and restore the old base URL constants, or set `PORIZO_API_BASE_URL` to the expected value.

## Artifacts and Notes

Evidence:

    npm run lint
    npm test

## Interfaces and Dependencies

`AppConfig.apiBaseURL` must be a `String` and remain available to `APIClient`, `RootView`, and any view previews using `APIClient`. `Info.plist` must include a `PORIZO_API_BASE_URL` string entry (empty allowed).

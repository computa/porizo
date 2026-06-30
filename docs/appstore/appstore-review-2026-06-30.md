# App Store Review Audit — 2026-06-30

**Scope:** TestFlight (internal testing) upload of build **1.5.25 (146)** from the `refactor` branch.
**Context:** Backend architecture refactor (Roots 1–11) deployed to Railway production (`api.porizo.co`) and smoke-verified green (Gates 0–4). This build points at the refactored backend. This is an INTERNAL TestFlight build for song-generation validation — NOT an App Store submission and NOT external TestFlight review.

## Verdict: GO (TestFlight internal)

Blockers: 0 · Warnings: 1 (informational)

## Checks performed

| Category | Result | Evidence |
|---|---|---|
| iOS build (Release archive) | ✅ PASS | `** ARCHIVE SUCCEEDED **` for 1.5.25 (146) |
| Backend lint | ✅ PASS | `eslint .` clean |
| Backend full suite (earlier today) | ✅ PASS | 3,146 pass / 0 fail (Gate 0); real-Postgres harness green (Gate 1) |
| Privacy manifest | ✅ Present | `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy` |
| Entitlements | ✅ Present | `PorizoApp/PorizoApp/PorizoApp.entitlements` |
| Legal URLs live (200) | ✅ PASS | `porizo.co/legal/privacy` + `/legal/terms` → HTTP/2 200 |
| ASC version state | ✅ Clean | 1.5.25 READY_FOR_SALE; no in-flight submission disturbed by build 146 |
| Build number unique | ✅ PASS | ASC latest = 145; bumped local → 146 |
| App↔backend launch contract | ✅ PASS | `/app/config` returns all required keys (stt, music, flags, gift_bundles, onboarding, app_update); `app_update.app_store_url` present |
| Refactor revenue-path safety | ✅ PASS | Money endpoints 401 without auth (C1/Root 2); flat error envelope (C2); Root 9 prod migrations 122/123 applied clean on live Postgres |

## Warning (informational, not a blocker)
- Prod boot logs show a pre-existing OneSignal tag-sync 404 batch (76 users) at startup — unrelated to the refactor, `[INFO]` level, present before this change. Track separately.

## Notes
- Full 14-category submission gate (screenshots DPI/dims, IAP review screenshots, EULA, description) was NOT re-run because this is an internal TestFlight build, not a store submission. Re-run `/appstore-review` in full before any App Store submission of the refactor.

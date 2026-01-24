# Stream Playback Smoke Check and S3 URL Test

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own PLANS.MD, so this plan follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Enable a production-safe way to validate audio playback readiness from TestFlight by adding a small, authenticated stream-check endpoint, and add a focused test that confirms track version responses return presigned S3 URLs. After this change, a user can verify playback health without guessing whether the API is returning local URLs that will fail in production.

## Progress

- [x] (2026-01-24 14:07Z) Identify API surface for track versions and S3 URL generation logic.
- [x] (2026-01-24 14:17Z) Add authenticated stream-check endpoint for a specific track version.
- [x] (2026-01-24 14:20Z) Add test asserting presigned URLs when storage type is S3.
- [x] (2026-01-24 14:31Z) Run lint/tests and record results.

## Surprises & Discoveries

- Observation: Track version URLs were rewritten for localhost but not presigned for S3, which explains immediate playback errors in production.
  Evidence: `src/server.js` `getTrackVersions` only used `rewriteStreamUrl` before this change.
- Observation: ESLint fails on pre-existing parsing errors in `src/database/story-repository.js`, `src/jobs/compute-daily-aggregates.js`, and `src/workflows/runner.js`.
  Evidence: `npm run lint` reports `Parsing error: Unexpected token db` and `Unexpected token updateJobExternalTask`.

## Decision Log

- Decision: Move S3 URL generation into a new `buildTrackVersionUrls` helper for testability without loading the full server.
  Rationale: Avoids `server.js` test import issues and keeps URL logic in one place.
  Date/Author: 2026-01-24 (assistant)
- Decision: Add a dedicated authenticated stream-check endpoint instead of reusing a debug-only route so TestFlight can call it in production.
  Rationale: It provides explicit evidence of storage availability without lowering security.
  Date/Author: 2026-01-24 (assistant)

## Outcomes & Retrospective

Stream-check endpoint added; S3 URL helper test passes. Lint/tests still failing due to pre-existing parsing errors and database adapter gaps.

## Context and Orientation

Track version playback URLs are returned by `getTrackVersions` in `src/server.js`. In production, audio is stored in S3, but the API was returning local URLs, which fail on device. The storage provider supports `createPresignedDownload` and key helpers exist in `src/storage/index.js` (`trackPreviewKey`, `trackMasterKey`). A lightweight endpoint for streaming checks is added to `src/server.js` near existing track routes. A new helper in `src/services/track-urls.js` centralizes URL generation so it can be unit-tested without loading the full server.

## Plan of Work

Edit `src/server.js` to add a new authenticated endpoint `GET /tracks/:id/versions/:version/stream-check`. This endpoint will validate the user, load the track and version, and return presigned URLs plus object-existence checks where supported. Add `src/services/track-urls.js` and update `getTrackVersions` to use it. Then add a new test file under `test/services/` that calls `buildTrackVersionUrls` with a mocked S3 storage provider and asserts the returned URLs match expected presigned form.

## Concrete Steps

1) Add the route in `src/server.js` after `/tracks/:id/versions`.
2) Add `src/services/track-urls.js` and wire `getTrackVersions` to use it.
3) Create `test/services/track-urls.test.js` to assert presigned URLs.
4) Run `npm run lint` and `npm test` from the repo root and capture failures.

## Validation and Acceptance

The new endpoint should return JSON with `preview.url` and `full.url` when the track version has those assets. The new test should fail before the change and pass after it. Running `npm test` should show the new test passing even if unrelated tests continue to fail.

## Idempotence and Recovery

The endpoint is read-only and safe to retry. The test is pure and does not touch the filesystem, so it can be rerun safely.

## Artifacts and Notes

Example expected response (shape only):

    {
      "track_id": "...",
      "version_num": 1,
      "storage": "s3",
      "preview": { "exists": true, "url": "https://.../preview.m4a?..." },
      "full": { "exists": true, "url": "https://.../master.m4a?..." }
    }

## Interfaces and Dependencies

Use `storageProvider.createPresignedDownload({ key, expiresInSec })` and `storageProvider.objectExists({ key })` if available. Use `trackPreviewKey` and `trackMasterKey` from `src/storage/index.js`. The new endpoint must enforce `requireUserId` to avoid leaking URLs. The test should call `buildTrackVersionUrls` directly with a mocked storage provider.

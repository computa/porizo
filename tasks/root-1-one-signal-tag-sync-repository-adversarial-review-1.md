# Root 1 OneSignal Tag Sync Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `src/database/one-signal-tag-sync-repository.js`.
- Delegated the OneSignal user/song-count/last-song aggregate read from
  `src/services/onesignal.js`.
- Added `test/one-signal-tag-sync-repository.test.js`.
- Added `startTagSyncJob` repository-injection coverage to
  `test/onesignal-service.test.js`.

## Boundary

This slice does not change OneSignal configuration, HTTP payload construction,
admin campaign push sending, tag bucketing policy, date math, scheduler
intervals, immediate-start behavior, or per-user error tolerance. It only moves
the tag-sync aggregate read behind a repository.

## Review Outcome

No P0/P1 issues found in local adversarial review.

## Risks Checked

- **Startup behavior:** `startTagSyncJob` still runs immediately and returns a
  stoppable handle.
- **Unconfigured OneSignal:** the job still exits before repository/API work
  when env configuration is missing.
- **PostgreSQL COUNT portability:** repository normalizes `COUNT()` output to a
  number so strict tag bucketing treats `"1"` as one song, not the fallback
  `"5+"` bucket.
- **Query-only adapter compatibility:** repository uses `dbAll`, preserving the
  dual SQLite/Postgres/query-function adapter path.
- **Admin marketing coupling:** admin push campaign persistence remains in
  `admin-marketing-repository.js`; this slice does not mix campaign sends with
  daily tag sync.
- **Existing row semantics:** the aggregate still includes all users and all
  tracks exactly as before; no deleted-row filters were introduced.
- **Agent resource management:** two read-only explorer agents were launched;
  both completed and were closed after their results were collected.

## Validation

- `node --check src/database/one-signal-tag-sync-repository.js`
- `node --check src/services/onesignal.js`
- `node --check test/one-signal-tag-sync-repository.test.js`
- `node --test --test-concurrency=1 test/one-signal-tag-sync-repository.test.js test/onesignal-service.test.js test/admin-marketing-repository.test.js test/admin-marketing-routes.test.js`
- `npm run lint`
- `git diff --check`

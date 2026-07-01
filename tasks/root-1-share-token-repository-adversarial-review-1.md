# Root 1 Share Token Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `src/database/share-token-repository.js`.
- Delegated song/poem share creation, reuse, lifetime upgrade, PIN stripping,
  expiration marking, and track/poem backlink updates from
  `src/services/share-service.js`.
- Delegated `/tracks/:id/share`'s duplicate active manual-share lookup and
  backlink repair from `src/routes/tracks.js`.
- Added `test/share-token-repository.test.js`.

## Boundary

This slice does not change share claim, receiver-session, streaming/download,
gift delivery, admin share management, access logging, audit/event emission,
OG variant validation, or share-followup scheduling. It preserves the existing
`DELETE expired/revoked -> INSERT -> UPDATE backlink` order rather than fixing
the known non-transactional creation race in this slice.

## Review Outcome

No P0/P1 issues found in local adversarial review.

## Risks Checked

- **Query-only adapter compatibility:** `test/share-service.test.js` still
  passes for song and poem share creation with a query-only adapter.
- **Claim-path safety:** `healAndCheckShare` keeps the existing exported
  signature and routes status writes through a repository with allowed-table
  validation.
- **Manual-vs-gift reuse:** `getLatestManualSongShare` keeps excluding
  `delivery_source = 'gift'` so `/tracks/:id/share` does not surface scheduled
  gift tokens as manual shares.
- **PIN-less reuse:** existing unbound shares still clear `claim_pin` and reset
  `claim_attempts` when `require_pin: false` goes through
  `createOrGetShareToken`.
- **Lifetime upgrade/heal:** non-revoked normal shares still upgrade to lifetime
  and incorrectly expired lifetime shares still revive to the correct active
  status; genuinely expired normal shares are still marked expired.
- **Creation sequence:** the extraction preserves the current non-transactional
  delete/insert/backlink sequence, avoiding a behavior change in this slice.
- **Table-name safety:** repository status/lifetime updates reject unsupported
  table names instead of interpolating arbitrary identifiers.
- **Agent resource management:** no new agents were launched for implementation;
  prior read-only explorers were already closed before this slice completed.

## Validation

- `node --check src/database/share-token-repository.js`
- `node --check src/services/share-service.js`
- `node --check src/routes/tracks.js`
- `node --test --test-concurrency=1 test/share-token-repository.test.js test/share-service.test.js`
- First route/security run without the established anon/device test env failed
  with expected 401s in anonymous-header tests.
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/render-endpoints.test.js test/recipient-contact.test.js test/share-flow.test.js test/share-embed.test.js test/share-app-only.test.js test/sharing-security.test.js test/receiver-session.test.js`
- `npm run lint`
- `git diff --check`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot "test/**/*.test.js"`

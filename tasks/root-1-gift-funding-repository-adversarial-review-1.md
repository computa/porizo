# Root 1 Gift Funding Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `src/database/gift-funding-repository.js`.
- Delegated reservation/content lookup and funded-content deletion persistence
  from `src/services/gift-funding.js`.
- Added `test/gift-funding-repository.test.js`.

## Boundary

This slice does not move reservation creation, reservation finalize/cancel route
logic, gift wallet debit/refund accounting, gift order creation, or dispatch.
`gift-funding.js` keeps validation policy, active-status rules, expiration
checks, error envelopes, content rendering, and deletion orchestration.

## Review Outcome

No P0/P1 issues found in local adversarial review.

## Risks Checked

- **Reservation validation drift:** active owned reservations still validate;
  existing active funded content still rejects with
  `GIFT_RESERVATION_CONTENT_ALREADY_CREATED`.
- **Schema invariant:** tests respect the unique active `gift_reservation_id`
  indexes on tracks/poems.
- **Content discovery:** song discovery remains preferred when no content type
  is provided; explicit poem discovery still works.
- **Funded-content deletion:** tracks/poems are soft-deleted, library entries are
  removed, song shares are revoked and web streaming is disabled, poem shares
  are revoked, and `dispatched_at` is cleared.
- **Consumer compatibility:** existing reservation cancellation/expiry tests and
  mocked story-billing validation path still pass.
- **Agent resource management:** no subagent was launched for this slice because
  the prior close-agent call stalled; review was performed locally with bounded
  commands.

## Validation

- `node --check src/database/gift-funding-repository.js`
- `node --check src/services/gift-funding.js`
- `node --check test/gift-funding-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-funding-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot --test-name-pattern "deletes gift-funded content when a reservation is cancelled|deletes gift-funded content when a reservation expires|finalizing the same reservation twice returns the original gift" test/gifts.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/story-billing.test.js`
- `npm run lint`
- `git diff --check -- src/database/gift-funding-repository.js src/services/gift-funding.js test/gift-funding-repository.test.js`

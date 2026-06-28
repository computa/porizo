# Root 1 Gift Dispatch Scheduler Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `src/database/gift-dispatch-repository.js`.
- Delegated scheduler polling/recovery SQL from `src/jobs/gift-dispatch.js`.
- Added `test/gift-dispatch-repository.test.js`.

## Boundary

This slice does not move `dispatchGiftById`, channel-send delivery, share-token
mutation, wallet refund/debit logic, reservation funding, or admin retry/cancel
routes. Those remain larger revenue-adjacent gift roots.

## Review Outcome

No P0/P1 issues found in local adversarial review.

## Risks Checked

- **Dispatch state drift:** repository preserves the exact stale-dispatching
  transition to `dispatch_retry`/`error`, clears `dispatch_started_at`, sets
  `next_retry_at`, and only fills `last_dispatch_error` when absent.
- **Channel recovery drift:** repository preserves stale `sending` outbox
  recovery to `failed`, clears `locked_at`, and keeps existing `last_error`
  when present.
- **Overdue false positives:** overdue detection still excludes gifts with a
  sent outbox row.
- **Batch behavior:** due gifts are still selected from `scheduled` and
  `dispatch_retry`, ordered by `send_at`, and limited by caller-provided
  `batchSize`.
- **Incident side effects:** incident creation/resolution remains in the job,
  not the repository, preserving current observability behavior.
- **Agent resource management:** no subagent was launched for this slice because
  the previous close-agent call stalled; review was performed locally with
  bounded commands.

## Validation

- `node --check src/database/gift-dispatch-repository.js`
- `node --check src/jobs/gift-dispatch.js`
- `node --check test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot --test-name-pattern "stale dispatching gifts|marks overdue scheduled gifts" test/gifts.test.js`
- `npm run lint`
- `git diff --check -- src/database/gift-dispatch-repository.js src/jobs/gift-dispatch.js test/gift-dispatch-repository.test.js`

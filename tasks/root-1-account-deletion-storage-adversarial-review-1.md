# Root 1 Account-Deletion Storage Adversarial Review 1

Date: 2026-06-27

Scope: account-deletion durable storage cleanup across local/S3-compatible
storage providers, route wiring, and regression tests.

## Findings

- P1 fixed: storage cleanup originally risked stale documentation and an
  incomplete storage inventory. The deletion prefix set now covers tracks,
  poems, enrollment raw chunks, enrollment clean outputs/Suno persona files, and
  voice-profile embeddings.
- P1 fixed: S3-compatible storage could return more than one listing page. The
  S3 adapter now exposes `nextContinuationToken`, and account deletion walks all
  pages before deleting.
- P1 fixed: a truncated listing without a continuation token would have silently
  left artifacts. The cleanup now fails closed before issuing deletes.
- P2 fixed: the cleanup log no longer includes the raw user id.

## Residual Risk

Object storage deletion is external to the SQL transaction. The implementation
orders cleanup as the final transaction step so later DB writes cannot cause a
rollback after storage deletion, but a mid-delete provider failure can still
leave partial external side effects while the SQL transaction rolls back. A
future outbox/retry erasure job would be the stronger production-grade closure.

## Validation

- `node --check` passed for the changed account-deletion, route, server, storage,
  and test files.
- Focused account-deletion storage/service/API tests passed.
- Focused storage adapter tests passed.
- `npm run lint` passed.
- `git diff --check` passed.

# Root 1 — Device Push Token Repository Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/device-repository.js`
- `src/routes/enrollment.js`
- `src/workflows/runner.js`
- `src/routes/sharing.js`
- `test/device-repository.test.js`

Root boundary:
- In scope: `/device/register` row insert/update persistence and device push-token lookups for runner render-completion and sharing receiver-play-completed notifications.
- Out of scope: queued-job claim, stale recovery, heartbeat semantics, terminal status update, DLQ handling, provider step extraction, sharing track-title lookup, and APNs send orchestration.

Reviewer mode: local adversarial pass after bounded explorers identified the runner and sharing token reads. Explorer agents were closed after completion.

## Attack Vectors

1. P0 check — job completion semantics change.
   - Result: NOT FOUND. Only the device-token read moved; `updateJobStatus.run("completed", ...)` and ready-step ordering are unchanged.

2. P0 check — device registration stops issuing a device token for anonymous/fallback callers.
   - Result: NOT FOUND. `routes/enrollment.js` still owns auth/fallback policy and `issueDeviceToken()`. Repository call is gated on `userId`, matching prior persistence behavior.

3. P0 check — existing push tokens are cleared when a device registers without a push token.
   - Result: NOT FOUND. Repository preserves existing `push_token` and `push_token_updated_at` on no-token updates.
   - Coverage: `registerDevice updates an existing device and preserves push token when omitted`.

4. P0 check — push-token timestamp is not refreshed when a token is supplied.
   - Result: NOT FOUND. Repository updates both `push_token` and `push_token_updated_at` when `pushToken` is present.
   - Coverage: `registerDevice refreshes push token and timestamp for an existing device`.

5. P0 check — push notification failure becomes fatal.
   - Result: NOT FOUND. Existing try/catch and fire-and-forget `sendRenderComplete().catch()` behavior remain in `runner.js`.

6. P0 check — null push tokens are sent.
   - Result: NOT FOUND. Repository keeps `push_token IS NOT NULL`, and the runner retains the defensive `if (device.push_token)` guard.

7. P0 check — sharing receiver-play-completed event handling changes.
   - Result: NOT FOUND. The route still gates on `receiver_play_completed`, APNs configuration, and `share.creator_id`; only the device lookup moved.

8. P1 check — repository changes row shape and breaks the existing loops.
   - Result: NOT FOUND. Repository returns rows with only `{ push_token }`.
   - Coverage: repository test asserts exact key set.

9. P1 check — lookup starts returning other users' devices.
   - Result: NOT FOUND. Repository filters by `user_id = ?`.
   - Coverage: repository test seeds another user's token and expects it excluded.

10. P1 check — slice accidentally touches the high-risk runner claim/update cluster.
   - Result: NOT FOUND for this slice. No due-job selection, lock ownership, stale recovery, or status transition SQL was edited.

11. P1 check — sharing title/recipient lookup is accidentally moved or changed.
   - Result: NOT FOUND. The `tracks` lookup remains in `sharing.js`, outside this slice.

## Findings

No P0 findings.

No P1 findings.

No deferred P2 findings in this slice. Naming was corrected to the aggregate (`device-repository.js`) before completion.

## Validation

- `node --check src/database/device-repository.js`
- `node --check src/routes/enrollment.js`
- `node --check src/workflows/runner.js`
- `node --check src/routes/sharing.js`
- `node --check test/device-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/device-repository.test.js test/share-flow.test.js test/sharing-security.test.js test/receiver-session.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/push-notification.test.js test/ready-step-s3-ordering.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/share-flow.test.js test/recipient-contact.test.js test/share-embed.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/receiver-session.test.js test/sharing-security.test.js`

Focused result: device-registration-focused rerun passed 81 tests, 2 skipped, 0 failed; notification/sharing sweeps passed 132 tests, 2 skipped, 0 failed.

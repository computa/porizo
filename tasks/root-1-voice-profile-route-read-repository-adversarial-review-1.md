# Root 1 — Voice Profile Route Read Repository Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/voice-provider-profile-repository.js`
- `src/routes/enrollment.js`
- `test/voice-provider-profile-repository.test.js`
- `test/voice-enrollment.test.js`

Root boundary:
- In scope: voice-profile read persistence for `GET /voice/profile`, `POST /voice/reverify`, and `DELETE /voice/profile` preflight.
- Out of scope: enrollment completion writes, provider-profile lifecycle, provider job cancellation, enrollment token revocation, audit emission, and the actual voice-profile soft-delete update.

Reviewer mode: local adversarial pass. No new subagents launched because prior agent cleanup remained nonresponsive to bounded interrupt/wait.

## Attack Vectors

1. P0 check — deleted voice profiles become visible in `GET /voice/profile`.
   - Result: NOT FOUND. The active and latest fallback reads both retain `deleted_at IS NULL`, and the fallback retains `status != 'deleted'`.
   - Coverage: existing route test `should not return deleted profiles` still returns `NO_VOICE_PROFILE`.

2. P0 check — pending replacement profile hides the current active provider persona.
   - Result: NOT FOUND. Only profile row reads moved; `findActiveProviderProfileForUser()`, `findLatestPendingProviderProfileForUser()`, and response composition are unchanged.
   - Coverage: existing route test `should keep current active persona visible while replacement is pending`.

3. P0 check — legacy clients lose the preparing-state compatibility behavior.
   - Result: NOT FOUND. The `responseStatus` calculation remains route-owned and unchanged.

4. P0 check — reverify starts accepting non-active profiles.
   - Result: NOT FOUND. The repository method preserves the exact `status = 'active'` predicate from the route.
   - Coverage: repository test asserts active-id lookup shape; route test pins successful challenge shape for an active profile.

5. P0 check — delete route mutation semantics change.
   - Result: NOT FOUND. This slice deliberately did not move the `UPDATE voice_profiles SET status = ?, embedding_ref = ?, elevenlabs_voice_id = ?, deleted_at = ?` mutation. Token revocation, provider cleanup, and audit emission remain route/service-owned.
   - Coverage: route test verifies soft-delete side effects remain status=`deleted`, null embedding, null ElevenLabs id, and non-null `deleted_at`.

6. P1 check — delete preflight stops matching the previous row selection.
   - Result: NOT FOUND. The repository method preserves the previous predicate: `user_id = ? AND status != 'deleted'`, without adding a new `deleted_at IS NULL` filter or ordering.

7. P1 check — repository grows a duplicate aggregate instead of using an existing boundary.
   - Result: NOT FOUND. The slice extends `voice-provider-profile-repository.js`, which already owns `voice_profiles` and `voice_provider_*` persistence, instead of creating another voice-profile repository.

8. P1 check — route-level rate limits/auth change.
   - Result: NOT FOUND. All auth and `consumeRateLimit` calls are untouched.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: `routes/enrollment.js` still has voice-profile writes during enrollment completion and delete. The next safe follow-up should move those writes only with the full enrollment completion/delete characterization suite because provider cleanup and token revocation sit adjacent to the mutations.

## Validation

- `node --check src/database/voice-provider-profile-repository.js`
- `node --check src/routes/enrollment.js`
- `node --check test/voice-provider-profile-repository.test.js`
- `node --check test/voice-enrollment.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/voice-provider-profile-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-name-pattern "GET /voice/profile|POST /voice/reverify|DELETE /voice/profile" test/voice-enrollment.test.js`

Focused result: 15 pass / 0 fail.

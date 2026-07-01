# Root 1 Suno Voice Persona Status Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added a voice-profile status read to `voice-provider-profile-repository.js`
  and exposed it through `voice-provider-profile-service.js`.
- Replaced the final direct `voice_profiles` fallback query in
  `suno-voice-persona-service.js`.

## Boundary

This slice intentionally does not change Suno persona execution, provider
calls, consent policy, between-step revalidation, retry/backoff behavior, or
error mapping. It only moves the fallback status persistence read behind the
existing voice-provider repository boundary.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** When `voice_profile_status` is already hydrated in the
  execution context, the service still uses that value and does not perform the
  fallback read.
- **P2 VERIFIED:** When the fallback read is needed, it remains scoped by both
  `voiceProfileId` and `userId`.
- **P2 VERIFIED:** The active/pending-provider allowlist remains service-owned.

## Risks Checked

- **Provider blast radius:** no provider submission/polling paths changed.
- **Consent boundary:** consent checks remain unchanged and still require
  provider-profile or enrollment-session scoped consent.
- **Repository direction:** `suno-voice-persona-service.js` now has zero raw SQL
  matches.
- **Agent resource management:** fresh explorer agents were launched only for
  independent read-only hotspot mapping; this code slice was completed locally
  without overlapping edits.

## Validation

- `node --check src/database/voice-provider-profile-repository.js`
- `node --check src/services/voice-provider-profile-service.js`
- `node --check src/services/suno-voice-persona-service.js`
- `node --check test/voice-provider-profile-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/voice-provider-profile-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/suno-voice-persona-service.test.js`
- `npm run lint`
- Targeted grep confirmed no raw persistence SQL remains in
  `suno-voice-persona-service.js`.
- `git diff --check -- src/database/voice-provider-profile-repository.js src/services/voice-provider-profile-service.js src/services/suno-voice-persona-service.js test/voice-provider-profile-repository.test.js`

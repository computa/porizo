# Root 1 Voice Provider Active Profile Validation — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `hasActiveVoiceProfileForUser` to
  `src/database/voice-provider-profile-repository.js`.
- Delegated personalized voice active-profile validation from
  `src/providers/voice.js` into the existing voice-provider profile repository.
- Added repository coverage in `test/voice-provider-profile-repository.test.js`.

## Boundary

This slice does not change Seed-VC conversion, reference-audio selection,
Demucs stem separation, active Suno persona validation, track voice-mode route
contracts, or provider retry behavior. It only removes the provider-layer
`voice_profiles` SQL check.

## Review Outcome

No P0/P1 issues found in local adversarial review.

## Risks Checked

- **Provider behavior:** personalized conversion still throws
  `E302_VOICE_ERROR: Database connection required for voice profile validation`
  when no DB is supplied.
- **Active-profile gate:** inactive/pending voice profiles still fail the
  personalized conversion precondition; only `status = 'active'` passes.
- **Repository cohesion:** the check was added to
  `voice-provider-profile-repository.js`, which already owns `voice_profiles`
  lifecycle reads/writes beside provider-profile rows.
- **Provider purity:** `src/providers/voice.js` no longer calls direct DB
  primitives; DB access is behind the repository.
- **No remote-provider drift:** Seed-VC availability checks, conversion params,
  temp-file cleanup, and reference-audio selection were not changed.
- **Agent resource management:** no new agents were launched for this slice.

## Validation

- `node --check src/providers/voice.js`
- `node --check src/database/voice-provider-profile-repository.js`
- `node --check test/voice-provider-profile-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/voice-provider-profile-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/critical-fixes.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/voice-provider-profile-service.test.js test/suno-voice-persona-service.test.js`
- `npm run lint`
- `git diff --check`

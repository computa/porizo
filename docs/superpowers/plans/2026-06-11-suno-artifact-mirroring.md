# Suno Artifact Mirroring Implementation Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not contain its own `PLANS.MD`, so this document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

SunoAPI retains media files for 14 days and log data for 2 months. Porizo must not rely on Suno-hosted audio for user playback, retries, or audit recovery. After this change, every successfully downloaded Suno audio artifact is mirrored into Porizo-owned storage immediately, retries prefer the mirrored copy, and tests prove the mirror path works without depending on Suno's temporary URLs.

The user-visible outcome is that generated songs remain playable and recoverable from Porizo storage even after Suno deletes its hosted files. Operators can verify the behavior through tests that assert the raw Suno MP3 is uploaded under the track version storage prefix and that later workflow steps hydrate from that storage key before trying the provider URL.

## Progress

- [x] (2026-06-11 10:51Z) Read provider-review, writing-plans, executing-plans, requesting-code-review, receiving-code-review, and verification-before-completion skills.
- [x] (2026-06-11 10:52Z) Read `~/.codex/PLANS.MD`.
- [x] (2026-06-11 10:53Z) Inspected the Suno provider, workflow runner, storage providers, and existing Suno tests.
- [x] (2026-06-11 10:57Z) Reviewed this plan against code reality and updated the mirror-provider scope.
- [x] (2026-06-11 11:06Z) Added a storage key helper for raw provider artifacts.
- [x] (2026-06-11 11:06Z) Mirrored downloaded Suno MP3 artifacts to storage and included the durable key in result metadata.
- [x] (2026-06-11 11:06Z) Preferred durable provider artifact keys when mixing provider-complete audio.
- [x] (2026-06-11 11:12Z) Added focused tests for mirror upload and durable-key hydration.
- [x] (2026-06-11 11:16Z) Accepted review finding that mirror upload and durable-key hydration storage failures must remain retryable; classified both as infrastructure-transient.
- [x] (2026-06-11 11:24Z) Accepted review finding that a local Suno MP3 written before a failed mirror upload could bypass mirroring on retry; delete the unmirrored file before rethrowing.
- [x] (2026-06-11 11:35Z) Final code review reported no actionable correctness issues.
- [x] (2026-06-11 11:36Z) Ran focused tests, lint, and full test suite verification.

## Surprises & Discoveries

- Observation: The Suno provider already downloads the provider URL into the local version directory as `inst_preview.mp3` or `inst_full.mp3`.
  Evidence: `src/providers/suno.js` function `downloadSunoAudio` fetches `audioUrl` and writes the response to `versionDir`.

- Observation: The workflow already uploads final Porizo playback assets to S3/R2 before marking a track version ready.
  Evidence: `src/workflows/runner.js` function `uploadTrackOutputsToS3` uploads `preview.m4a` or `full.m4a`, and existing `test/ready-step-s3-ordering.test.js` covers upload-before-ready behavior.

- Observation: The workflow still stores the Suno provider URL in provenance and later may re-download from that URL in provider-complete mixing.
  Evidence: `src/workflows/render-contract.js` exposes `getProviderAudioUrl`, and `src/workflows/runner.js` uses that URL to populate `suno_complete.mp3` if a local provider file is missing.

- Observation: The Suno callback route is intentionally authenticated but no-op.
  Evidence: `src/routes/internal-suno-callback.js` explicitly says the route must not mutate state until auth semantics are hardened.

- Observation: New mirror and hydration storage failures must be retryable, otherwise transient object-storage outages can strand otherwise valid Suno renders in DLQ.
  Evidence: `codex review --uncommitted` reported the issue, and `src/utils/step-classification.js` now classifies `E302_SUNO_MIRROR_FAILED` and `E301_PROVIDER_AUDIO_MIRROR_UNAVAILABLE` as `infrastructure_transient`.

- Observation: A local Suno MP3 written before a mirror upload failure can make the next retry skip provider generation and skip mirroring unless the file is removed.
  Evidence: `src/workflows/runner.js` reuses existing `inst_preview.mp3` for the preview instrumental step, so `src/providers/suno.js` now removes the unmirrored file on mirror failure.

## Decision Log

- Decision: Mirror the raw Suno MP3 into the existing track version storage namespace instead of creating a new table.
  Rationale: The storage key can be derived from user id, track id, version number, provider, and render kind. That avoids a migration and keeps retry hydration close to existing storage behavior.
  Date/Author: 2026-06-11 / Codex

- Decision: Keep final playback behavior unchanged.
  Rationale: Users should still play Porizo's processed `preview.m4a` or `full.m4a`; the raw Suno artifact is for retry, recovery, and audit durability, not direct playback.
  Date/Author: 2026-06-11 / Codex

- Decision: Do not make the Suno callback mutate state in this change.
  Rationale: The callback accepts a query token fallback and the source file warns that state mutation first needs stronger replay-safe authentication. Mirroring can be achieved safely in the polling path already used by renders.
  Date/Author: 2026-06-11 / Codex

- Decision: Mirror through any storage provider that exposes `putFile`, including local storage.
  Rationale: Local, test, and production paths should exercise the same durability branch. The local storage provider safely no-ops only when source and destination are identical, and the provider artifact key is distinct from the downloaded Suno file path.
  Date/Author: 2026-06-11 / Codex

- Decision: Treat mirror upload and durable-key hydration failures as retryable infrastructure errors.
  Rationale: These are object-storage availability failures after provider work has otherwise succeeded. Retrying preserves user renders and lets DLQ auto-reprocess recover once storage returns.
  Date/Author: 2026-06-11 / Codex

- Decision: Delete the local provider MP3 if the durable mirror upload fails.
  Rationale: The provider step is not complete until the durable mirror exists. Removing the local file prevents retries from treating the step as reusable without a persisted `provider_audio_key`.
  Date/Author: 2026-06-11 / Codex

## Outcomes & Retrospective

Implementation is complete. Suno provider MP3s are mirrored into Porizo-owned storage under deterministic track-version keys, provenance records `provider_audio_key`, provider-complete mixing hydrates from the durable key before using a temporary Suno URL, and mirror/hydration storage failures remain retryable.

Code review:

    codex review --uncommitted
    first pass: accepted two findings about retryability for mirror upload and hydration storage failures
    second pass: accepted one finding about retry bypass after local MP3 write and mirror failure
    final pass: no actionable correctness issues

Focused tests passed:

    NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/storage-keys.test.js test/suno-provider.test.js test/workflows/render-contract.test.js test/workflows/provider-artifact-hydration.test.js test/step-classification.test.js
    tests 66
    pass 66
    fail 0

Lint passed:

    npm run lint

Full verification required escalation because the managed sandbox blocked repo-local fixture writes under `storage/` and `marketing/email/.test-fixtures/`. The sandboxed run failed with `EPERM`; the same command outside the sandbox passed:

    npm test
    tests 590
    pass 584
    skipped 6
    fail 0

## Context and Orientation

Porizo is a Node/Fastify backend with a workflow runner in `src/workflows/runner.js`. Suno music generation is implemented in `src/providers/suno.js`. Storage providers live in `src/storage/`; both local storage and S3/R2 providers expose `putFile`, `downloadToFile`, and `objectExists`.

Important terms:

Provider URL means a temporary HTTPS URL returned by Suno. Suno may delete the file behind this URL after 14 days.

Durable artifact means a file copied into Porizo-owned local storage or S3/R2 storage.

Provider-complete pipeline means a render path where Suno returns complete audio and Porizo converts or mixes that file into final output.

The files expected to change are:

`src/storage/index.js` adds `trackProviderAudioKey({ userId, trackId, versionNum, provider, kind, format })`, returning a path like `tracks/<user>/<track>/v1/provider/suno-preview.mp3`.

`src/providers/suno.js` imports `trackProviderAudioKey`, accepts an optional `storageProvider` in `downloadSunoAudio` and `generateMusicWithSuno`, uploads the downloaded `inst_preview.mp3` or `inst_full.mp3` to the provider artifact key, and records `provider_audio_key` and `provider_audio_mirrored` in `raw`.

`src/workflows/runner.js` passes `storageProvider` to `downloadSunoAudio`, includes `provider_audio_key` in provenance where Suno results are recorded, and hydrates provider-complete audio from `provider_audio_key` before falling back to the Suno provider URL.

`src/workflows/render-contract.js` adds a helper to extract `provider_audio_key` from `provenance_json`.

`test/suno-provider.test.js` adds a focused provider test that stubs `fetch`, writes a small valid MP3, and asserts `storageProvider.putFile` receives the raw Suno artifact key.

`test/workflows/render-contract.test.js` adds a small helper test for extracting the durable key from provenance.

If practical within the existing runner test harness, `test/ready-step-s3-ordering.test.js` or a nearby workflow test will cover that provider-complete mixing hydrates from `provider_audio_key` without using the Suno URL.

## Plan of Work

First add a storage key helper for raw provider artifacts. The helper must normalize provider, render kind, and file extension to simple lowercase path segments to avoid path traversal and surprise object names. It should live next to `trackPreviewKey` and `trackMasterKey`.

Next update `downloadSunoAudio`. After the provider MP3 is fetched, written locally, and validated, if any `storageProvider` with `putFile` is provided, upload that exact MP3 file to `trackProviderAudioKey`. Return the key in `raw.provider_audio_key`. If upload fails, throw an `E302_SUNO_MIRROR_FAILED` error so the job does not proceed as if the artifact is durable.

Then update the runner so all calls to `downloadSunoAudio` pass `storageProvider`. When provenance is merged, include both the temporary provider URL and the durable provider key. Add `getProviderAudioKey` in `render-contract.js`, and use it in the provider-complete mix step. The mix step should try `storageProvider.downloadToFile({ key, filePath })` first when the durable key exists and local `suno_complete.mp3` is missing. Only if no durable key is available should it use the provider URL fallback.

Finally add tests, run review, fix issues, and verify.

## Concrete Steps

Run all commands from the repository root:

    cd /Users/ao/Documents/projects/porizo

Implement in this order:

1. Add `trackProviderAudioKey` to `src/storage/index.js`.
2. Add durable mirror support to `src/providers/suno.js`.
3. Add `getProviderAudioKey` to `src/workflows/render-contract.js`.
4. Update `src/workflows/runner.js` call sites and hydration logic.
5. Add or update focused tests.
6. Run:

    npm test -- test/suno-provider.test.js test/workflows/render-contract.test.js

7. Run:

    npm run lint

8. Run a provider/code review and fix all valid findings.
9. Run broader verification. At minimum:

    npm test

## Validation and Acceptance

Acceptance requires the focused tests to prove:

1. `downloadSunoAudio` still writes a local Suno MP3.
2. When a storage provider is passed, the raw Suno MP3 is uploaded to a durable key under `tracks/<user>/<track>/v<version>/provider/`.
3. Suno result metadata includes `provider_audio_key`.
4. The render contract helper extracts `provider_audio_key` from provenance.
5. The provider-complete mix path can hydrate the provider MP3 from storage before using a temporary provider URL.

Full acceptance requires lint and tests to pass, or any failure to be explicitly explained with evidence.

## Idempotence and Recovery

The storage key is deterministic, so retrying a completed mirror upload overwrites the same object and is safe. If implementation causes regressions, revert only the files changed by this plan and leave unrelated local changes untouched. The existing uncommitted `src/services/llm-provider.js` change and `docs/generated-documents/` artifact are unrelated and must not be edited or committed as part of this plan.

## Artifacts and Notes

This plan intentionally avoids changing the callback route because its header warns against state mutation until authentication is replay-safe.

## Interfaces and Dependencies

`trackProviderAudioKey({ userId, trackId, versionNum, provider, kind, format = "mp3" })` must return a string key.

`downloadSunoAudio({ storageDir, track, trackVersion, kind, statusResponse, storageProvider })` must keep its existing return shape and add optional `raw.provider_audio_key` and `raw.provider_audio_mirrored`.

`getProviderAudioKey(trackVersion)` must parse `trackVersion.provenance_json` and return a non-empty string from `provenance.music.provider_audio_key`, or null.

The existing storage provider interface is sufficient: `putFile({ key, filePath, contentType })` and `downloadToFile({ key, filePath })`.

# Test Fixtures

## suno-upload-cover-response.json

**Purpose:** Canonical shape of SunoAPI upload-cover task status response. Consumed by `src/providers/suno-persona.js`'s typed `extractSunoAudioId` (U6) and asserted in `test/suno-persona-provider.test.js`.

**Status:** VERIFIED (2026-05-05). The fixture was captured from a live `tools/suno-persona-probe.js` upload-cover run using a consented test voice and then redacted. R2.1 vendor confirmation is still required before any production flag flip.

1. Run `node tools/suno-persona-probe.js` against a real SunoAPI account (sandbox or single-test-user prod).
2. Capture the raw `getTask` response after upload-cover completes.
3. Redact per the rules below and overwrite this fixture.
4. Re-run `npm test -- suno-persona-provider` to confirm the typed extractor still finds `audioId` against the real shape. If not, update the typed extractor in `src/providers/suno-persona.js`.

## Redaction rules

- Bearer tokens: **never recorded** in fixtures. Probe script must strip before write.
- URLs: replace with `[redacted_url]`.
- Task IDs: replace with `task_REDACTED_<8-char-deterministic-hash>` so structural references stay intact.
- Audio IDs: replace with `audio_REDACTED_<8-char-deterministic-hash>`.
- Persona IDs: replace with `persona_REDACTED_<8-char-deterministic-hash>`.

## Capture provenance

| Field             | Value                          |
| ----------------- | ------------------------------ |
| Captured from     | `tools/suno-persona-probe.js` live run |
| Suno model        | V5_5                           |
| Capture timestamp | 2026-05-05T11:12:19.392Z       |
| Probe script      | `tools/suno-persona-probe.js`  |

# Gemini SDK Migration ExecPlan

## Goal

Move Porizo's Gemini integration from the legacy direct REST call to the official `@google/genai` SDK, switch the default Gemini model to `gemini-3-flash`, and make Gemini model selection configurable so future upgrades are not code edits.

## Context

- Current Gemini calls are made directly against `generativelanguage.googleapis.com` in `src/services/llm-provider.js`.
- Current Gemini model selection is hardcoded to `gemini-2.0-flash` for both `lyrics` and `simple`.
- The LLM layer is in a critical path for:
  - story building
  - story guidance
  - lyrics generation
  - structured JSON responses
- Recent production runs show repeated Gemini `429 RESOURCE_EXHAUSTED` failures, so this migration must not reduce observability or silently change fallback behavior.

## Decision

Implement the Gemini migration with these rules:

- use `@google/genai` as the Gemini client
- keep the current unified provider interface intact
- preserve current logging and fallback semantics
- make Gemini model selection configurable via env-backed config
- default both Gemini task types to `gemini-3-flash`
- keep per-task override capability so future tuning does not require code edits

## Configuration Surface

Add env-backed resolution with this priority:

1. `GEMINI_MODEL_LYRICS` or `GEMINI_MODEL_SIMPLE`
2. `GEMINI_MODEL`
3. code default

Code defaults:

- `lyrics`: `gemini-3-flash`
- `simple`: `gemini-3-flash`

## Exact Tasks

1. Add `@google/genai` dependency and update lockfile.
2. Replace the Gemini REST implementation in `src/services/llm-provider.js` with the SDK client.
3. Preserve structured JSON behavior:
   - `responseMimeType`
   - sanitized `responseSchema`
   - parse/normalize JSON text exactly as before
4. Preserve logging and result metadata:
   - provider
   - model
   - finish reason
   - token usage
5. Replace hardcoded Gemini model strings with env-backed resolution helpers.
6. Update tests to cover:
   - Gemini model resolution defaults and overrides
   - Gemini SDK success path
   - structured JSON normalization under the new implementation
   - provider fallback behavior when Gemini fails
7. Run targeted tests, then full `npm test`, then `npm run lint`.
8. Review the diff critically for any song-generation regression risk and fix any issue found before handoff.

## Risks

### R1. Structured JSON behavior regresses

The writer stack depends heavily on reliable JSON outputs.

Mitigation:
- preserve `responseMimeType` / `responseSchema`
- keep `normalizeStructuredResult`
- cover with tests

### R2. Model configurability becomes misleading

If model config is only partly wired, operators will think they changed the model when runtime still uses the old default.

Mitigation:
- resolve models in one function
- assert override behavior in tests

### R3. SDK migration changes fallback semantics

Mitigation:
- do not change provider ordering
- do not change retry loop behavior
- do not change token guardrails in this pass

## Validation

Targeted:

- `node --test test/llm-provider.test.js`

Full:

- `npm test`
- `npm run lint`

## Rollback

If `gemini-3-flash` behaves worse than expected:

1. set `GEMINI_MODEL` or task-specific env vars back to the previous stable model
2. keep the SDK migration intact
3. do not revert the configurability work unless the SDK itself proves unstable

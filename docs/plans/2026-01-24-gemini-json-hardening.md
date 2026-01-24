# Harden Gemini JSON Outputs for V2 Reasoner

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own `PLANS.MD`, so this plan follows `~/.codex/PLANS.MD` and must be maintained in accordance with it.

## Purpose / Big Picture

Users should see stable, reliable story progression without “JSON parse error” failures in the V2 engine. We will harden Gemini JSON responses by using the correct system instruction field, optional response schemas, and lower temperatures for structured outputs, while keeping Anthropic/OpenAI behavior unchanged. Success means the V2 reasoner no longer fails due to malformed JSON and can progress without falling back to heuristics.

## Progress

- [x] (2026-01-24 00:00Z) Review Gemini provider configuration and identify JSON handling gaps.
- [x] (2026-01-24 00:00Z) Update Gemini request format to use systemInstruction and conditional JSON schema enforcement.
- [x] (2026-01-24 00:00Z) Add JSON response options to V2 reasoner stages and reduce temperature for structured outputs.
- [x] (2026-01-24 00:00Z) Update JSON-producing call sites to pass JSON response options explicitly.
- [x] (2026-01-24 00:00Z) Record changes, note any risks, and outline validation steps.

## Surprises & Discoveries

- Observation: Gemini rejected `responseSchema` with `additionalProperties` and also rejects empty object schemas.
  Evidence: Production logs showed `Unknown name "additionalProperties" at generation_config.response_schema` and `response_schema.properties should be non-empty`.

## Decision Log

- Decision: Limit JSON schema enforcement to Gemini and keep Anthropic/OpenAI request shapes unchanged.
  Rationale: The reported failures are Gemini JSON parse errors; minimizing change surface preserves stability.
  Date/Author: 2026-01-24 / Codex
- Decision: Reduce temperature to 0.2 for JSON-only V2 reasoner stages.
  Rationale: Lower variance improves JSON compliance without altering creative modules.
  Date/Author: 2026-01-24 / Codex
- Decision: Strip `additionalProperties` and add a Gemini schema fallback that retries without schema on schema-related 400s.
  Rationale: Gemini rejects unsupported schema fields; retrying without schema preserves JSON enforcement via responseMimeType and prompt.
  Date/Author: 2026-01-24 / Codex

## Outcomes & Retrospective

- Outcome: Implemented Gemini systemInstruction usage, conditional JSON schema enforcement, and JSON-only settings for V2 reasoner plus other JSON-producing calls. Pending runtime validation.
  Date/Author: 2026-01-24 / Codex

## Context and Orientation

The Gemini provider is implemented in `src/services/llm-provider.js`. It currently concatenates system prompts into user prompts and always sets `responseMimeType: application/json` for Gemini, which can cause non-JSON or malformed JSON responses. The V2 story engine reasoner uses Gemini via `src/writer/v2/reasoner.js` and expects strict JSON outputs. Recent production logs show frequent JSON parse errors in the selection and reasoning stages.

## Plan of Work

We will update the Gemini provider to:

1) Use `systemInstruction` for the system prompt and keep user content separate.
2) Only set `responseMimeType` and `responseSchema` when explicitly requested by the caller.
3) Pass JSON options from the V2 reasoner stages and use a lower temperature for JSON generation.
4) Ensure other JSON-producing call sites explicitly request JSON output to preserve behavior.

## Concrete Steps

1) Edit `src/services/llm-provider.js` to add optional `responseSchema`/`responseMimeType` parameters and use `systemInstruction` for Gemini.
2) Edit `src/writer/v2/reasoner.js` to pass JSON options and reduce temperature for structured outputs.
3) Update JSON-producing call sites (songwriter, poem generator, memory questions) to request JSON responses explicitly.

## Validation and Acceptance

Acceptance is met if:

- V2 reasoner logs no longer show “No JSON object found” or “JSON parse error” for Gemini under normal load.
- A sample request to `/story/start` produces a valid JSON response path without falling back to heuristics.

Validation steps:

Run the server locally and trigger one story step. Observe the log for Gemini JSON success. If you cannot run locally, confirm changes are confined to the JSON interface and do not alter Anthropic/OpenAI request shapes.

## Idempotence and Recovery

The changes are safe to apply repeatedly. If a regression appears, revert only the Gemini provider changes and re-enable the previous behavior.

## Artifacts and Notes

Key change summary (paths):

  src/services/llm-provider.js: systemInstruction for Gemini, conditional responseMimeType/responseSchema.
  src/writer/v2/reasoner.js: JSON schema + low temperature for structured stages.
  src/services/memory-questions.js: JSON response hint.
  src/services/poem-generator.js: JSON response hint.
  src/writer/poem/index.js: JSON response hint.
  src/writer/songwriter.js: JSON response hint.

## Interfaces and Dependencies

- `src/services/llm-provider.js`: Gemini request shape and JSON options.
- `src/writer/v2/reasoner.js`: structured JSON calls for the story engine.
- JSON-producing callers: `src/writer/songwriter.js`, `src/writer/poem/index.js`, `src/services/poem-generator.js`, `src/services/memory-questions.js`.

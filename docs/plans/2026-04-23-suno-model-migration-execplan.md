# Suno Model Migration ExecPlan

## Goal

Move Porizo song generation from a hardcoded Suno `V4_5` payload to a configurable Suno model with a safe default, without breaking the current render pipeline.

## Context

- Current Suno payload is hardcoded to `model: "V4_5"` in `src/providers/suno.js`.
- Runtime music routing is effectively Suno-only for song generation.
- Admin config models provider choice and reroll behavior, but not Suno model choice.
- Risk is not just API acceptance. The real risk is breaking:
  - task submission
  - polling and audio readiness recovery
  - downstream Demucs / voice-conversion expectations

## Decision

Implement end-to-end `suno_model` configuration with:

- allowed values: `V4_5`, `V5`, `V5_5`
- runtime default: `V5`
- fallback compatibility: `V4_5` remains selectable
- experimental path: `V5_5` selectable but not default

## Why `V5` first

- `V4_5` is stale relative to current Suno model offerings.
- `V5` is the lowest-risk quality upgrade.
- `V5_5` adds more unknowns than value for the first migration pass.
- Making the model configurable is more important than forcing one irreversible jump.

## Exact Tasks

1. Extend music provider config storage and API to include `suno_model`.
2. Extend admin UI state and controls to expose `suno_model`.
3. Thread `suno_model` through runtime music config resolution in the workflow runner.
4. Update the Suno provider to use configured `suno_model` instead of hardcoded `V4_5`.
5. Add regression tests for:
   - config defaults
   - config persistence / validation
   - runtime config resolution
   - Suno payload model selection
6. Run targeted tests first, then relevant broader checks.
7. Review the diff critically and fix any breakage or config drift found during validation.

## Risks

### R1. Admin says one thing, runtime does another

This already exists today for provider defaults. The migration must avoid repeating that for model selection.

Mitigation:
- define the default once in config/service/runtime
- assert it in tests

### R2. `V5` or `V5_5` changes output behavior enough to break downstream assumptions

Mitigation:
- do not change polling or readiness logic in this pass
- do not change Demucs / voice-conversion contracts in this pass
- keep `V4_5` selectable for rollback

### R3. Hidden callers bypass runtime config

Mitigation:
- search all `generateMusicWithSuno` and payload call sites
- make model explicit at the provider boundary

## Validation

Minimum required before handoff:

- `node --test test/suno-provider.test.js`
- `node --test test/music-provider-config.test.js`
- `node --test test/provider-style-routing.test.js`
- relevant route/config tests if touched

Broader validation after targeted pass:

- relevant repo test command for backend/provider coverage

## Rollback

If `V5` causes regressions:

1. change stored/default `suno_model` back to `V4_5`
2. keep code path intact
3. do not revert the configurability work

The rollback should be a config flip, not a code revert.

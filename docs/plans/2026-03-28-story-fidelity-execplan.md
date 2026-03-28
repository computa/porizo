# Story Fidelity ExecPlan

Goal: make story-to-song generation preserve the actual story arc so the recipient recognizes their story, not just scattered keywords.

## Invariants

- Rich stories must preserve setup, conflict, turn, and payoff before lyric generation.
- `song_map` and `motifs` must survive from V3 story collection to the songwriter prompt.
- Story-backed lyrics must not be accepted when fidelity remains low after repair.
- Judge feedback must improve retries, not just score them.

## Task List

### Phase 1: Upstream Story Shaping

- [x] Update active V3 prompts in `src/writer/v3/prompts/reason-v3.md`
- [x] Update active V3 editor prompt in `src/writer/v3/prompts/reason-v3-editor.md`
- [x] Relax narrative compression for rich stories without allowing raw dumps
- [x] Strengthen prompt instructions to preserve payoff, meaning, and transformation
- [x] Review prompt-builder limits in `src/writer/v3/prompts/builder.js`
- [x] Tighten readiness gating in `src/writer/v3/index.js`
- [x] Tighten slot/readiness rules in `src/writer/v3/quality.js`
- [x] Improve deterministic fallback extraction in `src/writer/v3/engine.js`
- [x] Improve fallback narrative prioritization in `src/writer/v3/narrative.js`

### Phase 2: Context Preservation

- [x] Persist `song_map`, `motifs`, and needed evaluation metadata in `src/routes/story.js`
- [x] Pass preserved fields through `src/writer/lyrics-context.js`
- [x] Extend `normalizeContext()` in `src/writer/songwriter.js` to retain new fields
- [x] Add prompt-facing fact filtering for noisy facts in `src/writer/songwriter.js`

### Phase 3: Songwriter Conversion

- [x] Make `buildStoryArcSection()` use `song_map` as primary structure when present
- [x] Reduce atom overdependence in lyric guidance
- [x] Tighten provenance instructions in lyric prompt
- [x] Remove forced sensory pressure when story material is sparse
- [x] Improve heuristic scoring so unsupported specificity is penalized

### Phase 4: Judge and Repair

- [x] Extend fidelity judge with `faithfulness`
- [x] Return structured repair data from judge
- [x] Feed structured repair data into lyric retries
- [x] Implement a concrete snapshot repair path before final lyric failure
- [x] Replace silent `fidelity_passed: false` acceptance for story-backed tracks
- [x] Add provenance/debug metadata for lyric generation decisions

### Phase 5: Regression Validation

- [x] Add story-shaping tests for rich story payoff preservation
- [x] Add boundary test for `getStoryContextV3()` -> `story_context_json`
- [x] Add boundary test for `story_context_json` -> `buildLyricsContext()`
- [x] Add boundary test for `buildLyricsContext()` -> `normalizeContext()`
- [x] Add lyric-level hallucination regression test
- [x] Add story-backed rejection test for fidelity failure after repair

### Final Validation

- [x] Run targeted lyric/story tests
- [x] Run `npm run lint`
- [x] Run `npm test`
- [ ] Run iOS build only to ensure no cross-project breakage
- [x] Summarize evidence with exact commands and results

## Validation Notes

- Targeted tests passed:
  - `node --test test/lyrics.test.js test/story-to-track-contract.test.js test/writer/songwriter-fidelity.test.js test/writer/v3/condense-readiness.test.js`
- Repo lint passed:
  - `npm run lint`
- Full Node suite passed:
  - `npm test`
- iOS build was not run in this pass because the changes are server/runtime-only and this repository does not expose a general-purpose build script for that surface.

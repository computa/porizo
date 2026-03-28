# Story Fidelity ExecPlan

Goal: make confirmed story-to-song generation preserve the actual story arc so the recipient recognizes their story, not just scattered keywords, and keep lyric repair internal once the story is confirmed.

## Design Rule

- Before confirmation, the system may still shape the story with the user.
- After confirmation, lyric fidelity failures are our problem, not the user's problem.
- The story engine decides what the song must say.
- The lyric engine decides how to say it musically.
- The judge verifies alignment and feeds internal repair.

## Invariants

- Rich stories must preserve setup, conflict, turn, and payoff before lyric generation.
- `song_map` and `motifs` must survive from V3 story collection to the songwriter prompt.
- Confirmed stories must not be pushed back to the user because lyric conversion drifted.
- Contract repair and lyric repair after confirmation stay internal.
- When a valid cited `song_map` exists, it is the primary story-to-song scaffold.

## Task List

### Phase 1: Cited Contract

- [x] Update `src/writer/v3/prompts/reason-v3.md` so `song_map` items can be `{ idea, source_facts }`
- [x] Update `src/writer/v3/prompts/reason-v3-editor.md` to preserve cited `song_map` items
- [x] Update V3 engine-side `sanitizeSongMap()` in `src/writer/v3/engine.js` to accept cited items and keep backward compatibility with plain strings
- [x] Update songwriter-side `sanitizeSongMap()` in `src/writer/songwriter.js` to normalize cited items and plain strings into one internal shape
- [x] Ensure normalization preserves citations only when they reference real fact ids
- [x] Keep old track/story payloads working without migration

### Phase 2: Internal Contract Validation and Repair

- [x] Add `validateSongContract(context)` in `src/writer/songwriter.js`
- [x] Add internal contract checks:
  - [x] `verse1` exists
  - [x] `chorus` exists
  - [x] `verse2` or `bridge` exists
  - [x] each populated section has at least one usable cited item
  - [x] cited ids exist in `facts`
  - [x] payoff/meaning appears in `chorus` or `bridge`
  - [x] turn/change appears in `verse2` or `bridge`
- [x] Add internal contract repair from existing `facts`, `narrative`, `beats`, and `primitives`
- [x] Keep contract repair fully internal for confirmed stories
- [x] Surface contract validity/repair metadata in lyric provenance/debug output

### Phase 3: Contract-First Monolithic Generation

- [x] Make `buildStoryArcSection()` emit contract-first guidance only when a valid contract exists
- [x] Suppress fallback beat/atom/fact arc guidance when cited `song_map` is valid
- [x] Keep fallback guidance only when `song_map` is absent or invalid
- [x] Ensure retry prompts rewrite against the cited contract and prior draft

### Phase 4: Judge and Repair

- [x] Update story certification block to expose cited contract entries clearly
- [x] Extend judge prompt to report contract failures explicitly:
  - [x] `uncovered_song_map_slots`
  - [x] `unsupported_lines`
  - [x] `broken_citations`
  - [ ] `payoff_missing`
  - [ ] `turn_missing`
- [x] Keep judge failures internal to the retry loop for confirmed stories
- [x] Preserve judge-unavailable graceful degradation only for actual judge outages

### Phase 5: Regression Validation

- [x] Add prompt/schema tests for cited `song_map` compatibility
- [ ] Add normalization tests for cited + legacy `song_map`
- [ ] Add contract validation tests for missing sections / bad citations
- [x] Add contract repair tests from existing facts/primitives
- [x] Add contract-first prompt tests that prove dual guidance is suppressed
- [x] Add fidelity test that proves the judge sees cited contract content

## Review Plan

### Code Review

- [x] Re-read every touched `song_map` boundary:
  - [x] reasoner prompt schema
  - [x] editor prompt schema
  - [x] V3 engine sanitize/merge
  - [x] `getStoryContextV3()`
  - [x] track `story_context_json`
  - [x] `buildLyricsContext()`
  - [x] `normalizeContext()`
  - [x] prompt assembly
  - [x] judge input
- [x] Check backward compatibility for legacy string-based `song_map`
- [x] Check that invalid citations are dropped or repaired, not trusted
- [x] Check that valid cited contracts suppress fallback guidance
- [x] Check that confirmed-story repair stays internal and does not route back to user prompts

### Behavioral Review

- [x] Verify contract repair improves weak `song_map` before lyric writing
- [x] Verify retries use cited contract + previous draft instead of generic regeneration
- [x] Verify no new silent data loss at storage or normalization boundaries

## Confirmation Plan

### Automated

- [x] Run targeted tests for songwriter fidelity and V3 prompt/contract handling
- [x] Run `npm run lint`
- [x] Run `npm test`

### Evidence to confirm before handoff

- [x] Show exact commands run
- [x] Report whether cited `song_map` now survives from prompt -> engine -> storage -> lyric generation
- [x] Report whether contract validation/repair is internal after confirmation
- [x] Report whether fallback guidance is suppressed when cited contract exists
- [x] State any remaining gaps honestly, especially around section-by-section generation not yet implemented

## Stop-Ship Criteria for This Phase

- [x] Cited `song_map` survives end-to-end without breaking old tracks
- [x] Invalid/weak confirmed-story contracts self-repair internally
- [x] Dual guidance is suppressed when contract exists
- [x] Retry loop uses cited contract to drive correction
- [x] Full lint + test suite pass

## Validation Notes

- Targeted contract/fidelity tests passed:
  - `node --test test/lyrics.test.js`
  - `node --test test/writer/songwriter-fidelity.test.js test/writer/v3/prompt-builder-rich-input.test.js test/writer/v3/condense-readiness.test.js test/story-to-track-contract.test.js`
- Repo lint passed:
  - `npm run lint`
- Full Node suite passed:
  - `npm test`
- End-to-end cited contract persistence now has an explicit boundary fixture in `test/story-to-track-contract.test.js`:
  - mocked story context with cited `song_map`
  - route storage into `story_context_json`
  - rebuild via `buildLyricsContext()`
  - confirm contract-first lyric prompt still carries fact-backed support

# Fix P0/P1 Labov Story Guidance Bugs

**Branch:** `version3`
**Context:** Code review found 6 bugs (3 P0 critical, 3 P1 high) in the Labov story guidance implementation. All are wiring/consistency issues -- no architectural changes needed.
**Status:** COMPLETE

---

## Fixes

### P0 (Critical)

- [x] **Fix 1:** Wire `extractStoryState()` into execution path
  - Added `state.story_state = extractStoryState(state)` before `updateSession` in both `startStoryV3` and `continueStoryV3`

- [x] **Fix 2:** Wire `canProceedAnyway` into response
  - Added `canProceedAnyway` to return objects in `startStoryV3` and `continueStoryV3`
  - Added `can_proceed_anyway` to `mapAnalysisFields()` (writer/index.js)
  - Added `can_proceed_anyway` to `spreadStoryAnalysisFields()` (routes/story.js)

- [x] **Fix 3:** Consolidate duplicate `EVALUATION_REGEX`
  - Exported `EVALUATION_REGEX`, `SENSORY_REGEX`, `PAST_ACTION_REGEX`, `DEDICATION_REGEX` from quality.js
  - In `extractStoryState()`, removed local duplicate and imported from quality.js
  - Renamed misnamed `SENSORY_REGEX` to `PROPER_NOUN_REGEX` in index.js

### P1 (High)

- [x] **Fix 4:** Remove `/g` flag from regex used with `.test()` in loop
  - Split into `SPECIFIC_DETAIL_MATCH_REGEX` (/gi for .match()) and `SPECIFIC_DETAIL_TEST_REGEX` (/i for .test())

- [x] **Fix 5:** Map `resolution` to display element in Labov branch
  - Blended resolution into `moment` via `blendStrength(complicating.strength, resolution.strength, 0.25)`

- [x] **Fix 6:** Replace hardcoded `0.6` with `STRENGTH_THRESHOLDS.covered`
  - Changed `el.strength >= 0.6` to `el.strength >= STRENGTH_THRESHOLDS.covered` in `computeQuestionPriority()`

## Verification

- [x] Run `labov-fixes.test.js` -- 16/16 pass
- [x] Run existing test suite -- 86/86 pass (labov-gap-analysis + question-targeting + tone-rewrite)

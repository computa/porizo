# Kraken: Step 1C - Question Targeting + Funnel Staging

## Checkpoints
**Task:** Implement computeQuestionPriority, getQuestionStage, detectEmotionalIntensity in quality.js + buildQuestionTargeting in builder.js + wire into prompts
**Started:** 2026-04-04T12:00:00Z
**Last Updated:** 2026-04-04T12:30:00Z

### Phase Status
- Phase 1 (Tests Written): VALIDATED (30 tests, 29 failing as expected)
- Phase 2 (Implementation - quality.js): VALIDATED (20/20 quality tests green)
- Phase 3 (Implementation - builder.js): VALIDATED (30/30 all tests green)
- Phase 4 (Prompt template + wiring): VALIDATED (template + index.js state persistence)
- Phase 5 (Regression check): VALIDATED (216/223 pass, 7 pre-existing failures, 0 new regressions)

### Validation State
```json
{
  "test_count": 30,
  "tests_passing": 30,
  "tests_failing": 0,
  "files_modified": [
    "src/writer/v3/quality.js",
    "src/writer/v3/prompts/builder.js",
    "src/writer/v3/prompts/reason-v3.md",
    "src/writer/v3/index.js",
    "test/writer/v3/question-targeting.test.js"
  ],
  "last_test_command": "NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/writer/v3/question-targeting.test.js",
  "last_test_exit_code": 0,
  "regression_check": "writer/v3 suite: 216/223 pass, 7 pre-existing failures, 0 new regressions"
}
```

### Resume Context
- Current focus: COMPLETE
- Next action: None - Step 1C fully implemented
- Blockers: None

## Implementation Summary

### Files Modified

**src/writer/v3/quality.js**
- Added `computeQuestionPriority(labovAnalysis)` — information-gain question targeting using weight * (1 - strength)
- Added `getQuestionStage(turnCount)` — funnel staging (OPEN/PROBING/CLOSED)
- Added `detectEmotionalIntensity(userMessage)` — regex-based emotion detection with 3 signal categories
- Added 3 regex constants: VULNERABILITY_REGEX, INTENSIFIER_REGEX, FIRST_PERSON_EMOTION_REGEX
- Added all 3 functions to module.exports

**src/writer/v3/prompts/builder.js**
- Added `buildQuestionTargeting(state, labovAnalysis, userMessage)` — combines priority, stage, emotion into prompt injection block
- Added imports for computeQuestionPriority, getQuestionStage, detectEmotionalIntensity from quality.js
- Wired `{{question_targeting}}` replacement into `buildContextPrompt()` (reads `state.labov_analysis`)
- Added buildQuestionTargeting to module.exports

**src/writer/v3/prompts/reason-v3.md**
- Added `{{question_targeting}}` placeholder after `{{already_asked}}`, before ANTI-REPETITION RULE
- `{{gap_targeting}}` preserved for backward compatibility

**src/writer/v3/index.js**
- Updated `attachGapTelemetry()` to persist `labov_analysis` on state for prompt builder consumption on next turn

**test/writer/v3/question-targeting.test.js** (new)
- 30 tests covering all requirements

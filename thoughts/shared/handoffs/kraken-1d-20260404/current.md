# Kraken: Step 1D - Question Targeting Enforcement

## Checkpoints
**Task:** Implement generateTargetedFallbackQuestion + validateQuestionRelevance as post-processing enforcement when LLM ignores question_targeting injection
**Started:** 2026-04-04T15:00:00Z
**Last Updated:** 2026-04-04T15:45:00Z

### Phase Status
- Phase 1 (Tests Written): VALIDATED (28 tests, all failing as expected - functions not yet defined)
- Phase 2 (Implementation - quality.js): VALIDATED (28/28 tests green)
- Phase 3 (Wiring - index.js): VALIDATED (85/86 pass, 1 pre-existing failure, 0 new regressions)
- Phase 4 (Regression check): VALIDATED (260/283 pass, 23 pre-existing failures, 0 new regressions)

### Validation State
```json
{
  "test_count": 28,
  "tests_passing": 28,
  "tests_failing": 0,
  "files_modified": [
    "src/writer/v3/quality.js",
    "src/writer/v3/index.js",
    "test/writer/v3/question-enforcement.test.js"
  ],
  "last_test_command": "NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test test/writer/v3/question-enforcement.test.js",
  "last_test_exit_code": 0,
  "regression_check": "writer/v3 suite: 260/283 pass, 23 pre-existing failures, 0 new regressions"
}
```

### Resume Context
- Current focus: COMPLETE
- Next action: None - Step 1D fully implemented
- Blockers: None

## Implementation Summary

### Files Modified

**src/writer/v3/quality.js**
- Added `RELEVANCE_KEYWORDS` constant: regex patterns per Labov element for question relevance checking
- Added `validateQuestionRelevance(question, targetElement)`: keyword-based check if question addresses target
- Added `extractAnchor(text)`: extracts most salient detail from user message (proper nouns > named events > sensory > actions > content words)
- Added `TARGETED_QUESTION_TEMPLATES`: template matrix (4 elements x 3 funnel stages x 2 variants = 24 templates)
- Added `generateTargetedFallbackQuestion(targetElement, state, userMessage)`: deterministic story-specific fallback question generator
- Added both functions to module.exports
- Fixed pre-existing broken export of undefined `generateStorySpecificSuggestions`

**src/writer/v3/index.js**
- Added imports: computeQuestionPriority, generateTargetedFallbackQuestion, validateQuestionRelevance
- Modified `resolveTurnDecision` to accept `options.userMessage`
- Rewired normal-priority gap decision (else if gapQuestion) to 3 branches:
  1. LLM targeted exact slot -> keep (llm_slot_targeted)
  2. LLM question relevant to target element -> keep (llm_element_relevant)  
  3. LLM off-target -> targeted fallback or static template (targeted_fallback / deterministic_gap)
- startStoryV3: passes initialPrompt as userMessage
- continueStoryV3: passes answer as userMessage

**test/writer/v3/question-enforcement.test.js** (new)
- 28 tests covering all requirements

# Handoff Document: Story Module Hardening

> **NOTE (2026-01-18):** V1 Story Engine has been deleted. All code now uses V2 unified reasoning engine.
> Files referenced below (story-engine.js, story-models/*, question-generator.js, signal-extractor.js, element-quality.js) no longer exist.
> See V2 engine at `src/writer/v2/`.

<original_task>
Implement 8 critical fixes to the story-driven songwriter module based on researcher feedback. The module had scaffolding for Q&A but didn't extract stories with proper depth, specificity, or persistence. The plan was documented at `/Users/ao/.claude/plans/resilient-dazzling-frost.md`.
</original_task>

<work_completed>

## Phase 1: Database Persistence (Completed in prior session)
- Created `migrations/020_story_sessions.sql` - SQLite tables for story_sessions and story_turns
- Created `src/database/story-repository.js` - Repository pattern for session CRUD operations
- Modified `src/server.js` to initialize repository and inject into writer module
- Modified `src/writer/index.js` to export `initWithRepository`

## Phase 2: Signal Extraction (Completed)
- Created `src/writer/signal-extractor.js`:
  - `extractStorySignals()` - LLM-powered multi-element extraction from single answers
  - `extractWithHeuristics()` - Keyword-based fallback using model anchorWords
  - `isVagueAnswer()` - Detects "I don't know", "not sure", etc.
  - `mergeSignals()` - Combines extracted content with existing elements
  - `parseExtractionResult()` - Handles LLM JSON response parsing
  - `buildAnchorObjects()` - Creates anchor objects with context for follow-ups

## Phase 3: Element Quality Assessment (Completed)
- Created `src/writer/element-quality.js`:
  - `assessElementQuality(content, elementId)` - Returns `{ filled, score: 0-1, issues[] }`
  - `hasElement(storyContext, elementId)` - Replaces simple `length > 10` check
  - `findWeakElements(storyContext, elementIds)` - Identifies low-quality elements
  - `assessAllElements()` - Batch assessment
  - `GENERIC_PHRASES` - List of vague phrases to detect
  - `SPECIFICITY_MARKERS` - Regex patterns for time, place, sensory details

## Phase 4: Completion Logic Fix (Completed)
- Updated all 3 story models to not force-complete at MAX_QUESTIONS without adequate content
- Added `hasAdequateContent` check: `minRequiredFilled >= minRequiredCount - 1`
- Added `weakElements` array to completion response for UI feedback

## Phase 5: Anchor Follow-up Fixes (Completed)
- Fixed `src/writer/question-generator.js:37-50`:
  - Changed from `shift()` to peek `[0]` first
  - Only remove anchor after successful follow-up generation (peek-before-consume pattern)
- Fixed anchor extraction in all models to use word boundaries: `new RegExp(\`\\b${word}\\b\`, "i")`

## Phase 6: addMoreDetails Routing (Completed)
- Updated `src/writer/story-engine.js` `addMoreDetails()` to use signal extraction
- Routes additional details to proper elements instead of generic "additional" bucket

## Phase 7: Relationship Element (Completed)
- Added `relationship` element to all 3 story models (love, gratitude, celebration)
- Marked as `optional: true` with priority 6
- Added to PRIORITY_ORDER but NOT to MINIMUM_REQUIRED

## Phase 8: Initial Prompt Analysis (Completed)
- Made `analyzeInitialPrompt()` async
- Uses signal extraction instead of simple keyword matching
- Uses `assessElementQuality` instead of prompt length gating

## Code Simplification (Completed)
- Created `src/writer/story-models/base.js` with factory functions:
  - `createFindGaps({ STORY_ELEMENTS, PRIORITY_ORDER })`
  - `createIsStoryComplete({ MINIMUM_REQUIRED, PRIORITY_ORDER, MAX_QUESTIONS })`
  - `createAnchorExtractor(indicatorGroups)`
- Updated all 3 story models to use factories:
  - `src/writer/story-models/love.js` - Now ~100 lines (was ~320)
  - `src/writer/story-models/gratitude.js` - Now ~100 lines (was ~270)
  - `src/writer/story-models/celebration.js` - Now ~100 lines (was ~270)
- Total reduction: ~150 lines of duplicated code removed

## Test Coverage (Completed)
- Created `test/writer/element-quality.test.js` - 22 tests
- Created `test/writer/signal-extractor.test.js` - 23 tests
- All 192 project tests passing

## Bug Fixes from Researcher Review (Completed)
- Fixed session ID round-trip: `story-repository.js` now uses `params.id` if provided
- Fixed anchor `followUp` boolean vs string: Validates type before using as question
- Fixed element mapping: Preserves `element` and `sourceElement` in anchor objects
- Fixed initial prompt gating: Uses `assessElementQuality` instead of `length > 30`

## Commits Created
```
e4e8710 chore: lint fixes and remove unused variables
fe90ef5 fix(writer): resolve session round-trip and anchor mapping issues
d356731 refactor(writer): extract shared story model logic to base module
f7799ff feat(writer): harden story module with persistence and quality scoring
```

</work_completed>

<work_remaining>

The story module hardening is **complete**. All 8 phases from the plan have been implemented, tested, reviewed, and committed.

### Potential Future Improvements (Not Required)
1. **PostgreSQL migration** - Currently SQLite only; production may need PostgreSQL version of `020_story_sessions.sql`
2. **Story session cleanup job** - `cleanupOldSessions()` exists but no cron/scheduled invocation
3. **Additional test coverage** - Could add integration tests for full story flow
4. **Inaudible audio watermarking** - Mentioned in CLAUDE.md as TODO

</work_remaining>

<attempted_approaches>

## Edit String Mismatches
- When editing `addMoreDetails()`, grep output showed "/" but actual file had "// TODO"
- Solution: Read actual file content first before constructing edit strings

## Test Runner Glob Issue
- `npm test -- test/writer/` failed with "MODULE_NOT_FOUND" for directory
- Solution: Use `test/writer/*.test.js` glob pattern instead

## Signal Extractor Anchor Shape
- Initial implementation dropped `sourceElement` when building anchor objects
- Researcher caught this in review
- Fixed by preserving both `element` and `sourceElement` fields

</attempted_approaches>

<critical_context>

## Architecture Decisions
- **Factory pattern for story models**: Each model declares WHAT (elements, priorities, indicators), base.js provides HOW (gap-finding, completion logic, anchor extraction)
- **Peek-before-consume for anchors**: Prevents data loss when follow-up generation fails
- **Quality scoring over length**: `assessElementQuality` checks specificity markers, not just character count
- **LLM with heuristic fallback**: Signal extraction tries LLM first, falls back to keyword matching

## Key Files
| File | Purpose |
|------|---------|
| `src/writer/story-engine.js` | Main orchestrator - startStory, continueStory, confirmStory |
| `src/writer/story-models/base.js` | Factory functions for shared logic |
| `src/writer/story-models/{love,gratitude,celebration}.js` | Arc-specific element definitions |
| `src/writer/element-quality.js` | Quality scoring for story elements |
| `src/writer/signal-extractor.js` | Multi-element extraction from answers |
| `src/writer/question-generator.js` | Next question selection and generation |
| `src/database/story-repository.js` | SQLite persistence layer |

## Story Session States
```
active → ready_for_confirm → confirmed
```

## Element Quality Thresholds
- `score >= 0.4` and `issues.length === 0` = filled
- `score < 0.6` = weak (could benefit from more detail)
- Generic phrases like "I don't know" are rejected regardless of length

## Testing
- Tests use Node's built-in test runner (`node:test`, `node:assert`)
- 12 tests skip due to PostgreSQL/LocalStack not available in test env
- Story module tests in `test/writer/`

</critical_context>

<current_state>

## Status: COMPLETE
- All 8 phases implemented
- All tests passing (192/192, 12 skipped)
- Code reviewed by code-simplifier and code-reviewer agents
- All critical/high issues from researcher review addressed
- 4 commits pushed to main branch

## Git State
- Branch: `main`
- Clean working directory (no uncommitted changes)
- Latest commit: `e4e8710 chore: lint fixes and remove unused variables`

## No Open Questions
- All implementation decisions finalized
- All reviewer feedback addressed
- Ready for production deployment (pending PostgreSQL migration if needed)

</current_state>

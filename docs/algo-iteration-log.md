# Story Algorithm — Iteration Log

## Iteration 0: Baseline (pre-algo changes)
- Story never completed after 3+ rounds
- Repeated questions (ice cream asked twice)
- Clinical tone ("your story lacks...")
- No progress visibility

## Iteration 1: Algo implementation (Steps 1A-1D)
- Labov 6-element scoring engine
- Fact tracking + anti-repetition
- Info-gain question targeting
- Tone rewrite + verbatim quotes
- **Result:** Rich stories score 0.88 and mark Ready in 1 round

## Iteration 2: Autoresearch baseline + hot-reload
- Baseline: 63% (19/30 evals pass)
- Best after prompt mutations: 73% (22/30)
- Hot-reload enabled for prompt mutations

### Eval breakdown (best round):
| Eval | Score | Root Cause |
|------|-------|------------|
| Narrative mentions name | 5/5 (100%) | Solved |
| Narrative emotional core | 4/5 (80%) | Prompt-level — mostly working |
| Question builds on input | 4/5 (80%) | Prompt-level — mostly working |
| Question is answerable | 4/5 (80%) | Prompt-level — mostly working |
| Question targets weakest | 3/5 (60%) | **CODE: targeting injection not strong enough** |
| Suggestions story-specific | 2/5 (40%) | **CODE: suggestions generated generically by LLM** |

---

## Iteration 3: Code fixes (in progress)

### Fix 1: Suggestions must be story-specific (2/5 → target 5/5)

**Root cause:** The writer prompt asks the LLM to generate suggestions, but the LLM defaults to generic templates ("I wanted to make it unforgettable", "The surprise party we planned"). The suggestions have zero connection to the user's story.

**Code fix:** Generate suggestions DIRECTLY from the extracted facts and story content in the code, not by the LLM. Extract key nouns/phrases from the user's message and build suggestions from them.

**Where:** `src/writer/v3/index.js` — after the LLM response, post-process suggestions to be story-specific. OR add a `generateStorySpecificSuggestions(state)` function.

### Fix 2: Question targeting needs enforcement (3/5 → target 5/5)

**Root cause:** The `{{question_targeting}}` injection tells the LLM which element to target, but the LLM often ignores it and asks a generic question. The targeting is advisory, not enforced.

**Code fix:** `validateQuestionRelevance()` + `generateTargetedFallbackQuestion()` — when the LLM's question doesn't match the target element (detected by regex keyword matching), replace it with a deterministic story-specific question from a 24-template matrix (4 elements × 3 funnel stages × 2 variants). Uses `extractAnchor()` to pull the most salient detail from the user's message as the question's grounding.

**Files:** `src/writer/v3/quality.js` (3 new functions), `src/writer/v3/index.js` (wiring in `resolveTurnDecision`)

### Code Fixes Applied:
1. `generateStorySpecificSuggestions()` — extracts proper nouns, activities, time/place references from user's message; builds 3 suggestions under 8 words; falls back to occasion-aware templates
2. `generateTargetedFallbackQuestion()` — 24-template matrix grounded in user's anchor phrase
3. `validateQuestionRelevance()` — regex keyword matching per Labov element type
4. `extractAnchor()` — priority cascade: proper nouns → descriptive phrases → action phrases → content words
5. `buildResponseSuggestions()` — now calls story-specific generator before LLM suggestions
6. Prompt hot-reload — `builder.js` reloads templates from disk in dev mode

### Quick test result:
Input: "My dad taught me everything about fishing. We used to go every Saturday morning."
- Before: Suggestions = ["I wanted to make it unforgettable", "They just wanted everyone together"] (GENERIC)
- After: Suggestions = ["What Dad said while fishing", "The every Saturday that stands out most", "A moment only you and Dad share"] (STORY-SPECIFIC)

### Autoresearch Iteration 3: Measuring code fix impact (in progress)
- Previous baseline: 63% (19/30)
- Previous best: 73% (22/30) 
- New run with code fixes: pending...

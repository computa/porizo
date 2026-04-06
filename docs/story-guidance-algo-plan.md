# Plan: Story Guidance Algorithm Improvement (v2 — post-review)

## Context

The story guidance algorithm is the #1 UX blocker. Full research: `docs/story-guidance-algo-research.md`. Flow audit: `docs/story-guidance-ux-audit.md`. Council: `docs/council/council-report-20260404.html`.

---

## Sequence

```
Step 1: Implement algo changes (the engine) — behind feature flag
Step 2: Expose debug APIs
Step 3: Build thin debug page (test harness)
Step 4: Run autoresearch to optimize prompts
```

---

## Architecture Decision: Labov Is Internal Only

**The iOS API contract MUST NOT change.** The 5 display elements (`setting`, `feeling`, `bond`, `moment`, `details`) and 8 slot IDs remain the external vocabulary. Labov scoring is the new internal evaluation model, mapped back to client-facing IDs before serialization.

**Mapping:**

| Labov Element | Maps to Display Element | Maps to Slot(s) |
|---------------|------------------------|-----------------|
| Orientation | The Setting | `moment_destination`, `who` |
| Complicating Action | The Moment | `blocker`, `stakes` |
| Evaluation | The Feeling | `want`, `ending_feel` |
| Resolution | Your Bond | `turn` |
| Specificity bonus | The Details | `tone` (repurposed) |

The mapping layer sits in `computeStoryElements()` — it receives Labov scores internally, outputs the existing 5-element structure for the iOS client. Zero client changes needed.

---

## Feature Flag: `labov_scoring`

Use existing `getFeatureFlag()` service. New sessions get Labov scoring. Existing in-progress sessions keep legacy 8-slot scoring until they complete. No migration of in-progress state needed.

```javascript
const useLabov = await getFeatureFlag('labov_scoring', { userId, default: true });
```

**Rollback:** Set flag to `false` → all sessions use legacy scoring. Zero code revert needed.

---

## Step 1: Implement the 4 Core Algo Changes

### 1A. Labov 6-element evaluation (internal, behind flag)

**Files:**
- `src/writer/v3/quality.js` — Add `computeLabovGapAnalysis()` alongside existing `computeStoryGapAnalysis()` (don't delete the old one)
- `src/writer/v3/quality.js` — Update `computeStoryElements()` mapping layer
- `src/writer/v3/index.js` — Branch on feature flag: `useLabov ? computeLabovGapAnalysis() : computeStoryGapAnalysis()`

**Labov scoring (deterministic — no LLM calls):**

| Element | Weight | Detection (pattern-matching against atoms/primitives/facts) |
|---------|--------|-------------------------------------------------------------|
| Orientation | 0.20 | `atoms.who` + `atoms.where` or `atoms.when` + relationship regex |
| Complicating Action | 0.25 | Past-tense action verbs, sequential events, `primitives.conflict` |
| Evaluation | 0.35 | Subjective/emotional language, intensifiers, `atoms.after`, `primitives.resolution` |
| Resolution | 0.10 | Temporal conclusion markers, change/result in corpus |
| Coda | 0.05 | Present-tense shift, dedication language |
| Specificity bonus | 0.05 | Proper nouns, concrete nouns, sensory words, quoted dialogue |

**Ready threshold:** weighted score >= 0.60 (lowered from effective ~0.72 to account for optional elements)

**Occasion-aware adjustment:** For tribute/memorial occasions, de-weight Resolution to 0.05 and redistribute to Evaluation (0.40). This replaces the dual Dramatic/Reflective profiles with a single threshold that adapts.

**"Good enough" escape:** After turn 2, set `can_proceed_anyway: true` in the response regardless of score. The iOS client shows "Create Song" as primary action. The AI can still suggest more detail, but never blocks.

**Semantic integrity reconciliation:** Update `ensureSemanticStoryIntegrity()` in `src/writer/story-semantics.js` to accept Labov scores. When Labov Evaluation >= 0.6, treat the `meaning` semantic block as satisfied. When Labov Complicating Action >= 0.6, treat `conflict` + `turn` as satisfied.

### 1B. Fact tracking (anti-repetition)

**Files:**
- `src/writer/v3/index.js` — Add `extractStoryState()` after each round, stored in `state.story_state`
- `src/writer/v3/prompts/builder.js` — Add `{{already_known}}` and `{{already_asked}}` template variables
- `src/writer/v3/prompts/reason-v3.md` — Add `ALREADY KNOWN` and `ALREADY ASKED` sections
- `src/writer/v3/prompts/reason-v3-selection.md` — Add anti-repetition instructions

**How it relates to existing `state.facts`:** The new `story_state` is a derived view — computed from `state.facts` + `state.conversation` each round, not a parallel tracking system. It's a structured summary that gets injected into prompts. `state.facts` remains the source of truth.

**Prompt budget:** Cap at 10 known facts + 5 asked questions in the injection. Use existing `buildPromptWithinBudget()` compaction for overflow.

**Schema:**
```json
{
  "labov": { "orientation": { "strength": 0.8, "key_facts": ["best friends since college"] }, ... },
  "sensory_details": ["mint chocolate chip", "Dancing Queen"],
  "questions_asked": [{ "round": 1, "question": "...", "element": "complicating_action", "answered": true }]
}
```

### 1C. Information-gain question selection + funnel staging

**Files:**
- `src/writer/v3/quality.js` — Add `computeQuestionPriority()` and `getQuestionStage()`
- `src/writer/v3/index.js` — Replace slot targeting with priority-based + stage-aware targeting
- `src/writer/v3/prompts/builder.js` — New `{{question_targeting}}` variable replacing `{{gap_targeting}}`

**Priority formula:**
```
priority(element) = element.weight × (1 - element.strength)
target = argmax(priority) across elements with strength < 0.6
```

**Funnel stage (based on turn_count):**
- Turn 1: OPEN questions — "Tell me about a special moment with [recipient]"
- Turn 2: PROBING questions — build on specifics they mentioned
- Turn 3+: CLOSED questions — specific detail extraction

**Emotion-sensitive override:** Extract `emotional_intensity` (low/medium/high) during fact extraction. When high (vulnerability markers, first-person emotional language, intensifiers), override priority to deepen the current emotional thread (target Evaluation) regardless of which element scores highest.

**Injection format:**
```
QUESTION TARGET: Evaluation (emotional meaning) — highest priority
QUESTION STAGE: PROBING (turn 2 — build on their specifics)
EMOTIONAL INTENSITY: high → deepen this thread

The user just said: "[their last message]"
Build your question on something THEY said.

ALREADY KNOWN: [facts list]
ALREADY ASKED: [questions list]
```

### 1D. Tone rewrite + FROM YOUR STORY fix

**Files:**
- `src/writer/v3/prompts/reason-v3.md` — Rewrite tone section, add Yes-And rules
- `src/writer/v3/prompts/reason-v3-selection.md` — Tone-aware selection
- `src/writer/v3/guidance.js` — Rewrite `buildGuidancePrompt()` tone, fix `story_anchor` to use verbatim quotes from `state.facts` instead of LLM-regenerated paraphrases

**Tone rules (injected into all prompts):**
```
1. Reference something SPECIFIC from the user's last message
2. BANNED words: "lacks", "missing", "insufficient", "needs", "doesn't explain"
3. ONE question per response. Never two.
4. Pattern: Validate → Ask → Encourage
5. You are an excited friend helping make a gift, not a professor
6. Frame as curiosity: "Help me picture..." / "I'm curious..."
7. Gift-giver framing: "Tell me about [recipient]" not "Tell me your story"
```

**FROM YOUR STORY fix:** In `guidance.js`, change `story_anchor` generation to select the closest verbatim substring from `state.facts[].content` instead of asking the LLM to generate a quote. This eliminates the broken-grammar problem ("Sarah dance in the park").

---

## Step 2: Debug APIs

**File:** `src/routes/story.js` — Add routes gated on `process.env.NODE_ENV === 'development'`

**`GET /debug/story/:id/state`**
Returns: Labov scores, fact inventory, questions asked, completeness score, feature flag status

**`POST /debug/story/simulate`**
Accepts: `{ message, occasion, recipient_name, prior_state? }`
Returns: AI response, Labov scores, question targeting rationale, ready status
Supports multi-round: pass `prior_state` from previous simulate response
Rate-limited: max 12 calls/minute (matches existing debug cap)

**`GET /debug/story/:id/transcript`**
Returns: Full conversation with per-round Labov scores and targeting decisions

---

## Step 3: Debug Page

**File:** `src/public/debug-story.html` (new, single self-contained HTML file)

- Text input + occasion selector + Send button
- Calls `/debug/story/simulate` API
- Displays: AI response, Labov element score bars, fact inventory, targeting rationale
- Multi-round: maintains state, shows progression
- Pure scaffolding — delete when done, zero impact on product

---

## Step 4: Autoresearch

Install autoresearch skill. Define evals against debug API:

**Test inputs:** 5 scenarios (birthday, anniversary, memorial, thank-you, friendship)

**Binary evals:**
1. Ready within 3 rounds?
2. Follow-up references something specific user said?
3. Free of banned words (lacks/missing/insufficient)?
4. Validates before asking?
5. Round 2+ avoids re-asking round 1 topics?
6. Question matches funnel stage (open/probing/closed)?

**Target prompts:** `reason-v3.md`, `reason-v3-selection.md`

---

## Files to Modify (Complete)

| File | Change |
|------|--------|
| `src/writer/v3/quality.js` | Add `computeLabovGapAnalysis()`, `computeQuestionPriority()`, `getQuestionStage()`. Update `computeStoryElements()` mapping. Keep legacy functions. |
| `src/writer/v3/index.js` | Feature flag branch. Add `extractStoryState()`. Wire Labov scoring + fact tracking + priority targeting. |
| `src/writer/v3/prompts/builder.js` | Add `{{already_known}}`, `{{already_asked}}`, `{{question_targeting}}` template variables with budget caps. |
| `src/writer/v3/prompts/reason-v3.md` | Labov targeting section. Tone rewrite. Yes-And + funnel stage rules. |
| `src/writer/v3/prompts/reason-v3-selection.md` | Anti-repetition instructions. Tone rules. |
| `src/writer/v3/prompts/reason-v3-editor.md` | Align block vocabulary with Labov mapping. |
| `src/writer/story-semantics.js` | Reconcile semantic blocks with Labov scores. Accept Labov evaluation as `meaning` satisfaction. |
| `src/writer/v3/guidance.js` | Tone rewrite. Fix `story_anchor` to use verbatim quotes. |
| `src/routes/story.js` | Add debug endpoints (dev-gated). Add `can_proceed_anyway` flag after turn 2. |
| `src/public/debug-story.html` | New — debug page (temporary scaffolding). |

---

## Rollback Plan

1. **Feature flag:** Set `labov_scoring` to `false` → all sessions use legacy 8-slot scoring
2. **Prompt revert:** `git checkout` the 3 prompt files to pre-change versions
3. **No data migration needed:** Labov state is derived (not stored separately), legacy state untouched

---

## Verification

| Step | Verification |
|------|-------------|
| 1A | Sarah birthday test: completes within 3 rounds. Memorial tribute test: completes without blocker/stakes. |
| 1B | Round 2 never re-asks round 1 topics. "mint chocolate chip" test. |
| 1C | Questions build on user's last message. Turn 1 = open, Turn 2 = probing. |
| 1D | Zero instances of "lacks/missing/insufficient". FROM YOUR STORY shows correct grammar. |
| 2 | `curl` debug APIs, verify JSON schema. |
| 3 | Debug page renders, multi-round works. |
| 4 | Autoresearch dashboard shows improving pass rate. |

---

## NOT in scope (future work)

- Story Elements progress indicator UI (needs design brainstorm)
- Post-preview enrichment (council suggestion)
- iOS client changes (none needed — API contract preserved)
- Lyrics generation prompt improvements (separate workstream)
- Test file updates in `test/writer/v3/` (will update as we implement)

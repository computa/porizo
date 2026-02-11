# Porizo Story Engine V3 Specification

## 1. Document Control

- Version: 0.1.0
- Date: 2026-02-10
- Status: Draft for implementation on branch `newStory`
- Scope: Backend story collection and story-to-lyrics preparation pipeline
- Primary objective: Replace generic questions with deterministic gap-targeted questioning while preserving V2 production resilience

## 2. Problem Statement

Current V2 behavior asks generic follow-up questions too often, which causes:

1. weak story specificity,
2. unstable progression to confirmation,
3. mismatch between user intent and generated outputs,
4. higher perceived quality variance.

The desired behavior is a stateful loop:

`extract patch -> update state -> deterministic gap analysis -> ask one highest-value gap question -> repeat -> write story when gates pass`.

## 3. Product Intent and Rules

### 3.1 Non-negotiable rules

1. Never write the full story until blocker/conflict and stakes are sufficiently captured.
2. Never ask generic prompts like "tell me more" when a concrete gap can be asked.
3. Ask exactly one question per turn.
4. Every question must map to a specific gap slot and include `target_slot` metadata.
5. Every turn must carry machine-auditable progress fields (`missing_slots`, `readiness_score`, `gap_reason`).

### 3.2 User-visible outcomes

After V3 phase 1:

1. questions are noticeably more specific,
2. conversation advances in a deterministic order when critical slots are missing,
3. readiness and missing slots are inspectable from API responses,
4. story confirmation quality improves without reducing safety.

## 4. Architecture Strategy

V3 is an **evolution of existing V2**, not a greenfield rewrite.

### 4.1 Keep (existing V2 strengths)

1. Session persistence and ownership flow.
2. Retry/fallback chain in reasoner (`primary -> lightweight -> heuristic`).
3. Grounding checks and moderation pipeline.
4. Existing routes and mobile API contracts.

### 4.2 Add (V3 behavior layer)

1. Deterministic slot coverage model.
2. Deterministic gap analyzer.
3. Deterministic question picker with quick replies.
4. Turn metadata for traceability.
5. Readiness gates before full story write stages.

## 5. V3 Data Model Additions

## 5.1 StoryState additions

Add the following non-breaking fields to V2 session state object:

- `story_slots`: object keyed by slot id with status summary.
- `current_gap`: currently targeted slot id.
- `gap_history`: append-only array of asked slot decisions.
- `readiness`: object with score and gating flags.
- `selected_style`: explicit style chosen by user (for later style fidelity wiring).

### 5.1.1 Canonical slot ids

1. `moment_destination`
2. `who`
3. `want`
4. `blocker`
5. `stakes`
6. `turn`
7. `ending_feel`
8. `tone`

## 5.2 Gap slot status shape

```json
{
  "slot": "stakes",
  "status": "missing",
  "confidence": 0.18,
  "reason": "No explicit consequence if protagonist fails.",
  "evidence": []
}
```

## 5.3 Turn metadata shape

```json
{
  "target_slot": "stakes",
  "gap_reason": "Missing consequence severity",
  "missing_slots": ["stakes", "turn", "ending_feel"],
  "weak_slots": ["blocker"],
  "readiness_score": 0.46,
  "is_story_ready": false
}
```

## 6. Deterministic Gap Analysis Design

## 6.1 Slot order and priority

Fixed priority chain (from product discussion):

1. `moment_destination`
2. `who`
3. `want`
4. `blocker`
5. `stakes`
6. `turn`
7. `ending_feel`
8. `tone`

## 6.2 Coverage heuristics (phase 1)

Coverage is derived from existing state fields (`atoms`, `primitives`, `facts`, `dials`, `beats`) with deterministic checks.

### 6.2.1 Slot heuristics

1. `moment_destination`
- Covered: location and temporal context exist, plus one concrete moment/action detail.
- Weak: location or time exists but no concrete moment detail.
- Missing: no location/time context.

2. `who`
- Covered: `atoms.who` or `primitives.characters` has content.
- Weak: recipient known but relationship role detail absent.
- Missing: no identifiable subject.

3. `want`
- Covered: explicit desire/goal in primitives or strong desire phrasing in facts.
- Weak: implied desire but not explicit.
- Missing: no clear protagonist goal.

4. `blocker`
- Covered: internal or external conflict present.
- Weak: vague friction only.
- Missing: no defined obstacle.

5. `stakes`
- Covered: explicit loss/risk consequence present.
- Weak: emotional importance implied but no concrete loss.
- Missing: no consequence if failure occurs.

6. `turn`
- Covered: turning point captured.
- Weak: progression exists but no decisive shift.
- Missing: no pivot/change moment.

7. `ending_feel`
- Covered: desired ending emotional effect stated.
- Weak: outcome text exists but emotional framing unclear.
- Missing: no ending affect.

8. `tone`
- Covered: tonal direction exists (`dials.tone` or explicit equivalent).
- Weak: broad mood language only.
- Missing: no tonal guidance.

## 6.3 Readiness score and gates

- Score: weighted deterministic average of slot confidences.
- Mandatory gates before story-ready:
  1. `blocker` covered,
  2. `stakes` covered,
  3. at least 5/8 slots covered,
  4. no active safety block.

`is_story_ready = gates_passed && readiness_score >= 0.72`

## 7. Deterministic Question Picker

## 7.1 Question selection algorithm

1. compute current slot statuses,
2. choose first `missing` slot by priority,
3. if none missing, choose first `weak` slot by priority,
4. if neither, allow confirmation path.

## 7.2 Question output contract

```json
{
  "target_slot": "blocker",
  "prompt": "What is the main thing stopping this from going smoothly?",
  "quick_replies": [
    "A person",
    "A rule",
    "A fear",
    "A secret",
    "Time pressure"
  ],
  "input_mode": "single_choice_or_text",
  "reason": "Blocker slot is missing"
}
```

## 7.3 UX rule

Always include quick replies plus optional free text. Do not emit multiple questions.

## 8. API Surface Changes (Backward Compatible)

Add optional fields to story responses (`/story/start`, `/story/:id/continue`):

- `target_slot`
- `gap_reason`
- `missing_slots`
- `weak_slots`
- `readiness_score`

No existing field removals.

## 9. Agent-Oriented Build Process (Requested Multi-Agent Design)

This section defines the internal orchestration pattern for robust implementation.

## 9.1 Planning Agent JSON contract

### Input

```json
{
  "task_id": "story-v3-phase-1",
  "repo": "porizo",
  "objective": "deterministic gap-driven story questioning",
  "constraints": {
    "preserve_v2_resilience": true,
    "backward_compatible_api": true
  }
}
```

### Output

```json
{
  "architecture": {
    "new_modules": ["gap_analysis", "question_strategy"],
    "modified_modules": ["writer/v2/index", "writer/v2/quality", "writer/v2/engine"],
    "api_changes": ["optional response metadata"]
  },
  "milestones": [
    {"id": "M1", "name": "gap model"},
    {"id": "M2", "name": "question picker"},
    {"id": "M3", "name": "route integration"},
    {"id": "M4", "name": "tests"}
  ]
}
```

## 9.2 Backend Coding Agent contract

### Input

```json
{
  "milestone": "M2",
  "design_refs": ["specv3.md#6", "specv3.md#7"],
  "target_files": [
    "src/writer/v2/quality.js",
    "src/writer/v2/index.js",
    "test/writer/v2/*.test.js"
  ]
}
```

### Output

```json
{
  "files_changed": ["..."],
  "tests_added": ["..."],
  "known_risks": ["..."],
  "status": "implemented"
}
```

## 9.3 Debugging Agent contract (HTTP feedback loop)

### Request plan JSON

```json
{
  "checks": [
    {
      "name": "start_story_returns_target_slot",
      "method": "POST",
      "url": "/story/start",
      "expect": {
        "status": 200,
        "json_has": ["story_id", "first_question", "target_slot", "missing_slots", "readiness_score"]
      }
    },
    {
      "name": "continue_story_updates_gap",
      "method": "POST",
      "url": "/story/{story_id}/continue",
      "expect": {
        "status": 200,
        "json_has_any": ["next_question", "complete"],
        "json_has": ["readiness_score"]
      }
    }
  ]
}
```

### Feedback JSON

```json
{
  "check": "continue_story_updates_gap",
  "passed": false,
  "failure": {
    "type": "contract_mismatch",
    "detail": "missing target_slot",
    "response_excerpt": {"complete": false, "next_question": "..."}
  }
}
```

## 9.4 Information-Gathering Agent contract

Goal: mine real repositories for robust state-machine and slot-filling patterns.

```json
{
  "sources": [
    {"repo": "langchain-ai/langgraph", "focus": ["state graphs", "checkpointing"]},
    {"repo": "microsoft/semantic-kernel", "focus": ["orchestration", "evaluation loops"]}
  ],
  "extract": {
    "patterns": ["retry topology", "state snapshotting", "question-selection strategy"],
    "anti_patterns": ["non-deterministic progression", "opaque scoring"]
  },
  "output_format": "normalized_pattern_json"
}
```

## 9.5 Trajectory Agent contract

Goal: reproduce representative implementations from extracted plans for training trajectories.

```json
{
  "input": {
    "pattern_pack": "normalized_pattern_json",
    "target_problem": "slot-driven story collection"
  },
  "output": {
    "artifacts": ["commit_sequence", "tests", "validation_logs"],
    "quality_gates": ["lint", "tests", "api-contract-checks"]
  }
}
```

## 10. Implementation Boundaries

## 10.1 In scope for immediate implementation

1. Deterministic gap analysis functions.
2. Deterministic question picker integration.
3. Response metadata propagation.
4. Unit and orchestration tests.

## 10.2 Deferred

1. Full story artifact pipeline rewrite.
2. External orchestration framework migration (LangGraph runtime).
3. Training trajectory generation infrastructure.

## 11. Telemetry and Observability

Emit per-turn metrics:

1. `story_gap_target_slot`
2. `story_readiness_score`
3. `story_missing_slot_count`
4. `story_question_source` (`deterministic_gap` vs `llm` vs `heuristic`)
5. `story_confirmation_gate_failures`

## 12. Safety and Compliance

1. Keep existing moderation checks on start/continue/confirm/add-details.
2. Add question-generation guard: avoid asking for exact personal identifiers.
3. On sensitive content, mark safety blocked and force safe rephrase path.

## 13. Testing Requirements

## 13.1 Unit

1. Slot coverage classifier test per slot state (`missing/weak/covered`).
2. Deterministic question order test.
3. Readiness gate test (must fail without blocker/stakes).

## 13.2 Integration

1. `/story/start` returns deterministic `target_slot`.
2. `/story/:id/continue` updates readiness and slot metadata.
3. Confirmation cannot trigger while blocker/stakes missing.

## 13.3 Regression

1. Existing V2 fallback tests remain green.
2. Existing route payload shape remains backward compatible.

## 14. Rollout

1. Phase flag: `storyV3GapQuestions` (default enabled in dev, guarded in prod rollout).
2. Shadow logging mode first (compute gaps but do not override question) optional for validation.
3. Full enable once API contract checks pass.

## 15. Acceptance Criteria

1. In 100 sampled story turns, generic questions decrease significantly and each asks a concrete gap.
2. Every non-complete response includes `target_slot` and `readiness_score`.
3. Story-ready is never true when blocker or stakes are missing.
4. Existing tests pass and new deterministic gap tests pass.

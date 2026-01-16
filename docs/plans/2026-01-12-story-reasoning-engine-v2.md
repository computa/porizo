# Story Reasoning Engine V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an intelligent, thinking story collection system that reasons holistically about each user input — understanding what was said, what the story needs, and what to ask next — without hardcoded rules or fabrication.

**Architecture:** Single unified reasoning call per turn (not a pipeline). The LLM perceives, reasons, and acts in one prompt. State tracks: event understanding, grounded facts, evolving narrative, dynamic beats, user model, and reasoning trace.

**Tech Stack:** Node.js, SQLite (sql.js), Anthropic Claude (same model as lyrics), node:test

**Key Design Decisions:**
- Confirmation UX: Show narrative + "Does this capture your story?"
- Debug Mode: Reasoning trace in logs only (not in app)
- Minimum Story: scene + stakes + turning_point + meaning
- Model: Same as lyrics (Claude Sonnet), evaluate cost later

---

## Checkpoints

| Checkpoint | After Task | Review Gate |
|------------|------------|-------------|
| CP1 | Task 3 | `auto-pr-review` — Foundation complete (migration + module structure) |
| CP2 | Task 8 | `auto-pr-review` — Reasoner complete (prompt + parser + tests) |
| CP3 | Task 12 | `auto-pr-review` — State manager complete |
| CP4 | Task 17 | `auto-pr-review` — Engine complete (full reasoning loop) |
| CP5 | Task 21 | `auto-pr-review` — API wired up with feature flag |
| FINAL | Task 22 | `/review` — Full implementation review before merge |

---

## Task 1: Create Migration for V2 Columns

**Files:**
- Create: `migrations/021_add_story_engine_v2.sql`

**Step 1.1: Write the migration file**

```sql
-- Story Engine V2: Add engine versioning and V2 state storage
-- Enables running V1 and V2 side-by-side with clean separation

-- Add engine version column (v1 = legacy, v2 = reasoning engine)
ALTER TABLE story_sessions ADD COLUMN engine_version TEXT DEFAULT 'v1';

-- Add V2 state JSON column (only populated for v2 sessions)
-- Contains: event, facts, narrative, beats, user_model, last_reasoning
ALTER TABLE story_sessions ADD COLUMN v2_state_json TEXT;

-- Index for filtering by engine version (useful for analytics)
CREATE INDEX idx_story_sessions_engine_version ON story_sessions(engine_version);
```

**Step 1.2: Verify migration syntax**

Run: `cat migrations/021_add_story_engine_v2.sql`
Expected: File contents displayed without syntax errors

**Step 1.3: Test migration applies cleanly**

Run: `npm test -- --test-name-pattern="migration"`
Expected: Migration tests pass (or no migration tests exist yet — that's OK)

**Step 1.4: Commit**

```bash
git add migrations/021_add_story_engine_v2.sql
git commit -m "feat(db): add engine_version and v2_state_json columns for story engine v2"
```

---

## Task 2: Create V2 Module Directory Structure

**Files:**
- Create: `src/writer/v2/index.js`
- Create: `src/writer/v2/prompts/.gitkeep`
- Create: `test/writer/v2/.gitkeep`

**Step 2.1: Create directory structure**

```bash
mkdir -p src/writer/v2/prompts
mkdir -p test/writer/v2
```

**Step 2.2: Create V2 index with placeholder exports**

```javascript
/**
 * Story Reasoning Engine V2
 *
 * An intelligent, thinking story collection system that reasons holistically
 * about each user input. Uses a single unified LLM call per turn instead of
 * a pipeline of specialized extractors.
 *
 * Key differences from V1:
 * - Dynamic beat schemas (not hardcoded arcs)
 * - Single evolving narrative (not element fragments)
 * - Unified reasoning (not extract → integrate → evaluate → select)
 * - User model detection (brief/verbose, emotional/analytical)
 * - Fatigue detection (know when to stop)
 *
 * @module writer/v2
 */

// Placeholder exports - will be implemented in subsequent tasks
module.exports = {
  // Core engine
  startStoryV2: async () => { throw new Error("Not implemented"); },
  continueStoryV2: async () => { throw new Error("Not implemented"); },
  getStoryContextV2: async () => { throw new Error("Not implemented"); },

  // Constants
  ENGINE_VERSION: "v2",

  // For testing
  __internal: {},
};
```

**Step 2.3: Create .gitkeep files**

```bash
touch src/writer/v2/prompts/.gitkeep
touch test/writer/v2/.gitkeep
```

**Step 2.4: Commit**

```bash
git add src/writer/v2/ test/writer/v2/
git commit -m "feat(writer): create v2 module structure for story reasoning engine"
```

---

## Task 3: Update Story Repository for V2 Columns

**Files:**
- Modify: `src/database/story-repository.js`

**Step 3.1: Write failing test for V2 column support**

Create: `test/writer/v2/repository-v2.test.js`

```javascript
/**
 * Story Repository V2 Tests
 * Tests for engine_version and v2_state_json column support
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { initDb } = require("../../../src/db");

describe("Story Repository V2 Support", () => {
  let db, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-repo-v2-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = await initDb({
      dbPath,
      migrationsDir: path.join(__dirname, "../../../migrations"),
    });
  });

  after(async () => {
    if (db && db.close) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create session with engine_version v2", async () => {
    const storyRepo = require("../../../src/database/story-repository");
    storyRepo.initialize(db);

    const session = await storyRepo.createSession({
      userId: "test-user-v2",
      arc: "celebration",
      recipientName: "Test Recipient",
      initialPrompt: "Test story about twins",
      engineVersion: "v2",
    });

    assert.strictEqual(session.engineVersion, "v2");
  });

  it("should store and retrieve v2_state_json", async () => {
    const storyRepo = require("../../../src/database/story-repository");
    storyRepo.initialize(db);

    const v2State = {
      event: { title: "Birth of twins", type: "birth", confidence: 0.9 },
      narrative: "Test narrative",
      beats: [{ id: "discovery", status: "missing" }],
      facts: [],
      user_model: { style: "verbose" },
    };

    const session = await storyRepo.createSession({
      userId: "test-user-v2-state",
      arc: "celebration",
      recipientName: "Test Recipient",
      initialPrompt: "Test story",
      engineVersion: "v2",
      v2State,
    });

    const retrieved = await storyRepo.getSession(session.id);
    assert.deepStrictEqual(retrieved.v2State, v2State);
  });

  it("should default engine_version to v1 for existing sessions", async () => {
    const storyRepo = require("../../../src/database/story-repository");
    storyRepo.initialize(db);

    const session = await storyRepo.createSession({
      userId: "test-user-v1-default",
      arc: "celebration",
      recipientName: "Test Recipient",
      initialPrompt: "Test story",
      // No engineVersion specified
    });

    assert.strictEqual(session.engineVersion, "v1");
    assert.strictEqual(session.v2State, null);
  });

  it("should update v2_state_json on session update", async () => {
    const storyRepo = require("../../../src/database/story-repository");
    storyRepo.initialize(db);

    const session = await storyRepo.createSession({
      userId: "test-user-v2-update",
      arc: "celebration",
      recipientName: "Test Recipient",
      initialPrompt: "Test story",
      engineVersion: "v2",
      v2State: { narrative: "Initial" },
    });

    const updatedState = {
      narrative: "Updated narrative",
      beats: [{ id: "discovery", status: "covered" }],
    };

    await storyRepo.updateSession(session.id, { v2State: updatedState });

    const retrieved = await storyRepo.getSession(session.id);
    assert.strictEqual(retrieved.v2State.narrative, "Updated narrative");
  });
});
```

**Step 3.2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="Story Repository V2"`
Expected: FAIL — `engineVersion` and `v2State` not recognized

**Step 3.3: Update story-repository.js createSession**

In `src/database/story-repository.js`, find the `createSession` function and update:

```javascript
async function createSession({
  userId,
  arc,
  occasion = null,
  recipientName,
  style = null,
  initialPrompt,
  engineVersion = "v1",  // NEW: default to v1
  v2State = null,        // NEW: V2 state object
}) {
  const id = generateId();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO story_sessions (
      id, user_id, status, arc, occasion, recipient_name, style,
      initial_prompt, elements_json, pending_anchors_json,
      current_question_json, question_count,
      engine_version, v2_state_json,
      created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    "active",
    arc,
    occasion,
    recipientName,
    style,
    initialPrompt,
    "{}",           // elements_json
    "[]",           // pending_anchors_json
    null,           // current_question_json
    0,              // question_count
    engineVersion,  // NEW
    v2State ? JSON.stringify(v2State) : null,  // NEW
    now,
    now,
    expiresAt
  );

  return getSession(id);
}
```

**Step 3.4: Update hydrateSession function**

Find the `hydrateSession` function and add V2 fields:

```javascript
function hydrateSession(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    arc: row.arc,
    occasion: row.occasion,
    recipientName: row.recipient_name,
    style: row.style,
    initialPrompt: row.initial_prompt,
    elements: row.elements_json ? JSON.parse(row.elements_json) : {},
    pendingAnchors: row.pending_anchors_json ? JSON.parse(row.pending_anchors_json) : [],
    currentQuestion: row.current_question_json ? JSON.parse(row.current_question_json) : null,
    summary: row.summary_json ? JSON.parse(row.summary_json) : null,
    additionalNotes: row.additional_notes,
    questionCount: row.question_count,
    engineVersion: row.engine_version || "v1",  // NEW
    v2State: row.v2_state_json ? JSON.parse(row.v2_state_json) : null,  // NEW
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at,
  };
}
```

**Step 3.5: Update updateSession function**

Find the `updateSession` function and handle v2State:

```javascript
async function updateSession(sessionId, updates) {
  const setClauses = [];
  const values = [];

  // ... existing update handlers ...

  if (updates.v2State !== undefined) {
    setClauses.push("v2_state_json = ?");
    values.push(updates.v2State ? JSON.stringify(updates.v2State) : null);
  }

  if (updates.engineVersion !== undefined) {
    setClauses.push("engine_version = ?");
    values.push(updates.engineVersion);
  }

  // ... rest of function ...
}
```

**Step 3.6: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="Story Repository V2"`
Expected: PASS — All 4 tests pass

**Step 3.7: Commit**

```bash
git add src/database/story-repository.js test/writer/v2/repository-v2.test.js
git commit -m "feat(repo): add engine_version and v2_state_json support to story repository"
```

---

## CHECKPOINT 1: Foundation Complete

Run: `/auto-pr-review`

**Review Focus:**
- Migration syntax correct
- Repository properly handles V2 columns
- Tests cover create, retrieve, update, and default behavior
- No breaking changes to V1 flow

---

## Task 4: Create V2 State Schema and Validation

**Files:**
- Create: `src/writer/v2/state.js`
- Create: `test/writer/v2/state.test.js`

**Step 4.1: Write failing tests for state validation**

Create: `test/writer/v2/state.test.js`

```javascript
/**
 * V2 State Manager Tests
 * Tests for state schema validation and grounding checks
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  createInitialState,
  validateState,
  isStateGrounded,
  updateNarrative,
  addFact,
  updateBeatStatus,
} = require("../../../src/writer/v2/state");

describe("V2 State Manager", () => {
  describe("createInitialState", () => {
    it("should create valid initial state with recipient and occasion", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter's first birthday",
      });

      assert.ok(state.event, "Should have event object");
      assert.strictEqual(state.narrative, "");
      assert.ok(Array.isArray(state.beats), "Beats should be array");
      assert.ok(Array.isArray(state.facts), "Facts should be array");
      assert.ok(state.user_model, "Should have user_model");
      assert.strictEqual(state.turn_count, 0);
      assert.strictEqual(state.status, "active");
    });
  });

  describe("validateState", () => {
    it("should accept valid state", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const result = validateState(state);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it("should reject state missing required fields", () => {
      const invalidState = { narrative: "test" };
      const result = validateState(invalidState);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });
  });

  describe("isStateGrounded", () => {
    it("should return true when narrative only contains known facts", () => {
      const state = {
        facts: [
          { id: "f1", text: "met at coffee shop" },
          { id: "f2", text: "she smiled" },
        ],
        narrative: "They met at a coffee shop. She smiled.",
      };

      assert.strictEqual(isStateGrounded(state), true);
    });

    it("should return false when narrative contains ungrounded claims", () => {
      const state = {
        facts: [{ id: "f1", text: "met at coffee shop" }],
        narrative: "They met at a coffee shop. She was wearing a red dress.",
      };

      // "red dress" is not in facts — this is hallucination
      assert.strictEqual(isStateGrounded(state), false);
    });
  });

  describe("addFact", () => {
    it("should add fact with auto-generated id and source", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const updatedState = addFact(state, {
        text: "bleeding at 9 weeks",
        beat: "scare",
        sourceTurn: 1,
      });

      assert.strictEqual(updatedState.facts.length, 1);
      assert.ok(updatedState.facts[0].id.startsWith("f"));
      assert.strictEqual(updatedState.facts[0].text, "bleeding at 9 weeks");
      assert.strictEqual(updatedState.facts[0].beat, "scare");
      assert.strictEqual(updatedState.facts[0].source_turn, 1);
    });

    it("should not add duplicate facts", () => {
      let state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      state = addFact(state, { text: "met at coffee shop", beat: "discovery", sourceTurn: 1 });
      state = addFact(state, { text: "met at coffee shop", beat: "discovery", sourceTurn: 2 });

      assert.strictEqual(state.facts.length, 1);
    });
  });

  describe("updateBeatStatus", () => {
    it("should update beat status and evidence", () => {
      let state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      // Add a beat
      state.beats = [
        { id: "discovery", purpose: "how they found out", required: true, status: "missing", evidence: [] },
      ];

      state = updateBeatStatus(state, "discovery", "covered", ["f1", "f2"]);

      const beat = state.beats.find(b => b.id === "discovery");
      assert.strictEqual(beat.status, "covered");
      assert.deepStrictEqual(beat.evidence, ["f1", "f2"]);
    });
  });
});
```

**Step 4.2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="V2 State Manager"`
Expected: FAIL — module not found

**Step 4.3: Implement state.js**

Create: `src/writer/v2/state.js`

```javascript
/**
 * V2 State Manager
 *
 * Manages the V2 story session state with:
 * - Schema validation
 * - Grounding checks (no hallucinations)
 * - Immutable updates
 *
 * @module writer/v2/state
 */

const crypto = require("crypto");

/**
 * Create initial V2 state for a new session
 */
function createInitialState({ recipientName, occasion, initialPrompt }) {
  return {
    // Event understanding (populated after first LLM call)
    event: {
      title: "",
      type: "",
      confidence: 0,
      people: [recipientName],
      timeframe: "",
      occasion: occasion || "",
    },

    // Grounded facts (audit trail)
    facts: [],

    // Single evolving narrative (3-6 sentences, grounded)
    narrative: "",

    // Dynamic beat schema (generated per event)
    beats: [],

    // User signals
    user_model: {
      style: "unknown",        // brief | verbose | emotional | analytical | unknown
      fatigue_signals: 0,      // Count of short answers, skips
      tone_preference: "neutral",  // Detected from language
    },

    // Reasoning trace (debuggable)
    last_reasoning: null,

    // Conversation history
    conversation: [],

    // Session meta
    turn_count: 0,
    status: "active",  // active | ready_for_confirm | confirmed | abandoned
    recipient_name: recipientName,
    initial_prompt: initialPrompt,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Validate V2 state schema
 */
function validateState(state) {
  const errors = [];

  const requiredFields = [
    "event",
    "facts",
    "narrative",
    "beats",
    "user_model",
    "turn_count",
    "status",
  ];

  for (const field of requiredFields) {
    if (state[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (state.facts && !Array.isArray(state.facts)) {
    errors.push("facts must be an array");
  }

  if (state.beats && !Array.isArray(state.beats)) {
    errors.push("beats must be an array");
  }

  if (state.status && !["active", "ready_for_confirm", "confirmed", "abandoned"].includes(state.status)) {
    errors.push(`Invalid status: ${state.status}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if narrative is grounded in facts (no hallucinations)
 *
 * This is a simple heuristic check - looks for key phrases from facts
 * in the narrative. More sophisticated checks could use embedding similarity.
 */
function isStateGrounded(state) {
  if (!state.narrative || state.narrative.trim() === "") {
    return true;  // Empty narrative is trivially grounded
  }

  if (!state.facts || state.facts.length === 0) {
    return false;  // Narrative with no facts = ungrounded
  }

  const narrativeLower = state.narrative.toLowerCase();

  // Extract key words from facts (words > 3 chars)
  const factWords = new Set();
  for (const fact of state.facts) {
    const words = fact.text.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 3) {
        factWords.add(word);
      }
    }
  }

  // Check that narrative doesn't contain significant words not in facts
  // This is a simplified check - in production, use semantic similarity
  const narrativeWords = narrativeLower.split(/\s+/);
  const significantWords = narrativeWords.filter(w => w.length > 5);

  // Allow common connecting words
  const allowedWords = new Set([
    "their", "there", "about", "would", "could", "should", "being", "having",
    "moment", "that's", "they'd", "she'd", "he'd", "everything", "something",
    "nothing", "everyone", "someone", "before", "after", "during", "through",
  ]);

  for (const word of significantWords) {
    const cleanWord = word.replace(/[.,!?;:'"]/g, "");
    if (!factWords.has(cleanWord) && !allowedWords.has(cleanWord)) {
      // Check if any fact contains this word
      const foundInFacts = state.facts.some(f =>
        f.text.toLowerCase().includes(cleanWord)
      );
      if (!foundInFacts) {
        return false;  // Ungrounded word found
      }
    }
  }

  return true;
}

/**
 * Add a fact to state (immutable)
 */
function addFact(state, { text, beat, sourceTurn }) {
  // Check for duplicates
  const normalizedText = text.toLowerCase().trim();
  const isDuplicate = state.facts.some(
    f => f.text.toLowerCase().trim() === normalizedText
  );

  if (isDuplicate) {
    return state;  // Return unchanged
  }

  const newFact = {
    id: `f${crypto.randomBytes(4).toString("hex")}`,
    text,
    beat,
    source_turn: sourceTurn,
  };

  return {
    ...state,
    facts: [...state.facts, newFact],
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update narrative (immutable)
 */
function updateNarrative(state, narrative) {
  return {
    ...state,
    narrative,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update beat status (immutable)
 */
function updateBeatStatus(state, beatId, status, evidence = []) {
  const beats = state.beats.map(beat => {
    if (beat.id === beatId) {
      return { ...beat, status, evidence };
    }
    return beat;
  });

  return {
    ...state,
    beats,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update user model (immutable)
 */
function updateUserModel(state, updates) {
  return {
    ...state,
    user_model: { ...state.user_model, ...updates },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Add conversation turn (immutable)
 */
function addConversationTurn(state, { role, content }) {
  return {
    ...state,
    conversation: [...state.conversation, { role, content, timestamp: new Date().toISOString() }],
    turn_count: role === "user" ? state.turn_count + 1 : state.turn_count,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Set reasoning trace (immutable)
 */
function setReasoningTrace(state, reasoning) {
  return {
    ...state,
    last_reasoning: {
      ...reasoning,
      turn: state.turn_count,
    },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Set status (immutable)
 */
function setStatus(state, status) {
  return {
    ...state,
    status,
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  createInitialState,
  validateState,
  isStateGrounded,
  addFact,
  updateNarrative,
  updateBeatStatus,
  updateUserModel,
  addConversationTurn,
  setReasoningTrace,
  setStatus,
};
```

**Step 4.4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="V2 State Manager"`
Expected: PASS — All tests pass

**Step 4.5: Commit**

```bash
git add src/writer/v2/state.js test/writer/v2/state.test.js
git commit -m "feat(v2): implement state manager with validation and grounding checks"
```

---

## Task 5: Create Unified Reasoning Prompt Template

**Files:**
- Create: `src/writer/v2/prompts/reason.md`

**Step 5.1: Write the reasoning prompt template**

Create: `src/writer/v2/prompts/reason.md`

```markdown
You are a story collector helping someone create a personalized song. Your job is to understand their story deeply and ask thoughtful questions that surface specific, emotional memories.

## Context

**Recipient:** {{recipient_name}}
**Occasion:** {{occasion}}

**Narrative so far:**
{{narrative}}

**Beat coverage:**
| Beat | Purpose | Status | Evidence |
|------|---------|--------|----------|
{{#each beats}}
| {{id}} | {{purpose}} | {{status}} | {{evidence}} |
{{/each}}

**Conversation history:**
{{#each conversation}}
**{{role}}:** {{content}}
{{/each}}

**User's new input:**
{{user_input}}

## Your Task

Think step by step:

### 1. PERCEIVE
What new facts did the user share? List them explicitly as JSON array:
- Only include facts explicitly stated by the user
- Each fact should be a concrete detail (person, place, time, action, emotion)
- Do not infer or assume anything not directly stated

### 2. UPDATE NARRATIVE
Integrate new facts into the narrative:
- ONLY include facts explicitly stated (from this turn and previous)
- Keep to 3-6 sentences
- Write in third person, past tense
- Do not invent or assume details
- Do not add emotional interpretation unless user stated it

### 3. ASSESS BEATS
For each beat, determine status:
- **covered**: Has concrete details (specific scene, sensory detail, exact moment)
- **weak**: Mentioned but vague (no specifics, no scene, no sensory detail)
- **missing**: Not addressed at all

### 4. DETECT USER STATE
Analyze the user's communication:
- **style**: brief (< 20 words) | verbose (> 50 words) | emotional (uses feeling words) | analytical (factual, sequential)
- **fatigue_signals**: Count of: short answers (< 10 words), deflections ("I don't know"), skips, repeated "that's it"
- **tone_preference**: celebratory | reflective | gentle | bittersweet (infer from language)

### 5. DECIDE ACTION
Choose one action:
- **ASK**: Story needs more detail on a specific beat. Choose the most emotionally important missing/weak beat.
- **CLARIFY**: User's input was unclear or contradictory. Ask a focused clarification.
- **CONFIRM**: Story is complete enough (scene + stakes + turning_point + meaning all covered). Present narrative for confirmation.
- **STOP**: User explicitly indicated they're done ("that's all", "I'm done", etc.)

Decision rules:
- If fatigue_signals >= 2 AND at least 3 beats are covered → CONFIRM with what we have
- If all required beats are covered with concrete details → CONFIRM
- If user explicitly says done → STOP
- Otherwise → ASK about the most important missing/weak beat

### 6. GENERATE
If action is ASK, write a question that:
- References something from the narrative ("You mentioned X...")
- Asks for a memory marker: place, person, exact words, sensory detail, or specific moment
- Targets ONE specific beat
- Matches the user's tone (gentle for loss/illness, celebratory for birthday)
- Is 1-2 sentences max

If action is CONFIRM, write a confirmation message that:
- Presents the narrative
- Asks "Does this capture your story?"

## Output

Respond with ONLY a JSON object (no markdown, no explanation):

```json
{
  "reasoning": {
    "new_facts": [
      { "text": "fact text", "beat": "beat_id" }
    ],
    "user_style": "brief|verbose|emotional|analytical",
    "fatigue_signals": 0,
    "beat_assessment": {
      "beat_id": { "status": "covered|weak|missing", "reason": "why" }
    },
    "decision": "ASK|CLARIFY|CONFIRM|STOP",
    "decision_reason": "explanation of why this action was chosen"
  },
  "narrative": "updated 3-6 sentence narrative",
  "beats": [
    { "id": "beat_id", "purpose": "purpose", "required": true, "status": "covered|weak|missing", "evidence": ["fact_ids"] }
  ],
  "user_model": {
    "style": "brief|verbose|emotional|analytical",
    "fatigue_signals": 0,
    "tone_preference": "celebratory|reflective|gentle|bittersweet"
  },
  "action": "ASK|CLARIFY|CONFIRM|STOP",
  "question": "the question to ask (if action is ASK)",
  "confirmation": "the confirmation message (if action is CONFIRM)"
}
```

## Important Rules

1. **Grounding**: NEVER add facts not explicitly stated. If unsure, leave it out.
2. **Beat generation**: On first turn, generate 5-7 beats appropriate for the event type.
3. **Minimum story**: A story is ready for confirmation when it has: scene + stakes + turning_point + meaning.
4. **Question quality**: Every question must ask for a SPECIFIC memory marker, not generic feelings.
5. **Tone matching**: If the event is loss/illness, be gentle. If celebration, be warm and excited.
```

**Step 5.2: Commit**

```bash
git add src/writer/v2/prompts/reason.md
git commit -m "feat(v2): add unified reasoning prompt template"
```

---

## Task 6: Implement Reasoner Module

**Files:**
- Create: `src/writer/v2/reasoner.js`
- Create: `test/writer/v2/reasoner.test.js`

**Step 6.1: Write failing tests for reasoner**

Create: `test/writer/v2/reasoner.test.js`

```javascript
/**
 * V2 Reasoner Tests
 * Tests for the unified reasoning module
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");

const {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
} = require("../../../src/writer/v2/reasoner");

const { createInitialState } = require("../../../src/writer/v2/state");

describe("V2 Reasoner", () => {
  describe("buildReasoningPrompt", () => {
    it("should build prompt with all state context", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter",
      });
      state.narrative = "Sarah is turning one.";
      state.beats = [
        { id: "discovery", purpose: "how it started", required: true, status: "missing", evidence: [] },
      ];

      const prompt = buildReasoningPrompt(state, "She loves playing with blocks");

      assert.ok(prompt.includes("Sarah"), "Should include recipient name");
      assert.ok(prompt.includes("birthday"), "Should include occasion");
      assert.ok(prompt.includes("Sarah is turning one"), "Should include narrative");
      assert.ok(prompt.includes("She loves playing with blocks"), "Should include user input");
      assert.ok(prompt.includes("discovery"), "Should include beats");
    });

    it("should handle empty narrative", () => {
      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Test",
      });

      const prompt = buildReasoningPrompt(state, "First input");
      assert.ok(prompt.includes("First input"));
    });
  });

  describe("parseReasoningResponse", () => {
    it("should parse valid JSON response", () => {
      const response = JSON.stringify({
        reasoning: {
          new_facts: [{ text: "plays with blocks", beat: "character" }],
          user_style: "verbose",
          fatigue_signals: 0,
          beat_assessment: { discovery: { status: "missing", reason: "not mentioned" } },
          decision: "ASK",
          decision_reason: "Need more story details",
        },
        narrative: "Sarah is turning one. She loves playing with blocks.",
        beats: [{ id: "discovery", purpose: "how it started", required: true, status: "missing", evidence: [] }],
        user_model: { style: "verbose", fatigue_signals: 0, tone_preference: "celebratory" },
        action: "ASK",
        question: "What moment stands out from her first year?",
      });

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
      assert.strictEqual(result.data.question, "What moment stands out from her first year?");
      assert.ok(result.data.reasoning.new_facts.length > 0);
    });

    it("should handle malformed JSON gracefully", () => {
      const response = "This is not JSON";
      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it("should extract JSON from markdown code blocks", () => {
      const response = `Here's my analysis:

\`\`\`json
{
  "action": "ASK",
  "question": "Test question",
  "narrative": "Test narrative",
  "beats": [],
  "reasoning": { "decision": "ASK", "decision_reason": "test" },
  "user_model": { "style": "brief", "fatigue_signals": 0, "tone_preference": "neutral" }
}
\`\`\`

That's my response.`;

      const result = parseReasoningResponse(response);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.action, "ASK");
    });

    it("should validate required fields", () => {
      const response = JSON.stringify({
        action: "ASK",
        // Missing: question, narrative, beats, reasoning
      });

      const result = parseReasoningResponse(response);

      // Should fail validation
      assert.strictEqual(result.success, false);
    });
  });

  describe("reason (integration)", () => {
    // Skip integration tests if LLM not available
    const llmAvailable = process.env.ANTHROPIC_API_KEY;

    it("should return valid reasoning result with LLM", async function() {
      if (!llmAvailable) {
        console.log("  [skipped] LLM not available");
        return;
      }

      const state = createInitialState({
        recipientName: "Sarah",
        occasion: "birthday",
        initialPrompt: "Song for my daughter's first birthday",
      });

      const result = await reason(state, "She took her first steps last month!");

      assert.ok(result.success, "Should succeed");
      assert.ok(["ASK", "CLARIFY", "CONFIRM", "STOP"].includes(result.data.action));
      assert.ok(result.data.narrative);
      assert.ok(result.data.reasoning);
    });
  });
});
```

**Step 6.2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="V2 Reasoner"`
Expected: FAIL — module not found

**Step 6.3: Implement reasoner.js**

Create: `src/writer/v2/reasoner.js`

```javascript
/**
 * V2 Reasoner
 *
 * Unified reasoning module that handles perception, reasoning, and action
 * selection in a single LLM call.
 *
 * @module writer/v2/reasoner
 */

const fs = require("fs");
const path = require("path");
const { generateText, isAvailable } = require("../../services/llm-provider");

// Load prompt template
const PROMPT_TEMPLATE_PATH = path.join(__dirname, "prompts", "reason.md");

/**
 * Build the reasoning prompt with current state
 */
function buildReasoningPrompt(state, userInput) {
  // Load template
  let template;
  try {
    template = fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
  } catch (err) {
    // Fallback to inline template if file not found (for testing)
    template = getInlineTemplate();
  }

  // Replace placeholders
  let prompt = template
    .replace("{{recipient_name}}", state.recipient_name || "")
    .replace("{{occasion}}", state.event?.occasion || state.initial_prompt || "")
    .replace("{{narrative}}", state.narrative || "(No narrative yet)")
    .replace("{{user_input}}", userInput);

  // Build beats table
  const beatsTable = state.beats.map(beat =>
    `| ${beat.id} | ${beat.purpose} | ${beat.status} | ${beat.evidence?.join(", ") || "none"} |`
  ).join("\n");
  prompt = prompt.replace(/{{#each beats}}[\s\S]*?{{\/each}}/g, beatsTable || "| (no beats yet) | | | |");

  // Build conversation history
  const conversationHistory = state.conversation.map(turn =>
    `**${turn.role}:** ${turn.content}`
  ).join("\n\n");
  prompt = prompt.replace(/{{#each conversation}}[\s\S]*?{{\/each}}/g, conversationHistory || "(New conversation)");

  return prompt;
}

/**
 * Parse the LLM response into structured data
 */
function parseReasoningResponse(response) {
  try {
    // Try to extract JSON from markdown code blocks
    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find JSON object in response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const data = JSON.parse(jsonStr);

    // Validate required fields
    const requiredFields = ["action", "narrative", "reasoning"];
    const missingFields = requiredFields.filter(f => !data[f]);

    if (missingFields.length > 0) {
      return {
        success: false,
        error: `Missing required fields: ${missingFields.join(", ")}`,
        raw: response,
      };
    }

    // Validate action is one of allowed values
    if (!["ASK", "CLARIFY", "CONFIRM", "STOP"].includes(data.action)) {
      return {
        success: false,
        error: `Invalid action: ${data.action}`,
        raw: response,
      };
    }

    // If action is ASK, question is required
    if (data.action === "ASK" && !data.question) {
      return {
        success: false,
        error: "Action is ASK but no question provided",
        raw: response,
      };
    }

    return {
      success: true,
      data,
    };
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err.message}`,
      raw: response,
    };
  }
}

/**
 * Run unified reasoning on user input
 */
async function reason(state, userInput) {
  if (!isAvailable()) {
    return {
      success: false,
      error: "LLM not available",
      fallback: true,
    };
  }

  const prompt = buildReasoningPrompt(state, userInput);

  try {
    const response = await generateText({
      prompt,
      taskType: "creative",  // Use same model as lyrics
      temperature: 0.7,
      maxTokens: 2000,
    });

    const parsed = parseReasoningResponse(response);

    if (!parsed.success) {
      console.error("[V2 Reasoner] Parse error:", parsed.error);
      console.error("[V2 Reasoner] Raw response:", response.substring(0, 500));
    }

    return parsed;
  } catch (err) {
    console.error("[V2 Reasoner] LLM error:", err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Inline template fallback (for testing without file access)
 */
function getInlineTemplate() {
  return `You are a story collector helping someone create a personalized song.

**Recipient:** {{recipient_name}}
**Occasion:** {{occasion}}
**Narrative so far:** {{narrative}}
**Conversation:** {{#each conversation}}{{role}}: {{content}}{{/each}}
**User's new input:** {{user_input}}

Analyze the input and respond with JSON:
{
  "reasoning": { "new_facts": [], "decision": "ASK|CLARIFY|CONFIRM|STOP", "decision_reason": "" },
  "narrative": "updated narrative",
  "beats": [],
  "user_model": { "style": "brief", "fatigue_signals": 0, "tone_preference": "neutral" },
  "action": "ASK|CLARIFY|CONFIRM|STOP",
  "question": "question if ASK"
}`;
}

module.exports = {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
};
```

**Step 6.4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="V2 Reasoner"`
Expected: PASS — All non-integration tests pass

**Step 6.5: Commit**

```bash
git add src/writer/v2/reasoner.js test/writer/v2/reasoner.test.js
git commit -m "feat(v2): implement unified reasoner with prompt building and response parsing"
```

---

## Task 7: Add First-Turn Beat Generation

**Files:**
- Modify: `src/writer/v2/reasoner.js`
- Create: `src/writer/v2/beats.js`
- Create: `test/writer/v2/beats.test.js`

**Step 7.1: Write failing tests for beat generation**

Create: `test/writer/v2/beats.test.js`

```javascript
/**
 * V2 Beat Generation Tests
 * Tests for dynamic beat schema generation
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { generateBeatsForEvent, DEFAULT_BEATS } = require("../../../src/writer/v2/beats");

describe("V2 Beat Generation", () => {
  describe("generateBeatsForEvent", () => {
    it("should generate birth-specific beats for birth event", () => {
      const beats = generateBeatsForEvent({
        type: "birth",
        title: "Birth of twins",
      });

      const beatIds = beats.map(b => b.id);
      assert.ok(beatIds.includes("discovery"), "Should have discovery beat");
      assert.ok(beatIds.includes("birth_moment"), "Should have birth_moment beat");
      assert.ok(beats.length >= 5, "Should have at least 5 beats");
    });

    it("should generate loss-specific beats for loss/illness event", () => {
      const beats = generateBeatsForEvent({
        type: "loss",
        title: "Grandmother's passing",
      });

      const beatIds = beats.map(b => b.id);
      assert.ok(beatIds.includes("memory"), "Should have memory beat");
      assert.ok(beatIds.includes("meaning"), "Should have meaning beat");
    });

    it("should use default beats for unknown event types", () => {
      const beats = generateBeatsForEvent({
        type: "unknown",
        title: "Some event",
      });

      assert.ok(beats.length >= 4, "Should have at least 4 default beats");
    });

    it("should mark required beats correctly", () => {
      const beats = generateBeatsForEvent({
        type: "celebration",
        title: "Birthday",
      });

      const requiredBeats = beats.filter(b => b.required);
      assert.ok(requiredBeats.length >= 3, "Should have at least 3 required beats");
    });

    it("should initialize all beats with missing status", () => {
      const beats = generateBeatsForEvent({
        type: "birthday",
        title: "First birthday",
      });

      const allMissing = beats.every(b => b.status === "missing");
      assert.ok(allMissing, "All beats should start as missing");
    });
  });
});
```

**Step 7.2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="V2 Beat Generation"`
Expected: FAIL — module not found

**Step 7.3: Implement beats.js**

Create: `src/writer/v2/beats.js`

```javascript
/**
 * V2 Beat Generation
 *
 * Dynamic beat schema generation based on event type.
 * Beats are story elements that capture specific emotional moments.
 *
 * @module writer/v2/beats
 */

/**
 * Default beats used for any event type
 */
const DEFAULT_BEATS = [
  { id: "scene", purpose: "where and when it happened", required: true },
  { id: "stakes", purpose: "what was at risk or what mattered", required: true },
  { id: "turning_point", purpose: "the pivotal moment", required: true },
  { id: "meaning", purpose: "what it means now / why it matters", required: true },
  { id: "sensory", purpose: "a specific sensory detail", required: false },
];

/**
 * Event-specific beat schemas
 */
const EVENT_BEATS = {
  birth: [
    { id: "discovery", purpose: "finding out about the pregnancy", required: true },
    { id: "scare", purpose: "moment of fear or tension", required: false },
    { id: "turning_point", purpose: "the pivotal moment (hearing heartbeat, etc.)", required: true },
    { id: "challenges", purpose: "struggles during pregnancy/journey", required: false },
    { id: "birth_moment", purpose: "the moment of birth / meeting them", required: true },
    { id: "first_hold", purpose: "first time holding them", required: false },
    { id: "meaning", purpose: "what they mean to you / hopes for them", required: true },
  ],

  loss: [
    { id: "relationship", purpose: "who they were to you", required: true },
    { id: "memory", purpose: "a defining memory of them", required: true },
    { id: "character", purpose: "what made them special", required: true },
    { id: "last_moment", purpose: "a meaningful last interaction", required: false },
    { id: "legacy", purpose: "what they taught you / how they changed you", required: false },
    { id: "meaning", purpose: "what they still mean to you", required: true },
  ],

  illness: [
    { id: "diagnosis", purpose: "finding out about the illness", required: false },
    { id: "struggle", purpose: "the hardest moment", required: true },
    { id: "support", purpose: "who was there / how you supported each other", required: false },
    { id: "turning_point", purpose: "moment of hope or change", required: true },
    { id: "strength", purpose: "what kept you/them going", required: true },
    { id: "meaning", purpose: "what this journey taught you", required: true },
  ],

  anniversary: [
    { id: "meeting", purpose: "how you met", required: true },
    { id: "first_impression", purpose: "what you first noticed about them", required: false },
    { id: "falling", purpose: "when you knew you loved them", required: true },
    { id: "challenges", purpose: "what you've overcome together", required: false },
    { id: "moment", purpose: "a defining moment in your relationship", required: true },
    { id: "meaning", purpose: "what they mean to you now", required: true },
  ],

  birthday: [
    { id: "who", purpose: "who this person is to you", required: true },
    { id: "memory", purpose: "a favorite memory with them", required: true },
    { id: "character", purpose: "what makes them special", required: true },
    { id: "moment", purpose: "a specific moment that captures them", required: false },
    { id: "wish", purpose: "what you wish for them", required: false },
    { id: "meaning", purpose: "what they mean to you", required: true },
  ],

  celebration: [
    { id: "achievement", purpose: "what is being celebrated", required: true },
    { id: "journey", purpose: "the path to get here", required: false },
    { id: "struggle", purpose: "challenges overcome", required: false },
    { id: "moment", purpose: "the defining moment of success", required: true },
    { id: "supporters", purpose: "who helped along the way", required: false },
    { id: "meaning", purpose: "what this achievement means", required: true },
  ],

  gratitude: [
    { id: "who", purpose: "who you're thanking", required: true },
    { id: "what", purpose: "what they did", required: true },
    { id: "impact", purpose: "how it affected you", required: true },
    { id: "moment", purpose: "a specific moment of their kindness", required: false },
    { id: "meaning", purpose: "what they mean to you", required: true },
  ],

  farewell: [
    { id: "relationship", purpose: "your connection with them", required: true },
    { id: "memory", purpose: "a favorite shared memory", required: true },
    { id: "impact", purpose: "how they changed you", required: false },
    { id: "wish", purpose: "what you wish for their future", required: true },
    { id: "meaning", purpose: "what they mean to you", required: true },
  ],
};

/**
 * Generate beats appropriate for an event type
 */
function generateBeatsForEvent(event) {
  const type = normalizeEventType(event.type);
  const baseBeats = EVENT_BEATS[type] || DEFAULT_BEATS;

  // Initialize all beats with missing status and empty evidence
  return baseBeats.map(beat => ({
    ...beat,
    status: "missing",
    evidence: [],
  }));
}

/**
 * Normalize event type to known category
 */
function normalizeEventType(type) {
  if (!type) return "default";

  const normalized = type.toLowerCase().trim();

  // Map common variations to canonical types
  const typeMap = {
    "birth": "birth",
    "baby": "birth",
    "pregnancy": "birth",
    "twins": "birth",
    "newborn": "birth",

    "death": "loss",
    "loss": "loss",
    "passing": "loss",
    "memorial": "loss",
    "funeral": "loss",
    "remembrance": "loss",

    "sick": "illness",
    "illness": "illness",
    "cancer": "illness",
    "recovery": "illness",
    "surgery": "illness",
    "hospital": "illness",

    "anniversary": "anniversary",
    "wedding": "anniversary",
    "engagement": "anniversary",

    "birthday": "birthday",
    "bday": "birthday",

    "celebration": "celebration",
    "achievement": "celebration",
    "graduation": "celebration",
    "promotion": "celebration",

    "gratitude": "gratitude",
    "thank": "gratitude",
    "appreciation": "gratitude",

    "farewell": "farewell",
    "goodbye": "farewell",
    "retirement": "farewell",
    "moving": "farewell",
  };

  return typeMap[normalized] || "default";
}

/**
 * Get minimum required beats for a complete story
 */
function getMinimumRequiredBeats(eventType) {
  return ["scene", "stakes", "turning_point", "meaning"];
}

/**
 * Check if beats meet minimum story requirements
 */
function hasMinimumBeats(beats) {
  const required = getMinimumRequiredBeats();
  const covered = beats.filter(b => b.status === "covered").map(b => b.id);

  // Check if we have equivalents for the minimum required
  const hasScene = covered.some(id =>
    ["scene", "meeting", "discovery", "diagnosis", "who", "relationship", "achievement"].includes(id)
  );
  const hasStakes = covered.some(id =>
    ["stakes", "scare", "struggle", "challenges", "what", "impact"].includes(id)
  );
  const hasTurningPoint = covered.some(id =>
    ["turning_point", "moment", "birth_moment", "first_hold", "falling"].includes(id)
  );
  const hasMeaning = covered.includes("meaning");

  return hasScene && hasStakes && hasTurningPoint && hasMeaning;
}

module.exports = {
  DEFAULT_BEATS,
  EVENT_BEATS,
  generateBeatsForEvent,
  normalizeEventType,
  getMinimumRequiredBeats,
  hasMinimumBeats,
};
```

**Step 7.4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="V2 Beat Generation"`
Expected: PASS — All tests pass

**Step 7.5: Commit**

```bash
git add src/writer/v2/beats.js test/writer/v2/beats.test.js
git commit -m "feat(v2): implement dynamic beat generation for different event types"
```

---

## Task 8: Implement Quality Checks

**Files:**
- Create: `src/writer/v2/quality.js`
- Create: `test/writer/v2/quality.test.js`

**Step 8.1: Write failing tests**

Create: `test/writer/v2/quality.test.js`

```javascript
/**
 * V2 Quality Tests
 * Tests for story completeness and quality checks
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  isStoryComplete,
  shouldConfirm,
  getCompletionScore,
  getMissingBeats,
} = require("../../../src/writer/v2/quality");

describe("V2 Quality Checks", () => {
  describe("isStoryComplete", () => {
    it("should return true when all required beats are covered", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "covered", evidence: ["f2"] },
          { id: "turning_point", required: true, status: "covered", evidence: ["f3"] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
          { id: "sensory", required: false, status: "missing", evidence: [] },
        ],
      };

      assert.strictEqual(isStoryComplete(state), true);
    });

    it("should return false when required beats are missing", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "missing", evidence: [] },
          { id: "turning_point", required: true, status: "weak", evidence: [] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
        ],
      };

      assert.strictEqual(isStoryComplete(state), false);
    });
  });

  describe("shouldConfirm", () => {
    it("should return true when complete and no fatigue", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "covered", evidence: ["f2"] },
          { id: "turning_point", required: true, status: "covered", evidence: ["f3"] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
        ],
        user_model: { fatigue_signals: 0 },
      };

      assert.strictEqual(shouldConfirm(state), true);
    });

    it("should return true when fatigued and minimum beats met", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "weak", evidence: [] },
          { id: "turning_point", required: true, status: "covered", evidence: ["f3"] },
          { id: "meaning", required: true, status: "covered", evidence: ["f4"] },
        ],
        user_model: { fatigue_signals: 2 },
      };

      // Should confirm because fatigued, even with one weak beat
      const result = shouldConfirm(state);
      assert.strictEqual(result, true);
    });

    it("should return false when not complete and no fatigue", () => {
      const state = {
        beats: [
          { id: "scene", required: true, status: "covered", evidence: ["f1"] },
          { id: "stakes", required: true, status: "missing", evidence: [] },
        ],
        user_model: { fatigue_signals: 0 },
      };

      assert.strictEqual(shouldConfirm(state), false);
    });
  });

  describe("getCompletionScore", () => {
    it("should return 100 when all beats covered", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "covered" },
        ],
      };

      assert.strictEqual(getCompletionScore(state), 100);
    });

    it("should return 50 when half beats covered", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "missing" },
        ],
      };

      assert.strictEqual(getCompletionScore(state), 50);
    });

    it("should count weak as partial coverage", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "weak" },
        ],
      };

      // covered = 1, weak = 0.5, total = 1.5 / 2 = 75%
      assert.strictEqual(getCompletionScore(state), 75);
    });
  });

  describe("getMissingBeats", () => {
    it("should return only missing and weak required beats", () => {
      const state = {
        beats: [
          { id: "a", required: true, status: "covered" },
          { id: "b", required: true, status: "missing" },
          { id: "c", required: true, status: "weak" },
          { id: "d", required: false, status: "missing" },
        ],
      };

      const missing = getMissingBeats(state);
      const ids = missing.map(b => b.id);

      assert.ok(ids.includes("b"), "Should include missing required");
      assert.ok(ids.includes("c"), "Should include weak required");
      assert.ok(!ids.includes("a"), "Should not include covered");
      assert.ok(!ids.includes("d"), "Should not include optional");
    });
  });
});
```

**Step 8.2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="V2 Quality"`
Expected: FAIL — module not found

**Step 8.3: Implement quality.js**

Create: `src/writer/v2/quality.js`

```javascript
/**
 * V2 Quality Checks
 *
 * Evaluates story completeness and determines when to confirm.
 *
 * @module writer/v2/quality
 */

/**
 * Check if story has all required beats covered
 */
function isStoryComplete(state) {
  if (!state.beats || state.beats.length === 0) return false;

  const requiredBeats = state.beats.filter(b => b.required);
  return requiredBeats.every(b => b.status === "covered");
}

/**
 * Determine if we should confirm with the user
 *
 * Confirms when:
 * - All required beats are covered, OR
 * - User is fatigued (>=2 signals) AND minimum beats are covered
 */
function shouldConfirm(state) {
  if (isStoryComplete(state)) return true;

  const fatigued = state.user_model?.fatigue_signals >= 2;
  if (fatigued && hasMinimumCoverage(state)) {
    return true;
  }

  return false;
}

/**
 * Check if minimum story elements are covered
 * Minimum = scene + at least one of (stakes/turning_point) + meaning
 */
function hasMinimumCoverage(state) {
  const covered = state.beats.filter(b =>
    b.status === "covered" || b.status === "weak"
  );
  const coveredIds = covered.map(b => b.id);

  // Need at least 3 beats covered/weak
  if (covered.length < 3) return false;

  // Need meaning
  const hasMeaning = coveredIds.includes("meaning");
  if (!hasMeaning) return false;

  // Need some scene-like beat
  const sceneBeats = ["scene", "meeting", "discovery", "who", "relationship"];
  const hasScene = sceneBeats.some(id => coveredIds.includes(id));

  // Need some turning point or stakes
  const pivotBeats = ["turning_point", "stakes", "moment", "impact", "struggle"];
  const hasPivot = pivotBeats.some(id => coveredIds.includes(id));

  return hasScene && hasPivot;
}

/**
 * Calculate completion score (0-100)
 */
function getCompletionScore(state) {
  if (!state.beats || state.beats.length === 0) return 0;

  const requiredBeats = state.beats.filter(b => b.required);
  if (requiredBeats.length === 0) return 100;

  let score = 0;
  for (const beat of requiredBeats) {
    if (beat.status === "covered") score += 1;
    else if (beat.status === "weak") score += 0.5;
  }

  return Math.round((score / requiredBeats.length) * 100);
}

/**
 * Get missing or weak required beats, sorted by priority
 */
function getMissingBeats(state) {
  return state.beats
    .filter(b => b.required && (b.status === "missing" || b.status === "weak"))
    .sort((a, b) => {
      // Missing before weak
      if (a.status === "missing" && b.status === "weak") return -1;
      if (a.status === "weak" && b.status === "missing") return 1;
      return 0;
    });
}

/**
 * Get the most important beat to ask about next
 */
function getNextBeatToAsk(state) {
  const missing = getMissingBeats(state);
  if (missing.length === 0) return null;

  // Priority order for beats
  const priorityOrder = [
    "turning_point", "moment", "birth_moment", "falling",  // Most emotionally important
    "meaning",  // Core to the song
    "scene", "meeting", "discovery", "who",  // Foundation
    "stakes", "scare", "struggle",  // Tension
  ];

  // Sort by priority
  missing.sort((a, b) => {
    const aIndex = priorityOrder.indexOf(a.id);
    const bIndex = priorityOrder.indexOf(b.id);
    const aPriority = aIndex === -1 ? 999 : aIndex;
    const bPriority = bIndex === -1 ? 999 : bIndex;
    return aPriority - bPriority;
  });

  return missing[0];
}

module.exports = {
  isStoryComplete,
  shouldConfirm,
  hasMinimumCoverage,
  getCompletionScore,
  getMissingBeats,
  getNextBeatToAsk,
};
```

**Step 8.4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="V2 Quality"`
Expected: PASS — All tests pass

**Step 8.5: Commit**

```bash
git add src/writer/v2/quality.js test/writer/v2/quality.test.js
git commit -m "feat(v2): implement story quality checks and completion detection"
```

---

## CHECKPOINT 2: Reasoner Complete

Run: `/auto-pr-review`

**Review Focus:**
- Unified reasoning prompt is well-structured
- Response parsing handles edge cases (markdown, malformed JSON)
- Beat generation covers all event types
- Quality checks correctly evaluate completion
- All tests pass

---

## Task 9-12: State Integration and Engine Core

*(Tasks 9-12 follow the same TDD pattern - write failing test, implement, verify, commit)*

**Task 9:** Integrate state updates from reasoner output
**Task 10:** Implement conversation turn tracking
**Task 11:** Implement fallback heuristics (when LLM unavailable)
**Task 12:** Add state persistence to repository

---

## CHECKPOINT 3: State Manager Complete

Run: `/auto-pr-review`

---

## Task 13-17: Engine Orchestration

**Task 13:** Implement `startStoryV2()` - create session, get first question
**Task 14:** Implement `continueStoryV2()` - process answer, get next question
**Task 15:** Implement `getStoryContextV2()` - for lyrics generation
**Task 16:** Implement confirmation flow
**Task 17:** Integration tests for full conversation flow

---

## CHECKPOINT 4: Engine Complete

Run: `/auto-pr-review`

---

## Task 18-21: API Integration

**Task 18:** Add engine version dispatch to story routes
**Task 19:** Add feature flag for V2 opt-in
**Task 20:** Update route handlers to use V2 when flagged
**Task 21:** E2E tests for API with V2 engine

---

## CHECKPOINT 5: API Complete

Run: `/auto-pr-review`

---

## Task 22: Final Review and Commit

Run: `/review`

**Review Checklist:**
- [ ] All tests pass (`npm test`)
- [ ] No TypeScript/lint errors
- [ ] V1 still works (no regressions)
- [ ] V2 handles: complete story paste, brief input, fatigue, direction change
- [ ] Reasoning trace logged correctly
- [ ] Code follows project patterns
- [ ] No security issues (grounding prevents hallucination)

**Final Commit:**

```bash
git add .
git commit -m "feat(writer): implement Story Reasoning Engine V2

Adds an intelligent story collection system that reasons holistically about
each user input. Key features:

- Unified reasoning: One LLM call per turn (not a pipeline)
- Dynamic beats: Generated per event type (not hardcoded)
- Single narrative: Evolving paragraph (not fragments)
- User model: Detects brief/verbose, fatigue signals
- Grounding: Validates narrative contains only stated facts
- Quality gates: Confirms when scene + stakes + turning_point + meaning covered

V2 runs alongside V1 via engine_version flag. Toggle with feature flag.

Co-authored by Ambrose Obimma"
```

---

## Execution Options

**Plan complete and saved to `docs/plans/2026-01-12-story-reasoning-engine-v2.md`.**

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with `executing-plans`, batch execution with checkpoints

**Which approach?**

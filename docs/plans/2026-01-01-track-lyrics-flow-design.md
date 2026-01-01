# Track + Lyrics Flow Design

**Date:** 2026-01-01
**Status:** Approved
**Author:** Brainstorming session

---

## Overview

Design for the personalized song creation flow - from memory capture to final voice-converted song. The core insight: **A personalized song isn't just "happy birthday to X" - it's rekindling a specific memory.**

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MEMORY CAPTURE (5 core questions)            │
│  1. Who is this for?                                            │
│  2. What's the occasion?                                        │
│  3. What ONE memory do you want this song to capture?           │
│  4. [AI-generated] Context question based on memory             │
│  5. [AI-generated] Depth question based on memory               │
│                                                                 │
│  [Tell me more] ← Optional: 2-3 more AI questions               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    STYLE SUGGESTION                             │
│  "Your story feels like a romantic ballad. Sound right?"        │
│  [Ballad ✓] [Pop] [R&B] [Something else...]                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    LYRICS GENERATION                            │
│  AI generates story-driven lyrics (verse/chorus/bridge)         │
│  User can iterate:                                              │
│    - Reroll entire song                                         │
│    - Reroll specific section                                    │
│    - Edit specific line                                         │
│    - General feedback ("make chorus more emotional")            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    PREVIEW (Guide Vocal)                        │
│  Generate ~15-25s chorus preview with AI guide voice            │
│  User hears melody + lyrics together                            │
│  FREE - no credits charged                                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    FULL RENDER (Voice Conversion)               │
│  Generate 60-90s full song with user's voice                    │
│  PAID - credits charged here                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DOWNLOAD / SHARE                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Memory Capture Details

### Core Questions (Always Asked)

| # | Question | Purpose |
|---|----------|---------|
| 1 | Who is this for? | Recipient name (anchor for lyrics) |
| 2 | What's the occasion? | Context for tone/style |
| 3 | What ONE memory do you want this song to capture? | The emotional core |
| 4 | [AI-generated based on #3] | Temporal/spatial context |
| 5 | [AI-generated based on #3] | Emotional depth |

### AI-Generated Follow-ups

The LLM reads the memory description and generates contextually relevant questions:

**Example:**
- Memory: "The night we danced in the rain in Paris"
- AI Q4: "When did this happen?"
- AI Q5: "What made that moment unforgettable?"

### Optional Depth ("Tell Me More")

If user wants richer lyrics, additional AI-generated questions:
- "How did the night end?"
- "What were you feeling in that moment?"
- "What song was playing?"

---

## Lyrics Structure

Songs tell a story, not repeat the same thing:

```
VERSE 1 (Set the scene)
  "Paris summer, rain on cobblestone
   We were running late, dinner reservations gone"

CHORUS (The emotional anchor)
  "Dancing with you in the pouring rain
   Sarah, I'd do it all again"

VERSE 2 (The moment unfolds)
  "The storm came fast, but we didn't care
   Your laugh echoed through the midnight air"

CHORUS (Callback with variation)
  "Dancing with you in the pouring rain
   Every drop felt like champagne"

BRIDGE (The meaning/realization)
  "That's when I knew, under that cafe light
   You were my forever, my Paris night"

OUTRO (Resolution)
  "Still dancing with you..."
```

**Duration target:** 60-90 seconds (under 90s hard limit)

---

## Lyrics Iteration

### Reroll Options

```
┌─────────────────────────────────────────┐
│  VERSE 1                                │
│  "Paris summer, rain on cobblestone..." │
│  [Reroll Section] [Edit Line ✏️]        │
├─────────────────────────────────────────┤
│  CHORUS                                 │
│  "Dancing with you, nothing else..."    │
│  [Reroll Section] [Edit Line ✏️]        │
├─────────────────────────────────────────┤
│  ...                                    │
└─────────────────────────────────────────┘

[General Feedback: _____________________ ]
[Reroll Everything]
[Approve & Generate Preview →]
```

### Reroll Limits

| Type | Limit | Reason |
|------|-------|--------|
| Section reroll | 10 per section | Prevent abuse |
| Full reroll | 10 per track | API cost control |
| Line edits | Unlimited | Low cost (no generation) |
| General feedback | 5 per track | Expensive (full regen) |

---

## Pricing Model

**Free exploration, pay for production:**

| Action | Cost |
|--------|------|
| Memory capture | Free |
| Lyrics generation | Free |
| All rerolls | Free |
| Preview (guide vocal) | Free |
| **Full render (voice conversion)** | **1 credit** |

---

## Session Persistence

- **Auto-save:** Drafts saved automatically after each step
- **TTL:** 24-hour expiry on drafts
- **Resume:** "Continue your song for Sarah" on return
- **Cleanup:** Background job removes expired drafts

---

## LLM Provider Architecture

### Multi-Provider Support

```
┌─────────────────────────────────────────────────────────────────┐
│                     LLM Provider Manager                        │
├─────────────────────────────────────────────────────────────────┤
│  Providers:                                                     │
│    - anthropic (Claude Haiku, Sonnet, Opus)                     │
│    - openai (GPT-4, GPT-4-turbo, GPT-3.5)                       │
│    - google (Gemini Pro)                                        │
│                                                                 │
│  Admin Controls:                                                │
│    - Set primary provider per task type                         │
│    - Set fallback chain                                         │
│    - Enable/disable providers                                   │
│    - View usage/cost metrics                                    │
│                                                                 │
│  Fallback Logic:                                                │
│    1. Try primary provider                                      │
│    2. On failure (timeout, rate limit, error), try fallback     │
│    3. Log failure for monitoring                                │
│    4. If all fail, return graceful error                        │
└─────────────────────────────────────────────────────────────────┘
```

### Default Configuration

| Task | Primary | Fallback | Reason |
|------|---------|----------|--------|
| Follow-up questions | Claude Haiku | GPT-3.5-turbo | Fast, cheap, simple |
| Lyrics generation | Claude Sonnet | GPT-4-turbo | Quality matters |
| Style suggestion | Claude Haiku | GPT-3.5-turbo | Simple classification |
| Content moderation | Claude Haiku | GPT-3.5-turbo | Fast validation |

### Provider Config Schema

```javascript
// src/config/llm-providers.js
{
  providers: {
    anthropic: {
      enabled: true,
      apiKey: process.env.ANTHROPIC_API_KEY,
      models: {
        haiku: "claude-3-haiku-20240307",
        sonnet: "claude-sonnet-4-20250514",
        opus: "claude-opus-4-20250514"
      }
    },
    openai: {
      enabled: true,
      apiKey: process.env.OPENAI_API_KEY,
      models: {
        gpt4: "gpt-4-turbo",
        gpt35: "gpt-3.5-turbo"
      }
    }
  },
  tasks: {
    followup_questions: { primary: "anthropic:haiku", fallback: "openai:gpt35" },
    lyrics_generation: { primary: "anthropic:sonnet", fallback: "openai:gpt4" },
    style_suggestion: { primary: "anthropic:haiku", fallback: "openai:gpt35" },
    moderation: { primary: "anthropic:haiku", fallback: "openai:gpt35" }
  },
  fallback: {
    maxRetries: 2,
    timeoutMs: 30000,
    retryDelayMs: 1000
  }
}
```

---

## Schema Changes

### Migration: 012_track_lyrics_flow.sql

```sql
-- Draft tracking
ALTER TABLE tracks ADD COLUMN draft_expires_at TEXT;
ALTER TABLE tracks ADD COLUMN draft_step TEXT;
  -- Values: 'memory', 'style', 'lyrics', 'preview', 'complete'

-- Lyrics sections for granular reroll
ALTER TABLE track_versions ADD COLUMN lyrics_sections_json TEXT;
  -- { "verse1": "...", "chorus": "...", "verse2": "...", "bridge": "...", "outro": "..." }

-- Reroll tracking
ALTER TABLE track_versions ADD COLUMN reroll_count INTEGER DEFAULT 0;
ALTER TABLE track_versions ADD COLUMN section_reroll_counts_json TEXT;
  -- { "verse1": 2, "chorus": 1, "bridge": 0 }

-- AI interaction log
ALTER TABLE tracks ADD COLUMN memory_questions_json TEXT;
  -- [{ "question": "...", "answer": "...", "ai_generated": true }]

-- Style suggestion
ALTER TABLE tracks ADD COLUMN ai_suggested_style TEXT;
ALTER TABLE tracks ADD COLUMN user_selected_style TEXT;

-- Index for draft cleanup job
CREATE INDEX idx_tracks_draft_expires ON tracks (draft_expires_at)
  WHERE draft_expires_at IS NOT NULL;
```

### Expanded story_context_json Structure

```javascript
{
  "core_memory": "Dancing in the rain in Paris",
  "questions": [
    { "q": "Who is this for?", "a": "Sarah", "ai_generated": false },
    { "q": "What's the occasion?", "a": "Anniversary", "ai_generated": false },
    { "q": "What ONE memory?", "a": "Dancing in Paris rain", "ai_generated": false },
    { "q": "When did this happen?", "a": "Summer 2019", "ai_generated": true },
    { "q": "What made it unforgettable?", "a": "Got caught in storm", "ai_generated": true }
  ],
  "depth_level": 1,  // 0=core only, 1=told more once, 2+=deep dive
  "ai_suggested_style": "ballad",
  "user_overrode_style": false
}
```

---

## API Endpoints

### Memory Capture

```
POST /tracks/draft
  → Creates draft track, returns track_id

PUT /tracks/:id/memory
  Body: { question_index: 3, answer: "Summer 2019" }
  → Saves answer, returns next AI-generated question (if any)

POST /tracks/:id/memory/more
  → Generates additional depth questions

PUT /tracks/:id/style
  Body: { style: "ballad" }  // or null to accept AI suggestion
  → Confirms style selection
```

### Lyrics

```
POST /tracks/:id/lyrics/generate
  → Generates full lyrics based on memory context
  → Returns { lyrics_sections: {...}, full_lyrics: "..." }

POST /tracks/:id/lyrics/reroll
  Body: { section: "verse1" }  // or null for full reroll
  → Regenerates specific section or all

PUT /tracks/:id/lyrics/section/:section
  Body: { line_index: 2, new_text: "..." }
  → Edits specific line in section

POST /tracks/:id/lyrics/feedback
  Body: { feedback: "Make the chorus more emotional" }
  → Regenerates with feedback context

POST /tracks/:id/lyrics/approve
  → Locks lyrics, enables preview generation
```

### Preview & Render

```
POST /tracks/:id/preview
  → Generates guide vocal preview (~15-25s chorus)
  → Returns { job_id, estimated_sec }

GET /tracks/:id/preview/status
  → Poll for completion

POST /tracks/:id/render
  → Full voice conversion render (charges credits)
  → Returns { job_id, estimated_sec }

GET /tracks/:id/render/status
  → Poll for completion
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Memory blocked by moderation | Error at step 3, "Please rephrase your memory" |
| No voice profile | Block at POST /tracks/draft, redirect to enrollment |
| Very short memory (<10 chars) | Prompt: "Tell us a bit more about this memory" |
| Very long memory (>500 chars) | Accept, truncate in LLM prompt |
| Lyrics generation failure | Retry 3x with fallback provider, then "Please try again" |
| 24h draft expiry | Background job cleans up, optional push notification |
| Max rerolls exceeded | "You've reached the limit. Approve current or start fresh" |
| LLM provider outage | Automatic fallback to secondary provider |
| All providers fail | Graceful error: "Service temporarily unavailable" |

---

## Implementation Phases

### Phase 3.1: Content Moderation (Priority: Critical)
- Create `src/services/content-filter.js`
- Enhance `src/providers/moderation.js`
- Block profanity, hate speech, prompt injection

### Phase 3.2: LLM Provider Manager (Priority: Critical)
- Create `src/services/llm-provider.js`
- Multi-provider support with fallback
- Admin configuration

### Phase 3.3: Memory Capture Flow (Priority: High)
- Draft creation endpoint
- AI-generated follow-up questions
- Style suggestion

### Phase 3.4: Lyrics Generation (Priority: High)
- Story-driven lyrics prompt
- Section-based structure
- Anchor enforcement (recipient name in chorus)

### Phase 3.5: Lyrics Iteration (Priority: High)
- Section reroll
- Line editing
- General feedback

### Phase 3.6: Preview & Render (Priority: High)
- Guide vocal preview
- Full voice conversion
- Credit charging

### Phase 3.7: Session Persistence (Priority: Medium)
- Auto-save drafts
- 24h TTL
- Cleanup job

---

## Security Considerations

| Risk | Mitigation |
|------|------------|
| Prompt injection in memory | Sanitize before LLM, content-filter.js |
| Profanity bypass attempts | Re-moderate generated lyrics |
| Excessive API usage | Reroll limits, rate limiting |
| Stale drafts accumulating | 24h TTL + cleanup job |
| LLM API key exposure | Server-side only, env vars |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Memory capture completion | >80% |
| Lyrics approval rate (no rerolls) | >60% |
| Preview → Full render conversion | >70% |
| Average rerolls per track | <3 |
| Draft abandonment rate | <30% |

---

## Open Questions

1. **Multi-language support?** - Defer to post-MVP
2. **Collaborative creation?** - Defer to post-MVP
3. **Template lyrics fallback?** - If all LLMs fail, show "try again later"

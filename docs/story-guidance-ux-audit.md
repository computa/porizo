# Story Guidance AI — UX Audit Report

**Date:** 2026-04-04  
**Tester:** Automated (XcodeBuildMCP + manual observation)  
**Flow:** Song creation for "Sarah" (Birthday, Pop)  
**Backend:** DEV_MODE with Gemini + OpenAI fallback  

---

## Test Scenario

Creating a birthday song for a best friend named Sarah. The goal was to complete the story flow and reach song creation, then share on Facebook.

## Full Conversation Transcript

### Round 1 — User's Initial Story

**System prompt:** "Tell me about the story with Sarah that you want to turn into a song. What's a moment or memory that stands out?"

**User input:**
> Sarah has been my best friend since college. She showed up with ice cream during my worst breakup and made me laugh when I thought I could not smile again. Every summer we dance in the park and one time she slipped in a puddle and we all laughed so hard we cried. She makes me feel truly known and loved and I want her to feel that same warmth on her birthday.

**Assessment of user input:** This is a rich, emotionally complete story. It contains:
- Relationship context (best friends since college)
- Specific memory #1 (ice cream during breakup — emotional support)
- Specific memory #2 (puddle incident — joy and laughter)
- Sensory detail (danced in the park, laughed so hard we cried)
- Emotional meaning (feel truly known and loved)
- Birthday connection (want her to feel that warmth)

**AI response:**
- Stage: "Exploring"
- Question: "What would it have meant if things went differently?"
- Guidance card: "FROM YOUR STORY: 'Every summer, Sarah dance in the park'"
- Critique: "The story mentions specific events like the breakup and the park dance, but lacks sensory details to make them vivid."
- Suggestion: "Can you describe the specific flavor of ice cream you brought during Sarah's breakup, or the song that was playing when you slipped in the puddle?"

**Problems with AI response:**
1. The story already had emotional depth and vivid moments. Asking for ice cream flavors is nitpicking.
2. "What would it have meant if things went differently?" is an overly philosophical question for a birthday song.
3. The FROM YOUR STORY quote is grammatically broken: "Sarah dance in the park" (missing "s").
4. The question about "what if things went differently" doesn't help build a birthday song — it creates hypothetical sadness.

### Round 2 — User Adds Sensory Detail

**User input:**
> Yes mint chocolate chip and Dancing Queen was playing when she fell

**AI response:**
- Stage: still "Exploring"
- Question: "Tell me more about what makes your relationship special."
- Critique: "The story highlights fun moments, but it doesn't quite capture the deeper connection that makes your friendship with Sarah special."
- Suggestion: "Beyond the fun times, what's a specific instance where Sarah truly 'got' you, especially during a challenging time?"

**Problems with AI response:**
1. **Forgot previous context** — The user already described the breakup ice cream moment (Sarah showing up during hardest time). That IS the "specific instance where Sarah truly 'got' you." The AI isn't tracking answered questions.
2. Still "Exploring" — no progress indication after 2 rounds of detailed input.
3. The guidance feels repetitive — asking for emotional depth that was already provided in Round 1.

### Round 3 — User Adds Emotional Depth

**User input:**
> When I was doubting my career path Sarah said you are the bravest person I know and that one sentence changed everything for me

**AI response:**
- Stage: still "Exploring"  
- Question: "What was at stake for you in your career when Sarah gave you that encouragement?"
- Critique: "The story mentions Sarah bringing ice cream during a breakup, but lacks specific details to make the moment vivid."
- Suggestion: "What kind of ice cream did Sarah bring during your breakup?"

**Problems with AI response:**
1. **ASKED THE SAME QUESTION AGAIN** — The user already answered "mint chocolate chip" in Round 2. The AI completely forgot.
2. After 3 rounds of rich, emotional input, the system still says "Exploring" with no completion in sight.
3. The career encouragement moment — "you are the bravest person I know" — is a perfect song lyric moment. The AI should have recognized this as a turning point and moved toward completion.
4. The tone is still critical rather than encouraging.

### Result: Story Never Completed

After 3 rounds (with a total of ~120 words of rich, emotional input), the story was never marked as complete. The "Done — ready to create" button never appeared (after our fix to only show it when server confirms completion). The flow was effectively stuck.

---

## Root Cause Analysis

### 1. No Accumulated State Across Rounds

The story reasoner evaluates completeness each round without tracking what's been gathered. Each LLM call re-analyzes from scratch and finds new things to critique. This creates an infinite loop where the AI always finds something missing.

**Fix:** Maintain a "fact inventory" checklist:
- [ ] Relationship type & duration
- [ ] At least one specific memory
- [ ] Sensory/concrete detail
- [ ] Emotional meaning / why it matters
- [ ] Connection to occasion

Once 4/5 are checked, mark complete. Don't require perfection.

### 2. Ice Cream Amnesia (Context Not Carried Forward)

The reasoner asked about ice cream flavor in Round 1, got the answer in Round 2, then asked again in Round 3. The answered-question tracking is broken.

**Fix:** Pass the full conversation history to the LLM with clear markers of which questions have been answered. Or better — extract facts from each round and exclude them from future guidance.

### 3. Completeness Threshold Too High

The system requires a level of story detail that most casual users won't provide. A birthday song doesn't need Pulitzer-level narrative depth. The AI keeps pushing for "sensory details," "emotional truth," and "deeper connection" even when the story has plenty.

**Fix:** Calibrate completeness to the output format. A 60-second pop birthday song needs: a name, an occasion, 1-2 specific memories, and a feeling. That's it. The current threshold is set for a memoir.

### 4. Questions Are Abstract, Not Conversational

Examples of questions that confuse rather than help:
- "What is the emotional truth of this story, not just the timeline?"
- "What would it have meant if things went differently?"
- "What was at stake for you in your career?"

These are therapy questions, not song-creation questions. Users came to make a birthday song, not write a personal essay.

**Fix:** Use concrete, answerable questions:
- "What's one thing only Sarah would do?"
- "If you could put one moment in the song, which one?"
- "How do you want Sarah to feel when she hears this?"

### 5. Tone Is Critical, Not Encouraging

The guidance cards start with "The story mentions X, but lacks Y..." This frames the user's heartfelt story as inadequate. Every response feels like a rejection.

**Fix:** Lead with validation, then gently ask for more:
- "I love the puddle story! Now help me picture it — what song was playing?"
- "The ice cream moment is perfect. Was there a flavor? A movie you watched?"
- "This is going to make Sarah cry (happy tears). One more detail and we're ready."

### 6. No "Good Enough" Escape Hatch

After Round 2, the user should be able to say "that's enough, create it." The AI will always want more. Users don't have infinite patience.

**Fix:** After 2 rounds, always show a "Create anyway" option alongside the guidance. Let the user choose between adding more detail or proceeding with what they have. The AI can note "your song will be more personal with one more detail" but shouldn't block creation.

### 7. No Progress Feedback

The stage label stayed at "Exploring" for all 3+ rounds. Users have no idea if they're close to done or just starting. This kills motivation.

**Fix:** Show a story strength meter or phase progression:
- Round 1: "Getting to know your story" (1/3 bars)
- Round 2: "Adding color and detail" (2/3 bars)  
- Round 3: "Almost there!" (3/3 bars) → auto-complete

### 8. FROM YOUR STORY Quotes Are Broken

The quote extraction produces grammatically incorrect fragments:
- "Sarah dance in the park" (missing conjugation)
- "Sarah, it's true Sarah've been best friends" (nonsensical)

These appear prominently in the guidance card and undermine trust in the system.

**Fix:** Either quote verbatim from the user's actual text or don't quote at all. Never paraphrase into broken grammar.

---

## Recommendations Priority

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| P0 | Completeness threshold too high (songs never finish) | Blocks entire flow | Medium |
| P0 | No "good enough" escape after 2 rounds | Users abandon | Low |
| P1 | Context amnesia (asks same questions) | Frustrating loop | Medium |
| P1 | Tone: critical → encouraging | Emotional product needs warm UX | Medium |
| P1 | Questions too abstract | Confuses casual users | Medium |
| P2 | Progress indicator | Motivation and clarity | Low |
| P2 | FROM YOUR STORY quote quality | Trust and polish | Low |
| P3 | Suggestion verbosity | Minor friction | Low |

---

## Comparison: What Good Guidance Looks Like

**Current (what the AI does):**
> The story mentions being best friends and dancing in the park, but it doesn't explain *why* Sarah is your best friend or what makes your bond unique. It needs specific details to show the depth of your friendship.
> 
> What shared experiences or personality traits make your friendship with Sarah so special?

**Ideal (what it should do):**
> Great start! I can already picture Sarah dancing in that park. To make the song really hit home:
>
> What's one thing Sarah does that nobody else does? (like how she showed up with ice cream — love that detail)

The ideal version:
1. Validates what the user shared
2. References a specific thing they said (builds rapport)
3. Asks ONE concrete question (not three abstract ones)
4. Keeps it conversational and warm

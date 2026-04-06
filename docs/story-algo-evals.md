# Story Guidance Algorithm — Autoresearch Eval Framework

## What We're Testing

Three capabilities of the story guidance system:

### 1. Story Reconstruction (Algo Quality)
Does the algorithm take raw user input and produce a good emotional narrative summary?

**Eval criteria:**
- Does the summary capture the KEY emotional moment from the input? (not just restate facts)
- Does the summary mention the recipient by name?
- Does the summary include at least one specific detail from the user's input? (not generic)
- Is the summary written in a way that could become song lyrics? (emotional, not clinical)

### 2. Question Relevance (Gap Filling)
When story elements are missing, does the AI ask the RIGHT question to fill that specific gap?

**Eval criteria:**
- Does the question target the weakest/missing Labov element? (not a random topic)
- Does the question build on something the user ALREADY said? (Yes, And — not a template)
- Is the question specific enough that the user knows exactly what to answer?
- Does the question avoid re-asking something already covered?

### 3. Guidance Quality (User Help)
Are the suggestions actionable enough that a user could follow them?

**Eval criteria:**
- Are suggestions specific to THIS story? (not generic like "add more detail")
- Are suggestions short enough to be tappable chips? (under 8 words each)
- Do suggestions give the user a concrete starting point? (not vague directions)

---

## Binary Evals for Autoresearch

### Test Inputs (5 scenarios, varying completeness)

**Input 1 — Rich (should be READY in 1 round):**
```
Sarah has been my best friend since college. She showed up with mint chocolate chip 
ice cream during my worst breakup and made me laugh when I thought I could not smile 
again. Every summer we dance in the park and one time she slipped in a puddle while 
Dancing Queen was playing and we laughed so hard we cried. She makes me feel truly 
known and loved.
```
Occasion: birthday, Recipient: Sarah

**Input 2 — Moderate (needs 1 follow-up):**
```
My dad taught me everything I know about fishing. We used to go every Saturday morning.
```
Occasion: birthday, Recipient: Dad

**Input 3 — Sparse (needs guidance):**
```
Happy birthday mom
```
Occasion: birthday, Recipient: Mom

**Input 4 — Emotional/Tribute (should handle sensitively):**
```
I will never forget the high-risk pregnancy of the twins. There was fear, pain, and 
uncertainty. But she stayed strong through every appointment, every scare. That was 
love in action. Watching her become a mother changed everything.
```
Occasion: mothers_day, Recipient: Chioma

**Input 5 — Friendship with humor:**
```
Jake and I have been causing trouble since high school. He once convinced me to enter 
a hot dog eating contest and I threw up on the judges table. We still laugh about it 
ten years later.
```
Occasion: friendship, Recipient: Jake

---

### Eval 1: Story Reconstruction Quality
```
EVAL 1: Narrative captures emotional core
Question: Does the AI's narrative/summary mention the specific emotional moment 
  from the user's input (not just restate generic facts)?
Pass: The narrative references AT LEAST ONE specific memory/event the user described
  (e.g., "ice cream during the breakup", "fishing on Saturday", "hot dog contest")
Fail: The narrative is generic (e.g., "you have a special bond") without referencing
  any specific moment the user shared
```

```
EVAL 2: Narrative mentions recipient by name
Question: Does the AI's narrative include the recipient's name?
Pass: The name appears in the narrative text
Fail: The narrative uses only generic references ("your friend", "the recipient")
```

### Eval 3: Question Relevance
```
EVAL 3: Question targets the weakest element
Question: Does the AI's follow-up question address the MOST NEEDED story element
  (the one with lowest Labov strength that has highest weight)?
Pass: The question clearly targets what's missing (e.g., asks about feelings when
  evaluation is low, asks about a specific moment when complicating_action is low)
Fail: The question asks about something already covered, or asks a random/generic
  question unrelated to the gap
```

```
EVAL 4: Question builds on user's input (Yes-And)
Question: Does the follow-up question reference something specific the user said?
Pass: The question mentions or builds on a detail from the user's message
  (e.g., "The fishing trips on Saturday mornings — was there one trip that 
  stands out?")
Fail: The question is generic and could apply to any story
  (e.g., "Can you tell me more about your relationship?")
```

```
EVAL 5: Question is answerable (not abstract)
Question: Could a user immediately answer this question without thinking hard?
Pass: The question asks for a concrete, specific thing
  (e.g., "What did she say when she showed up with the ice cream?")
Fail: The question is abstract/philosophical
  (e.g., "What is the emotional truth of this story?")
```

### Eval 6: Guidance Quality
```
EVAL 6: Suggestions are story-specific
Question: Are the suggestion chips specific to THIS user's story?
Pass: At least 2 of 3 suggestions reference details from the user's input
  (e.g., "The puddle moment", "Her laugh", "Saturday fishing")
Fail: Suggestions are generic templates
  (e.g., "Add more detail", "Describe the setting", "Share a memory")
```

---

## Scoring

- 6 evals × 5 test inputs = 30 checks per run
- Max score: 30
- Baseline target: measure current system
- Optimization target: 90%+ (27/30)

## Target Prompts to Mutate

1. `src/writer/v3/prompts/reason-v3.md` — Main writer (controls narrative, questions, suggestions)
2. `src/writer/v3/prompts/reason-v3-selection.md` — Selection (controls fact extraction)

## API for Autoresearch

Use `POST /debug/story/full-round` to run each test input through the full pipeline.
Response contains: `ai_response.narrative`, `ai_response.question`, `ai_response.suggestions`, `labov.elements`

All evals can be scored programmatically by checking the response fields.

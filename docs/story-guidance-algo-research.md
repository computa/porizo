# Story Guidance Algorithm — Research Reference

**Date:** 2026-04-04  
**Purpose:** Reference document for improving Porizo's story extraction and guidance algorithm  
**Status:** Research complete, plan pending

---

## Table of Contents

1. [Core Thesis](#core-thesis)
2. [Labov's Narrative Model](#labovs-narrative-model)
3. [Information-Gain Question Selection](#information-gain-question-selection)
4. [Yes-And Conversational Technique](#yes-and-conversational-technique)
5. [Fact Tracking and Anti-Repetition](#fact-tracking-and-anti-repetition)
6. [Emotion-Sensitive Dialogue Policy](#emotion-sensitive-dialogue-policy)
7. [Funnel Questioning Strategy](#funnel-questioning-strategy)
8. [Story Quality Scoring](#story-quality-scoring)
9. [Narrative Transportation Theory](#narrative-transportation-theory)
10. [Tone Engineering for Emotional Products](#tone-engineering-for-emotional-products)
11. [Competitive Landscape](#competitive-landscape)
12. [UX Patterns from Established Apps](#ux-patterns-from-established-apps)
13. [Current System Issues (Audit Findings)](#current-system-issues)
14. [Sources](#sources)

---

## Core Thesis

Porizo's differentiator is **deep story extraction** — getting the minute personal details that transform a generic birthday song into something that makes the recipient cry. The guidance algorithm must be a skilled conversational interviewer: warm, encouraging, building on what the user says, tracking what's been gathered, knowing what's missing, and prompting for exactly the right detail at the right moment.

The goal is NOT speed-to-song (that's Suno's game). The goal is **emotional resonance of the output** — which requires complete, vivid, emotionally specific stories.

---

## Labov's Narrative Model

**Source:** William Labov's sociolinguistic research on oral personal experience narratives (1972). Computational detection: Ouyang & McKeown (LREC 2014, f-score 71.55). Updated guidelines: Kubota et al. (LREC-COLING 2024).

Labov identified 6 structural elements that naturally appear in personal stories told in conversation. This is the ideal framework for Porizo because it was developed from studying exactly the kind of input we deal with — people telling personal stories orally.

### The 6 Elements

| Element | What it captures | Song relevance | Weight | Detection signals |
|---------|-----------------|----------------|--------|-------------------|
| **Abstract** | Why is this story being told? | Sets the emotional frame | 0.05 | Summary/thesis statement, "This is about..." |
| **Orientation** | Who, when, where, what context | Scene-setting for lyrics | 0.20 | Named entities, temporal markers, locations, relationship words |
| **Complicating Action** | What happened — the events | The "story" of the song | 0.25 | Past-tense action verbs, sequential events, "and then..." |
| **Evaluation** | Why it matters emotionally | **THE emotional core** | 0.35 | Subjective language, intensifiers, "I felt...", "it meant...", comparators |
| **Resolution** | How it ended / what changed | The landing/payoff | 0.10 | Temporal conclusion markers, result clauses |
| **Coda** | Return to present / dedication | Bridge back to occasion | 0.05 | Present-tense shift, generalizations, "and that's why..." |

### Key Insight

**Evaluation carries the highest weight (0.35).** A song can work without Resolution (many great songs don't resolve — they sit in the feeling). A song can work without a Coda. But a song CANNOT work without Evaluation — the emotional meaning is what makes lyrics connect.

### Mapping to Current System

| Current 8 Slots | Labov Element | Change |
|-----------------|---------------|--------|
| `who` | Orientation | Keep |
| `moment_destination` | Orientation + Complicating Action | Merge |
| `want` | Evaluation | Merge into Evaluation |
| `blocker` | Complicating Action | Merge |
| `stakes` | Complicating Action | Merge |
| `turn` | Resolution | Keep as optional |
| `ending_feel` | Evaluation + Coda | Merge into Evaluation |
| `tone` | Meta (not Labov) | Keep as tone detection |

### Proposed Completeness Scoring

```
CompletenessScore = weighted_sum(
  has_orientation        * 0.20,   // who/when/where
  has_complicating_action * 0.25,  // what happened (specific events)
  has_evaluation         * 0.35,   // why it matters (emotional meaning)
  has_resolution         * 0.10,   // how it ended/what changed
  has_specificity_bonus  * 0.10    // named details vs generics (sensory, concrete)
)

Ready threshold: >= 0.65 (allows missing Resolution or Abstract)
High-quality threshold: >= 0.85 (all elements present with specificity)
```

---

## Information-Gain Question Selection

**Source:** "Dialogue as Discovery" (Nous framework, 2025). "Learning to Ask Informative Questions" (2024, EIG + DPO training).

### The Problem with Current Approach

The current system cycles through 8 slots sequentially or based on which slot the LLM feels like targeting. This leads to:
- Asking low-value questions when high-value ones are available
- Repeating topics already covered
- Not building on what the user just said

### Information Gain Formula

```
EIG(question) = H_prior - H_posterior
             = H_prior - (p_answer * H_after_answer)
```

**Translation:** Each unfilled Labov element has an "entropy" (uncertainty). The best question is the one whose answer would reduce the most total uncertainty.

### Practical Application

After each user message:
1. Update which Labov elements are filled (binary or strength 0-1)
2. Calculate which unfilled element has the highest uncertainty × weight
3. Generate a question that targets THAT element
4. Frame the question as building on what the user just said (Yes-And)

**Example:**
- User provided: Orientation (who/where) and Complicating Action (the puddle incident)
- Missing: Evaluation (why it matters emotionally)
- Evaluation has highest weight (0.35) × fully unfilled = highest priority
- Generated question: "That puddle moment sounds hilarious — what is it about Sarah that makes even the messy moments feel special?"

### Anti-Circular Logic

The question selector should NEVER target an element that is already at strength >= 0.6. If all weighted elements are above 0.6, the story is ready regardless of overall score.

---

## Yes-And Conversational Technique

**Source:** SPOLIN Project (USC ISI, 68,000+ improv dialogue examples). Applied to conversational AI in chatbot research.

### The Principle

In improv comedy, "Yes, And" means: accept what your partner offers (yes) and build on it (and). Applied to story extraction:

- **"Yes"** = validate/acknowledge what the user just shared
- **"And"** = ask a follow-up that deepens THEIR specific detail, not a new topic

### Bad vs Good Examples

| Pattern | Example | Problem |
|---------|---------|---------|
| **Interrogation** | "What sensory details can you provide about the park?" | Ignores what they said, asks from template |
| **Critique** | "Your story lacks specific details to make it vivid." | Makes user feel inadequate |
| **Topic jump** | User talks about ice cream moment → AI asks about career | Doesn't build on their momentum |
| **Yes, And** | "The ice cream during the breakup — that's the kind of moment that becomes a song. What did she say when she showed up?" | Validates, references their detail, deepens it |

### Implementation Pattern

The guidance LLM prompt should include:

```
RULE: Every follow-up must reference something specific from the user's
last message. Never ask a generic question. Never introduce a topic the
user didn't mention. Build on THEIR words, THEIR memories, THEIR details.

FORMAT: [Validate what they shared] + [Ask ONE follow-up that deepens it]

EXAMPLE: "The puddle and Dancing Queen — that's such a vivid moment.
What happened right after she fell? Did she just keep dancing?"
```

---

## Fact Tracking and Anti-Repetition

**Source:** MindDial framework (belief dynamics tracking with theory-of-mind). Microsoft slot-filling best practices. ACM survey on multi-turn dialogue systems.

### The Problem

Our current system asked about ice cream flavor twice even after the user answered "mint chocolate chip." The `buildFactInventory` serializes facts but the LLM re-analyzes from scratch each round.

### Solution: Explicit Fact State

After each user message, maintain a structured fact state:

```json
{
  "recipient": { "name": "Sarah", "relationship": "best friend since college" },
  "occasion": "birthday",
  "orientation": {
    "filled": true,
    "facts": ["best friends since college", "dance in the park every summer"]
  },
  "complicating_action": {
    "filled": true,
    "facts": [
      "slipped in puddle, laughed so hard they cried",
      "showed up with mint chocolate chip ice cream during breakup",
      "Dancing Queen was playing when she fell"
    ]
  },
  "evaluation": {
    "filled": false,
    "facts": ["makes me feel truly known and loved"],
    "strength": 0.4
  },
  "resolution": {
    "filled": false,
    "facts": [],
    "strength": 0.0
  },
  "tone": "warm, funny, nostalgic",
  "questions_asked": [
    "What flavor ice cream?",
    "What song was playing?"
  ]
}
```

### Anti-Repetition Rule

Before generating each guidance question, the LLM prompt MUST include:

```
ALREADY KNOWN (do NOT ask about these):
- Recipient: Sarah, best friend since college
- Ice cream flavor: mint chocolate chip
- Song playing: Dancing Queen
- Park dancing: every summer tradition
- Breakup support: she showed up with ice cream

ALREADY ASKED (do NOT repeat):
- "What flavor ice cream?" (answered: mint chocolate chip)
- "What song was playing?" (answered: Dancing Queen)

TARGET: Evaluation (emotional meaning)
The user said "makes me feel truly known and loved" but this is
still generic. We need a SPECIFIC moment that demonstrates this feeling.
```

---

## Emotion-Sensitive Dialogue Policy

**Source:** EmoWOZ dataset (LREC 2022). Emotion-Sensitive Dialogue Policy research (PMC 2024). Woebot/Wysa therapy chatbot analysis.

### Dual Action Space

Separate two types of responses:
1. **Goal responses** — advance the extraction (ask about next unfilled element)
2. **Emotional responses** — go deeper on the current emotional thread

### When to Switch

When the user shares something emotionally charged ("she showed up during my worst breakup"), the system should:

- **NOT** jump to the next slot ("What about the park setting?")
- **DO** go deeper on the emotional thread ("What did she say when she walked in?")

### Detection Signal

If the user's message contains:
- First-person emotional language ("I felt...", "it meant...", "I couldn't believe...")
- Vulnerability markers (breakup, loss, fear, relief, crying)
- Intensifiers ("the worst", "the most", "I'll never forget")

→ Switch to emotional deepening mode. Target Evaluation, not the next unfilled slot.

### Implementation

Add a simple emotional intensity score to the fact extraction call:

```json
{
  "emotional_intensity": "high",  // low | medium | high
  "emotional_thread": "Sarah's support during the breakup",
  "deepening_question": "What did she say when she showed up with that ice cream?"
}
```

When `emotional_intensity: "high"`, always deepen the current thread before moving to other slots.

---

## Funnel Questioning Strategy

**Source:** Nielsen Norman Group qualitative research methodology. Applied to conversational AI by Botpress and conversational design literature.

### Three Stages

1. **Open questions** — broad, inviting, low-pressure
   - "Tell me about a special moment with Sarah"
   - "What comes to mind when you think about your friendship?"

2. **Probing questions** — based on what they said, going deeper
   - "You mentioned dancing in the park — was there one time that really stands out?"
   - "The ice cream during the breakup — what happened when she showed up?"

3. **Closed questions** — specific detail extraction
   - "Was this before or after you moved?"
   - "Was it always mint chocolate chip, or was that her go-to comfort flavor?"

### Critical Rule

**Each subsequent question must be based on the previous answer.** Never pull from a generic question bank. This is what makes the conversation feel like a real dialogue rather than a form.

### Application to Rounds

- **Round 1** should primarily use Open questions (the user's first message)
- **Round 2** should use Probing questions (building on specifics they mentioned)
- **Round 3+** should use Closed questions (filling in vivid details)

---

## Story Quality Scoring

**Source:** Narrative transportation theory (Green & Brock). Six emotional arcs (Reagan et al., 2016). NLP memory specificity research (2025). NRC Valence-Arousal-Dominance lexicon.

### What Makes a Personal Story Good Enough for a Song

Research on narrative transportation identifies four dimensions for immersive stories:
1. **Focused attention** — the listener is drawn in
2. **Emotional engagement** — empathy/feeling
3. **Mental imagery** — the listener can "see" it
4. **Cognitive detachment** — temporarily lost in the story

For a 60-second song, the critical dimensions are **Emotional engagement** and **Mental imagery** — achieved through specific emotional moments and sensory details.

### Scoring Function

```
StoryQuality = (
  specificity_score     * 0.30 +  // named entities, concrete nouns, sensory words
  emotional_depth_score * 0.35 +  // evaluative language, intensifiers, emotion words
  arc_presence          * 0.20 +  // does the story have a shift/turn?
  uniqueness_score      * 0.15    // not a generic greeting-card sentiment
)
```

### Specificity Detection

Distinguish between:
- **Generic:** "We had fun together" (low specificity)
- **Moderate:** "We used to dance in the park" (some specificity)
- **High:** "She slipped in a puddle while Dancing Queen was playing and we laughed so hard we cried" (named song, specific event, physical detail, emotional response)

High specificity = concrete nouns, proper names, numbers, sensory words (smell, taste, sound, texture), quoted dialogue.

### Emotional Arc Detection

The most common and emotionally resonant arc for personal stories is **"Man in a hole"** (fall then rise):
- Things were good → something went wrong → it got better/we grew

For birthday/celebration songs, the arc is often:
- Here's a memory → it was meaningful because → and that's what makes you special

The scoring should detect whether the story has at least one emotional shift (not just a flat description).

---

## Narrative Transportation Theory

**Source:** Green & Brock (2000). Emotional shifts research (2022). Six emotional arcs (Reagan et al., 2016).

### Key Finding for Song Lyrics

**Emotional shifts reinforce transportation more than static emotion.** A story that moves from joy → loss → acceptance is more transporting than one that stays uniformly happy.

### Practical Implication

The guidance algorithm should:
1. Identify if the story has an emotional shift (contrast, turning point, before/after)
2. If not, prompt for one: "Was there ever a time when things weren't easy between you two?"
3. If the story is purely positive, the shift can be subtle: "What would you miss most if Sarah moved away?"

### The Six Arcs Applied to Birthday Songs

| Arc | Pattern | Song Application |
|-----|---------|-----------------|
| Rags to riches | Rise | "You changed my life" |
| Man in a hole | Fall → rise | "Through thick and thin" (most common for friendship songs) |
| Cinderella | Rise → fall → rise | "We lost touch but found each other again" |

---

## Tone Engineering for Emotional Products

**Source:** NNGroup anthropomorphism research. Botpress conversational design. Frontiers in Education (validation + engagement). Replika user studies.

### Four-Layer Tone Architecture

| Layer | Purpose | Example |
|-------|---------|---------|
| **Warmth** | Make user feel safe sharing | "That's such a sweet detail" |
| **Specificity** | Prove the AI is listening | "The part about the puddle and Dancing Queen..." |
| **Forward momentum** | Keep energy moving | "This is going to make such a beautiful song" |
| **Low bar signaling** | Prevent overthinking | "Even just that one memory gives us so much" |

### The Sandwich Pattern

Every guidance response should follow: **Affirm → Question → Encourage**

```
[Affirm] "The ice cream during the breakup — that's exactly the kind of 
moment that makes a song feel real."

[Question] "What did Sarah say when she showed up at your door?"

[Encourage] "This is going to hit her right in the heart."
```

### Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|-----------|
| "Your story lacks X" | "To make this even more vivid..." |
| "Please provide more detail" | "Help me picture that moment" |
| "What is the emotional truth?" | "How did that make you feel?" |
| Three questions in one response | ONE question, clearly stated |
| Abstract/philosophical questions | Concrete, answerable questions |

### Prompt Engineering for Tone

```
You are a warm, encouraging songwriter helping someone create a deeply 
personal song as a gift. You're excited about their story and genuinely 
moved by what they share.

Rules:
- Always acknowledge what they shared before asking anything
- Reference a specific detail from THEIR message (proves you listened)
- Keep responses to 2-3 sentences max
- Never use words like "lacks," "missing," "insufficient," "needs"
- Mirror their emotional energy (funny → light, sentimental → gentle)
- ONE question per response, clearly framed
- End with forward momentum ("this is going to be beautiful")
```

---

## Competitive Landscape

### Direct Competitors (Personalized Song)

| Product | Story Input | Follow-ups | Time to Song |
|---------|------------|------------|-------------|
| **Suno** | Single text prompt | Zero | ~60 seconds |
| **Udio** | Text prompt + optional lyrics | Zero | ~5 minutes |
| **SongR** | Genre + keywords | Zero | ~2 minutes |
| **Song Mint** | 4-step questionnaire | Fixed form | 5-10 minutes |
| **GiftSong** | Occasion + memories + vibe | Fixed form (3-4 steps) | ~5 minutes |
| **Porizo** | Conversational extraction | Multi-round (broken) | Currently infinite |

### Porizo's Differentiator

Suno/Udio create music from prompts — they're music tools. Porizo extracts **personal narratives** and converts them to songs — it's an emotional product. The depth of story extraction IS the moat. A Suno song says "happy birthday." A Porizo song says "remember when you fell in that puddle while Dancing Queen was playing."

### The Risk

If the extraction process feels like homework, users switch to Suno (instant) or GiftSong (fixed 3-step form). The guidance must feel like a conversation with an excited friend, not an interview with a therapist.

---

## UX Patterns from Established Apps

### StoryCorps — Question-List-Driven Interview
- Pre-written question lists by topic (Love, Family, Childhood)
- Open-ended by design ("Tell me about...", "What was it like when...")
- Complete freedom — users can skip prep entirely
- Warm, guiding, never prescriptive

### Storyworth — Weekly Drip Model
- One question per week for a year
- AI-personalized questions based on shared context
- Never asks for everything at once
- Low-pressure, asynchronous

### Sudowrite — Progressive Deepening with Escape Hatches
- 6 sequential stages, each with a "Generate" button
- Users can go deep on any stage or skip by hitting Generate
- Context accumulates progressively
- Every stage has an escape hatch

### Therapy Chatbots (Woebot, Wysa)
- Start with mood/emotional anchor (easy question first)
- Structured choices for initial capture, free text for depth
- Escalate gradually — surface first, deeper after trust
- Never demand long responses
- Escape at any point

### Key Cross-Cutting Rules

| Rule | Evidence |
|------|----------|
| Never block creation on "enough" detail | Suno, Udio, GiftSong |
| One question at a time | 2-3x completion rates vs forms |
| Start with the easiest question | Every therapy app |
| Structured choices + free text hybrid | Woebot, Wysa |
| Accumulate context, don't re-ask | Sudowrite, Storyworth |
| Use first output to prompt refinement | Suno (generates 2 versions), GiftSong (30s preview) |
| Praise and validation encourage sharing | Replika, therapy chatbot research |

---

## Current System Issues

Documented from hands-on flow testing (2026-04-04). Full audit: `docs/story-guidance-ux-audit.md`

### Critical Bugs

1. **Context amnesia** — Asked about ice cream flavor twice after user already answered
2. **Infinite loop** — 3 rounds of rich input, never marked complete
3. **Confirm rejection** — "Done" button appeared but confirm endpoint rejected (422)

### Design Issues

4. **Clinical tone** — "Your story lacks specific details" instead of warm encouragement
5. **Abstract questions** — "What is the emotional truth?" confuses casual users
6. **No progress feedback** — Stage label stuck at "Exploring" for all rounds
7. **Broken quotes** — FROM YOUR STORY shows grammatically incorrect fragments
8. **Over-demanding threshold** — Requires memoir-level detail for a 60-second song

### Architecture Issues

9. **8 slots too many** — Many overlap (want/ending_feel, blocker/stakes)
10. **5-stage pipeline overkill** — 5 LLM calls per follow-up question
11. **No fact deduplication** — Facts serialized but LLM re-analyzes from scratch
12. **Hard gates** — moment_destination AND ending_feel required regardless of overall quality

---

## Sources

### Academic Papers
- Labov, W. (1972). Language in the Inner City. University of Pennsylvania Press.
- Ouyang, J. & McKeown, K. (2014). Modeling Reportable Surprises in Human Narrative Summarization. LREC 2014. [aclanthology.org/L14-1108](https://aclanthology.org/L14-1108/)
- Kubota et al. (2024). Labovian Structural Analysis Guidelines. LREC-COLING 2024. [arxiv.org/html/2603.29347](https://arxiv.org/html/2603.29347)
- Reagan et al. (2016). The Emotional Arcs of Stories. [arxiv.org/abs/1606.07772](https://arxiv.org/abs/1606.07772)
- Green, M.C. & Brock, T.C. (2000). Narrative Transportation Theory. [Wikipedia summary](https://en.wikipedia.org/wiki/Transportation_theory_(psychology))

### Dialogue Systems
- Dialogue as Discovery: Nous Framework (2025). [arxiv.org/html/2510.27410v1](https://arxiv.org/html/2510.27410v1)
- Learning to Ask Informative Questions (2024). [arxiv.org/html/2406.17453v1](https://arxiv.org/html/2406.17453v1)
- MindDial: Belief Dynamics (2023). [arxiv.org/abs/2306.15253](https://arxiv.org/abs/2306.15253)
- Neural Belief Tracker (2016). [arxiv.org/abs/1606.03777](https://arxiv.org/abs/1606.03777)
- MIT Press: Dialogue State Tracking with Incremental Reasoning. [direct.mit.edu](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00384/101875/)
- FATA: First Ask Then Answer (2025). [arxiv.org/html/2508.08308v1](https://arxiv.org/html/2508.08308v1)

### Emotion & Narrative
- Emotional Shifts in Narrative Persuasion (2022). [tandfonline.com](https://www.tandfonline.com/doi/full/10.1080/15213269.2022.2103711)
- EmoWOZ: Emotion in Task-Oriented Dialogue (LREC 2022). [aclanthology.org/2022.lrec-1.436](https://aclanthology.org/2022.lrec-1.436/)
- Emotion-Sensitive Dialogue Policy (2024). [pmc.ncbi.nlm.nih.gov](https://pmc.ncbi.nlm.nih.gov/articles/PMC11347666/)
- NLP for Memory Specificity (2025). [sciencedirect.com](https://www.sciencedirect.com/science/article/abs/pii/S1364661325000543)

### UX & Product
- Nielsen Norman Group: Funnel Technique. [nngroup.com](https://www.nngroup.com/articles/the-funnel-technique-in-qualitative-user-research/)
- NNGroup: 4 Degrees of Anthropomorphism. [nngroup.com](https://www.nngroup.com/articles/anthropomorphism/)
- SPOLIN: "Yes, And" Dialogue Dataset (USC ISI). [voicebot.ai](https://voicebot.ai/2020/07/17/new-chatbot-project-turns-conversational-ai-into-an-improv-performance/)
- Botpress: Conversational AI Design (2026). [botpress.com](https://botpress.com/blog/conversation-design)
- StoryCorps App & Great Questions. [storycorps.org](https://storycorps.org/participate/great-questions/)
- Storyworth Questions Guide. [storyworth.com](https://welcome.storyworth.com/blog/a-complete-guide-to-storyworths-questions)

### LLM Evaluation
- Confident AI: LLM-as-a-Judge Guide. [confident-ai.com](https://www.confident-ai.com/blog/why-llm-as-a-judge-is-the-best-llm-evaluation-method)
- Monte Carlo Data: LLM-as-Judge Best Practices. [montecarlodata.com](https://www.montecarlodata.com/blog-llm-as-judge/)
- Evidently AI: LLM-as-Judge Complete Guide. [evidentlyai.com](https://www.evidentlyai.com/llm-guide/llm-as-a-judge)

### Therapy Chatbots
- Woebot Case Study in Conversation Design. [uxwritinghub.com](https://uxwritinghub.com/woebot-case-study-in-conversation-design-for-mental-health-products/)
- Woebot PMC Study (2017). [pmc.ncbi.nlm.nih.gov](https://pmc.ncbi.nlm.nih.gov/articles/PMC5478797/)
- Replika Analysis: Anthropomorphism & Attachment. [theconversation.com](https://theconversation.com/i-tried-the-replika-ai-companion-and-can-see-why-users-are-falling-hard-the-app-raises-serious-ethical-questions-200257)

### Creative AI
- PABST: Persona Enrichment with Background Stories (CMU). [aclanthology.org](https://aclanthology.org/2021.acl-short.74.pdf)
- SCORE: Story Coherence and Retrieval Enhancement. [arxiv.org/abs/2503.23512](https://arxiv.org/abs/2503.23512)
- Minimum Viable Prompt (Why Try AI). [whytryai.com](https://www.whytryai.com/p/minimum-viable-prompt)
- Satisficing vs Maximizing (Dr. Tricia Groff). [drtriciagroff.com](https://www.drtriciagroff.com/decision-making-models-for-leaders/)

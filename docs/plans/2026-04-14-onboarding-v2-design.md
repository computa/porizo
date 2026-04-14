# Onboarding V2: Belief Shift -> First Creation

**Date:** 2026-04-14  
**Status:** Design - revised for v1 implementation  
**Replaces:** Current 3-slide static onboarding (`OnboardingView.swift`)  
**Sources:** Brainstorm session + Codex review + adaptive questionnaire framework

---

## Problem

Users download Porizo but do not reliably register or create. The current onboarding explains features instead of making the product emotionally obvious. Users can mistake Porizo for a generic AI music tool instead of a gift product.

The onboarding job is not to build a full recipient graph or collect rich profile data. The onboarding job is to make one use case feel inevitable fast enough that the user taps `Make This Song`.

---

## Product Decision

Porizo onboarding is now split into two systems:

1. **V1 onboarding**
   A narrow first-run flow that gets a user from install to first personalized song idea as fast as possible.
2. **Profile builder**
   A later, progressive system that captures who else they care about, birthdays, reminder preferences, and deeper gifting behavior over time.

This preserves the adaptive questionnaire idea without turning first-run onboarding into CRM setup.

---

## Design Principles

1. **Show the product immediately.**
   The first screen must feel unmistakably like a personal song, even on mute.
2. **One person, one song.**
   Onboarding is about a single recipient and a single first creation.
3. **Belief shift before explanation.**
   One sharp contrast is enough. Do not lecture.
4. **Adaptive under the hood.**
   The user should experience a personal conversation, not a branching survey.
5. **Get to intent fast.**
   Every screen before `Make This Song` must directly improve first creation likelihood.
6. **Delay secondary asks.**
   Profile expansion, reminders, social proof, and permissions come later.
7. **No auth until emotional investment.**
   Identity is captured after the user has felt the product.

---

## Success Target

Download -> `Make This Song` tap in **under 70 seconds** for a decisive user.

Secondary target:
- The user leaves onboarding with one clear personalized song idea, not a vague understanding of the product.

---

## V1 Onboarding Flow (9 Screens)

### Screen 1 - Living Splash (3-5s)

**Purpose:** Immediate product comprehension.

**Visual (mandatory):**
- Animated personal-song artifact: cover art, recipient label (`For Mom`), lyric line, waveform, motion
- Warm Canvas visual language
- The screen must communicate "this is a personal song gift" even if the device is muted

**Audio (graceful, not relied upon):**
- Attempt to stream demo song from config
- If autoplay works, great
- If blocked or silent mode is active, the screen still lands without degradation
- Show an obvious play affordance if audio is not already active

**Product rule:**
- The onboarding must be visually self-sufficient
- Audio is a force multiplier, not a dependency

**Config contract:**
- `AppConfigResponse.onboarding.sample_audio_url` may be reused, or replaced by a dedicated `splash_demo_url`
- Optional metadata:
  - `splash_demo_recipient`
  - `splash_demo_lyrics_preview`

**Transition:**
- Auto-advance after 3-5 seconds or on tap

---

### Screen 2 - The Mirror (6-8s)

**Purpose:** One sharp emotional contrast.

**Copy direction:**

```text
Think about the last birthday you celebrated.

Did you send a text? Flowers? A gift card?

Do you still remember what you sent?
```

Then the landing line:

```text
Most gifts fade. A song stays.
```

**Interaction:**
- Read-only
- One CTA: `Continue`

**Design note:**
- This should feel like a mirror, not a sermon
- Keep it short and high-contrast

---

### Screen 3 - Pain Points (8-10s)

**Purpose:** Interactive self-identification. Creates psychological investment AND captures data that adapts the reframe embedded in the mirror's landing line.

**Copy direction:**

```text
What makes gifting hard?
Pick all that apply.
```

**Options (multi-select chips):**

| Label | Key | Data Use |
|-------|-----|----------|
| I'm not creative enough | `not_creative` | Adapt reframe: "You don't need to be creative" |
| I never know what to get | `dont_know_what` | Adapt reframe: "We'll suggest the perfect idea" |
| I always end up sending a text | `default_to_text` | Adapt reframe: "What if that text became a song?" |
| I forget until the last minute | `forget_timing` | Profile builder: emphasize reminders later |
| Nothing feels personal enough | `not_personal` | Adapt reframe: "That's exactly what we fix" |

**Interaction:**
- Multi-select Warm Canvas chips (surface bg, 12px radius, coral border on selection)
- At least one required
- Continue button at bottom

**Data captured:**
- `pain_points[]` — feeds reframe adaptation, profile builder emphasis, marketing analytics

**Why this stays in onboarding:**
- It's interactive, not passive (10 seconds, not 10 minutes)
- It makes users feel understood before asking them to commit
- The data directly improves the mirror's landing line and later profile suggestions

---

### Screen 4 - Goal Question (3-5s)

**Purpose:** Psychological investment. The user self-identifies their intent, which makes them feel the app owes them a solution. Also feeds the suggestion engine.

**Copy direction:**

```text
What brought you here today?
```

**Options (single-select chips):**

| Label | Key | Data Use |
|-------|-----|----------|
| Surprise someone for their birthday | `birthday_surprise` | Pre-select birthday occasion |
| Say something I've never been able to say | `unsaid_words` | Weight gratitude emotional seeds |
| Create a gift that actually means something | `meaningful_gift` | Neutral path |
| Preserve a special memory | `preserve_memory` | Weight memory-based seeds |
| Just exploring | `exploring` | Neutral path |

**Interaction:**
- Single-select, auto-advances on tap

**Data captured:**
- `goal_intent` — pre-selects occasion, weights emotional seed ordering, analytics

---

### Screen 5 - Pick One Person (3-5s)

**Purpose:** Move from abstract gifting to one concrete recipient.

**Copy direction:**

```text
Who deserves something unforgettable?
```

**Interaction:**
- Single-select grid
- Options:
  - Mom
  - Dad
  - Partner
  - Sister
  - Brother
  - Best Friend
  - Son
  - Daughter
  - Grandparent
  - Someone Else
- Tap selects and auto-advances after a short delay

**Data captured:**
- `relationship_type`

---

### Screen 6 - Name Them (3-5s)

**Purpose:** Turn the recipient into a real person.

**Copy direction (adaptive):**
- `What's your mom's name?`
- `What's your partner's name?`
- `What's your best friend's name?`
- Fallback: `Who is this for?`

**Interaction:**
- Single text field
- Continue enabled at >= 2 characters

**Data captured:**
- `recipient_name`

---

### Screen 7 - The Emotional Seed (10-15s)

**Purpose:** Capture the lyric seed with one adaptive prompt.

This is where the adaptive engine matters. The graph should branch by relationship type, but the user should only feel that the app is asking the right question.

**Prompt families:**

**Mom / Dad**
```text
Is there something you've always wanted
to say to {name}, but never found the words?
```
Quick picks:
- Thank you for everything
- A childhood memory together
- Something I've never said out loud
- Write your own

**Partner**
```text
What moment is just yours and {name}'s?
```
Quick picks:
- How we first met
- An inside joke only we get
- Something I want them to always remember
- Write your own

**Sibling**
```text
What would {name} instantly recognize
as something only you two share?
```
Quick picks:
- Growing up together
- An inside joke
- Something we survived together
- Write your own

**Best Friend**
```text
What's the story only you and {name} know?
```
Quick picks:
- How we became friends
- The thing we always laugh about
- A moment that changed everything
- Write your own

**Child**
```text
What do you want {name} to always remember?
```
Quick picks:
- How proud I am
- A moment that made me smile
- Something I want to pass on
- Write your own

**Grandparent / Other**
```text
What makes {name} unforgettable?
```
Quick picks:
- A memory I treasure
- Something I've always admired
- A moment I want to preserve
- Write your own

**Interaction:**
- Quick-pick chips or free text
- Continue enabled after one valid choice

**Data captured:**
- `emotional_seed`

---

### Screen 8 - Occasion (Optional, 3-5s)

**Purpose:** Add context without making the flow feel formal or blocked.

**Copy direction:**

```text
Is this for something special?
```

**Options:**
- Just Because
- Birthday
- Anniversary
- Thank You
- Graduation
- Wedding

**Interaction:**
- Single-select chips
- `Just Because` should feel like the default path, not a lesser option

**Data captured:**
- `occasion` (nullable)

---

### Screen 9 - The Payoff (8-10s)

**Purpose:** Present one personalized first song idea so strong that tapping `Make This Song` feels obvious.

**Input data:**
- `recipient_name`
- `relationship_type`
- `emotional_seed`
- `occasion`

**Display shape:**
- Headline:
  - `Your first forever gift for Linda`
- Song card:
  - suggested title
  - emotional angle
  - short preview line
- Primary CTA:
  - `Make This Song`
- Secondary action:
  - `Maybe later`

**Critical product rule:**
- The payoff cannot depend exclusively on an LLM
- There must be a deterministic fallback template path if the suggestion service is slow, offline, or unavailable

**Suggested implementation:**
1. Build a local/server template suggestion from the captured inputs
2. Optionally enhance it with an LLM when available
3. Never block the payoff on model latency

**Example request:**

```json
{
  "recipient_name": "Linda",
  "relationship_type": "mom",
  "emotional_seed": "A childhood memory together",
  "occasion": "birthday"
}
```

**Example response shape:**

```json
{
  "title": "Summer at the Lake",
  "emotional_angle": "A birthday song for Linda about the summers that shaped everything",
  "preview_line": "Remember when the water was too cold but we jumped in anyway...",
  "source": "template_or_llm"
}
```

**CTA behavior:**
- `Make This Song`
  - persists pending context
  - enters creation flow directly
  - no auth gate
- `Maybe later`
  - marks onboarding complete
  - should preserve the suggestion somewhere visible in-app
  - must not discard the emotional work the user just did

**Do not do in v1:**
- no notification permission ask here
- no social proof here
- no additional persuasion screens after payoff

---

## What Was Deferred From Onboarding V1

The following are intentionally **not** part of first-run onboarding:

- `Social Proof` — deferrable; can be added if drop-off data shows trust gap
- `Notification Priming` — better as in-context prompt when song creation starts
- Multi-person profiling
- Birthday/reminder setup
- Love-language / gifting-personality quiz

These are not discarded. They are moved to later systems where they support retention rather than block first creation.

**Kept in onboarding v1 (restored from original design):**
- `Pain Points` — interactive, 10 seconds, feeds reframe adaptation + marketing data
- `Goal Question` — psychological investment, 5 seconds, feeds suggestion engine

---

## Phase 2 - Profile Builder (Post-First-Song)

This is where the broader adaptive questionnaire belongs.

**Trigger:** After first successful creation, or after first meaningful app session following creation.

**Purpose:**
- expand from one recipient to a personal gifting graph
- collect reminder-worthy dates
- improve future suggestions
- power recurring gifting and retention

### Entry Prompt

```text
Who else deserves a forever gift?
```

### Flow

1. Add another person
2. Choose relationship type
3. Enter name
4. Optionally add birthday or important date
5. Optionally enable reminders
6. Optionally answer deeper relationship prompts

### Questions relocated from onboarding

- `What makes gifting hard?`
- `What brought you here today?`
- `Who else matters to you?`
- `How do you usually show love?`
- `What's something your {relationship} would cherish from you?`
- `Do you want reminders before important dates?`

### Retention use cases

- birthday reminders
- occasion suggestions
- relationship-specific inspiration prompts
- reminder nudges tied to upcoming dates
- deeper preference learning over time

### Data model

Either:
- introduce a `recipients` table, or
- model this as a richer user-profile graph

Minimum fields:
- `id`
- `user_id`
- `name`
- `relationship_type`
- `birthday`
- `reminder_enabled`
- `created_at`

---

## Adaptive Question Graph

The adaptive engine remains, but its first-run scope is smaller.

### V1 graph scope

The graph supports:
- `pain_points` (multi-select)
- `goal_question` (single-select)
- `relationship_picker` (single-select)
- `name_entry` (text input)
- `emotional_seed_{relationship}` (single-select or free text, one per relationship type)
- `occasion_picker` (single-select)
- `payoff` (terminal)

### V1 graph JSON

```json
{
  "version": 1,
  "entry_node": "pain_points",
  "nodes": {
    "pain_points": {
      "type": "multi_select",
      "question": "What makes gifting hard?",
      "subtitle": "Pick all that apply.",
      "options": [
        { "label": "I'm not creative enough", "value": "not_creative" },
        { "label": "I never know what to get", "value": "dont_know_what" },
        { "label": "I always end up sending a text", "value": "default_to_text" },
        { "label": "I forget until the last minute", "value": "forget_timing" },
        { "label": "Nothing feels personal enough", "value": "not_personal" }
      ],
      "min_selections": 1,
      "next": "goal_question"
    },
    "goal_question": {
      "type": "single_select",
      "question": "What brought you here today?",
      "options": [
        { "label": "Surprise someone for their birthday", "value": "birthday_surprise" },
        { "label": "Say something I've never been able to say", "value": "unsaid_words" },
        { "label": "Create a gift that actually means something", "value": "meaningful_gift" },
        { "label": "Preserve a special memory", "value": "preserve_memory" },
        { "label": "Just exploring", "value": "exploring" }
      ],
      "next": "relationship_picker"
    },
    "relationship_picker": {
      "type": "single_select",
      "question": "Who deserves something unforgettable?",
      "options": [
        { "label": "Mom", "value": "mom" },
        { "label": "Dad", "value": "dad" },
        { "label": "Partner", "value": "partner" },
        { "label": "Sister", "value": "sister" },
        { "label": "Brother", "value": "brother" },
        { "label": "Best Friend", "value": "best_friend" },
        { "label": "Son", "value": "son" },
        { "label": "Daughter", "value": "daughter" },
        { "label": "Grandparent", "value": "grandparent" },
        { "label": "Someone Else", "value": "other" }
      ],
      "next": "name_entry"
    },
    "name_entry": {
      "type": "text_input",
      "question_template": "What's your {relationship_label}'s name?",
      "fallback_question": "Who is this for?",
      "next": "emotional_seed_{relationship_type}"
    },
    "emotional_seed_mom": {
      "type": "single_select_or_text",
      "question_template": "Is there something you've always wanted to say to {name}, but never found the words?",
      "options": [
        { "label": "Thank you for everything", "value": "thank_you_everything" },
        { "label": "A childhood memory together", "value": "childhood_memory" },
        { "label": "Something I've never said out loud", "value": "unsaid_words" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_dad": {
      "type": "single_select_or_text",
      "question_template": "Is there something you've always wanted to say to {name}, but never found the words?",
      "options": [
        { "label": "Thank you for everything", "value": "thank_you_everything" },
        { "label": "A childhood memory together", "value": "childhood_memory" },
        { "label": "Something I've never said out loud", "value": "unsaid_words" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_partner": {
      "type": "single_select_or_text",
      "question_template": "What moment is just yours and {name}'s?",
      "options": [
        { "label": "How we first met", "value": "first_met" },
        { "label": "An inside joke only we get", "value": "inside_joke" },
        { "label": "Something I want them to always remember", "value": "always_remember" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_sister": {
      "type": "single_select_or_text",
      "question_template": "What would {name} instantly recognize as something only you two share?",
      "options": [
        { "label": "Growing up together", "value": "growing_up" },
        { "label": "An inside joke", "value": "inside_joke" },
        { "label": "Something we survived together", "value": "survived_together" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_brother": {
      "type": "single_select_or_text",
      "question_template": "What would {name} instantly recognize as something only you two share?",
      "options": [
        { "label": "Growing up together", "value": "growing_up" },
        { "label": "An inside joke", "value": "inside_joke" },
        { "label": "Something we survived together", "value": "survived_together" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_best_friend": {
      "type": "single_select_or_text",
      "question_template": "What's the story only you and {name} know?",
      "options": [
        { "label": "How we became friends", "value": "how_we_met" },
        { "label": "The thing we always laugh about", "value": "always_laugh" },
        { "label": "A moment that changed everything", "value": "changed_everything" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_son": {
      "type": "single_select_or_text",
      "question_template": "What do you want {name} to always remember?",
      "options": [
        { "label": "How proud I am", "value": "proud" },
        { "label": "A moment that made me smile", "value": "made_me_smile" },
        { "label": "Something I want to pass on", "value": "pass_on" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_daughter": {
      "type": "single_select_or_text",
      "question_template": "What do you want {name} to always remember?",
      "options": [
        { "label": "How proud I am", "value": "proud" },
        { "label": "A moment that made me smile", "value": "made_me_smile" },
        { "label": "Something I want to pass on", "value": "pass_on" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_grandparent": {
      "type": "single_select_or_text",
      "question_template": "What makes {name} unforgettable?",
      "options": [
        { "label": "A memory I treasure", "value": "treasured_memory" },
        { "label": "Something I've always admired", "value": "always_admired" },
        { "label": "A moment I want to preserve", "value": "preserve_moment" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "emotional_seed_other": {
      "type": "single_select_or_text",
      "question_template": "What makes {name} unforgettable?",
      "options": [
        { "label": "A memory I treasure", "value": "treasured_memory" },
        { "label": "Something I've always admired", "value": "always_admired" },
        { "label": "A moment I want to preserve", "value": "preserve_moment" }
      ],
      "allow_free_text": true,
      "next": "occasion_picker"
    },
    "occasion_picker": {
      "type": "single_select",
      "question": "Is this for something special?",
      "options": [
        { "label": "Just Because", "value": null, "is_default": true },
        { "label": "Birthday", "value": "birthday", "emoji": "🎂" },
        { "label": "Anniversary", "value": "anniversary", "emoji": "💑" },
        { "label": "Thank You", "value": "thank_you", "emoji": "🙏" },
        { "label": "Graduation", "value": "graduation", "emoji": "🎓" },
        { "label": "Wedding", "value": "wedding", "emoji": "💒" }
      ],
      "next": "payoff"
    },
    "payoff": {
      "type": "terminal",
      "action": "generate_suggestion"
    }
  }
}
```

### Node types

| Type | UI | Behavior |
|------|-----|---------|
| `multi_select` | Chip grid, multi-tap | Requires `min_selections`, Continue button |
| `single_select` | Chip grid or 2-column grid | Auto-advances on tap (300ms delay) |
| `text_input` | Text field + Continue | Auto-capitalize, min 2 chars |
| `single_select_or_text` | Chips + "Write your own" expandable | Continue on chip tap or text entry |
| `terminal` | N/A | Triggers payoff generation |

### Deferred graph nodes

Keep in the framework for Phase 2, not exposed in first-run:
- deeper gifting personality nodes
- profile-builder-specific reminder nodes
- relationship-specific inspiration prompts

### Bundled + overridable graph

- Bundled JSON for reliability
- Server override via `AppConfigResponse.onboarding.question_graph_version` + `question_graph_url`
- App checks version on launch, fetches newer graph if available, falls back to bundled

---

## Data Flow Summary

```text
Living Splash        -> product comprehension
Mirror               -> belief shift
Pain Points          -> pain_points[] (feeds reframe, marketing)
Goal Question        -> goal_intent (feeds occasion pre-select, seed weighting)
Pick One Person      -> relationship_type
Name Them            -> recipient_name
Emotional Seed       -> emotional_seed
Occasion (optional)  -> occasion
Payoff               -> suggestion + Make This Song
CTA tap              -> persist pending context -> creation flow (no auth)
```

---

## What Changes vs. Current Code

| Current | New |
|---------|-----|
| `SplashView.swift` static coral mic animation | Living splash with personal-song artifact and optional audio |
| `OnboardingView.swift` 3 static slides | Replaced by a narrow belief-shift -> first-creation flow |
| `InlineNamePromptView.swift` after onboarding | Name entry folded into onboarding |
| splash -> onboarding -> nameEntry -> auth -> main | splash -> onboarding v2 -> creation/main, auth deferred |
| broad static onboarding | adaptive first-recipient flow with a smaller graph |

---

## New Files

| File | Purpose |
|------|---------|
| `OnboardingV2View.swift` | Root container for the v1 onboarding flow |
| `LivingSplashView.swift` | Screen 1 |
| `MirrorView.swift` | Screen 2 |
| `PainPointsView.swift` | Screen 3 |
| `GoalQuestionView.swift` | Screen 4 |
| `RecipientPickerView.swift` | Screen 5 |
| `RecipientNameView.swift` | Screen 6 |
| `AdaptiveQuestionView.swift` | Screens 7-8 (seed + occasion, driven by graph) |
| `OnboardingPayoffView.swift` | Screen 9 |
| `QuestionGraphEngine.swift` | Graph interpreter with template resolution |
| `Resources/onboarding-graph.json` | Bundled v1 graph |

---

## Server Changes

| Change | Scope |
|--------|-------|
| Extend `/api/config` onboarding payload | Support splash demo metadata if needed |
| New `POST /api/onboarding/suggest` | Return title + angle + preview line |
| Deterministic fallback suggestion path | Required for resilience |
| `recipients` table or equivalent (Phase 2) | Post-first-song profile builder only |

---

## Analytics Events

Track only what helps answer onboarding drop-off and first-creation conversion.

| Event | When | Properties |
|-------|------|------------|
| `onboarding_v2_started` | Splash appears | `audio_available` |
| `onboarding_v2_splash_audio_played` | Demo audio starts | `trigger` |
| `onboarding_v2_mirror_viewed` | Mirror shown | |
| `onboarding_v2_pain_points_selected` | Pain points continued | `pain_points[]`, `count` |
| `onboarding_v2_goal_selected` | Goal chosen | `goal_intent` |
| `onboarding_v2_person_selected` | Person chosen | `relationship_type` |
| `onboarding_v2_name_entered` | Name continued | |
| `onboarding_v2_seed_selected` | Seed completed | `seed_type`, `relationship_type`, `has_occasion` |
| `onboarding_v2_suggestion_shown` | Payoff visible | `generation_time_ms`, `source` |
| `onboarding_v2_create_tapped` | CTA tapped | `relationship_type`, `occasion` |
| `onboarding_v2_skipped` | `Maybe later` tapped | `skipped_at_screen` |
| `onboarding_v2_completed` | Create tapped or explicit skip | `total_time_seconds` |

Do not overload v1 analytics with every possible psychological label.

---

## Experiment Matrix (V1)

| Experiment | Hypothesis | Metric |
|------------|-----------|--------|
| Audio-on-capable vs visual-only emphasis | Living product screen improves create rate | `create_tapped` |
| Mirror copy variant A vs B | One framing lands better without increasing drop-off | screen 2 -> screen 3 completion |
| Occasion screen included vs omitted | Occasion context may help or may slow users | create rate, completion time |
| Quick-pick vs heavier free-text seed | Quick picks reduce friction | screen 5 completion time |
| Template-only payoff vs template+LLM enhancement | richer payoff may lift CTA without hurting latency | `create_tapped`, `generation_time_ms` |

---

## Explicit Non-Goals For V1

- Full relationship graph setup
- Reminder permission strategy
- Social proof carousel
- Gifting personality quiz
- Deep retention profiling
- Notification prompt optimization

If those become necessary, they belong in profile building or later lifecycle moments.

---

## Open Questions

1. What is the exact demo song artifact on the living splash?
2. Should occasion be shown in v1 or folded into the emotional seed / payoff only?
3. Where should the `Maybe later` suggestion live in the main app so momentum is not lost?
4. When is the right post-first-song moment to introduce profile building?
5. Do we want the first shipped graph to include only 6 relationship families for simplicity, then expand later?

---

## Final Product Stance

This onboarding should not try to explain Porizo comprehensively.

It should make one outcome feel obvious:

```text
I know what this is.
I know who this is for.
The app already has a strong first idea for me.
I want to make it.
```

That is the standard for v1.

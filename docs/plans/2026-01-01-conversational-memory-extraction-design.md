# Conversational Memory Extraction Design

**Date:** 2026-01-01
**Status:** Approved
**Goal:** Replace static form with guided, conversational wizard that extracts the emotional essence of the user's message for personalized song creation.

---

## Problem Statement

The current TrackCreationView uses a static form where story context fields (memory, special phrases, what makes them special) are hidden in "Advanced Options". This approach:
- Buries the most important inputs
- Doesn't guide users to share meaningful details
- Results in generic songs that don't "rekindle a memory"

---

## Design Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Where does flow happen? | iOS app (native SwiftUI wizard) | No LLM latency, faster iteration, saves API costs |
| Question depth | 5 core + optional "Add More" | Captures breadth, offers depth without forcing |
| "Tell me more" timing | After all 5 questions | Keeps core flow fast, depth is optional |
| Screen style | Card with examples | Examples unlock creativity without being prescriptive |
| Navigation | Skip-friendly for 4 & 5 | Recipient, occasion, AND memory required - memory is the heart |
| Style selection | AI-suggested + override | Smart defaults (Anniversary→Soul), user can change |
| Lyrics review | Section-by-section with edit | Users can edit lines, regenerate sections |

---

## The Complete Flow

### Step 1: Who
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  "Who is this song for?"                                    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Sarah                                                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  e.g., "Mom", "My love", "Best friend Jake"                 │
│                                                             │
│                                              [Next →]       │
└─────────────────────────────────────────────────────────────┘
```
- **Required field** - cannot skip
- Text input with name suggestions

### Step 2: Occasion
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  "What's the occasion?"                                     │
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ 🎂      │ │ 💑      │ │ 🙏      │ │ ❤️      │           │
│  │Birthday │ │Annivers.│ │Thank You│ │I Love U │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ 💒      │ │ 🎓      │ │ 🎉      │ │ ✨      │           │
│  │ Wedding │ │Graduati.│ │Celebrat.│ │ Custom  │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│                                                             │
│                                      [← Back]  [Next →]     │
└─────────────────────────────────────────────────────────────┘
```
- Grid of occasion cards with emoji
- Tappable selection
- Defaults to Birthday

### Step 3: The Memory (Core Essence)
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  "What's the ONE memory you want this song to capture?"     │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ The night we danced in the rain in Paris              │  │
│  │                                                       │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  e.g., "The day we met at the coffee shop",                 │
│        "When you held my hand at the hospital"              │
│                                                             │
│                                      [← Back]  [Next →]     │
└─────────────────────────────────────────────────────────────┘
```
- **Required field** - THE HEART OF THE SONG
- Without this, we're just writing generic "Happy Birthday" lyrics
- Multi-line text area with emotional examples to inspire
- This is what makes the song personal and meaningful

### Step 4: Special Names
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  "Any nicknames or inside jokes?"                           │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ My sunshine, Nkem                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  e.g., "Sunshine", "My rock", "Partner in crime"            │
│                                                             │
│                              [← Back]  [Skip]  [Next →]     │
└─────────────────────────────────────────────────────────────┘
```
- Single line input
- These get woven into lyrics naturally

### Step 5: What Makes Them Special
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  "What makes Sarah special to you?"                         │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ How she always knows when I need a hug                │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  e.g., "Their laugh fills every room",                      │
│        "They never gave up on me"                           │
│                                                             │
│                              [← Back]  [Skip]  [Next →]     │
└─────────────────────────────────────────────────────────────┘
```
- Multi-line text area
- Becomes the emotional anchor line

### Step 6: Review + Create
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  "Ready to create your song?"                               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ For: Sarah                                            │  │
│  │ Occasion: Anniversary 💑                              │  │
│  │ Memory: "The night we danced in the rain in Paris"    │  │
│  │ Style: [Soul ▼]  ← tappable, AI-suggested             │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │ + Add More Details  │  │   ✨ Create My Song         │  │
│  └─────────────────────┘  └─────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
- Summary of what user entered
- Style pill is tappable to change (AI suggested based on occasion)
- "Add More Details" expands to optional follow-ups

### Optional: Add More Details (Expanded)
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Tell us more about this memory...                          │
│                                                             │
│  When was this?                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Summer 2019                                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  What made it special?                                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ We were supposed to go to dinner but got caught...    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  How did it end?                                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ We laughed and kissed under a cafe awning             │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│                                              [Done]         │
└─────────────────────────────────────────────────────────────┘
```
- Only shown if user taps "Add More Details"
- These fields provide deeper context for richer lyrics

---

## Lyrics Review Flow

### Section Display
```
┌─────────────────────────────────────────────────────────────┐
│  "Paris Rain" - Song for Sarah                              │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ CHORUS                                    [✏️ Edit] │   │
│  │                                                     │   │
│  │ Dancing in the rain, Sarah                          │   │
│  │ Every drop feels like champagne                     │   │
│  │ That Paris night still lives in me                  │   │
│  │ You're everything I'll ever need                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ VERSE 1                                   [✏️ Edit] │   │
│  │                                                     │   │
│  │ Summer evening, cobblestone streets                 │   │
│  │ We missed our dinner, but the night was sweet       │   │
│  │ The sky opened up and you just laughed              │   │
│  │ I knew right then this love would last              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ VERSE 2                                   [✏️ Edit] │   │
│  │ ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│            [🔄 Regenerate All]    [✅ Approve & Sing]       │
└─────────────────────────────────────────────────────────────┘
```

### Edit Mode
```
┌─────────────────────────────────────────────────────────────┐
│  EDITING: CHORUS                              [Cancel]      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  [Dancing in the rain, Sarah               ] ← editable     │
│  [Every drop feels like champagne          ] ← editable     │
│  [That Paris night still lives in me       ] ← editable     │
│  [You're everything I'll ever need         ] ← editable     │
│                                                             │
│        [Save Changes]    [🔄 Regenerate Section]            │
└─────────────────────────────────────────────────────────────┘
```

- **Save Changes**: Keeps user's exact edits
- **Regenerate Section**: Uses user's edits as guidance for AI to rewrite

---

## Style Suggestion Logic

```swift
let occasionStyleDefaults: [Occasion: MusicStyle] = [
    .birthday:      .pop,        // Upbeat, celebratory
    .anniversary:   .soul,       // Romantic, smooth
    .wedding:       .acoustic,   // Intimate, warm
    .thankYou:      .folk,       // Heartfelt, sincere
    .iLoveYou:      .rnb,        // Smooth, romantic
    .graduation:    .pop,        // Triumphant, upbeat
    .apology:       .acoustic,   // Vulnerable, gentle
    .encouragement: .soul,       // Uplifting, warm
    .celebration:   .afrobeats,  // High energy, joyful
    .custom:        .pop         // Safe default
]
```

- Logic lives entirely in iOS app
- Displayed as tappable pill on review screen
- User can override before creating song

---

## Data Model

### Story Context (sent to backend)

```swift
struct StoryContext {
    // Core (from wizard) - ALL REQUIRED
    let recipientName: String        // Required - Step 1
    let occasion: Occasion           // Required - Step 2
    let specificMemory: String       // Required - Step 3 (THE HEART)

    // Optional enrichment
    let specialPhrases: String?      // Step 4 - Skip OK
    let whatMakesThemSpecial: String? // Step 5 - Skip OK

    // Optional depth (from "Add More Details")
    let memoryWhen: String?          // When was this?
    let memoryWhatMadeItSpecial: String? // What made it special?
    let memoryHowItEnded: String?    // How did it end?

    // Style
    let style: MusicStyle            // AI-suggested or user-selected
}
```

### API Request

```json
POST /tracks
{
  "title": "Song for Sarah",
  "recipient_name": "Sarah",
  "occasion": "anniversary",
  "style": "soul",
  "duration_target": 60,
  "voice_mode": "user_voice",
  "message": "",
  "specific_memory": "The night we danced in the rain in Paris",
  "special_phrases": "My sunshine, Nkem",
  "what_makes_them_special": "How she always knows when I need a hug",
  "memory_when": "Summer 2019",
  "memory_context": "We were supposed to go to dinner but got caught in a storm",
  "memory_ending": "We laughed and kissed under a cafe awning"
}
```

---

## Implementation Files

| File | Changes |
|------|---------|
| `StoryWizardView.swift` | NEW - Main wizard container with step navigation |
| `WizardStepView.swift` | NEW - Reusable step template (question, input, examples) |
| `StoryReviewView.swift` | NEW - Review screen with style picker |
| `LyricsReviewView.swift` | UPDATE - Section-by-section with edit mode |
| `Models.swift` | UPDATE - Add new memory context fields |
| `APIClient.swift` | UPDATE - Include new fields in createTrack |
| `ContentView.swift` | UPDATE - Navigation to use new wizard |

### Backend Changes

| File | Changes |
|------|---------|
| `src/server.js` | Accept new memory context fields |
| `src/providers/lyrics.js` | Use memory context in songwriter prompt |
| `migrations/012_add_memory_context.sql` | Add new columns to tracks table |

---

## Success Criteria

1. Users complete the wizard in < 2 minutes
2. Generated lyrics reference the specific memory provided
3. Lyrics tell a story (narrative arc), not just repeat praise
4. Songs stay under 90 seconds
5. Users feel the song "captures" their relationship

---

## Out of Scope (Post-MVP)

- AI-generated follow-up questions (adaptive questioning)
- Voice input for memory capture
- Photo/video memory import
- Multiple memory support per song

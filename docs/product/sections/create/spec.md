# Create Section Specification

## Overview
The heart of Porizo — a streamlined 3-step wizard that guides users through creating personalized songs using AI-powered conversational questions. The wizard uses a light rose-themed design with card-based inputs and progressive disclosure.

## Important Design Decisions

### Wizard Structure: 3 Steps (NOT 5)
The wizard is intentionally consolidated to 3 steps for better UX:
1. **Basics** — Who + Occasion + Music Style (ALL on one screen)
2. **Story** — AI-powered conversational Q&A to extract emotional content
3. **Preview** — Review compiled song details and edit before creation

### Story Step: AI-Powered Conversational Q&A
The story step is the core innovation. **DO NOT use static pre-defined questions.**

How it works:
1. User enters Story step
2. AI generates first contextual question based on occasion + recipient
3. User answers in text area
4. User clicks "Done" → Answer is appended to the main "Your Song Story" area
5. AI evaluates the accumulated content and generates the NEXT relevant question
6. User sees their story building in real-time as they answer
7. Process repeats until user clicks "I'm done" or has enough content (50+ characters)

Key behaviors:
- Questions must be RELEVANT to what's been said (not generic)
- Each answer gets injected into visible story area immediately
- User can skip questions they don't want to answer
- User can click "I'm done" anytime after providing minimal content
- Loading indicator shows while AI generates next question
- Error handling with "Try Again" option if AI call fails

### "Done" Button (NOT "Add to Story")
The button to submit an answer should say **"Done"** with a checkmark icon. This conveys that the user is answering/completing the question, not just adding text.

## User Flows

### Primary Flow: Create Song (3-Step Wizard)
1. User taps Create/FAB button
2. **Step 1: Basics**
   - "Who is this song for?" — Recipient name input
   - "Occasion" — Horizontal pill selector (Birthday, Anniversary, etc.)
   - "Music Style" — Horizontal pill selector with "Random" button
   - Tap "Continue" to proceed
3. **Step 2: Story (AI-Powered)**
   - Top: "Your Song Story" card shows accumulated content with character count
   - Bottom: AI-generated question card with answer input
   - User answers → Clicks "Done" → Answer appears in story area
   - AI generates next relevant question based on context
   - User continues until satisfied or clicks "I'm done"
   - Tap "Preview Song" to proceed
4. **Step 3: Preview**
   - Song summary header with emoji, recipient, occasion, style
   - Editable story content text area
   - Optional extras: Nicknames, What makes them special
   - Tap "Create My Song" to generate

### Secondary Flow: Resume Draft
1. User taps draft from My Songs
2. Wizard opens at appropriate step
3. Continue through to completion

## UI Requirements

### Global Layout (Light Mode with Rose Accents)
- Background: subtle gray (#f9fafb)
- Card backgrounds: white with subtle border
- Text: dark gray primary, medium gray secondary
- Accent: rose-500 (#f43f5e) for buttons, active states
- Step indicator: Green checkmarks for completed steps, rose for current

### Step Tab Indicator
- Horizontal progress with numbered circles
- Completed: Green circle with checkmark
- Current: Rose circle with number
- Future: Gray circle with number
- Connecting lines between steps

### Input Cards (FormSectionCard)
- White background with rounded corners (16px)
- Subtle gray border (1px)
- Title in semibold
- Optional character count (right-aligned)
- Optional helper button ("Random" with sparkle icon)
- 16px padding

### Text Inputs (FormTextField, FormTextArea)
- White background (for contrast)
- Visible border (not just bottom line)
- Darker placeholder color (#9ca3af) for visibility
- Full width (maxWidth: .infinity)
- TextArea: Scrollable with configurable minHeight

### Pill/Chip Selectors (ChipSelector)
- Horizontal scroll
- Selected: Rose background, white text
- Unselected: Subtle gray background, dark text with border
- 18px border radius (pill shape)
- Optional refresh button for randomization

### AI Question Card States
1. **Loading**: ProgressView with "AI is thinking of the next question..."
2. **Error**: Warning icon with error message and "Try Again" button
3. **Question**: FormSectionCard with question title, text area, Done button
4. **Complete**: Success checkmark with "Story Complete!" message

### Action Buttons
- "Done" button: Rose background when enabled, gray when disabled
- Full-width at bottom of screen
- "Continue" / "Preview Song" / "Create My Song" labels by step
- Disabled until validation passes

### Validation Rules
- **Basics step**: Recipient name required (non-empty after trimming)
- **Story step**: At least 20 characters of story content
- **Preview step**: Always can proceed

## Music Styles
Pop, Acoustic, Soul, Folk, Jazz, R&B, Rock, Country, Afrobeats, Highlife, Afropop, Reggaeton, Salsa, Bossa Nova, Bachata, Latin Pop

## Occasions
Birthday, Anniversary, Thank You, I Love You, Wedding, Graduation, Celebration, Apology, Encouragement, Custom

## API Integration

### Memory Questions API
Endpoint: `POST /memory/questions`

Request:
```json
{
  "memory": "accumulated story content so far",
  "occasion": "birthday",
  "recipient_name": "Mom"
}
```

Response:
```json
{
  "questions": [
    {
      "id": "uuid",
      "question": "What's your favorite memory with Mom?",
      "placeholder": "Describe a moment that always makes you smile..."
    }
  ]
}
```

The AI backend evaluates the accumulated content and generates relevant follow-up questions. Questions should:
- Be specific to the context provided
- Not repeat questions already answered
- Guide user toward emotional content useful for lyrics
- Be conversational and warm in tone

## Configuration
- shell: false (full-screen modal experience)

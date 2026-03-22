# Unified Creation Flow — Design System v3.0

## Overview

The Unified Creation Flow (B+1) is a single-screen, chat-based experience for creating personalized songs and poems. The entire journey — from first message to hearing the finished song — happens in one continuous, scrollable thread with zero context switches.

**Design Philosophy:** The interface should feel like talking to a creative collaborator, not filling out a form. Every visual element serves the emotional arc: curiosity → sharing → building → anticipation → delight.

**Design Language:** Velvet & Gold — dark surfaces with warm gold accents, layered depth via surface hierarchy, and SF Pro + Playfair Display typography.

---

## 1. Color Palette

All colors reference `DesignTokens` — never use raw hex values.

### Backgrounds (darkest → lightest)

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#0A0A0A` | Screen background, bottom bar, safe areas |
| `surface` | `#161616` | Cards, chat bubbles (AI), input containers, action buttons |
| `surfaceMuted` | `#1A1A1A` | Subtle card variants |
| `surfaceElevated` | `#1E1E1E` | Elevated cards (Song Player) for depth separation |

### Text Hierarchy

| Token | Hex | Usage |
|-------|-----|-------|
| `textPrimary` | `#F5F5F0` | Headings, user content, active labels, lyrics |
| `textSecondary` | `#8A8A8A` | AI text, inactive labels, metadata |
| `textTertiary` | `#666666` | Timestamps, char counts, placeholders, disabled states |

### Accents

| Token | Hex | Usage |
|-------|-----|-------|
| `gold` | `#D4A574` | Primary accent: user bubbles, CTAs, active selections, icons, progress |
| `goldDark` | `#8B7355` | Gradient endpoints, pressed states |
| `gold.opacity(0.1)` | — | Mood pill backgrounds, tab highlight |
| `gold.opacity(0.12)` | — | Badge backgrounds (8/8 counter) |
| `gold.opacity(0.15)` | — | Card strokes (universal), primary chip backgrounds |
| `gold.opacity(0.2)` | — | Gold accent lines (input bar divider) |
| `gold.opacity(0.25)` | — | Phase divider lines |
| `gold.opacity(0.3)` | — | AI message left accent bar |

### Status Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `success` | `#7DD3A6` | Completed progress bars, checkmarks, "Song Created!" |
| `success.opacity(0.7)` | — | Checkmark icons in strength card |
| `border` | `#2A2A2A` | Card strokes, dividers, input field borders |
| `border.opacity(0.5)` | — | Internal dividers within cards |

---

## 2. Typography

All fonts reference `DesignTokens.bodyFont()` or `DesignTokens.displayFont()`.

### Scale Used in Creation Flow

| Element | Call | Size | Weight |
|---------|------|------|--------|
| Screen title | `bodyFont(size: 16, weight: .semibold)` | 16pt | Semibold |
| Card title (Story Elements) | `bodyFont(size: 16, weight: .bold)` | 16pt | Bold |
| Completion % | `bodyFont(size: 16, weight: .semibold)` | 16pt | Semibold |
| Chat text (user + AI) | `bodyFont(size: 15)` | 15pt | Regular |
| Render step (active) | `bodyFont(size: 15, weight: .bold)` | 15pt | Bold |
| Card labels | `bodyFont(size: 14, weight: .semibold)` | 14pt | Semibold |
| Body text (narrative) | `bodyFont(size: 14)` | 14pt | Regular |
| Lyrics lines | `bodyFont(size: 14)` | 14pt | Regular |
| Style pill text | `bodyFont(size: 13, weight: .medium)` | 13pt | Medium |
| Quick reply chip text | `bodyFont(size: 13, weight: .medium)` | 13pt | Medium |
| Beat label (strength) | `bodyFont(size: 13)` | 13pt | Regular |
| Tab label | `bodyFont(size: 12, weight: .semibold)` | 12pt | Semibold |
| Element value | `bodyFont(size: 12, weight: .medium)` | 12pt | Medium |
| Char count | `bodyFont(size: 12)` | 12pt | Regular |
| Badge text (8/8) | `bodyFont(size: 12, weight: .semibold)` | 12pt | Semibold |
| Element label | `bodyFont(size: 11)` | 11pt | Regular |
| Mood pill text | `bodyFont(size: 11, weight: .medium)` | 11pt | Medium |
| Section header (lyrics) | `bodyFont(size: 10, weight: .bold)` | 10pt | Bold |
| Phase divider label | `bodyFont(size: 10, weight: .bold)` | 10pt | Bold |
| Timestamp | `bodyFont(size: 10)` | 10pt | Regular |
| Tab icon | `.system(size: 11)` | 11pt | — |

### Letter Spacing

| Element | Tracking |
|---------|----------|
| Section headers (VERSE 1, CHORUS) | `1` |
| Phase divider labels (READY) | `1.5` |

### Line Spacing

| Element | Value |
|---------|-------|
| AI chat messages | `3` |
| User chat messages | `2` |
| Narrative summary | `4` |
| Lyrics lines | `2` |

---

## 3. Spacing System

All spacing uses `DesignTokens.spacing*` tokens.

### Layout Spacing

| Context | Value | Token |
|---------|-------|-------|
| Screen horizontal padding | 16px | `spacing16` |
| Story card horizontal padding | 16px | `spacing16` |
| Card internal padding | 14-16px | `spacing16` |
| Element row horizontal padding | 14px | — |
| Element row vertical padding | 7px | — |
| Strength row vertical padding | 6px | — |
| Chat message horizontal padding | 14px | — |
| Chat message vertical padding | 10px | — |
| Section spacing between phases | 8px top padding | `spacing8` |
| Chat message gap | 12px | `spacing12` |
| Story card top margin | 4px | `spacing4` |
| Story card bottom margin | 8px | `spacing8` |

### Component Internal Spacing

| Component | Element | Value |
|-----------|---------|-------|
| Header | Vertical padding | 10px |
| Tab bar | Vertical padding per tab | 10px |
| Mood pill | Horizontal padding | 10px |
| Mood pill | Vertical padding | 5px |
| Quick reply chip | Horizontal padding | 14px |
| Quick reply chip | Vertical padding | 8px |
| Style pill (collapsed) | Horizontal padding | 14px |
| Style pill (collapsed) | Vertical padding | 8px |
| Style grid tile | Vertical padding | 16px |
| Input bar text field | Horizontal padding | 16px |
| Input bar text field | Vertical padding | 14px |
| Input bar controls row | Vertical padding | 10px |

---

## 4. Corner Radii

| Token | Value | Usage |
|-------|-------|-------|
| `radiusMedium` | 12px | Content cards (story card, confirmation, lyrics, revised chorus) |
| `radiusCTA` | 14px | Input bar text field container, standalone CTA buttons |
| `radiusLarge` | 16px | Song Player card |
| `radiusPremium` / 20px | 20px | Sheet-style cards (rendering, player wrapper) |
| Capsule | auto | Pills, badges, chips, style pills, mood pills |
| Circle | auto | Close buttons, mic button (with 10px radius square bg), progress dots |
| 18px | — | Chat bubbles |
| 10px | — | Mic button rounded square, action buttons, story summary pill |
| 3px | — | Progress bar track/fill corner radius |

---

## 5. Component Specifications

### 5.1 Header Bar

```
HStack {
    Title: "Song for Sarah" (bodyFont 16 semibold, textPrimary)
    Spacer
    Badge: sparkle icon (9pt) + "8/8" (bodyFont 12 semibold)
        - gold text, gold.opacity(0.12) capsule bg
        - padding: horizontal 10, vertical 4
    Close: xmark (13pt semibold, textSecondary)
        - 30x30 circle, surface bg
}
Padding: horizontal 16, vertical 10
```

### 5.2 Tabbed Story Card

```
Container: surface bg, radiusMedium, gold.opacity(0.15) stroke 0.5pt

Tab Bar (HStack, spacing 0):
    Per tab:
        - Icon (11pt): doc.text.fill (elements) / chart.bar.fill (strength)
        - Label (bodyFont 12 semibold)
        - Selected: textPrimary + gold.opacity(0.1) bg
        - Unselected: textTertiary + clear bg
        - Full width, 10px vertical padding
    Collapse chevron:
        - chevron.up/down (11pt semibold, textTertiary)
        - 40px width, 10px vertical padding

Divider: border.opacity(0.5) — only when expanded

Elements Tab Content:
    Per row (ForEach with enumerated):
        - Icon (11pt, gold, 20px width frame)
        - Label (bodyFont 11, textTertiary, 65px width)
        - Value (bodyFont 12 medium, textPrimary, lineLimit 1)
        - Divider between rows: border.opacity(0.5), leading 38px indent
        - Row padding: horizontal 14, vertical 7

Strength Tab Content:
    Per beat:
        - Status dot: 7x7 Circle (gold if active, success if complete)
        - Label: bodyFont 13 (bold if active, regular otherwise)
            - Active: textPrimary
            - Complete: textSecondary
        - Checkmark: checkmark.circle.fill (16pt, success.opacity(0.7))
        - Progress bar: 4px height, 3px corner radius
            - Track: beatColor.opacity(0.2)
            - Fill: beatColor * progress width
            - Gold if active, success if complete
        - Row padding: vertical 6
    Container padding: horizontal 14, vertical 8
```

### 5.3 Chat Bubbles

```
User Message (right-aligned):
    - Spacer(minLength: 60) on left
    - Text: bodyFont 15, .black color, lineSpacing 2
    - Padding: horizontal 14, vertical 10
    - Background: gold (solid)
    - Shape: RoundedRectangle(cornerRadius: 18)
    - Timestamp below: bodyFont 10, textTertiary, horizontal 4 padding

AI Message (left-aligned):
    - HStack(alignment: .top, spacing: 10):
        - Left accent bar: Rectangle, gold.opacity(0.3), 2px width, Capsule shape
        - Text: bodyFont 15, textPrimary, lineSpacing 3
    - Spacer(minLength: 50) on right
    - Timestamp below: bodyFont 10, textTertiary
```

### 5.4 Phase Divider (e.g., "READY")

```
HStack(spacing: 10):
    - Left line: Rectangle, gold.opacity(0.25), 0.5px height
    - Icon: checkmark.seal.fill (14pt, gold)
    - Label: bodyFont 10 bold, gold.opacity(0.7), tracking 1.5, uppercase
    - Right line: Rectangle, gold.opacity(0.25), 0.5px height
```

### 5.5 Confirmation Card

```
Container: surface bg, radiusMedium, gold.opacity(0.15) stroke 0.5pt, padding 16

Content (VStack, spacing 12):
    - Title: "Sarah's Story" (bodyFont 14 semibold, gold)
    - Narrative: bodyFont 14, textPrimary, lineSpacing 4
    - Mood pills row (HStack, spacing 12):
        Per pill:
            - Icon (9pt) + Text (bodyFont 11 medium)
            - gold color
            - gold.opacity(0.1) capsule bg
            - padding: horizontal 10, vertical 5
```

### 5.6 Lyrics Card

```
Container: surface bg, radiusMedium, gold.opacity(0.15) stroke 0.5pt, padding 16

Header (HStack):
    - music.note.list icon (14pt, gold)
    - "Generated Lyrics" (bodyFont 14 semibold, gold)
    - Spacer
    - Style badge: text (bodyFont 11, textTertiary)
        - border.opacity(0.5) capsule bg
        - padding: horizontal 8, vertical 3

Per section (VStack, spacing 4):
    - Section type label: bodyFont 10 bold, textTertiary, tracking 1, uppercase
    - Lines: bodyFont 14, textPrimary, lineSpacing 2
```

### 5.7 Revised Chorus Card

```
Container: surface bg, radiusMedium (12), gold.opacity(0.2) stroke 0.5pt, padding 14
Left-aligned: .trailing padding 50

Header (HStack):
    - arrow.triangle.2.circlepath icon (11pt, gold)
    - "CHORUS — REVISED" (bodyFont 10 bold, gold, tracking 1)

Lines: bodyFont 14, textPrimary, spacing 3
```

### 5.8 Quick Reply Chips

```
ScrollView(.horizontal, showsIndicators: false)
HStack(spacing: 8)

Per chip:
    - Text: bodyFont 13 medium
    - Padding: horizontal 14, vertical 8
    - Capsule shape

    Primary (e.g., "Love it"):
        - Background: gold.opacity(0.15)
        - Text color: gold
        - Stroke: gold.opacity(0.3), 0.5pt

    Secondary:
        - Background: surface
        - Text color: textSecondary
        - Stroke: border, 0.5pt
```

### 5.9 Rendering Card (Sheet-Style)

```
Container: surface bg, 20px corner radius, border stroke 0.5pt

Sheet handle:
    - RoundedRectangle: textTertiary, 36x4, cornerRadius 2
    - Padding: top 12, bottom 20

Waveform (HStack, spacing 3):
    - 20 bars, each 4px wide, deterministic heights:
      [12, 24, 8, 30, 16, 28, 10, 32, 14, 26, 18, 22, 8, 30, 12, 28, 20, 14, 24, 10]
    - Color: gold.opacity(0.8) for every 3rd bar, gold.opacity(0.3) otherwise
    - Frame height: 36
    - Bottom padding: 20

Progress Card (RenderingProgressCard):
    - Container: surface bg, radiusCTA (14), gold.opacity(0.15) stroke
    - Header HStack: waveform icon (14pt gold) + title (bodyFont 14 medium) + % (bodyFont 13 semibold gold)
    - Progress bar: 6px height, 4px corner radius
        - Track: gold.opacity(0.15)
        - Fill: gold, width = container * progress
    - Status text: bodyFont 12, textTertiary
    - Padding: 16

Step Checklist (VStack, spacing 14):
    Per step (HStack, spacing 10):
        - Icon (18pt):
            - Done: checkmark.circle.fill, success
            - Active: circle.dotted, gold
            - Pending: circle, textTertiary
        - Text (bodyFont 15):
            - Done: regular, textSecondary
            - Active: bold, textPrimary
            - Pending: regular, textTertiary
    Container padding: horizontal 24, bottom 24
```

### 5.10 Song Player Card (Sheet-Style)

```
Outer Container: surface bg, 20px corner radius, border stroke 0.5pt

Sheet handle: same as rendering card

Success Badge (HStack, spacing 8):
    - checkmark.seal.fill (18pt, success)
    - "Song Created!" (bodyFont 16 semibold, textPrimary)
    - Bottom padding: 16

Player Card (SongPlayerCard):
    Container: surfaceElevated bg, radiusLarge (16), gold.opacity(0.15) stroke, padding 16

    Album Art:
        - RoundedRectangle, radiusCTA (14), height 160
        - LinearGradient: gold.opacity(0.4) → goldDark.opacity(0.2), topLeading → bottomTrailing
        - Centered: music.note (36pt gold) + title (bodyFont 16 semibold) + style/duration (bodyFont 12 textSecondary)

    Playback Scrubber:
        - Track: border, 3px height, 2px radius
        - Fill: gold, width = container * progress, 3px height
        - Knob: gold Circle, 10x10
        - Time labels: bodyFont 10, textTertiary

    Transport Controls (HStack, spacing 24, centered):
        - backward.fill (20pt, textSecondary)
        - pause.circle.fill (48pt, gold)
        - forward.fill (20pt, textSecondary)

    Action Buttons (HStack, spacing 12):
        Per button:
            - Icon (16pt) + Label (bodyFont 11)
            - textSecondary color
            - surface bg, radiusMedium (10), border stroke 0.5pt
            - Full width (maxWidth: .infinity)
            - Vertical padding: 10

View Lyrics Button:
    - music.note.list icon (12pt) + "View Lyrics" text (bodyFont 13 medium)
    - textSecondary, surface bg, Capsule, border stroke 0.5pt
    - Padding: horizontal 16, vertical 8
    - Top padding: 12, bottom padding: 16
```

### 5.11 Collapsible Style Picker

```
Collapsed State (HStack, spacing 8):
    Toggle Button:
        - chevron.up/down (10pt bold, textTertiary)
        - 28x28 Circle, surface bg, border stroke 0.5pt

    Style Pills (ScrollView .horizontal):
        Per pill:
            - Text: bodyFont 13 medium
            - Padding: horizontal 14, vertical 8
            - Selected: gold bg, .black text, no stroke
            - Unselected: surface bg, textSecondary, border stroke 0.5pt
            - Capsule shape

    Create Button:
        - sparkles icon (12pt) + "Create" (bodyFont 14 semibold)
        - .black text, gold bg, Capsule
        - Padding: horizontal 18, vertical 10

Expanded State (LazyVGrid, 3 columns, spacing 8):
    Per tile:
        - Icon (20pt): gold (unselected) / .black (selected)
        - Label (bodyFont 12 medium): textPrimary / .black
        - Vertical padding: 16, full width
        - Selected: gold bg
        - Unselected: surface bg, border stroke 0.5pt
        - radiusMedium (12)

    Style Icons:
        - Acoustic: guitars.fill
        - Soul: heart.fill
        - Pop: star.fill
        - R&B: waveform
        - Folk: leaf.fill
        - Ballad: moon.fill

Animation: .easeInOut(duration: 0.25) on expand/collapse
           .easeInOut(duration: 0.15) on selection
```

### 5.12 Story Input Bar

```
Two separate areas with gold accent line between them.

Area 1 — Text Field Container:
    - TextField: "Share your thoughts...", axis: .vertical, lineLimit 1...6
    - Font: bodyFont 15, textPrimary
    - Container: surface bg, radiusCTA (14), border stroke 0.5pt
    - Padding: horizontal 16, vertical 14

Gold Accent Line:
    - Rectangle: gold.opacity(0.2), 0.5px height
    - Horizontal padding: 4

Area 2 — Controls Row (HStack, spacing 12):
    Char Counter:
        - "\(count)/6,000" formatted with NumberFormatter (.decimal)
        - Font: bodyFont 12, textTertiary

    Mic Button:
        - mic.fill icon (16pt, gold)
        - 36x36 frame
        - surface bg, RoundedRectangle cornerRadius 10, border stroke 0.5pt

    Send Button:
        - arrow.up.circle.fill (32pt)
        - Empty: textTertiary
        - Has text: gold
        - Disabled when empty

Overall container:
    - Padding: horizontal 16, vertical 10
    - Background: background
```

---

## 6. Layout Architecture

### Screen Structure (top to bottom, fixed)

```
VStack(spacing: 0) {
    1. Header Bar                    [FIXED at top]
    2. Tabbed Story Card             [FIXED, collapsible]
    3. ScrollView {                  [SCROLLABLE - main content]
        a. Chat messages (8 turns)
        b. Phase divider ("READY")
        c. Confirmation card
        d. Lyrics card
        e. Quick reply chips
        f. Revision exchange (user + AI + revised card)
        g. Rendering card (sheet-style)
        h. Player card (sheet-style)
    }
    4. Collapsible Style Picker      [FIXED at bottom]
    5. Story Input Bar               [FIXED at bottom]
}
```

### Key Layout Rules

1. **Scroll content** uses `VStack(spacing: 12)` with `padding(.horizontal, 16)`
2. **Phase transitions** (confirmation, lyrics, rendering, player) have `padding(.top, 8)`
3. **Sheet-style cards** (rendering, player) use 20px radius + sheet handle to visually elevate
4. **AI messages** are left-aligned with Spacer(minLength: 50) on right
5. **User messages** are right-aligned with Spacer(minLength: 60) on left
6. **Revised chorus card** has `.trailing` padding of 50 (left-aligned, narrower)
7. **Quick reply chips** scroll horizontally with no indicators

---

## 7. Interaction Patterns

### Animations

| Interaction | Animation |
|-------------|-----------|
| Tab selection | `.easeInOut(duration: 0.2)` |
| Card collapse/expand | `.easeInOut(duration: 0.25)` |
| Style selection | `.easeInOut(duration: 0.15)` |
| Style picker expand/collapse | `.easeInOut(duration: 0.25)` |

### State Management

| State | Type | Default | Purpose |
|-------|------|---------|---------|
| `inputText` | String | `""` | Text input field content |
| `isCardExpanded` | Bool | `true` | Story card expand/collapse |
| `selectedCardTab` | Enum | `.elements` | Which tab is active |
| `selectedStyle` | String? | `"Acoustic"` | Selected music style |

### Collapsible Behaviors

1. **Story Card**: Tapping a tab auto-expands if collapsed. Chevron toggles.
2. **Style Picker**: Chevron toggles between pill row and icon grid. Selecting a style in either mode works.
3. **Input Bar**: Text field expands vertically (1-6 lines). Send button activates when text is non-empty.

---

## 8. Data Models

### Story Elements (Key-Value Tab)

8 elements, each with: SF Symbol icon, label (short), value (extracted text)

| Icon | Label | Example Value |
|------|-------|---------------|
| person.fill | For | Sarah |
| gift.fill | Occasion | 30th Birthday |
| mountain.2.fill | Memory | Hiking Mt. Tamalpais |
| cloud.fog.fill | Image | Fog over Golden Gate at sunset |
| face.smiling.fill | Personality | Terrible puns, everyone laughs |
| heart.fill | Bond | Best friend, 10 years, 3 AM calls |
| quote.opening | Key Line | I don't know what I'd do without her |
| arrow.up.right | Arc | Gratitude -> adventure -> forever |

### Story Strength (Progress Tab)

5 beats, each with: label, progress (0.0-1.0), isComplete, isActive

| Beat | Progress | State |
|------|----------|-------|
| The Setting | 1.0 | Complete |
| The Feeling | 0.45 | Active (in-progress) |
| Your Bond | 1.0 | Complete |
| The Moment | 1.0 | Complete |
| The Details | 1.0 | Complete |

### Lyrics Structure

4 sections: Verse 1, Chorus, Verse 2, Bridge. Each has 4 lines.

### Rendering Steps

5 steps: Lyrics finalized, Melody composed, Acoustic arrangement, Vocal synthesis, Final mix & master.

---

## 9. Visual Hierarchy Rules

1. **Gold = user action/accent.** User bubbles, CTAs, active states, progress fills, icons.
2. **Surface = container.** Cards, AI bubbles, input fields, inactive buttons.
3. **SurfaceElevated = depth.** Only for the Song Player card to separate it from the surface parent.
4. **Success green = completion.** Progress bars (done), checkmarks, "Song Created!" badge.
5. **Text hierarchy is strict:** Primary for content, Secondary for AI/metadata, Tertiary for timestamps/counts.
6. **Stroke is universal 0.5pt** at `gold.opacity(0.15)` for gold-accented cards, `border` for neutral cards.
7. **Sheet handles** (36x4 RoundedRectangle, textTertiary) signal "this is an elevated inline card."
8. **No shadows anywhere.** Depth is created through background color layering, not shadows.

---

## 10. Files Reference

| File | Component | Shared? |
|------|-----------|---------|
| `UnifiedCreationFlowView.swift` | Main unified view | No |
| `StoryInputBar.swift` | Two-area input bar | Yes |
| `StoryElementsCard.swift` | Progress bars card | Yes |
| `CollapsibleStylePicker.swift` | Pill/grid style picker | Yes |
| `PostCreate/SharedPostCreateCards.swift` | RenderingProgressCard + SongPlayerCard | Yes |
| `PostCreate/MockLyricsData.swift` | Mock lyrics data model | Yes |
| `CreationFlowPickerView.swift` | Dev menu picker | Debug only |

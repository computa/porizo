# Explore Section Specification

## Overview

The Explore tab is the home screen of the app, providing quick access to creation flows and discovery features. It uses the Velvet & Gold design system with a dark theme (#0A0A0A background) and gold (#D4A574) accents.

## User Flows

### Primary Flow: Create Content
1. User views Explore tab (default home)
2. Taps "Express yourself, for them" button
3. Type selection screen appears ("What would you like to create?")
4. User chooses "Personalized Song" or "Custom Poem"
5. Flows to appropriate creation flow

### Secondary Flow: Quick Occasion Selection
1. User scrolls to "Popular Occasions" section
2. Taps an occasion chip (Birthday, Anniversary, Thank You, etc.)
3. Goes directly to Create flow with that occasion pre-selected

### Secondary Flow: Browse Featured Content
1. User views Featured Card (promotional content)
2. User views Stats Row (engagement metrics placeholder)
3. Horizontal scroll through occasion chips

## UI Layout

### Screen Structure (Top to Bottom)
1. **Status Bar** - iOS system status
2. **Header** - "Explore" title (Playfair Display, gold), Search + Bell icons
3. **Feature Banner** - Dismissible "Introducing Remixing" banner (optional)
4. **Featured Card** - 140px tall, gradient background with waveform visualization
5. **Stats Row** - 80px tall, engagement metrics (plays, likes, comments)
6. **Create Button** - Full-width gold button "Express yourself, for them"
7. **Popular Occasions** - Horizontal scroll chips with emojis
8. **Tab Bar** - 4-tab navigation (Home, Songs, Poems, Profile)

### Create Button (Key Component)
- **Text**: "Express yourself, for them"
- **Icon**: Sparkles (SF Symbol: "sparkles")
- **Style**: Full-width, gold gradient background (#D4A574)
- **Font**: Inter 16pt semibold, #0A0A0A (dark text on gold)
- **Height**: 56px with 16px vertical padding
- **Corner Radius**: 14px
- **Action**: Opens type selection screen (song or poem)

### Design Tokens
- Background: #0A0A0A (deep velvet black)
- Surface: #161616 (cards, chips)
- Gold: #D4A574 (accents, buttons)
- Text Primary: #F5F5F0
- Text Secondary: #8A8A8A
- Text Tertiary: #666666
- Border Subtle: #1A1A1A

### Popular Occasions Chips
- Horizontal scroll with 8px gap
- Each chip: emoji + text, 14pt Inter medium
- Unselected: #161616 background, 1px #1A1A1A border, 22px corner radius
- Height: 38px, padding: 14px horizontal, 10px vertical
- Available occasions: Birthday, Anniversary, Thank You, I Love You, Wedding, Graduation, Celebration, Apology, Encouragement, Custom

## Configuration
- shell: true (displays inside tab bar navigation)
- Tab index: 0 (Home tab)

## Change History

### 2026-01-29: Single Create Button
- **Changed**: Replaced two separate buttons ("New Song", "New Poem") with single "Express yourself, for them" button
- **Reason**: Both buttons led to the same type selection screen - redundant UX
- **New flow**: Create button → Type Selection → Setup → Story
